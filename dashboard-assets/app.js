// This file is a classic script, not a module: index.html loads it with
// `defer`. name-fold.js and page-notice.js are loaded (deferred) ahead of it in
// the same way team-directory.js is, and publish themselves on globalThis.
//
// name-fold.js carries the site's one name-folding rule — the rule
// `src/name_search.py` runs in Python and in SQL. This page's search is
// answered by the server, or on the published tree by the shim, and both fold
// with it. page-notice.js turns a browser's own "Failed to fetch" into a
// sentence a reader can act on, and leaves a message this site wrote alone.
const { readableError } = globalThis.ValueContributedPageNotice;
const RANKING_HEADSHOT_FALLBACK = new URL("./assets/player-silhouette.svg?v=plain-20260923", document.currentScript.src).href;

const DEFAULT_RANKING_LIMIT = "25";

const state = {
  controller: null,
  trendController: null,
  liftController: null,
  topGamesController: null,
  seasonWinsController: null,
  highValueRecordsController: null,
  contextController: null,
  searchTimer: null,
  sortBy: "wins_contributed",
  sortDirection: "desc",
  highValueSortBy: "games_played",
  highValueSortDirection: "desc",
  trendPayload: null,
  activeTrendPlayer: null,
  liftPayload: null,
  activeLiftPlayer: null,
  expandedChartPanel: null,
  expandedChartTrigger: null,
  selectedContextPlayerId: null,
  selectedContextPlayerName: null,
  contextPage: 1,
  contextTrigger: null,
  rankingsRunId: null,
  rankingsEngineVersion: null,
  v8RunId: null,
  officialRunIds: {},
  rankingsPayload: null,
  rankingsScopeSignature: null,
  rankingCardRequestToken: null,
  experimentClient: null,
  localExperimentCatalog: [],
  serverExperimentCatalog: [],
  serverExperimentRankingCache: new Map(),
  experimentCatalog: null,
  experimentManifest: null,
  experimentReview: null,
  experimentStarting: false,
  activeExperimentId: null,
  experimentRunProgress: null,
  runtimeModule: null,
  rankingCardModule: null,
  multiSeasonModule: null,
  rankingsVisualModule: null,
  rankingsVisualWorkspace: null,
  storageModule: null,
  rankingCardArtifact: null,
  advancedRefreshRevision: 0,
  advancedRefreshPromise: Promise.resolve(null),
  requestedStatVersion: null,
  dashboardReady: false,
  deferredPanels: {
    seasonWins: false,
    topGames: false,
    highValueRecords: false,
    trends: false,
    lift: false,
  },
  deferredPanelLoads: new Map(),
  deferredPanelQueue: Promise.resolve(),
  deferredPanelGeneration: 0,
  deferredPanelsReady: false,
  seasonValues: [],
  allowedSeasonValues: null,
  // Server statistic id -> the season end years it has calculated.
  sourceSeasonEndYears: {},
  // Server statistic id -> its own one-paragraph description, when it has one.
  sourceDescriptions: {},
  // The server statistics this page may show (the default alone with the
  // switch off); null until /api/sources has answered.
  offeredSources: null,
  selectedSeasons: [],
  seasonScopeAll: true,
};

const OFFICIAL_RANKINGS = Object.freeze([
  { value: "v13", label: "V13" },
  { value: "v12", label: "V12" },
  { value: "v11", label: "V11" },
  { value: "v10", label: "V10" },
  { value: "original", label: "V9" },
]);
const OFFICIAL_RANKING_SLUGS = new Set(
  OFFICIAL_RANKINGS.map((ranking) => ranking.value),
);
// /api/sources names the V9 baseline `v9`; this page has always called that
// slug `original`. Every other official ranking uses the same name in both.
const SOURCE_ID_FOR_RANKING = Object.freeze({ original: "v9" });
const RANKING_FOR_SOURCE_ID = Object.freeze({ v9: "original" });
const GARBAGE_TIME_MODES = Object.freeze([
  Object.freeze({ value: "competitive", label: "Exclude garbage time" }),
  Object.freeze({ value: "all_minutes", label: "Include garbage time" }),
]);
// Versions whose panels are served by their own /api/<version> endpoints.
const SERVER_STAT_VERSIONS = new Set(["v10", "v11", "v12", "v13"]);
// V12 is answered by V11's own routes under /api/v12, in V11's shapes, so
// every panel that asks V11's API a question asks V12's the same way. What
// V12 lacks (types, descriptions, the context breakdown) its answers say.
// V13 is answered the same way under /api/v13.
const V11_SHAPED_STAT_VERSIONS = new Set(["v11", "v12", "v13"]);
// team-directory.js is loaded (deferred) ahead of this script and turns a
// numeric NBA team id into the three-letter abbreviation shown on screen.
const TEAM_DIRECTORY = window.ValueContributedTeamDirectory ?? null;
const UNKNOWN_TEAM_LABEL = TEAM_DIRECTORY?.UNKNOWN_TEAM ?? "—";

function teamRecord(teamId, overrides = {}) {
  if (TEAM_DIRECTORY) return TEAM_DIRECTORY.teamRecord(teamId, overrides);
  const id = Number.isFinite(Number(teamId)) ? Number(teamId) : null;
  return {
    id,
    team_id: id,
    abbreviation: UNKNOWN_TEAM_LABEL,
    name: UNKNOWN_TEAM_LABEL,
    team_name: UNKNOWN_TEAM_LABEL,
  };
}

function teamRecords(teamIds = [], abbreviations = []) {
  return (teamIds ?? []).map((teamId, index) => teamRecord(teamId, {
    abbreviation: (abbreviations ?? [])[index] ?? null,
  }));
}
const ORIGINAL_ENGINE_VERSION = "value-contributed-original-browser-engine-v1-2026-08-30";
const ORIGINAL_CONFIG_SCHEMA = "value-contributed-original-experiment-config-v1";

// --- the experiments switch ---------------------------------------------------
//
// One site-wide switch, off unless the page says otherwise, so that what the
// owner sees locally is what is published.  The server stamps
// `<meta name="vc-experiments">` when VALUE_CONTRIBUTED_EXPERIMENTS is set, and
// `scripts/build_v11_site.py --with-experiments` stamps the same tag into the
// built tree.  Reading a meta tag rather than an endpoint is deliberate: it is
// known before the first fetch, so nothing experimental can start and then be
// told to stop.

/** Whether a `vc-experiments` meta content means "on".  Anything else is off. */
function experimentsEnabled(metaContent) {
  return String(metaContent ?? "").trim().toLowerCase() === "on";
}

/** The switch this page was served with. */
function experimentsSwitchedOn(doc = typeof document === "undefined" ? null : document) {
  return experimentsEnabled(
    doc?.querySelector('meta[name="vc-experiments"]')?.content,
  );
}

const EXPERIMENTS_ON = experimentsSwitchedOn();
const OUTCOME_GROUPS = Object.freeze([
  {
    key: "field-goals",
    label: "Assisted and self-created field goals",
    description: "Scorer, assister, OREB-pool, screen, and derived-remainder roles with and without an OREB.",
  },
  {
    key: "free-throws",
    label: "Free throws and retained-possession fouls",
    description: "Ordinary and assisted free throws, retained-possession outcomes, shooters, drawers, and OREB pools.",
  },
  {
    key: "missed-shots",
    label: "Missed shots",
    description: "Separate penalties for missed two-pointers and missed three-pointers.",
  },
  {
    key: "turnovers",
    label: "Turnovers",
    description: "Identified-player turnovers and team-coded turnovers shared across the five players on the floor.",
  },
  {
    key: "offensive-shortfalls",
    label: "Offensive shortfalls",
    description: "Penalties when a free-throw or retained-possession sequence produces less value than the policy expected.",
  },
  {
    key: "blocks-steals",
    label: "Blocks and steals",
    description: "Direct value for an identified block or named steal.",
  },
  {
    key: "defended-field-goals",
    label: "Defended field goals",
    description: "Location-aware credit for defended makes and misses. Open this section to compare every shot area in two columns.",
  },
  {
    key: "pressure-defense",
    label: "Pressure defense",
    description: "Shared defensive credit when pressure is identified at the team or lineup level.",
  },
  {
    key: "rebounds-boxouts",
    label: "Defensive rebounds and boxouts",
    description: "Contested and uncontested defensive rebounds plus offensive and defensive boxout helpers.",
  },
  {
    key: "screens-helpers",
    label: "Screens and helper allocations",
    description: "Complete screen outcomes and their scorer, assister, OREB, helper, and remainder roles.",
  },
  {
    key: "fouls-violations",
    label: "Fouls, violations, and administration",
    description: "Foul-draw credit plus ordinary, retained, technical, lane, three-seconds, and administrative foul values.",
  },
]);
const CONTRACT_RAW_GROUPS = Object.freeze([
  "scoring",
  "playmaking",
  "offensive_rebounding",
  "negative_offense",
  "defense",
  "helpers_hustle",
]);
const VIRTUAL_RAW_GROUP_FIELDS = Object.freeze({
  defensive_rebounding: Object.freeze([
    "v6.blocks_and_turnovers.defensive_rebound.contested_action_coefficient",
    "v6.blocks_and_turnovers.defensive_rebound.uncontested_action_coefficient",
  ]),
  missed_shots: Object.freeze([
    "v7.negative_actions.missed_three_coefficient",
    "v7.negative_actions.missed_two_coefficient",
  ]),
  turnovers: Object.freeze([
    "v7.negative_actions.turnover_accountability_coefficient",
  ]),
  offensive_shortfalls: Object.freeze([
    "v7.negative_actions.regular_ft_shortfall_coefficient",
    "v6.retained_fouls.oreb_completion.shortfall_shooter_coefficient",
  ]),
  fouls_administration: Object.freeze([
    "v6.retained_fouls.fouled_player_share.away_from_play",
    "lab.virtual.retained_fouls.identified_fouler_penalty_coefficient",
    "v6.fouls_and_violations.administrative_bonus_shooter_coefficient",
    "v6.fouls_and_violations.defensive_lane_replacement_shooter_coefficient",
    "v6.fouls_and_violations.offensive_lane_lost_point_violator_coefficient",
    "v6.fouls_and_violations.defensive_lane_identified_violator_coefficient",
    "v6.fouls_and_violations.defensive_three_seconds_identified_violator_coefficient",
    "v6.fouls_and_violations.ordinary_identified_fouler_coefficient",
    "v6.fouls_and_violations.technical_identified_offender_coefficient",
  ]),
});
const VIRTUAL_RAW_FIELD_GROUP = new Map(
  Object.entries(VIRTUAL_RAW_GROUP_FIELDS).flatMap(([group, keys]) =>
    keys.map((key) => [key, group])),
);

// The three context columns sort by their share of the selected total.
const contextSorts = new Set([
  "side_context_raw_pct",
  "offense_context_pct",
  "defense_context_pct",
]);
// Links written before the context sides sorted by share still work.
const LEGACY_CONTEXT_SORTS = Object.freeze({
  offense_context_value: "offense_context_pct",
  defense_context_value: "defense_context_pct",
});
const responsibilitySorts = new Set([
  "offense_value",
  "defense_value",
]);

const elements = {
  statVersion: document.querySelector("#stat-version"),
  season: document.querySelector("#season"),
  seasonPicker: document.querySelector("#season-picker"),
  seasonSelectionSummary: document.querySelector("#season-selection-summary"),
  seasonCheckboxes: document.querySelector("#season-checkboxes"),
  seasonPickerStatus: document.querySelector("#season-picker-status"),
  applySeasons: document.querySelector("#apply-seasons"),
  seasonShortcuts: Array.from(document.querySelectorAll("[data-season-shortcut]")),
  phase: document.querySelector("#phase"),
  garbageTimeMode: document.querySelector("#garbage-time-mode"),
  breakdownControl: document.querySelector("#breakdown-control"),
  breakdownMode: document.querySelector("#breakdown-mode"),
  search: document.querySelector("#search"),
  limit: document.querySelector("#limit"),
  body: document.querySelector("#rankings-body"),
  error: document.querySelector("#error"),
  resultsScopeTitle: document.querySelector("#results-scope-title"),
  sortableHeadings: Array.from(
    document.querySelectorAll(".rankings-table .sortable-heading"),
  ),
  mobileSort: document.querySelector("#mobile-sort"),
  mobileSortDirection: document.querySelector("#mobile-sort-direction"),
  topGamesPhases: Array.from(
    document.querySelectorAll('input[name="top-games-phase"]'),
  ),
  topGamesOutcomes: Array.from(
    document.querySelectorAll('input[name="top-games-outcome"]'),
  ),
  topGamesBody: document.querySelector("#top-games-body"),
  topGamesError: document.querySelector("#top-games-error"),
  seasonWinsPhases: Array.from(document.querySelectorAll('input[name="season-wins-phase"]')),
  seasonWinsLimit: document.querySelector("#season-wins-limit"),
  seasonWinsBody: document.querySelector("#season-wins-body"),
  seasonWinsError: document.querySelector("#season-wins-error"),
  highValuePhases: Array.from(
    document.querySelectorAll('input[name="high-value-phase"]'),
  ),
  highValuePlayerCount: document.querySelector("#high-value-player-count"),
  highValueThresholds: Array.from(
    document.querySelectorAll(".high-value-threshold"),
  ),
  highValueRecordsBody: document.querySelector("#high-value-records-body"),
  highValueRecordsError: document.querySelector("#high-value-records-error"),
  highValueSortableHeadings: Array.from(
    document.querySelectorAll(".high-value-sortable-heading"),
  ),
  highValueMobileSort: document.querySelector("#high-value-mobile-sort"),
  highValueMobileSortDirection: document.querySelector(
    "#high-value-mobile-sort-direction",
  ),
  seasonWinsDetails: document.querySelector("#season-wins-leaders"),
  topGamesDetails: document.querySelector("#top-games"),
  highValueRecordsDetails: document.querySelector("#high-value-records"),
  trendsSection: document.querySelector(".trends:not(.lift-trends)"),
  liftSection: document.querySelector(".lift-trends"),
  chartPanels: new Map(
    Array.from(document.querySelectorAll("[data-rankings-panel]"))
      .map((panel) => [panel.dataset.rankingsPanel, panel]),
  ),
  trendChart: document.querySelector("#trend-chart"),
  trendError: document.querySelector("#trends-error"),
  trendPhases: Array.from(document.querySelectorAll('input[name="trend-phase"]')),
  trendWindows: Array.from(document.querySelectorAll('input[name="trend-window"]')),
  trendLegend: document.querySelector("#trend-legend-list"),
  legendSummary: document.querySelector("#legend-summary"),
  trendTooltip: document.querySelector("#trend-tooltip"),
  liftChart: document.querySelector("#lift-chart"),
  liftError: document.querySelector("#lift-error"),
  liftWindows: Array.from(document.querySelectorAll('input[name="lift-window"]')),
  liftGroups: Array.from(document.querySelectorAll('input[name="lift-group"]')),
  liftLegend: document.querySelector("#lift-legend-list"),
  liftLegendSummary: document.querySelector("#lift-legend-summary"),
  liftTooltip: document.querySelector("#lift-tooltip"),
  rankingsTable: document.querySelector("#rankings-table"),
  sideGroupHeading: document.querySelector("#side-group-heading"),
  v8ContextOnly: Array.from(document.querySelectorAll(".v8-context-only")),
  experimentContextOnly: Array.from(document.querySelectorAll(".experiment-context-only")),
  contextGroupHeading: document.querySelector("#context-group-heading"),
  offenseHeading: document.querySelector("#offense-heading"),
  defenseHeading: document.querySelector("#defense-heading"),
  rankingsDefinition: document.querySelector("#rankings-definition"),
  rankingsGuideSummary: document.querySelector("#rankings-guide-summary"),
  contextDialog: document.querySelector("#player-context-dialog"),
  contextDialogTitle: document.querySelector("#context-dialog-title"),
  contextDialogMeta: document.querySelector("#context-dialog-meta"),
  contextDialogError: document.querySelector("#context-dialog-error"),
  contextDialogContent: document.querySelector("#context-dialog-content"),
  contextDialogClose: document.querySelector("#context-dialog-close"),
  contextPagePrevious: document.querySelector("#context-page-previous"),
  contextPageNext: document.querySelector("#context-page-next"),
  contextPageStatus: document.querySelector("#context-page-status"),
  officialRankingOptions: document.querySelector("#official-ranking-options"),
  myExperimentOptions: document.querySelector("#my-experiment-options"),
  desktopRequiredMessage: document.querySelector("#desktop-required-message"),
  experimentDialog: document.querySelector("#experiment-builder-dialog"),
  experimentDialogTitle: document.querySelector("#experiment-builder-title"),
  closeExperimentBuilder: document.querySelector("#close-experiment-builder"),
  experimentRuntimeError: document.querySelector("#experiment-runtime-error"),
  experimentRuntimeStatus: document.querySelector("#experiment-runtime-status"),
  experimentForm: document.querySelector("#original-experiment-form"),
  experimentName: document.querySelector("#experiment-name"),
  experimentAllSeasons: document.querySelector("#experiment-all-seasons"),
  experimentSeasons: document.querySelector("#experiment-seasons"),
  allSeasonsWarning: document.querySelector("#all-seasons-warning"),
  confirmAllSeasons: document.querySelector("#confirm-all-seasons"),
  allSeasonsDownloadEstimate: document.querySelector("#all-seasons-download-estimate"),
  allSeasonsStorageEstimate: document.querySelector("#all-seasons-storage-estimate"),
  allSeasonsRuntimeEstimate: document.querySelector("#all-seasons-runtime-estimate"),
  rawMultiplierControls: document.querySelector("#raw-multiplier-controls"),
  contextMagnifierControls: document.querySelector("#context-magnifier-controls"),
  linkReliabilityK: document.querySelector("#link-reliability-k"),
  reliabilityKOffense: document.querySelector("#reliability-k-offense"),
  reliabilityKDefense: document.querySelector("#reliability-k-defense"),
  linkLambda: document.querySelector("#link-lambda"),
  lambdaOffense: document.querySelector("#lambda-offense"),
  lambdaDefense: document.querySelector("#lambda-defense"),
  advancedOutcomeGroups: document.querySelector("#advanced-outcome-groups"),
  resetAllAdvanced: document.querySelector("#reset-all-advanced"),
  experimentValidationSummary: document.querySelector("#experiment-validation-summary"),
  experimentValidationErrors: document.querySelector("#experiment-validation-errors"),
  experimentRunProgress: document.querySelector("#experiment-run-progress"),
  experimentRunProgressLabel: document.querySelector("#experiment-run-progress-label"),
  experimentRunProgressCount: document.querySelector("#experiment-run-progress-count"),
  experimentRunProgressBar: document.querySelector("#experiment-run-progress-bar"),
  experimentRunProgressDetail: document.querySelector("#experiment-run-progress-detail"),
  resetExperiment: document.querySelector("#reset-experiment"),
  runExperiment: document.querySelector("#run-experiment"),
  cancelExperiment: document.querySelector("#cancel-experiment"),
  localExperimentList: document.querySelector("#local-experiment-list"),
  shareRankingCard: document.querySelector("#share-ranking-card"),
  shareStatus: document.querySelector("#share-status"),
  rankingCardDialog: document.querySelector("#ranking-card-dialog"),
  rankingCardDialogMeta: document.querySelector("#ranking-card-dialog-meta"),
  rankingCardPreview: document.querySelector("#ranking-card-preview"),
  rankingCardActionStatus: document.querySelector("#ranking-card-action-status"),
  closeRankingCard: document.querySelector("#close-ranking-card"),
  nativeShareRankingCard: document.querySelector("#native-share-ranking-card"),
  copyRankingCard: document.querySelector("#copy-ranking-card"),
  downloadRankingCard: document.querySelector("#download-ranking-card"),
};

const SVG_NS = "http://www.w3.org/2000/svg";

function selectedTrendPhase() {
  return document.querySelector('input[name="trend-phase"]:checked').value;
}

function selectedTrendWindow() {
  return Number(document.querySelector('input[name="trend-window"]:checked').value);
}

function selectedLiftWindow() {
  return Number(document.querySelector('input[name="lift-window"]:checked').value);
}

function selectedLiftGroup() {
  return document.querySelector('input[name="lift-group"]:checked').value;
}

function selectedTopGamesOutcome() {
  return document.querySelector('input[name="top-games-outcome"]:checked').value;
}

// The highest-games panel reads one schedule or the other, never both, and it
// always shows the twenty-five its heading names.
const TOP_GAMES_LIMIT = 25;

function selectedTopGamesPhase() {
  return document.querySelector('input[name="top-games-phase"]:checked')?.value
    || "Regular Season";
}

// The club is named after the number the answering statistic actually counted.
// V11 counts .500; the two earlier statistics still publish their own .400
// population, and the panel says so rather than mislabelling their rows.
function applyHighValueThreshold(threshold) {
  const value = Number(threshold);
  if (!Number.isFinite(value)) return;
  const label = value.toFixed(3).replace(/^0/u, "");
  elements.highValueThresholds.forEach((node) => { node.textContent = label; });
}

function selectedHighValuePhase() {
  return document.querySelector('input[name="high-value-phase"]:checked')?.value
    || "Regular Season";
}

function selectedSeasonWinsLimit() {
  return elements.seasonWinsLimit?.value || "25";
}

function garbageTimeLabel() {
  return elements.garbageTimeMode.value === "all_minutes"
    ? "Garbage time included"
    : "Garbage time excluded";
}

function statVersionLabel() {
  if (isFullLineupExperiment()) {
    return elements.statVersion.selectedOptions[0]?.textContent || "My experiment";
  }
  const labels = {
    v13: "V13",
    v12: "V12",
    v11: "V11",
    v10: "V10",
    original: "V9",
  };
  return labels[elements.statVersion.value] || elements.statVersion.value;
}

function isFullLineupExperiment() {
  return elements.statVersion.value.startsWith("experiment:");
}

function isServerStatVersion() {
  return SERVER_STAT_VERSIONS.has(elements.statVersion.value);
}

// The official group always reads in OFFICIAL_RANKINGS order (V11, V10, V9).
// V11 is baked into the page so the first paint is right; V10 and V9 are added
// only when /api/sources lists them, and V11 is removed again when its API has
// nothing to serve.
function setOfficialRankingOption(value, label, { present = true } = {}) {
  const group = elements.officialRankingOptions;
  const existing = group.querySelector(`option[value="${value}"]`);
  if (!present) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.textContent = label;
    return;
  }
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  const order = OFFICIAL_RANKINGS.map((ranking) => ranking.value);
  const follower = Array.from(group.querySelectorAll("option")).find((candidate) => {
    const position = order.indexOf(candidate.value);
    return position !== -1 && position > order.indexOf(value);
  });
  if (follower) group.insertBefore(option, follower);
  else group.append(option);
}

function officialRankingValues() {
  return new Set(Array.from(
    elements.officialRankingOptions.querySelectorAll("option"),
    (option) => option.value,
  ));
}

// V11 is the official statistic, so it is the default whenever it is present;
// the server's own default wins when it names something else that is present.
function defaultOfficialRanking(serverDefault = null) {
  const available = officialRankingValues();
  return [serverDefault, ...OFFICIAL_RANKINGS.map((ranking) => ranking.value)]
    .find((value) => value && available.has(value)) ?? "v11";
}

function officialRankingLabel(value) {
  return OFFICIAL_RANKINGS.find((ranking) => ranking.value === value)?.label ?? "V11";
}

// V10 and V11 publish their own options documents. Each is turned into the one
// bootstrap shape this page reads, so the page never has to know whose season
// list it is holding.
function serverBootstrapOptions(statVersion, options) {
  const entries = options?.seasons ?? options?.season_end_years ?? [];
  const labels = entries.map((entry) => {
    if (entry && typeof entry === "object") return String(entry.season);
    const year = Number(entry);
    return Number.isInteger(year)
      ? `${year - 1}-${String(year).slice(-2).padStart(2, "0")}`
      : String(entry);
  });
  const descending = [...new Set(labels)].sort().reverse();
  if (!descending.length) throw new Error("The season list could not be loaded.");
  const runId = (options?.sources ?? [])
    .find((row) => row.id === statVersion)?.run_id ?? null;
  return {
    run: runId ? { run_id: runId } : null,
    seasons: ["All Seasons", ...descending],
    default_season: descending[0],
    default_garbage_time_mode: "competitive",
    default_stat_version: statVersion,
    stat_versions: runId ? [{ value: statVersion, run_id: runId }] : [],
    garbage_time_modes: GARBAGE_TIME_MODES.map((mode) => ({ ...mode })),
  };
}

// V9 keeps its own bootstrap endpoint.
async function originalBootstrapOptions() {
  const response = await fetch("/api/rankings/options");
  if (!response.ok) throw new Error("The season list could not be loaded.");
  return response.json();
}

function availableRankingSeasons() {
  const allowed = state.allowedSeasonValues;
  return state.seasonValues.filter((season) => !allowed || allowed.has(season));
}

function selectedRankingSeasons() {
  const available = new Set(availableRankingSeasons());
  const selected = state.selectedSeasons.filter((season) => available.has(season));
  return selected.length ? selected : availableRankingSeasons();
}

function seasonSelectionCoversAll(seasons = selectedRankingSeasons()) {
  const available = availableRankingSeasons();
  return seasons.length === available.length
    && available.every((season) => seasons.includes(season));
}

function seasonSelectionIsAll(seasons = selectedRankingSeasons()) {
  return state.seasonScopeAll && seasonSelectionCoversAll(seasons);
}

function rankingSeasonLabel(seasons = selectedRankingSeasons()) {
  if (!state.seasonScopeAll && seasons.length === 1) return seasons[0];
  return state.multiSeasonModule?.seasonSelectionLabel(seasons, availableRankingSeasons())
    || (seasons.length === 1 ? seasons[0] : `${seasons.length} selected seasons`);
}

function contextSeasonValue(seasons = selectedRankingSeasons()) {
  if (seasonSelectionIsAll(seasons)) return "All Seasons";
  return seasons.length === 1 ? seasons[0] : null;
}

function rankingSeasonScopeValue(seasons = selectedRankingSeasons()) {
  return contextSeasonValue(seasons) || rankingSeasonLabel(seasons);
}

function sameSeasonSelection(left, right) {
  return left.length === right.length && left.every((season, index) => season === right[index]);
}

function checkedRankingSeasons() {
  const checked = new Set(
    Array.from(elements.seasonCheckboxes.querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => input.value),
  );
  return availableRankingSeasons().filter((season) => checked.has(season));
}

function setCheckedRankingSeasons(seasons) {
  const selected = new Set(seasons);
  elements.seasonCheckboxes.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = selected.has(input.value) && !input.disabled;
  });
}

function syncLegacySeasonSelect() {
  elements.season.value = contextSeasonValue() || "";
}

function updateSeasonPickerPresentation({ message = null } = {}) {
  const staged = checkedRankingSeasons();
  const applied = selectedRankingSeasons();
  const dirty = staged.length > 0 && !sameSeasonSelection(staged, applied);
  // The control's summary names the staged selection the same way the table
  // card's header does — "2013–2018 · 5 seasons", not "2013-14–2017-18". It
  // reads the staged ticks rather than the applied scope, so ticking every
  // season says "All Seasons" before it is applied as well as after.
  elements.seasonSelectionSummary.textContent = staged.length
    ? seasonRangeHeading(staged, { all: seasonSelectionCoversAll(staged) })
    : "Choose seasons";
  elements.applySeasons.disabled = !dirty;
  if (message) {
    elements.seasonPickerStatus.textContent = message;
  } else if (!staged.length) {
    elements.seasonPickerStatus.textContent = "Choose at least one season, then apply.";
  } else if (dirty) {
    elements.seasonPickerStatus.textContent = "Apply this selection to update the rankings.";
  } else if (!contextSeasonValue(applied)) {
    elements.seasonPickerStatus.textContent =
      "Player details and postseason comparisons are available for one season or All Seasons.";
  } else {
    elements.seasonPickerStatus.textContent = "Choose any combination, or use a five-season shortcut.";
  }
}

function renderRankingSeasonCheckboxes() {
  elements.seasonCheckboxes.innerHTML = state.seasonValues.map((season) => `
    <label class="season-ranking-option">
      <input type="checkbox" value="${escapeHtml(season)}" />
      <span>${escapeHtml(season)}</span>
    </label>`).join("");
  setCheckedRankingSeasons(selectedRankingSeasons());
  updateSeasonPickerPresentation();
}

function setStagedSeasonShortcut(shortcut) {
  const available = availableRankingSeasons();
  let selected = available;
  if (shortcut === "first-five") selected = available.slice(-5);
  if (shortcut === "last-five") selected = available.slice(0, 5);
  if (shortcut === "none") selected = [];
  setCheckedRankingSeasons(selected);
  updateSeasonPickerPresentation();
}

function applyRankingSeasonSelection() {
  const selected = checkedRankingSeasons();
  if (!selected.length) {
    updateSeasonPickerPresentation({ message: "Choose at least one season before applying." });
    return;
  }
  state.selectedSeasons = selected;
  state.seasonScopeAll = seasonSelectionCoversAll(selected);
  syncLegacySeasonSelect();
  updateSeasonPickerPresentation();
  elements.seasonPicker.open = false;
  if (!contextSeasonValue()) closePlayerContext({ updateUrl: false });
  invalidatePlayerContextScope();
  if (state.multiSeasonModule?.MULTI_SEASON_UNAVAILABLE_SORTS.has(state.sortBy)
      && !contextSeasonValue()) {
    state.sortBy = "wins_contributed";
    state.sortDirection = "desc";
  }
  loadRankings();
}

function restoreRankingSeasonSelection(params) {
  const requested = params.getAll("season");
  const available = availableRankingSeasons();
  const requestedAll = requested.includes("All Seasons");
  let selected;
  if (requestedAll) {
    selected = available;
  } else {
    const requestedSet = new Set(requested);
    selected = available.filter((season) => requestedSet.has(season));
  }
  if (!selected.length) {
    const fallback = state.seasonValues.includes(params.get("season"))
      ? params.get("season")
      : null;
    selected = fallback && available.includes(fallback)
      ? [fallback]
      : [available[0]].filter(Boolean);
  }
  state.selectedSeasons = selected;
  state.seasonScopeAll = requestedAll;
  setCheckedRankingSeasons(selected);
  syncLegacySeasonSelect();
  updateSeasonPickerPresentation();
}

function selectedExperimentId() {
  return isFullLineupExperiment()
    ? elements.statVersion.value.slice("experiment:".length)
    : null;
}

function entityAnalyticsSource() {
  const experimentId = selectedExperimentId();
  if (experimentId) return `experiment:${experimentId}`;
  // V10 and V11 each serve their own player, team, compare and season pages.
  return isServerStatVersion() ? elements.statVersion.value : "v9";
}

function entityAnalyticsUrl(kind, entityId) {
  const params = new URLSearchParams({
    source: entityAnalyticsSource(),
    schedule: {
      All: "all",
      "Regular Season": "regular_season",
      PlayIn: "play_in",
      Playoffs: "playoffs",
      Postseason: "postseason",
    }[elements.phase.value] || "all",
    time_mode: elements.garbageTimeMode.value,
    metric: state.sortBy === "wins_contributed" || selectedBreakdownMode() === "wc"
      ? "wins_contributed"
      : "value_contributed",
  });
  const selectedSeason = contextSeasonValue();
  if (selectedSeason && selectedSeason !== "All Seasons") params.set("season", selectedSeason);
  params.set(kind === "players" ? "player_id" : "team_id", String(entityId));
  return `/${kind}?${params}`;
}

function playerComparisonUrl(row) {
  const seasons = selectedRankingSeasons();
  const params = new URLSearchParams({
    source: entityAnalyticsSource(),
    mode: !seasonSelectionIsAll(seasons) && seasons.length === 1 ? "season" : "span",
    schedule: {
      All: "all", "Regular Season": "regular_season", PlayIn: "play_in",
      Playoffs: "playoffs", Postseason: "postseason",
    }[elements.phase.value] || "all",
    time_mode: elements.garbageTimeMode.value,
    metric: state.sortBy === "wins_contributed" || selectedBreakdownMode() === "wc"
      ? "wins_contributed" : "value_contributed",
    p1: String(row.player_id),
    p1_name: row.player_name,
  });
  if (!seasonSelectionIsAll(seasons)) seasons.forEach((season) => params.append("p1_season", season));
  return `/compare/players?${params}`;
}

function apiStatVersion() {
  return isFullLineupExperiment() ? "original" : elements.statVersion.value;
}

function supportingStatVersionLabel() {
  return statVersionLabel();
}

function addSelectedExperimentParam(params) {
  const experimentId = selectedExperimentId();
  if (experimentId) params.set("experiment_id", experimentId);
  return params;
}

function localPanelSort(panel, params) {
  if (["rankings", "responsibility", "context"].includes(panel)) {
    return {
      key: params.get("sort_by") || "wins_contributed",
      direction: params.get("sort_direction") || "desc",
    };
  }
  if (panel === "high-value-records") {
    return {
      key: params.get("sort_by") || "games_played",
      direction: params.get("sort_direction") || "desc",
    };
  }
  return null;
}

function throwIfRequestAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw new DOMException("The operation was aborted.", "AbortError");
}

async function responseErrorPayload(response) {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

function displayedResponsibilityAliases(row, breakdownMode) {
  const winsMode = breakdownMode === "wc";
  return {
    offense_value: Number(winsMode
      ? row.offensive_wins_contributed ?? 0
      : row.offensive_value_contributed ?? row.offense_value ?? 0),
    defense_value: Number(winsMode
      ? row.defensive_wins_contributed ?? 0
      : row.defensive_value_contributed ?? row.defense_value ?? 0),
    other_value: Number(winsMode
      ? row.other_wins_contributed ?? 0
      : row.other_value_contributed ?? row.other_value ?? 0),
  };
}

async function requestRankingPanel({ panel, url, params, signal }) {
  const experimentId = selectedExperimentId();
  if (!experimentId && isServerStatVersion()) {
    const serverStat = elements.statVersion.value;
    const serverStatLabel = serverStat.toUpperCase();
    const season = params.get("season");
    if (panel === "player-context") {
      // V11 answers the dialog in the dashboard's own terms — season label,
      // phase and page — so its parameters pass straight through. V12 answers
      // it through the same route.
      if (!V11_SHAPED_STAT_VERSIONS.has(serverStat)) {
        throw new Error(`The ${serverStatLabel} ${panel} view is not available in this panel yet.`);
      }
      const contextParams = new URLSearchParams({
        player_id: params.get("player_id") ?? "",
        season: season ?? "All Seasons",
        phase: params.get("phase") ?? "All",
        garbage_time_mode: params.get("garbage_time_mode") ?? "competitive",
        breakdown_mode: params.get("breakdown_mode") ?? "vc",
        page: params.get("page") ?? "1",
        per_page: params.get("per_page") ?? "20",
      });
      const contextResponse = await fetch(
        `/api/${serverStat}/rankings/player-context?${contextParams}`,
        { signal },
      );
      if (!contextResponse.ok) {
        const detail = await responseErrorPayload(contextResponse);
        throw new Error(detail?.detail?.message ?? detail?.detail
          ?? `The ${serverStatLabel} ${panel} panel could not be loaded.`);
      }
      return contextResponse.json();
    }
    // V11 orders and pages the table itself (`sort_by`/`sort_direction`), so a
    // page of twenty-five rows costs twenty-five rows. V10 has no such
    // parameter, so it keeps the old shape: ask for the widest answer the
    // endpoint gives and order it here.
    const serverSorts = V11_SHAPED_STAT_VERSIONS.has(serverStat) && panel === "rankings";
    const drawnLimit = String(params.get("limit") ?? "100");
    const v10Params = new URLSearchParams({
      schedule: ({
        All: "all", "Regular Season": "regular_season", PlayIn: "play_in",
        Playoffs: "playoffs", Postseason: "postseason",
      })[params.get("phase")] ?? "all",
      time_mode: params.get("garbage_time_mode") ?? "competitive",
      limit: panel !== "rankings" ? drawnLimit : (serverSorts ? drawnLimit : "1000"),
    });
    v10Params.set("breakdown_mode", params.get("breakdown_mode") ?? "vc");
    if (season && season !== "All Seasons") {
      v10Params.set("season_end_year", String(Number(season.slice(0, 4)) + 1));
    }
    let endpoint;
    if (panel === "rankings") {
      endpoint = `/api/${serverStat}/rankings`;
      v10Params.set("metric", ["wins_contributed", "value_contributed"].includes(params.get("sort_by"))
        ? params.get("sort_by") : "value_contributed");
      v10Params.set("search", params.get("search") ?? "");
      if (serverSorts) {
        v10Params.set("sort_by", params.get("sort_by") ?? "wins_contributed");
        v10Params.set("sort_direction", params.get("sort_direction") === "asc" ? "asc" : "desc");
      }
    } else if (panel === "top-games") {
      endpoint = `/api/${serverStat}/top-games`;
      v10Params.set("outcome", String(params.get("outcome") ?? "Both").toLowerCase());
    } else if (panel === "season-wins-leaders") {
      endpoint = `/api/${serverStat}/season-wins-leaders`;
    } else if (panel === "high-value-records") {
      endpoint = `/api/${serverStat}/high-value-records`;
      v10Params.set("sort_by", params.get("sort_by") ?? "games_played");
      v10Params.set("sort_direction", params.get("sort_direction") ?? "desc");
    } else if (panel === "rolling-trends") {
      endpoint = `/api/${serverStat}/rolling-trends`;
      v10Params.set("window_years", params.get("window_years") ?? "3");
    } else if (panel === "postseason-lift-trends") {
      endpoint = `/api/${serverStat}/postseason-lift-trends`;
      v10Params.set("window_years", params.get("window_years") ?? "3");
    } else {
      throw new Error(`The ${serverStatLabel} ${panel} view is not available in this panel yet.`);
    }
    const response = await fetch(`${endpoint}?${v10Params}`, { signal });
    if (!response.ok) {
      const detail = await responseErrorPayload(response);
      throw new Error(detail?.detail?.message ?? detail?.detail ?? `The ${serverStatLabel} ${panel} panel could not be loaded.`);
    }
    const payload = await response.json();
    let rows = (payload.rows ?? []).map((row) => ({
      ...row,
      minutes_played: Number(row.seconds_played ?? row.actual_seconds ?? 0) / 60,
      teams: teamRecords(row.team_ids, row.team_abbreviations),
      team: row.team_id
        ? teamRecord(row.team_id, { abbreviation: row.team_abbreviation })
        : row.team,
      opponent: row.opponent_id
        ? teamRecord(row.opponent_id, { abbreviation: row.opponent_abbreviation })
        : row.opponent,
    }));
    if (panel === "rankings") {
      const sortBy = params.get("sort_by") ?? "wins_contributed";
      const direction = params.get("sort_direction") === "asc" ? 1 : -1;
      // The Offense, Defense and Other columns show wins-only amounts in the
      // Wins Contributed view, so they must sort by those same amounts.
      const breakdownMode = params.get("breakdown_mode") ?? "vc";
      rows = rows.map((row) => ({
        ...row,
        ...displayedResponsibilityAliases(row, breakdownMode),
      }));
      // The endpoint already ordered and cut the page when it can, and the
      // order is the same rule either way: the column, then the player id.
      if (!serverSorts) {
        rows = rows.sort((left, right) => {
          const comparison = (Number(left[sortBy] ?? 0) - Number(right[sortBy] ?? 0)) * direction;
          return comparison || Number(left.player_id) - Number(right.player_id);
        }).slice(0, Number(params.get("limit") ?? 100));
      }
    }
    return {
      ...payload,
      stat_version: serverStat,
      run_id: payload.source?.run_id,
      release_id: payload.source?.runtime?.deployment_receipt,
      configuration_receipt: payload.source?.configuration_receipt,
      calculation_receipt: payload.source?.calculation_receipt,
      phase: params.get("phase") ?? "All",
      garbage_time_mode: params.get("garbage_time_mode") ?? "competitive",
      breakdown_mode: params.get("breakdown_mode") ?? "vc",
      season,
      selected_seasons: season ? [season] : [],
      rows,
    };
  }
  if (!experimentId) {
    const response = await fetch(`${url}?${params}`, { signal });
    if (!response.ok) {
      const payload = await responseErrorPayload(response);
      throw new Error(payload.detail || `The ${panel} panel could not be loaded.`);
    }
    return response.json();
  }
  if (isServerV10Experiment(experimentId)) {
    if (panel !== "rankings") {
      throw new Error(`The persisted defensive experiment does not provide the ${panel} panel.`);
    }
    const serverSource = serverExperiment(experimentId);
    const serverParams = new URLSearchParams({
      time_mode: params.get("garbage_time_mode") || "competitive",
      schedule: params.get("phase") || "All",
      search: params.get("search") || "",
      sort_by: params.get("sort_by") || "wins_contributed",
      sort_direction: params.get("sort_direction") || "desc",
      limit: "1000",
      compact: "true",
    });
    const serverSeason = params.get("season");
    if (serverSeason && serverSeason !== "All Seasons") {
      serverParams.set("season_end_year", String(seasonEndYearFromDashboardValue(serverSeason)));
    }
    const serverApiRoot = ({
      genuine: "/api/v10-genuine-experiments",
      "unbounded-side-budget": "/api/v10-unbounded-side-budget-experiments",
      legacy: "/api/v10-experiments",
    })[serverSource?.server_experiment_api] || "/api/v10-experiments";
    const requestUrl = `${serverApiRoot}/arms/${encodeURIComponent(experimentId)}/rankings?${serverParams}`;
    throwIfRequestAborted(signal);
    let result = state.serverExperimentRankingCache.get(requestUrl);
    if (!result) {
      const response = await fetch(requestUrl, { signal });
      if (!response.ok) {
        const detail = await responseErrorPayload(response);
        throw new Error(detail.detail || "The persisted experiment rankings could not be loaded.");
      }
      result = await response.json();
      if (state.serverExperimentRankingCache.size >= 64) {
        state.serverExperimentRankingCache.delete(
          state.serverExperimentRankingCache.keys().next().value,
        );
      }
      state.serverExperimentRankingCache.set(requestUrl, result);
    }
    throwIfRequestAborted(signal);
    const sortBy = params.get("sort_by") || "wins_contributed";
    const breakdownMode = params.get("breakdown_mode") || "vc";
    const direction = params.get("sort_direction") === "asc" ? 1 : -1;
    const limit = Number(params.get("limit") || 100);
    const rows = (result.rows || []).map((row) => {
      const value = Number(row.value_contributed || 0);
      const winsValue = Number(row.wins_contributed || 0);
      const offense = Number(row.offense_value_contributed || 0);
      const defense = Number(row.defense_value_contributed || 0);
      const other = Number(row.other_value_contributed || 0);
      return {
        ...row,
        ...displayedResponsibilityAliases(row, breakdownMode),
        teams: teamRecords(row.team_ids, row.team_abbreviations),
        hustle_value: 0,
        offensive_value_contributed: offense,
        defensive_value_contributed: defense,
        other_value_contributed: other,
        offensive_wins_contributed: Number(row.offensive_wins_contributed ?? 0),
        defensive_wins_contributed: Number(row.defensive_wins_contributed ?? 0),
        other_wins_contributed: Number(row.other_wins_contributed ?? 0),
        offensive_value_contributed_pct: value ? offense / value * 100 : 0,
        defensive_value_contributed_pct: value ? defense / value * 100 : 0,
        other_value_contributed_pct: value ? other / value * 100 : 0,
        offensive_wins_contributed_pct: winsValue
          ? Number(row.offensive_wins_contributed || 0) / winsValue * 100 : 0,
        defensive_wins_contributed_pct: winsValue
          ? Number(row.defensive_wins_contributed || 0) / winsValue * 100 : 0,
        other_wins_contributed_pct: winsValue
          ? Number(row.other_wins_contributed || 0) / winsValue * 100 : 0,
        value_per_game_rank: null,
        postseason_value_per_game_difference: null,
        postseason_rank_change: null,
        side_context_raw_value: null,
        general_offense_context_value: null,
        teammate_offense_context_value: null,
        opponent_defense_context_value: null,
        general_defense_context_value: null,
        teammate_defense_context_value: null,
        opponent_offense_context_value: null,
      };
    }).sort((left, right) => {
      const difference = (Number(left[sortBy] ?? 0) - Number(right[sortBy] ?? 0)) * direction;
      return difference || Number(left.player_id) - Number(right.player_id);
    }).slice(0, limit).map((row, index) => ({
      ...row,
      rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : index + 1,
    }));
    return {
      rows,
      run_id: experimentId,
      release_id: result.arm?.suite_id,
      configuration_receipt: result.arm?.arm_receipt,
      calculation_receipt: result.arm?.content_sha256,
      comparison_arm_slug: result.comparison_arm_slug,
      ranking_metric: result.ranking_metric,
      stat_version: "original",
      phase: params.get("phase") || "All",
      garbage_time_mode: params.get("garbage_time_mode") || "competitive",
      breakdown_mode: params.get("breakdown_mode") || "vc",
      season: params.get("season") || "2025-26",
      selected_seasons: ["2025-26"],
    };
  }
  if (!state.experimentClient?.queryRankings) {
    throw new Error(
      "This local experiment is stored on this device, but its browser ranking reader is not available yet.",
    );
  }
  const filters = Object.fromEntries(params.entries());
  delete filters.experiment_id;
  delete filters.stat_version;
  throwIfRequestAborted(signal);
  const result = await state.experimentClient.queryRankings(experimentId, {
    panel,
    filters,
    sort: localPanelSort(panel, params),
    limit: params.has("limit")
      ? Number(params.get("limit"))
      : Number.MAX_SAFE_INTEGER,
    offset: Number(params.get("offset") || 0),
    signal,
  });
  throwIfRequestAborted(signal);
  const payload = result?.metadata?.panel_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`The local ${panel} projection did not return a complete panel payload.`);
  }
  if (
    payload.run_id !== experimentId
    || payload.stat_version !== apiStatVersion()
  ) {
    throw new Error(`The local ${panel} projection identity did not match the selected experiment.`);
  }
  return payload;
}

function isV8() {
  return isFullLineupExperiment()
    || OFFICIAL_RANKING_SLUGS.has(elements.statVersion.value);
}

function isV11() {
  return elements.statVersion.value === "v11";
}

function isV11Shaped() {
  return V11_SHAPED_STAT_VERSIONS.has(elements.statVersion.value);
}

function hasPlayerContext() {
  if (!contextSeasonValue()) return false;
  // V11 and V12 answer the dialog from their own endpoints; V10 has none.
  if (isServerStatVersion()) return isV11Shaped();
  return OFFICIAL_RANKING_SLUGS.has(elements.statVersion.value)
    || (isFullLineupExperiment()
      && !isServerV10Experiment()
      && Boolean(state.experimentClient?.queryRankings));
}

function selectedContextRunId() {
  const experimentId = selectedExperimentId();
  if (experimentId) return experimentId;
  return state.officialRunIds[elements.statVersion.value]
    || state.rankingsRunId
    || null;
}

function contextRunMatchesSelectedSource(runId) {
  return !runId || runId === selectedContextRunId();
}

function restorePlayerContextSelection(params) {
  const playerId = params.get("player_id");
  if (
    !hasPlayerContext()
    || !contextRunMatchesSelectedSource(params.get("context_run_id"))
    || !/^\d+$/.test(playerId || "")
  ) {
    return false;
  }
  state.selectedContextPlayerId = playerId;
  // The name arrives with the context payload; an id is never shown.
  state.selectedContextPlayerName = "";
  const page = Number(params.get("context_page"));
  state.contextPage = Number.isInteger(page) && page > 0 ? page : 1;
  if (!elements.contextDialog.open) elements.contextDialog.showModal();
  return true;
}

function selectedBreakdownMode() {
  return elements.breakdownMode.value === "wc" ? "wc" : "vc";
}

// The most rows a single season's ranking endpoint will answer with, which is
// more than any season has ever had, and the cap a merged multi-season
// selection is held to once the per-player rows have been added up.
const API_RANKING_ROW_CEILING = 1000;
const MERGED_RANKING_ROW_CEILING = 100000;

// "Show" is the table's own population control, and every chart above the
// total-history section draws exactly what it leaves in the table. `null` is
// "all of them".
function selectedRankingLimit() {
  const requested = elements.limit.value;
  return requested === "all" ? null : Number(requested) || 25;
}

// --- collapsible chart panels ---------------------------------------------------
//
// Four disclosures: two charts of the table's own selection (offensive and
// defensive contribution, and regular season against postseason) and the two
// total-history charts. The type charts live on the season page. All four
// start closed, none of them fetches or draws
// anything until it is first opened, and which ones are open travels in the
// query string so a reload or a shared link brings the same page back.

const OPEN_PANEL_STORAGE_KEY = "value-contributed:rankings-open-panels";

function panelElement(key) {
  if (key === "trends") return elements.trendsSection;
  if (key === "lift") return elements.liftSection;
  return elements.chartPanels.get(key) ?? null;
}

function panelKeys() {
  return state.rankingsVisualModule?.ALL_PANEL_KEYS ?? [];
}

function currentOpenPanels() {
  return panelKeys().filter((key) => panelElement(key)?.open);
}

function rememberOpenPanels() {
  const serialize = state.rankingsVisualModule?.serializeOpenPanels;
  if (!serialize) return;
  try {
    sessionStorage.setItem(OPEN_PANEL_STORAGE_KEY, serialize(currentOpenPanels()));
  } catch {
    // A browser that refuses session storage still keeps the query string.
  }
}

function applyOpenPanels(keys) {
  const open = new Set(keys ?? []);
  for (const key of panelKeys()) {
    const panel = panelElement(key);
    if (panel) panel.open = open.has(key);
  }
}

function restoreOpenPanels(params) {
  const parse = state.rankingsVisualModule?.parseOpenPanels;
  if (!parse) return;
  let stored = null;
  try {
    stored = sessionStorage.getItem(OPEN_PANEL_STORAGE_KEY);
  } catch {
    stored = null;
  }
  applyOpenPanels(parse(`?${params.toString()}`, { stored }));
}

// Which identity the dialog binds to.  V9 and the browser experiments have one
// run behind the whole table, so the run id is the identity.  V11 publishes one
// run per season and no run id above them, so it binds on the engine version
// the rankings came from instead — together with the stat version and the scope
// already in the signature.  Until the rankings have reported an engine version
// there is nothing to bind to, and the scope alone decides.
function contextScopeIdentity(payload = null) {
  if (!isV11Shaped()) {
    return { run_id: payload ? payload.run_id : state.rankingsRunId };
  }
  if (!state.rankingsEngineVersion) return { engine_version: null };
  return {
    engine_version: payload
      ? (payload.source?.engine_version ?? null)
      : state.rankingsEngineVersion,
  };
}

function currentContextScopeSignature() {
  return JSON.stringify({
    ...contextScopeIdentity(),
    player_id: state.selectedContextPlayerId,
    season: contextSeasonValue(),
    phase: elements.phase.value,
    garbage_time_mode: elements.garbageTimeMode.value,
    stat_version: apiStatVersion(),
    breakdown_mode: selectedBreakdownMode(),
    page: state.contextPage,
  });
}

function responseContextScopeSignature(payload) {
  return JSON.stringify({
    ...contextScopeIdentity(payload),
    player_id: String(payload.player_id),
    season: payload.season,
    phase: payload.phase,
    garbage_time_mode: payload.garbage_time_mode,
    stat_version: payload.stat_version,
    breakdown_mode: payload.breakdown_mode,
    page: payload.pagination.page,
  });
}

function invalidatePlayerContextScope({ resetPage = true } = {}) {
  state.contextController?.abort();
  state.contextController = null;
  if (resetPage) state.contextPage = 1;
  if (!state.selectedContextPlayerId || !elements.contextDialog.open) return;
  elements.contextDialogError.hidden = true;
  elements.contextDialogContent.innerHTML = "<p>Loading exact-scope context…</p>";
  elements.contextPageStatus.textContent = "Loading…";
  elements.contextPagePrevious.disabled = true;
  elements.contextPageNext.disabled = true;
}

function number(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number(value));
}

function displayNumber(value) {
  return value === null || value === undefined ? "—" : number(value);
}

function percentage(value) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function percentagePoints(value) {
  if (value === null || value === undefined) return "—";
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value))}%`;
}

function signedPercentagePoints(value) {
  if (value === null || value === undefined) return "—";
  const numericValue = Number(value);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(numericValue);
  return `${numericValue > 0 ? "+" : ""}${formatted}%`;
}

function displayClosedTriplet(values, target, precision) {
  const numeric = values.map(Number);
  const factor = 10 ** precision;
  const roundedTicks = numeric.map((value) => Math.round(value * factor));
  const targetTicks = Math.round(Number(target) * factor);
  const residualTicks = targetTicks
    - roundedTicks.reduce((total, value) => total + value, 0);
  let closeIndex = 0;
  numeric.forEach((value, index) => {
    if (Math.abs(value) > Math.abs(numeric[closeIndex])) closeIndex = index;
  });
  roundedTicks[closeIndex] += residualTicks;
  return roundedTicks.map((ticks) => ticks === 0 ? 0 : ticks / factor);
}

function fixedDisplay(value, precision) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(Number(value));
}

function updateV8Presentation() {
  const active = isV8();
  // The hero says "Value Contributed" and nothing else: which statistic is
  // answering is on the Ranking control and in the table card's own header.
  document.body.classList.toggle("v8-dashboard", active);
  document.body.classList.toggle("original-dashboard", active);
  elements.rankingsTable.classList.toggle("v8-rankings", active);
  elements.rankingsTable.classList.toggle("original-rankings", active);
  elements.breakdownControl.hidden = !active;
  elements.sideGroupHeading.colSpan = active ? 2 : 3;
  elements.sideGroupHeading.textContent = active ? "Responsibility" : "Value source";
  elements.contextGroupHeading.colSpan = 3;
  elements.contextGroupHeading.textContent = "Context";
  elements.v8ContextOnly.forEach((element) => {
    element.hidden = !active;
  });
  const headingLabels = ["Offense", "Defense"];
  [elements.offenseHeading, elements.defenseHeading]
    .forEach((heading, index) => {
      const firstText = heading?.querySelector("button")?.childNodes?.[0];
      if (firstText) firstText.nodeValue = `${headingLabels[index]} `;
      const button = heading?.querySelector("button[data-sort]");
      if (button) button.disabled = false;
      heading?.classList.remove("experiment-responsibility-heading");
    });
  const hustleMobileOption = elements.mobileSort.querySelector(
    'option[value="hustle_value"]',
  );
  if (hustleMobileOption) {
    hustleMobileOption.disabled = active;
    hustleMobileOption.hidden = active;
  }
  responsibilitySorts.forEach((sort) => {
    const option = elements.mobileSort.querySelector(`option[value="${sort}"]`);
    if (option) option.disabled = false;
  });
  if (
    (active && state.sortBy === "hustle_value")
    || (!active && contextSorts.has(state.sortBy))
  ) {
    state.sortBy = "wins_contributed";
    state.sortDirection = "desc";
  }
  const customSeasonRange = !contextSeasonValue();
  state.multiSeasonModule?.MULTI_SEASON_UNAVAILABLE_SORTS.forEach((sort) => {
    const button = elements.rankingsTable.querySelector(`[data-sort="${sort}"]`);
    if (button) {
      button.disabled = customSeasonRange;
      button.title = customSeasonRange
        ? "Postseason comparisons are available for one season or All Seasons."
        : "";
    }
    const option = elements.mobileSort.querySelector(`option[value="${sort}"]`);
    if (option) option.disabled = customSeasonRange;
  });
  elements.rankingsDefinition.innerHTML = active
    ? "<strong>Responsibility</strong> is a separate exact Offense, Defense, and Other breakdown; those three nonnegative amounts add to the selected final VC or WC. <strong>Context</strong> starts collapsed with Raw VC, Offense Context, and Defense Context. Offense Context is General O + Teammate O + Opponent O. Defense Context is General D + Teammate D + Opponent D. The opponent labels name the side they affect: Opponent O is derived from opponent defense, and Opponent D is derived from opponent offense. Expanding replaces the two context totals with those six distinct factors—Raw VC is never repeated—and Raw VC plus the six changes closes to the same final total."
    : "<strong>Value Contributed</strong> sums a player’s final team-value share in wins and losses. <strong>Wins Contributed</strong> sums that same value only when the player’s team won; <strong>Loss VC</strong> is the remainder from losses.";
  elements.rankingsGuideSummary.textContent = active
    ? "Responsibility splits final value; context explains the bridge from Raw VC."
    : "Wins VC is value in wins; VC/game uses all selected appearances.";
  // V12 says what it changed and what it does not have yet, in the guide the
  // table already carries, so a reader never takes its empty context columns
  // for a measurement.  Its player types and similar players are built.
  const description = state.sourceDescriptions?.[elements.statVersion.value];
  if (elements.statVersion.value === "v12" && description) {
    elements.rankingsDefinition.insertAdjacentHTML(
      "beforeend",
      ` <strong>V12.</strong> ${escapeHtml(description)} V12 does not have the six-factor context breakdown yet, so the Raw VC and context columns show a dash.`,
    );
  }
  // V13 describes itself the same way; it has its own six-factor context
  // breakdown, so its Raw VC and context columns are filled like V11's.
  if (elements.statVersion.value === "v13" && description) {
    elements.rankingsDefinition.insertAdjacentHTML(
      "beforeend",
      ` <strong>V13.</strong> ${escapeHtml(description)}`,
    );
  }
}

// The record columns are always shown and always last; the context group is
// the raw amount and the two side totals, and the six per-factor columns live
// in the context dialog rather than in the table.
function visibleRankingColumnCount() {
  // Rank, Player, four value columns, the value sources, and the three record
  // columns; a context statistic adds Raw VC and the two side totals.
  return (isV8() ? 11 : 12) + (isV8() ? 3 : 0);
}

function signedNumber(value, suffix = "") {
  if (value === null || value === undefined) return "—";
  const numericValue = Number(value);
  return `${numericValue > 0 ? "+" : ""}${number(numericValue)}${suffix}`;
}

function signedRank(value) {
  if (value === null || value === undefined) return "—";
  const numericValue = Number(value);
  return `${numericValue > 0 ? "+" : ""}${numericValue}`;
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function currentRankingScope() {
  const seasons = typeof selectedRankingSeasons === "function"
    ? selectedRankingSeasons()
    : [elements.season.value];
  return {
    source: elements.statVersion.value,
    season: typeof rankingSeasonScopeValue === "function"
      ? rankingSeasonScopeValue(seasons)
      : elements.season.value,
    seasons,
    timeMode: elements.garbageTimeMode.value,
    phase: elements.phase.value,
    breakdownMode: selectedBreakdownMode(),
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    limit: elements.limit.value,
    search: elements.search.value.trim(),
  };
}

function rankingScopeSignature(scope = currentRankingScope()) {
  return JSON.stringify(scope);
}

function clearShareableRankings() {
  if (elements.rankingCardDialog?.open) closeRankingCardDialog();
  state.rankingsPayload = null;
  state.rankingsScopeSignature = null;
  state.rankingCardRequestToken = null;
  delete elements.body.dataset.rankingSource;
  delete elements.body.dataset.rankingReleaseId;
  delete elements.body.dataset.rankingRunId;
  delete elements.body.dataset.rankingConfigurationReceipt;
  delete elements.body.dataset.rankingCalculationReceipt;
  delete elements.body.dataset.rankingScopeSignature;
  elements.shareRankingCard.disabled = true;
  elements.shareStatus.textContent = "";
}

function setLoading() {
  clearShareableRankings();
  elements.error.hidden = true;
  elements.body.innerHTML = `
    <tr class="loading-row">
      <td colspan="${visibleRankingColumnCount()}">${({ v12: "Loading V12 rankings…", v13: "Loading V13 rankings…" })[apiStatVersion()] ?? "Reading the canonical calculation…"}</td>
    </tr>`;
}

function clearSupportingPanelBinding(node) {
  delete node.dataset.panelPayloadMetadata;
}

function bindSupportingPanelPayload(node, payload) {
  const { rows: _rows, players: _players, ...metadata } = payload;
  node.dataset.panelPayloadMetadata = JSON.stringify(metadata);
}

function supportingPanelDatum(value) {
  return escapeHtml(JSON.stringify(value)).replaceAll('"', "&quot;");
}

function setSeasonWinsLoading() {
  clearSupportingPanelBinding(elements.seasonWinsBody);
  elements.seasonWinsError.hidden = true;
  elements.seasonWinsBody.innerHTML = `
    <tr class="loading-row">
      <td colspan="6">Reading season leaders…</td>
    </tr>`;
}

function setTopGamesLoading() {
  clearSupportingPanelBinding(elements.topGamesBody);
  elements.topGamesError.hidden = true;
  elements.topGamesBody.innerHTML = `
    <tr class="loading-row">
      <td colspan="9">Reading the highest single-game values…</td>
    </tr>`;
}

function setHighValueRecordsLoading() {
  clearSupportingPanelBinding(elements.highValueRecordsBody);
  elements.highValueRecordsError.hidden = true;
  elements.highValueRecordsBody.innerHTML = `
    <tr class="loading-row">
      <td colspan="7">Reading .500-plus game records…</td>
    </tr>`;
  elements.highValuePlayerCount.textContent = "—";
}

function setTrendLoading() {
  const mobileTrend = document.querySelector("#mobile-trend-preview");
  if (mobileTrend) mobileTrend.textContent = "Loading career trends…";
  clearSupportingPanelBinding(elements.trendChart);
  elements.trendError.hidden = true;
  elements.trendLegend.innerHTML = "";
  elements.trendChart.innerHTML = `
    <text class="chart-loading" x="560" y="290" text-anchor="middle">
      Reading rolling averages…
    </text>`;
}

function setLiftLoading() {
  const mobileLift = document.querySelector("#mobile-lift-preview");
  if (mobileLift) mobileLift.textContent = "Reading postseason rank changes…";
  state.liftPayload = null;
  clearSupportingPanelBinding(elements.liftChart);
  elements.liftError.hidden = true;
  elements.liftLegend.innerHTML = "";
  elements.liftChart.innerHTML = `
    <text class="chart-loading" x="560" y="290" text-anchor="middle">
      Reading postseason rank changes…
    </text>`;
}

function setSortHighlight() {
  elements.sortableHeadings.forEach((heading) => {
    const button = heading.querySelector("button[data-sort]");
    const active = button.dataset.sort === state.sortBy;
    heading.classList.toggle("active-sort", active);
    heading.setAttribute(
      "aria-sort",
      active
        ? state.sortDirection === "asc"
          ? "ascending"
          : "descending"
        : "none",
    );
    button.querySelector(".sort-arrow").textContent = active
      ? state.sortDirection === "asc"
        ? "↑"
        : "↓"
      : "↕";
  });
  elements.mobileSort.value = state.sortBy;
  elements.mobileSortDirection.innerHTML = state.sortDirection === "asc"
    ? 'Low to high <span aria-hidden="true">↑</span>'
    : 'High to low <span aria-hidden="true">↓</span>';
  elements.mobileSortDirection.setAttribute(
    "aria-label",
    state.sortDirection === "asc"
      ? "Sort low to high; tap to reverse"
      : "Sort high to low; tap to reverse",
  );
}

function setHighValueSortHighlight() {
  elements.highValueSortableHeadings.forEach((heading) => {
    const button = heading.querySelector("button[data-high-value-sort]");
    const active = button.dataset.highValueSort === state.highValueSortBy;
    heading.classList.toggle("active-sort", active);
    heading.setAttribute(
      "aria-sort",
      active
        ? state.highValueSortDirection === "asc"
          ? "ascending"
          : "descending"
        : "none",
    );
    button.querySelector(".sort-arrow").textContent = active
      ? state.highValueSortDirection === "asc"
        ? "↑"
        : "↓"
      : "↕";
  });
  elements.highValueMobileSort.value = state.highValueSortBy;
  elements.highValueMobileSortDirection.innerHTML =
    state.highValueSortDirection === "asc"
      ? 'Low to high <span aria-hidden="true">↑</span>'
      : 'High to low <span aria-hidden="true">↓</span>';
  elements.highValueMobileSortDirection.setAttribute(
    "aria-label",
    state.highValueSortDirection === "asc"
      ? "Sort .500-plus records low to high; tap to reverse"
      : "Sort .500-plus records high to low; tap to reverse",
  );
}

// How a season selection is named — in the table card's header row and in the
// seasons control's own summary, from one rule so the two cannot disagree. One
// season is its own label, the whole history is "All Seasons", and several
// seasons are the first season's opening year to the last season's closing year
// beside how many were chosen: 2013-14 through 2017-18 reads
// "2013–2018 · 5 seasons" rather than "2013-14-2017-18". The count is always
// said, because a range with holes in it would otherwise claim seasons the
// table is not showing.
function seasonStartYear(season) {
  const year = Number(String(season ?? "").slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : null;
}

function seasonRangeHeading(seasons, { all = false } = {}) {
  if (all) return "All Seasons";
  const list = (seasons ?? []).filter(Boolean);
  if (!list.length) return "Player value";
  if (list.length === 1) return String(list[0]);
  const years = list.map(seasonStartYear).filter((year) => year !== null)
    .sort((left, right) => left - right);
  if (!years.length) return `${list.length} seasons`;
  const range = `${years[0]}\u2013${years[years.length - 1] + 1}`;
  return `${range} \u00b7 ${years.length} seasons`;
}

// The schedule and the game-time setting, said the way a header says them
// rather than the way a request spells them.
const SCHEDULE_HEADING_LABELS = {
  "All": "Full season",
  "Regular Season": "Regular season",
  "PlayIn": "Play-In",
  "Playoffs": "Playoffs",
  "Postseason": "Postseason",
};

const GAME_TIME_HEADING_LABELS = {
  competitive: "Garbage time excluded",
  all_minutes: "Garbage time included",
};

// The card's header row says the whole scope in words \u2014 the seasons, then the
// schedule, then whether garbage time is counted, and, only where a reader can
// choose it, which responsibility view is on screen. Pure, so a test can read
// it without a browser.
function resultsScopeLine({ seasons, all = false, phase, garbageTime, view = null }) {
  return [
    seasonRangeHeading(seasons, { all }),
    SCHEDULE_HEADING_LABELS[phase] ?? null,
    GAME_TIME_HEADING_LABELS[garbageTime] ?? null,
    view,
  ].filter(Boolean).join(" \u00b7 ");
}

function responsibilityViewLabel() {
  if (!elements.breakdownControl || elements.breakdownControl.hidden) return null;
  return elements.breakdownMode?.value === "wc"
    ? "Wins Contributed" : "Value Contributed";
}

function updateResultsHeading() {
  if (!elements.resultsScopeTitle) return;
  const seasons = selectedRankingSeasons();
  elements.resultsScopeTitle.textContent = resultsScopeLine({
    seasons,
    all: seasonSelectionIsAll(seasons),
    phase: elements.phase?.value,
    garbageTime: elements.garbageTimeMode?.value,
    view: responsibilityViewLabel(),
  });
}

// The Rank column counts the sorted table from the top, so sorting by Defense
// renumbers it 1..N down the column the reader chose. The ranking the metric
// itself publishes stays on the row (`row.rank`) for the ranking card and the
// context dialog; only the cell changed.
function displayRank(row, index) {
  const place = Number(index);
  if (Number.isFinite(place) && place >= 0) return place + 1;
  const published = Number(row?.rank);
  return Number.isFinite(published) ? published : "—";
}

function renderRows(rows) {
  if (!rows.length) {
    elements.body.innerHTML = `
      <tr class="empty-row">
        <td colspan="${visibleRankingColumnCount()}">No players match these filters.</td>
      </tr>`;
    return;
  }

  const contribution = (value, total) => {
    const numericValue = Number(value);
    const percent = Math.abs(total) > 1e-12
      ? `${number((numericValue / total) * 100)}% of total`
      : "No selected total";
    const signClass = numericValue < 0 ? " negative-value" : "";
    return `<span class="category-value${signClass}">${number(numericValue)}</span><span class="category-percent">${percent}</span>`;
  };
  const rate = (value) => {
    const signClass = Number(value) < 0 ? " negative-value" : "";
    return `<span class="rate-value${signClass}">${displayNumber(value)}</span>`;
  };
  const v8ResponsibilityCells = (row) => {
    const winsMode = selectedBreakdownMode() === "wc";
    const amountKeys = winsMode
      ? [
          "offensive_wins_contributed",
          "defensive_wins_contributed",
          "other_wins_contributed",
        ]
      : [
          "offensive_value_contributed",
          "defensive_value_contributed",
          "other_value_contributed",
        ];
    const pctKeys = winsMode
      ? [
          "offensive_wins_contributed_pct",
          "defensive_wins_contributed_pct",
          "other_wins_contributed_pct",
        ]
      : [
          "offensive_value_contributed_pct",
          "defensive_value_contributed_pct",
          "other_value_contributed_pct",
        ];
    const target = Number(winsMode ? row.wins_contributed : row.value_contributed);
    const rawAmounts = amountKeys.map((key) => row[key]);
    const amountsAvailable = rawAmounts.every(
      (value) => value !== null && value !== undefined,
    );
    const amounts = amountsAvailable
      ? displayClosedTriplet(rawAmounts, target, 3)
      : [null, null, null];
    const rawPercentages = pctKeys.map((key) => row[key]);
    const percentages = rawPercentages.every(
      (value) => value !== null && value !== undefined,
    )
      ? Math.abs(target) > 1e-12
        ? displayClosedTriplet(rawPercentages, 100, 1)
        : [0, 0, 0]
      : [null, null, null];
    // The closing keeps all three amounts, so the rounding residual still lands
    // where it belongs; only Offense and Defense are drawn. V11's other side is
    // always zero, so the two shown amounts still add to the selected total.
    const sides = ["Offense", "Defense"];
    const classes = ["offense", "defense"];
    const cells = sides.map(
        (side, index) => `
          <td class="numeric category-cell category-${classes[index]}-cell" data-label="${side} ${winsMode ? "WC" : "VC"}">
            <span class="category-value">${amounts[index] === null ? "—" : fixedDisplay(amounts[index], 3)}</span>
            <span class="category-percent">${percentages[index] === null ? "—" : `${fixedDisplay(percentages[index], 1)}%`}</span>
          </td>`,
      );
    return cells.join("");
  };
  const v8ContextCells = (row) => {
    const winsMode = selectedBreakdownMode() === "wc";
    const target = Number(winsMode ? row.wins_contributed : row.value_contributed);
    const expanded = [
      ["General O", "general_offense_context_value", "general-offense"],
      ["Teammate O", "teammate_offense_context_value", "teammate-offense"],
      ["Opponent O", "opponent_defense_context_value", "opponent-defense"],
      ["General D", "general_defense_context_value", "general-defense"],
      ["Teammate D", "teammate_defense_context_value", "teammate-defense"],
      ["Opponent D", "opponent_offense_context_value", "opponent-offense"],
    ];
    const rawAmount = row.side_context_raw_value ?? row.raw_vc;
    const rawAmounts = [rawAmount, ...expanded.map(([, key]) => row[key])];
    const contextAvailable = rawAmounts.every(
      (value) => value !== null && value !== undefined,
    );
    const closedExpanded = contextAvailable
      ? displayClosedTriplet(rawAmounts, target, 3)
      : rawAmounts.map(() => null);
    const expandedPercentages = closedExpanded.every(
      (value) => value !== null && value !== undefined,
    ) && Math.abs(target) > 1e-12
      ? displayClosedTriplet(
          closedExpanded.map((value) => (Number(value) / target) * 100),
          100,
          1,
        )
      : closedExpanded.map(() => null);
    const offenseContext = closedExpanded.slice(1, 4)
      .reduce((total, value) => total + Number(value || 0), 0);
    const defenseContext = closedExpanded.slice(4, 7)
      .reduce((total, value) => total + Number(value || 0), 0);
    const collapsedAmounts = contextAvailable
      ? displayClosedTriplet(
          [closedExpanded[0], offenseContext, defenseContext],
          target,
          3,
        )
      : [null, null, null];
    const collapsedPercentages = contextAvailable && Math.abs(target) > 1e-12
      ? displayClosedTriplet(
          collapsedAmounts.map((value) => (Number(value) / target) * 100),
          100,
          1,
        )
      : [null, null, null];
    const cell = ({ label, amount, percentage, className, visibilityClass }) => {
      const amountSignClass = Number(amount) < 0 ? " negative-value" : "";
      const percentSignClass = Number(percentage) < 0 ? " negative-value" : "";
      return `
        <td class="numeric category-cell context-composition-cell context-column ${visibilityClass} context-${className}-cell" data-label="${label} ${winsMode ? "WC" : "VC"}">
          <span class="category-percent context-primary-percentage${percentSignClass}">${percentage === null || percentage === undefined ? "—" : `${fixedDisplay(percentage, 1)}%`}</span>
          <span class="category-value context-raw-amount${amountSignClass}">${amount === null || amount === undefined ? "—" : `raw ${fixedDisplay(amount, 3)}`}</span>
        </td>`;
    };
    // The six per-factor amounts are still calculated, because the two side
    // totals are their sums and the closing is over all seven; the table shows
    // the three summary columns and the Context dialog shows the six.
    return [
      cell({
        label: "Raw",
        amount: collapsedAmounts[0],
        percentage: collapsedPercentages[0],
        className: "raw",
        visibilityClass: "context-raw-column",
      }),
      cell({
        label: "Offense Context",
        amount: collapsedAmounts[1],
        percentage: collapsedPercentages[1],
        className: "offense-total",
        visibilityClass: "context-collapsed-column",
      }),
      cell({
        label: "Defense Context",
        amount: collapsedAmounts[2],
        percentage: collapsedPercentages[2],
        className: "defense-total",
        visibilityClass: "context-collapsed-column",
      }),
    ].join("");
  };
  elements.body.innerHTML = rows
    .map((row, index) => {
      const teamLinks = row.teams.map((team) => `<a href="${entityAnalyticsUrl("teams", team.id ?? team.team_id)}">${escapeHtml(team.abbreviation)}</a>`).join(" · ");
      // The name opens the player's page; "Context" opens the dialog beside it,
      // for every source that can answer one. The Compare link is tabled with
      // the experiments (note of 2026-09-28), so it is drawn only with the
      // switch on.
      const compareAction = EXPERIMENTS_ON
        ? `<a class="compare-player-link" href="${playerComparisonUrl(row)}">Compare</a>`
        : "";
      const contextAction = hasPlayerContext()
        ? `${compareAction ? '<span class="ranking-context-separator" aria-hidden="true">·</span>' : ""}<span class="compare-player-link view-context" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="${state.selectedContextPlayerId === String(row.player_id)}" data-player-id="${escapeHtml(String(row.player_id))}" data-player-name="${escapeHtml(row.player_name)}">Context</span>`
        : "";
      // A phone hides the Context action and its separator, so when nothing
      // else comes before the teams their separator is hidden with them.
      const teamsSeparator = compareAction
        ? '<span aria-hidden="true">·</span>'
        : contextAction ? '<span class="ranking-context-separator" aria-hidden="true">·</span>' : "";
      const playerName = `<a class="player-name player-profile-link" href="${entityAnalyticsUrl("players", row.player_id)}">${escapeHtml(row.player_name)}</a><span class="player-row-actions">${compareAction}${contextAction}${teamLinks ? `${teamsSeparator}<span class="player-teams" title="${escapeHtml(row.teams.map((team) => team.name).join(" · "))}">${teamLinks}</span>` : ""}</span>`;
      const sideCells = isV8()
        ? v8ResponsibilityCells(row)
        : `
          <td class="numeric category-cell category-offense-cell" data-label="Offense">${contribution(row.offense_value, Number(row.value_contributed))}</td>
          <td class="numeric category-cell category-defense-cell" data-label="Defense">${contribution(row.defense_value, Number(row.value_contributed))}</td>
          <td class="numeric category-cell category-hustle-cell" data-label="Hustle">${contribution(row.hustle_value, Number(row.value_contributed))}</td>`;
      return `
        <tr>
          <td class="rank-number" data-label="Rank">${displayRank(row, index)}</td>
          <td class="player-cell">
            ${mobileCardHeadshot(row.player_id)}
            ${playerName}
          </td>
          <td class="numeric total-cell" data-label="Wins VC" title="${row.wins_contributed}">${number(row.wins_contributed)}</td>
          <td class="numeric total-cell" data-label="VC" title="${row.value_contributed}">${number(row.value_contributed)}</td>
          <td class="numeric total-cell" data-label="Loss VC" title="${row.losses_contributed}">${number(row.losses_contributed)}</td>
          <td class="numeric rate-cell" data-label="VC / game">${rate(row.value_per_game)}</td>
          ${sideCells}
          ${isV8() ? v8ContextCells(row) : ""}
          <td class="numeric summary-cell" data-label="GP">${row.games_played}</td>
          <td class="numeric summary-cell" data-label="Wins">${row.wins ?? "—"}</td>
          <td class="numeric summary-cell" data-label="Losses">${row.losses ?? "—"}</td>
        </tr>`;
    })
    .join("");
}

function mobileCardHeadshot(playerId) {
  return `<picture class="ranking-headshot" aria-hidden="true">
    <source media="(max-width: 760px)" srcset="https://cdn.nba.com/headshots/nba/latest/260x190/${encodeURIComponent(playerId)}.png" />
    <img src="${RANKING_HEADSHOT_FALLBACK}" alt="" width="40" height="40" loading="lazy" decoding="async" />
  </picture>`;
}

[elements.body, elements.topGamesBody, elements.seasonWinsBody].forEach(body => body.addEventListener("error", (event) => {
  const image = event.target;
  if (!image.matches?.(".ranking-headshot img")) return;
  const source = image.closest("picture").querySelector("source");
  if (source) { source.remove(); image.src = RANKING_HEADSHOT_FALLBACK; }
  else image.hidden = true;
}, true));

function displayGameDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function gameStageLabel(value) {
  return {
    "Regular Season": "Regular season",
    PlayIn: "Play-In",
    Playoffs: "Playoffs",
  }[value] ?? value;
}

function renderTopGames(rows) {
  if (!rows.length) {
    elements.topGamesBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="10">No games match these filters.</td>
      </tr>`;
    return;
  }

  elements.topGamesBody.innerHTML = rows
    .map((row) => {
      const venue = row.location === "home" ? "vs." : row.location === "away" ? "@" : "vs.";
      const outcomeClass = row.win_loss ? "game-win" : "game-loss";
      const outcomeShort = row.win_loss ? "W" : "L";
      return `
        <tr data-panel-row="${supportingPanelDatum(row)}">
          <td class="rank-number" data-label="Rank">${row.rank}</td>
          <td class="player-cell">
            ${mobileCardHeadshot(row.player_id)}
            <a class="player-name" href="${topGameProfileHref(row)}">${escapeHtml(row.player_name)}</a>
          </td>
          <td class="game-season-cell" data-label="Season">
            <strong>${escapeHtml(row.season)}</strong>
          </td>
          <td class="game-date-cell" data-label="Date">
            ${escapeHtml(displayGameDate(row.game_date))}
          </td>
          <td class="game-team-cell" data-label="Team">
            <strong>${escapeHtml(row.team.abbreviation)}</strong>
            <span>${escapeHtml(row.team.name)}</span>
          </td>
          <td class="game-opponent-cell" data-label="Opponent">
            <strong>${venue} ${escapeHtml(row.opponent.abbreviation)}</strong>
            <span>${escapeHtml(row.opponent.name)}</span>
          </td>
          <td class="game-stage-cell" data-label="Stage">
            ${escapeHtml(gameStageLabel(row.season_type))}
          </td>
          <td class="game-outcome-cell" data-label="Result">
            <span class="game-result ${outcomeClass}" aria-label="${escapeHtml(row.outcome)}">${outcomeShort}</span>
          </td>
          <td class="numeric game-value-cell" data-label="Value Contributed" title="${row.value_contributed}">
            ${number(row.value_contributed)}
          </td>
          <td data-label="Build"><a class="game-anatomy-button" href="${topGameProfileHref(row)}">See build</a></td>
        </tr>`;
    })
    .join("");
}

function topGameProfileHref(row) {
  const params = new URLSearchParams({
    source: elements.statVersion.value === "original" ? "v9" : elements.statVersion.value,
    player_id: String(row.player_id),
    season: String(row.season),
    schedule: "all",
    time_mode: elements.garbageTimeMode.value,
    metric: "wins_contributed",
    game_id: String(row.game_id),
  });
  return `/players?${params}`;
}

function seasonWinsPhase() {
  return document.querySelector('input[name="season-wins-phase"]:checked')?.value || "Regular Season";
}

function renderSeasonWinsLeaders(rows) {
  if (!rows.length) {
    elements.seasonWinsBody.innerHTML = '<tr class="empty-row"><td colspan="6">No season leaders are available.</td></tr>';
    return;
  }
  elements.seasonWinsBody.innerHTML = rows.map((row) => `
    <tr data-panel-row="${supportingPanelDatum(row)}">
      <td class="rank-number" data-label="Rank">${row.rank}</td>
      <td class="player-cell">${mobileCardHeadshot(row.player_id)}<span class="player-name">${escapeHtml(row.player_name)}</span><span class="player-teams" title="${escapeHtml(row.teams.map((team) => team.name).join(" · "))}">${escapeHtml(row.season)} · ${row.teams.map((team) => escapeHtml(team.abbreviation)).join(" · ")}</span></td>
      <td class="numeric" data-label="Games">${row.games_played}</td>
      <td class="numeric season-wins-total-cell" data-label="Wins VC" title="${row.wins_contributed}">${number(row.wins_contributed)}</td>
      <td class="numeric season-wins-offense-cell" data-label="Offense" title="${row.offensive_wins_contributed}">${number(row.offensive_wins_contributed)}<span class="category-percent">${number((row.offensive_wins_contributed / row.wins_contributed) * 100)}%</span></td>
      <td class="numeric season-wins-defense-cell" data-label="Defense" title="${row.defensive_wins_contributed}">${number(row.defensive_wins_contributed)}<span class="category-percent">${number((row.defensive_wins_contributed / row.wins_contributed) * 100)}%</span></td>
    </tr>`).join("");
}

async function loadSeasonWinsLeaders() {
  state.seasonWinsController?.abort();
  state.seasonWinsController = new AbortController();
  setSeasonWinsLoading();
  try {
    const params = new URLSearchParams({
      stat_version: apiStatVersion(),
      phase: seasonWinsPhase(),
      garbage_time_mode: elements.garbageTimeMode.value,
      limit: selectedSeasonWinsLimit(),
    });
    addSelectedExperimentParam(params);
    const payload = await requestRankingPanel({
      panel: "season-wins-leaders",
      url: "/api/rankings/season-wins-leaders",
      params,
      signal: state.seasonWinsController.signal,
    });
    renderSeasonWinsLeaders(payload.rows);
    bindSupportingPanelPayload(elements.seasonWinsBody, payload);
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false;
    elements.seasonWinsBody.innerHTML = "";
    elements.seasonWinsError.textContent = error.message;
    elements.seasonWinsError.hidden = false;
    return false;
  }
}

function renderHighValueRecords(rows) {
  if (!rows.length) {
    elements.highValueRecordsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">No players have a .500-plus game.</td>
      </tr>`;
    return;
  }

  elements.highValueRecordsBody.innerHTML = rows
    .map(
      (row) => `
        <tr data-panel-row="${supportingPanelDatum(row)}">
          <td class="rank-number" data-label="Rank">${row.rank}</td>
          <td class="player-cell">
            <span class="player-name">${escapeHtml(row.player_name)}</span>
          </td>
          <td class="numeric high-value-summary-cell" data-label="Games ≥ .500">${row.games_played}</td>
          <td class="numeric high-value-summary-cell" data-label="Wins">${row.wins}</td>
          <td class="numeric high-value-total-cell" data-label="Value Contributed" title="${row.value_contributed}">${number(row.value_contributed)}</td>
          <td class="numeric high-value-total-cell" data-label="Wins Contributed" title="${row.wins_contributed}">${number(row.wins_contributed)}</td>
          <td class="numeric high-value-win-rate" data-label="Winning percentage">${percentage(row.winning_percentage)}</td>
        </tr>`,
    )
    .join("");
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

function scheduleLabel(phase) {
  const labels = {
    All: "Full season",
    "Regular Season": "Regular season",
    PlayIn: "Play-In",
    Playoffs: "Playoffs",
    Postseason: "Postseason",
  };
  return labels[phase] ?? phase;
}

function resetExpandedChart({ restoreFocus = true } = {}) {
  const panel = state.expandedChartPanel;
  const trigger = state.expandedChartTrigger;
  if (!panel) return;

  panel.classList.remove("is-expanded");
  trigger?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("chart-expanded");
  state.expandedChartPanel = null;
  state.expandedChartTrigger = null;
  matchLegendHeightToChart(elements.trendChart, elements.trendLegend);
  matchLegendHeightToChart(elements.liftChart, elements.liftLegend);
  if (screen.orientation?.unlock) screen.orientation.unlock();
  if (restoreFocus) trigger?.focus();
}

async function closeExpandedChart() {
  const panel = state.expandedChartPanel;
  if (!panel) return;
  if (document.fullscreenElement === panel && document.exitFullscreen) {
    try {
      await document.exitFullscreen();
    } catch (_error) {
      resetExpandedChart();
    }
    return;
  }
  resetExpandedChart();
}

async function expandChart(trigger) {
  const panel = document.querySelector(
    `[data-chart-panel="${trigger.dataset.chartExpand}"]`,
  );
  if (!panel) return;

  if (state.expandedChartPanel && state.expandedChartPanel !== panel) {
    resetExpandedChart({ restoreFocus: false });
  }
  state.expandedChartPanel = panel;
  state.expandedChartTrigger = trigger;
  panel.classList.add("is-expanded");
  trigger.setAttribute("aria-expanded", "true");
  document.body.classList.add("chart-expanded");
  panel.querySelector("[data-chart-close]")?.focus();

  if (panel.requestFullscreen) {
    try {
      await panel.requestFullscreen();
    } catch (_error) {
      // The fixed-position view remains usable when fullscreen is unavailable.
    }
  }
  if (screen.orientation?.lock) {
    try {
      await screen.orientation.lock("landscape");
    } catch (_error) {
      // iOS and some browsers require the user to rotate manually.
    }
  }
}

function setupMobileCharts() {
  document.querySelectorAll("[data-chart-expand]").forEach((trigger) => {
    trigger.addEventListener("click", () => expandChart(trigger));
  });
  document.querySelectorAll("[data-chart-close]").forEach((button) => {
    button.addEventListener("click", closeExpandedChart);
  });
  document.addEventListener("fullscreenchange", () => {
    if (state.expandedChartPanel && !document.fullscreenElement) {
      resetExpandedChart();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.expandedChartPanel) {
      closeExpandedChart();
    }
  });
}

function renderContextPagination(pagination) {
  elements.contextPageStatus.textContent = pagination.total_pages
    ? `Page ${pagination.page} of ${pagination.total_pages}`
    : "No pages";
  elements.contextPagePrevious.disabled = pagination.page <= 1;
  elements.contextPageNext.disabled =
    pagination.total_pages === 0 || pagination.page >= pagination.total_pages;
}

// The six on-court context factors, in the project's standing order, with the
// plain words the dialog and the rankings table both use. The three offense-side
// factors come first: a player's own lineups on offense, the teammates he played
// with, and the defenses he faced.
const CONTEXT_FACTORS = Object.freeze([
  { key: "general_offense", label: "Own lineups · offense", side: "offense" },
  { key: "teammate_offense", label: "Teammates · offense", side: "offense" },
  { key: "opponent_defense", label: "Defenses faced", side: "offense" },
  { key: "general_defense", label: "Own lineups · defense", side: "defense" },
  { key: "teammate_defense", label: "Teammates · defense", side: "defense" },
  { key: "opponent_offense", label: "Offenses faced", side: "defense" },
]);

function isFiniteValue(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

// A percentage change of one factor's own multiplier. V11 publishes all six
// directly; V9 publishes four and the six multipliers they come from, so the
// other two are read back out of those rather than left blank.
function factorMultiplierPercentage(game, key) {
  const published = game[`${key}_multiplier_percentage`];
  if (isFiniteValue(published)) return Number(published);
  const multiplier = game.factor_multipliers?.[key];
  return isFiniteValue(multiplier) ? (Number(multiplier) - 1) * 100 : null;
}

// Every statistic that answers this dialog publishes Raw plus the six factor
// amounts, and the three the dialog collapses them into — Raw, the offense-side
// group and the defense-side group — add up to the published total. When a
// deployment has not built the breakdown, `context_decomposition.available` is
// false and the payload says why; the dialog then shows the total and the
// reason rather than a share of nothing.
function renderContextPayload(payload) {
  const summary = payload.summary;
  const decomposition = payload.context_decomposition ?? null;
  const contextAvailable = decomposition ? decomposition.available !== false : true;
  const contextReason = decomposition?.reason
    || "This deployment publishes no context breakdown for this statistic.";
  const breakdownLabel = (payload.breakdown_mode ?? selectedBreakdownMode()) === "wc" ? "WC" : "VC";
  const summaryAmounts = displayClosedTriplet(
    [
      summary.raw_no_context_value,
      summary.teammate_context_value,
      summary.opponent_context_value,
    ],
    summary.final_value,
    3,
  );
  const rawSummaryPercentages = [
    summary.raw_no_context_pct,
    summary.teammate_context_pct,
    summary.opponent_context_pct,
  ];
  const summaryPercentages = rawSummaryPercentages.every(isFiniteValue)
    ? displayClosedTriplet(rawSummaryPercentages, 100, 1)
    : [null, null, null];
  const summaryLabels = ["Raw · no context", "Offense context", "Defense context"];
  const summaryCards = summaryLabels
    .map(
      (label, index) => `
        <div class="context-summary-card">
          <span>${label}</span>
          <strong>${fixedDisplay(summaryAmounts[index], 3)}</strong>
          <small>${summaryPercentages[index] === null ? "—" : `${fixedDisplay(summaryPercentages[index], 1)}% of final`}</small>
        </div>`,
    )
    .join("");

  // The scope totals of the six, which add to the two group amounts above them.
  const scopeFactors = CONTEXT_FACTORS.map((factor) => ({
    ...factor,
    value: summary[`${factor.key}_context_value`],
  }));
  const scopeFactorsPublished = contextAvailable
    && scopeFactors.every((factor) => isFiniteValue(factor.value));
  const scopeTotal = scopeFactors.reduce((total, factor) => total + Number(factor.value || 0), 0);
  const finalTotal = Number(summary.final_value);
  const factorSection = scopeFactorsPublished
    ? `
      <section class="context-factor-summary" aria-label="The six context factors over this scope">
        <h3>The six context factors</h3>
        <p class="context-factor-note">Context moves value between teammates and never adds any: over this scope the six together are ${signedNumber(scopeTotal)} ${breakdownLabel}, against a published total of ${fixedDisplay(finalTotal, 3)}.</p>
        <ul class="context-factor-list">
          ${scopeFactors.map((factor) => `
            <li class="context-factor context-factor-${factor.side}">
              <span>${factor.label}</span>
              <strong class="${Number(factor.value) < 0 ? "negative-value" : ""}">${signedNumber(factor.value)}</strong>
              <small>${Math.abs(finalTotal) > 1e-12 ? `${fixedDisplay((Number(factor.value) / finalTotal) * 100, 2)}% of final` : "—"}</small>
            </li>`).join("")}
        </ul>
      </section>`
    : `<p class="context-unavailable-note">${escapeHtml(contextReason)}</p>`;

  const ppp = (points, possessions) =>
    Number(possessions) > 0 ? fixedDisplay(Number(points) / Number(possessions), 3) : "—";
  const evidence = (value) => (isFiniteValue(value) ? fixedDisplay(value, 3) : "—");
  const gameCards = payload.games.length
    ? payload.games
        .map((game) => {
          const contextAmounts = displayClosedTriplet(
            [
              game.raw_no_context_contribution,
              game.teammate_context_contribution,
              game.opponent_context_contribution,
            ],
            game.final_value_contributed,
            3,
          );
          const contextPercentages = isFiniteValue(game.raw_percent_of_final)
            ? displayClosedTriplet(
                [
                  game.raw_percent_of_final,
                  game.teammate_percent_of_final,
                  game.opponent_percent_of_final,
                ],
                100,
                1,
              )
            : [null, null, null];
          const gameFactors = CONTEXT_FACTORS.map((factor) => ({
            ...factor,
            value: game[`${factor.key}_context`],
            percentage: factorMultiplierPercentage(game, factor.key),
          }));
          const gameFactorsPublished = contextAvailable
            && gameFactors.every((factor) => isFiniteValue(factor.value));
          const outcome = game.win_loss ? "Win" : "Loss";
          const hasPpp = [
            game.offensive_possessions_on,
            game.defensive_possessions_on,
            game.opponent_defense_strength_mean,
            game.opponent_offense_strength_mean,
          ].some(isFiniteValue);
          const hasBasis = [
            game.offense_responsibility_basis,
            game.defense_responsibility_basis,
            game.other_responsibility_basis,
          ].some(isFiniteValue);
          // The same signed ledger after the team's own strength and the six
          // context factors have been applied to it.
          const hasAdjusted = [
            game.signed_adjusted_offense,
            game.signed_adjusted_defense,
            game.signed_adjusted_other,
          ].some(isFiniteValue);
          return `
            <details
              class="context-game"
              data-context-game-id="${escapeHtml(String(game.game_id))}"
              data-context-player-id="${escapeHtml(String(game.player_id))}"
            >
              <summary>
                <span><strong>${escapeHtml(displayGameDate(game.game_date))}</strong> · ${escapeHtml(game.team_abbreviation ?? game.team?.abbreviation ?? "—")} vs ${escapeHtml(game.opponent_abbreviation ?? game.opponent?.abbreviation ?? "—")} · ${outcome}</span>
                <span>${fixedDisplay(game.final_value_contributed, 3)} ${breakdownLabel}</span>
              </summary>
              <div class="context-game-grid">
                ${contextAvailable ? `
                <section>
                  <h4>Context composition</h4>
                  ${summaryLabels.map((label, index) => `<p><span>${label}</span><strong>${fixedDisplay(contextAmounts[index], 3)} · ${contextPercentages[index] === null ? "—" : `${fixedDisplay(contextPercentages[index], 1)}%`}</strong></p>`).join("")}
                </section>` : `
                <section class="context-unavailable">
                  <h4>Context composition</h4>
                  <p>${escapeHtml(contextReason)}</p>
                </section>`}
                ${gameFactorsPublished ? `
                <section class="context-game-factors">
                  <h4>The six context factors</h4>
                  ${gameFactors.map((factor) => `<p><span>${factor.label}</span><strong>${signedNumber(factor.value)} · ${factor.percentage === null ? "—" : signedNumber(factor.percentage, "%")}</strong></p>`).join("")}
                </section>` : ""}
                <section>
                  <h4>Responsibility</h4>
                  <p><span>Offense</span><strong>${fixedDisplay(game.offensive_value_contributed, 3)}</strong></p>
                  <p><span>Defense</span><strong>${fixedDisplay(game.defensive_value_contributed, 3)}</strong></p>
                  <p><span>Other</span><strong>${fixedDisplay(game.other_value_contributed, 3)}</strong></p>
                  ${isFiniteValue(game.actual_seconds) ? `<p><span>Minutes in scope</span><strong>${fixedDisplay(Number(game.actual_seconds) / 60, 1)}</strong></p>` : ""}
                </section>
                <section>
                  <h4>Signed evidence, before and after context</h4>
                  <p><span>Offense</span><strong>${signedNumber(game.signed_raw_offense)}${hasAdjusted ? ` → ${signedNumber(game.signed_adjusted_offense)}` : ""}</strong></p>
                  <p><span>Defense</span><strong>${signedNumber(game.signed_raw_defense)}${hasAdjusted ? ` → ${signedNumber(game.signed_adjusted_defense)}` : ""}</strong></p>
                  <p><span>Other</span><strong>${signedNumber(game.signed_raw_other)}${hasAdjusted ? ` → ${signedNumber(game.signed_adjusted_other)}` : ""}</strong></p>
                </section>
                <section>
                  <h4>How much each side's multiplier moved</h4>
                  <p><span>Teammates offense / defense</span><strong>${signedNumber(game.teammate_offense_multiplier_percentage, "%")} / ${signedNumber(game.teammate_defense_multiplier_percentage, "%")}</strong></p>
                  <p><span>Opponents offense / defense</span><strong>${signedNumber(game.opponent_offense_multiplier_percentage, "%")} / ${signedNumber(game.opponent_defense_multiplier_percentage, "%")}</strong></p>
                  <p><span>All three together, offense / defense</span><strong>${signedNumber(game.combined_offense_multiplier_percentage, "%")} / ${signedNumber(game.combined_defense_multiplier_percentage, "%")}</strong></p>
                </section>
                ${hasPpp ? `
                <section>
                  <h4>Points per possession on the floor</h4>
                  <p><span>Offense actual / expected</span><strong>${ppp(game.actual_offense_points_on, game.offensive_possessions_on)} / ${ppp(game.expected_offense_points_on, game.offensive_possessions_on)}</strong></p>
                  <p><span>Opponent actual / expected</span><strong>${ppp(game.actual_opponent_points_on, game.defensive_possessions_on)} / ${ppp(game.expected_opponent_points_on, game.defensive_possessions_on)}</strong></p>
                  <p><span>Opponent defense / offense strength</span><strong>${signedNumber(game.opponent_defense_strength_mean)} / ${signedNumber(game.opponent_offense_strength_mean)}</strong></p>
                </section>` : ""}
                <section>
                  <h4>What the evidence was made of</h4>
                  <p><span>Helped O / D / Other</span><strong>${evidence(game.offense_component_positive)} / ${evidence(game.defense_component_positive)} / ${evidence(game.other_component_positive)}</strong></p>
                  <p><span>Cost O / D / Other</span><strong>${evidence(game.offense_component_negative_magnitude)} / ${evidence(game.defense_component_negative_magnitude)} / ${evidence(game.other_component_negative_magnitude)}</strong></p>
                  ${hasBasis ? `<p><span>Basis O / D / Other</span><strong>${evidence(game.offense_responsibility_basis)} / ${evidence(game.defense_responsibility_basis)} / ${evidence(game.other_responsibility_basis)}</strong></p>` : ""}
                </section>
              </div>
            </details>`;
        })
        .join("")
    : '<p class="context-empty">No games match this exact scope.</p>';

  elements.contextDialogContent.innerHTML = `
    <section
      class="context-summary"
      aria-label="Selected-scope context composition"
      data-context-player-id="${escapeHtml(String(payload.player_id))}"
      data-context-run-id="${escapeHtml(String(payload.run_id || ""))}"
    >
      ${summaryCards}
      <div class="context-summary-total"><span>Selected final ${breakdownLabel}</span><strong>${fixedDisplay(summary.final_value, 3)}</strong></div>
    </section>
    ${factorSection}
    <section class="context-games" aria-label="Player game context">
      <h3>Player games</h3>
      ${gameCards}
    </section>`;
  renderContextPagination(payload.pagination);
}

async function loadPlayerContext() {
  if (!hasPlayerContext() || !state.selectedContextPlayerId) return;
  state.contextController?.abort();
  const controller = new AbortController();
  state.contextController = controller;
  const requestPlayerId = state.selectedContextPlayerId;
  const requestPage = state.contextPage;
  const requestScopeSignature = currentContextScopeSignature();
  elements.contextDialogError.hidden = true;
  elements.contextDialogContent.innerHTML = "<p>Loading exact-scope context…</p>";
  elements.contextPageStatus.textContent = "Loading…";
  elements.contextPagePrevious.disabled = true;
  elements.contextPageNext.disabled = true;
  const params = new URLSearchParams({
    player_id: requestPlayerId,
    season: contextSeasonValue(),
    phase: elements.phase.value,
    garbage_time_mode: elements.garbageTimeMode.value,
    stat_version: apiStatVersion(),
    breakdown_mode: selectedBreakdownMode(),
    page: String(requestPage),
    per_page: "20",
  });
  try {
    const payload = await requestRankingPanel({
      panel: "player-context",
      url: "/api/rankings/player-context",
      params,
      signal: controller.signal,
    });
    if (requestScopeSignature !== currentContextScopeSignature()) return;
    if (requestScopeSignature !== responseContextScopeSignature(payload)) {
      throw new Error("Player context response did not match the requested scope.");
    }
    if (payload.games[0]?.player_name) {
      state.selectedContextPlayerName = payload.games[0].player_name;
    }
    // The name arrives with the payload; until then the dialog is generic.
    elements.contextDialogTitle.textContent = state.selectedContextPlayerName
      ? `${state.selectedContextPlayerName} context`
      : "Player context";
    const scope = payload.season === "All Seasons" ? "Career" : payload.season;
    elements.contextDialogMeta.textContent = `${scope} · ${scheduleLabel(payload.phase)} · ${garbageTimeLabel()} · ${selectedBreakdownMode() === "wc" ? "Wins Contributed" : "Value Contributed"}`;
    renderContextPayload(payload);
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.contextDialogContent.innerHTML = "";
    elements.contextDialogError.textContent = error.message;
    elements.contextDialogError.hidden = false;
    elements.contextPageStatus.textContent = "";
  }
}

function openPlayerContext(playerId, playerName, trigger = null, pushUrl = true) {
  if (!hasPlayerContext()) return;
  state.selectedContextPlayerId = String(playerId);
  state.selectedContextPlayerName = playerName || "Unknown player";
  state.contextPage = 1;
  state.contextTrigger = trigger;
  trigger?.setAttribute("aria-expanded", "true");
  if (!elements.contextDialog.open) elements.contextDialog.showModal();
  syncUrl(pushUrl ? "push" : "replace");
  loadPlayerContext();
}

function closePlayerContext({ updateUrl = true, restoreFocus = true } = {}) {
  state.contextController?.abort();
  const trigger = state.contextTrigger;
  const selectedPlayerId = state.selectedContextPlayerId;
  const currentTrigger = Array.from(
    elements.body.querySelectorAll(".view-context"),
  ).find((button) => button.dataset.playerId === selectedPlayerId);
  trigger?.setAttribute("aria-expanded", "false");
  currentTrigger?.setAttribute("aria-expanded", "false");
  state.selectedContextPlayerId = null;
  state.selectedContextPlayerName = null;
  state.contextPage = 1;
  state.contextTrigger = null;
  if (elements.contextDialog.open) elements.contextDialog.close();
  if (updateUrl) syncUrl();
  if (restoreFocus) {
    const focusTarget = trigger?.isConnected ? trigger : currentTrigger;
    focusTarget?.focus();
  }
}

function syncUrl(historyMode = "replace") {
  const params = new URLSearchParams({
    stat_version: elements.statVersion.value,
    phase: elements.phase.value,
    garbage_time_mode: elements.garbageTimeMode.value,
    limit: elements.limit.value,
    trend_phase: selectedTrendPhase(),
    trend_window: String(selectedTrendWindow()),
    lift_window: String(selectedLiftWindow()),
    lift_group: selectedLiftGroup(),
    season_wins_limit: selectedSeasonWinsLimit(),
    game_phase: selectedTopGamesPhase(),
    game_outcome: selectedTopGamesOutcome(),
    high_value_sort_by: state.highValueSortBy,
    high_value_sort_direction: state.highValueSortDirection,
    high_value_phase: selectedHighValuePhase(),
    sort_by: state.sortBy,
    sort_direction: state.sortDirection,
  });
  const seasons = selectedRankingSeasons();
  if (seasonSelectionIsAll(seasons)) {
    params.append("season", "All Seasons");
  } else {
    seasons.forEach((season) => params.append("season", season));
  }
  if (isV8()) params.set("breakdown_mode", selectedBreakdownMode());
  if (state.selectedContextPlayerId) {
    params.set("player_id", state.selectedContextPlayerId);
    params.set("context_page", String(state.contextPage));
    const contextRunId = selectedContextRunId();
    if (contextRunId) params.set("context_run_id", contextRunId);
  }
  if (elements.search.value.trim()) {
    params.set("search", elements.search.value.trim());
  }
  const serializePanels = state.rankingsVisualModule?.serializeOpenPanels;
  if (serializePanels) params.set("panels", serializePanels(currentOpenPanels()));
  const method = historyMode === "push" ? "pushState" : "replaceState";
  history[method]({ playerContext: Boolean(state.selectedContextPlayerId) }, "", `?${params.toString()}`);
}

async function loadRankings() {
  const selectedSeasons = selectedRankingSeasons();
  if (!selectedSeasons.length) {
    clearShareableRankings();
    return false;
  }
  if (!contextSeasonValue(selectedSeasons)
      && state.multiSeasonModule?.MULTI_SEASON_UNAVAILABLE_SORTS.has(state.sortBy)) {
    state.sortBy = "wins_contributed";
    state.sortDirection = "desc";
  }

  updateV8Presentation();
  updateResultsHeading();
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const requestScopeSignature = rankingScopeSignature();
  setSortHighlight();
  setLoading();
  syncUrl();

  try {
    const directSeason = contextSeasonValue(selectedSeasons);
    let payload;
    if (directSeason) {
      const params = new URLSearchParams({
        stat_version: apiStatVersion(),
        season: directSeason,
        phase: elements.phase.value,
        garbage_time_mode: elements.garbageTimeMode.value,
        sort_by: state.sortBy,
        sort_direction: state.sortDirection,
        limit: String(selectedRankingLimit() ?? API_RANKING_ROW_CEILING),
        search: elements.search.value.trim(),
        breakdown_mode: selectedBreakdownMode(),
      });
      if (selectedExperimentId()) params.set("experiment_id", selectedExperimentId());
      payload = await requestRankingPanel({
        panel: "rankings",
        url: "/api/rankings",
        params,
        signal: controller.signal,
      });
    } else {
      const payloads = await Promise.all(selectedSeasons.map(async (season) => {
        const params = new URLSearchParams({
          stat_version: apiStatVersion(),
          season,
          phase: elements.phase.value,
          garbage_time_mode: elements.garbageTimeMode.value,
          sort_by: state.sortBy,
          sort_direction: state.sortDirection,
          limit: "1000",
          search: "",
          breakdown_mode: selectedBreakdownMode(),
        });
        if (selectedExperimentId()) params.set("experiment_id", selectedExperimentId());
        return requestRankingPanel({
          panel: "rankings",
          url: "/api/rankings",
          params,
          signal: controller.signal,
        });
      }));
      payload = state.multiSeasonModule.mergeSeasonRankingPayloads(payloads, {
        seasons: selectedSeasons,
        label: rankingSeasonLabel(selectedSeasons),
        sortBy: state.sortBy,
        sortDirection: state.sortDirection,
        metric: "value_contributed",
        search: elements.search.value.trim(),
        limit: selectedRankingLimit() ?? MERGED_RANKING_ROW_CEILING,
      });
    }
    if (
      state.controller !== controller
      || requestScopeSignature !== rankingScopeSignature()
    ) return false;
    state.rankingsRunId = payload.run_id;
    // V11 names its engine rather than one run; the dialog binds on it.
    state.rankingsEngineVersion = payload.source?.engine_version ?? null;
    state.rankingsPayload = payload;
    state.rankingsScopeSignature = requestScopeSignature;
    renderRows(payload.rows);
    await state.rankingsVisualWorkspace?.render(payload);
    elements.body.dataset.rankingSource = currentRankingScope().source;
    elements.body.dataset.rankingReleaseId = payload.release_id || "";
    elements.body.dataset.rankingRunId = payload.run_id || "";
    elements.body.dataset.rankingConfigurationReceipt = payload.configuration_receipt || "";
    elements.body.dataset.rankingCalculationReceipt = payload.calculation_receipt
      || payload.receipt
      || payload.run_receipt
      || "";
    elements.body.dataset.rankingScopeSignature = requestScopeSignature;
    updateRankingCardAvailability();
    if (state.selectedContextPlayerId && hasPlayerContext()) loadPlayerContext();
    return true;
  } catch (error) {
    if (
      error.name === "AbortError"
      || state.controller !== controller
      || requestScopeSignature !== rankingScopeSignature()
    ) return false;
    elements.body.innerHTML = "";
    clearShareableRankings();
    elements.error.textContent = readableError(error);
    elements.error.hidden = false;
    return false;
  }
}

async function loadRankingsComparisonPayload(currentPayload) {
  if (isServerV10Experiment()) return currentPayload;
  if ((currentPayload.rows ?? []).some((row) => Number(row.regular_games) > 0
      && Number(row.postseason_games) > 0)) return currentPayload;
  const selectedSeasons = selectedRankingSeasons();
  const payloads = await Promise.all(selectedSeasons.map(async (season) => {
    const params = new URLSearchParams({
      stat_version: apiStatVersion(),
      season,
      phase: "All",
      garbage_time_mode: elements.garbageTimeMode.value,
      sort_by: "wins_contributed",
      sort_direction: "desc",
      limit: "1000",
      search: "",
      breakdown_mode: selectedBreakdownMode(),
    });
    if (selectedExperimentId()) params.set("experiment_id", selectedExperimentId());
    return requestRankingPanel({ panel: "rankings", url: "/api/rankings", params });
  }));
  const byPlayer = new Map();
  for (const payload of payloads) {
    for (const row of payload.rows ?? []) {
      const key = String(row.player_id);
      if (!byPlayer.has(key)) byPlayer.set(key, {
        ...row,
        regular_games: 0,
        postseason_games: 0,
        regular_value_contributed: 0,
        postseason_value_contributed: 0,
        regular_wins_contributed: 0,
        postseason_wins_contributed: 0,
      });
      const target = byPlayer.get(key);
      for (const field of ["regular_games", "postseason_games", "regular_value_contributed",
        "postseason_value_contributed", "regular_wins_contributed", "postseason_wins_contributed"]) {
        target[field] += Number(row[field] ?? 0);
      }
    }
  }
  // The charts draw the players the table is showing, in the table's order, so
  // the merged comparison rows are kept to that population.
  const ordered = (currentPayload.rows ?? [])
    .map((row) => byPlayer.get(String(row.player_id)))
    .filter(Boolean);
  return { ...currentPayload, rows: ordered };
}

// The every-season chart: each season's own top players under the table's
// statistic, view, schedule and game time. Sorting, "Show" and the name search
// never change it, so one answer is kept per combination of those four.
const seasonHistoryCache = new Map();
const SEASON_HISTORY_LANE_SIZE = 50;

async function loadRankingsHistoryPayload(currentPayload, {
  breakdown = selectedBreakdownMode(),
  // The chart's own schedule, never the table's.
  schedule = "All",
} = {}) {
  if (isServerV10Experiment() || selectedExperimentId()) return null;
  // Oldest season at the top, so the chart reads down the years.
  const seasons = [...availableRankingSeasons()].sort();
  if (!seasons.length) return null;
  const selected = selectedRankingSeasons();
  const base = {
    stat_version: currentPayload.stat_version ?? apiStatVersion(),
    phase: schedule,
    garbage_time_mode: elements.garbageTimeMode.value,
    // The chart's own measure, which may differ from the table's.
    breakdown_mode: breakdown === "vc" ? "vc" : "wc",
    // Shading every row says nothing, so a whole-history table shades none.
    selected_seasons: seasonSelectionCoversAll(selected) ? [] : selected,
  };
  const metric = base.breakdown_mode === "wc" ? "wins_contributed" : "value_contributed";
  const key = [apiStatVersion(), schedule, base.garbage_time_mode, metric, seasons.join("|")].join("::");
  if (!seasonHistoryCache.has(key)) {
    const request = Promise.all(seasons.map(async (season) => {
      const params = new URLSearchParams({
        stat_version: apiStatVersion(),
        season,
        phase: schedule,
        garbage_time_mode: base.garbage_time_mode,
        sort_by: metric,
        sort_direction: "desc",
        limit: String(SEASON_HISTORY_LANE_SIZE),
        search: "",
        breakdown_mode: base.breakdown_mode,
      });
      const payload = await requestRankingPanel({ panel: "rankings", url: "/api/rankings", params });
      return { season, rows: payload.rows ?? [], total_count: payload.total_count };
    }));
    seasonHistoryCache.set(key, request);
    request.catch(() => seasonHistoryCache.delete(key));
  }
  const lanes = await seasonHistoryCache.get(key);
  return { ...base, history_lanes: lanes.filter((lane) => lane.rows.length) };
}

// "Wins Contributed by player type": each V13 type's season totals from
// /api/v13/type-trends. Only V13 has these types. One answer is kept per
// schedule, window and game-time setting.
const typeTrendCache = new Map();
const TYPE_TREND_SCHEDULE_PARAM = Object.freeze({
  All: "all", "Regular Season": "regular_season", Postseason: "postseason",
});

async function loadRankingsTypeTrendsPayload(_currentPayload, { schedule = "All", windowYears = 3 } = {}) {
  if (elements.statVersion.value !== "v13" || selectedExperimentId()) return null;
  const params = new URLSearchParams({
    schedule: TYPE_TREND_SCHEDULE_PARAM[schedule] ?? "all",
    time_mode: elements.garbageTimeMode.value === "all_minutes" ? "all_minutes" : "competitive",
    window_years: String(windowYears),
  });
  const key = params.toString();
  if (!typeTrendCache.has(key)) {
    const request = fetch(`/api/v13/type-trends?${params}`).then(async (response) => {
      if (!response.ok) {
        const detail = await responseErrorPayload(response);
        throw new Error(detail?.detail?.message ?? detail?.detail ?? "Player types over time could not be loaded.");
      }
      return response.json();
    });
    typeTrendCache.set(key, request);
    request.catch(() => typeTrendCache.delete(key));
  }
  return typeTrendCache.get(key);
}

async function loadRankingsVisualPayload(currentPayload) {
  if (isServerV10Experiment()) return currentPayload;
  // V11 describes a player season rather than publishing the per-source and
  // context vectors the V9/V10 charts project, so its style charts read the
  // landscape endpoint instead.
  if (isV11()) return attachV11Landscape(currentPayload);
  // V12 answers its own landscape, with the types its own style build fitted
  // from rung 7's profile columns; never V11's.
  if (elements.statVersion.value === "v12") return attachV12Landscape(currentPayload);
  // V13 answers its own landscape too, from its own style build when it has one.
  if (elements.statVersion.value === "v13") return attachV13Landscape(currentPayload);
  if (isServerStatVersion()
      && (currentPayload.rows ?? []).length
      && (currentPayload.rows ?? []).every(
        (row) => Object.keys(row.raw_component_totals ?? {}).length > 0,
      )) {
    return currentPayload;
  }
  // V9 and V10 need the per-source and context vectors their charts project,
  // and nothing else: the ranking rows themselves are already the population
  // the table chose, so no wider ranking request is made for the charts.
  return enrichOfficialLandscape(
    currentPayload, selectedRankingSeasons(), state.controller?.signal,
  );
}

// V12's landscape: the same route and query as V11's, under /api/v12. When its
// styles have not been built the envelope carries no types and the charts say so.
async function attachV12Landscape(payload) {
  const selectedSeasons = selectedRankingSeasons();
  const params = new URLSearchParams({
    schedule: ({
      All: "all", "Regular Season": "regular_season", PlayIn: "play_in",
      Playoffs: "playoffs", Postseason: "postseason",
    })[elements.phase.value] ?? "all",
    time_mode: elements.garbageTimeMode.value,
  });
  if (!seasonSelectionIsAll(selectedSeasons)) {
    selectedSeasons.forEach((season) => params.append("season", season));
  }
  const response = await fetch(`/api/v12/rankings/player-landscape?${params}`, {
    signal: state.controller?.signal,
  });
  if (!response.ok) throw new Error("The V12 player type landscape could not be loaded.");
  return { ...payload, player_landscape: await response.json() };
}

// V13's landscape: the same route and query again, under /api/v13. Until its
// style build is installed the envelope carries no types and the charts say so.
async function attachV13Landscape(payload) {
  const selectedSeasons = selectedRankingSeasons();
  const params = new URLSearchParams({
    schedule: ({
      All: "all", "Regular Season": "regular_season", PlayIn: "play_in",
      Playoffs: "playoffs", Postseason: "postseason",
    })[elements.phase.value] ?? "all",
    time_mode: elements.garbageTimeMode.value,
  });
  if (!seasonSelectionIsAll(selectedSeasons)) {
    selectedSeasons.forEach((season) => params.append("season", season));
  }
  const response = await fetch(`/api/v13/rankings/player-landscape?${params}`, {
    signal: state.controller?.signal,
  });
  if (!response.ok) throw new Error("The V13 player type landscape could not be loaded.");
  return { ...payload, player_landscape: await response.json() };
}

async function attachV11Landscape(payload) {
  const selectedSeasons = selectedRankingSeasons();
  const params = new URLSearchParams({
    schedule: ({
      All: "all", "Regular Season": "regular_season", PlayIn: "play_in",
      Playoffs: "playoffs", Postseason: "postseason",
    })[elements.phase.value] ?? "all",
    time_mode: elements.garbageTimeMode.value,
  });
  if (!seasonSelectionIsAll(selectedSeasons)) {
    selectedSeasons.forEach((season) => params.append("season", season));
  }
  const response = await fetch(`/api/v11/rankings/player-landscape?${params}`, {
    signal: state.controller?.signal,
  });
  if (!response.ok) throw new Error("The player type landscape could not be loaded.");
  return { ...payload, player_landscape: await response.json() };
}

async function enrichOfficialLandscape(payload, selectedSeasons, signal) {
  if (selectedExperimentId() || isServerStatVersion()) return payload;
  const params = new URLSearchParams({
    source: "v9",
    schedule: ({
      All: "all", "Regular Season": "regular_season", PlayIn: "play_in",
      Playoffs: "playoffs", Postseason: "postseason",
    })[elements.phase.value] ?? "all",
    time_mode: elements.garbageTimeMode.value,
  });
  if (!seasonSelectionIsAll(selectedSeasons)) {
    selectedSeasons.forEach((season) => params.append("season", season));
  }
  const response = await fetch(`/api/rankings/player-landscape?${params}`, { signal });
  if (!response.ok) throw new Error("The player similarity landscape could not be loaded.");
  const landscape = await response.json();
  const byPlayer = new Map((landscape.rows ?? []).map((row) => [String(row.player_id), row]));
  return {
    ...payload,
    rows: (payload.rows ?? []).map((row) => ({ ...row, ...(byPlayer.get(String(row.player_id)) ?? {}) })),
    landscape_source: landscape.source,
  };
}

async function loadTopGames() {
  state.topGamesController?.abort();
  state.topGamesController = new AbortController();
  setTopGamesLoading();
  syncUrl();

  const params = new URLSearchParams({
    stat_version: apiStatVersion(),
    season: "All Seasons",
    phase: selectedTopGamesPhase(),
    outcome: selectedTopGamesOutcome(),
    garbage_time_mode: elements.garbageTimeMode.value,
    limit: String(TOP_GAMES_LIMIT),
  });
  addSelectedExperimentParam(params);

  try {
    const payload = await requestRankingPanel({
      panel: "top-games",
      url: "/api/rankings/top-games",
      params,
      signal: state.topGamesController.signal,
    });
    renderTopGames(payload.rows);
    bindSupportingPanelPayload(elements.topGamesBody, payload);
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false;
    elements.topGamesBody.innerHTML = "";
    elements.topGamesError.textContent = error.message;
    elements.topGamesError.hidden = false;
    return false;
  }
}

async function loadHighValueRecords() {
  state.highValueRecordsController?.abort();
  state.highValueRecordsController = new AbortController();
  setHighValueSortHighlight();
  setHighValueRecordsLoading();
  syncUrl();

  const params = new URLSearchParams({
    stat_version: apiStatVersion(),
    phase: selectedHighValuePhase(),
    garbage_time_mode: elements.garbageTimeMode.value,
    sort_by: state.highValueSortBy,
    sort_direction: state.highValueSortDirection,
  });
  addSelectedExperimentParam(params);

  try {
    const payload = await requestRankingPanel({
      panel: "high-value-records",
      url: "/api/rankings/high-value-records",
      params,
      signal: state.highValueRecordsController.signal,
    });
    applyHighValueThreshold(payload.threshold);
    renderHighValueRecords(payload.rows);
    bindSupportingPanelPayload(elements.highValueRecordsBody, payload);
    elements.highValuePlayerCount.textContent = String(payload.total_players);
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false;
    elements.highValueRecordsBody.innerHTML = "";
    elements.highValuePlayerCount.textContent = "—";
    elements.highValueRecordsError.textContent = error.message;
    elements.highValueRecordsError.hidden = false;
    return false;
  }
}

function svgElement(tag, attributes = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  if (text !== null) node.textContent = text;
  return node;
}

function playerColor(index) {
  return `hsl(${Math.round((index * 137.508 + 18) % 360)} 58% 42%)`;
}

function highlightedPlayerIds() {
  return state.activeTrendPlayer ? new Set([state.activeTrendPlayer]) : new Set();
}

function applyTrendHighlight(temporaryPlayerId = null) {
  if (!state.trendPayload) return;
  const highlighted = temporaryPlayerId
    ? new Set([temporaryPlayerId])
    : highlightedPlayerIds();
  const hasHighlight = highlighted.size > 0;
  document.querySelectorAll("[data-trend-player]").forEach((node) => {
    const active = highlighted.has(node.dataset.trendPlayer);
    node.classList.toggle("is-highlighted", active);
    node.classList.toggle("is-muted", hasHighlight && !active);
  });
}

function trendWindowDetail(point) {
  const missingSeasons = point.window_span - point.window_size;
  if (point.window_span === point.window_years && missingSeasons === 0) {
    return `${point.window_years} played season${point.window_years === 1 ? "" : "s"}`;
  }
  const partial = point.window_span < point.window_years
    ? `${point.window_span}-season partial average`
    : `${point.window_years}-season window`;
  return missingSeasons === 0
    ? partial
    : `${partial}; ${missingSeasons} missed season${missingSeasons === 1 ? "" : "s"} = 0`;
}

function showTrendTooltip(event, player, point) {
  const windowDetail = trendWindowDetail(point);
  const qualificationRank = state.trendPayload.qualification_rank;
  elements.trendTooltip.innerHTML = `
    <strong>${escapeHtml(player.player_name)}</strong>
    <span>${escapeHtml(point.season)} · ${point.games_played} GP</span>
    <span>Season value: ${number(point.season_value)}</span>
    <span>${point.window_years}-season average: ${number(point.rolling_average)} · ${windowDetail}</span>
    ${point.qualifying_window ? `<em>Top-${qualificationRank} window · rank ${point.window_rank}</em>` : ""}`;
  const wrap = elements.trendChart.parentElement.getBoundingClientRect();
  const targetBounds = event.currentTarget?.getBoundingClientRect?.();
  const clientX = Number.isFinite(event.clientX)
    ? event.clientX
    : targetBounds?.left ?? wrap.left + wrap.width / 2;
  const clientY = Number.isFinite(event.clientY)
    ? event.clientY
    : targetBounds?.top ?? wrap.top + 40;
  elements.trendTooltip.style.left = `${Math.max(8, Math.min(clientX - wrap.left + 14, wrap.width - 230))}px`;
  elements.trendTooltip.style.top = `${Math.max(8, clientY - wrap.top - 36)}px`;
  elements.trendTooltip.hidden = false;
}

function hideTrendTooltip() {
  elements.trendTooltip.hidden = true;
}

function matchLegendHeightToChart(chart, legendList) {
  const chartWrap = chart?.closest(".chart-wrap");
  const legend = legendList?.closest(".trend-legend");
  if (!chartWrap || !legend || chartWrap.classList.contains("is-expanded")) return;
  legend.style.height = `${Math.ceil(chartWrap.getBoundingClientRect().height)}px`;
}

function renderTrendLegend(players, windowYears, qualificationRank) {
  elements.legendSummary.textContent = `${players.length} players reached the top ${qualificationRank} in at least one full ${windowYears}-year window`;
  elements.trendLegend.innerHTML = players
    .map(
      (player, index) => `
        <button
          type="button"
          class="legend-player"
          data-trend-player="${escapeHtml(player.player_id)}"
          title="Best ${windowYears}-season rank: ${player.best_window_rank}"
        >
          <span class="legend-swatch" style="--player-color: ${playerColor(index)}"></span>
          <span>${escapeHtml(player.player_name)}</span>
          <small>#${player.best_window_rank}</small>
        </button>`,
    )
    .join("");
  elements.trendLegend.querySelectorAll(".legend-player").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTrendPlayer =
        state.activeTrendPlayer === button.dataset.trendPlayer
          ? null
          : button.dataset.trendPlayer;
      applyTrendHighlight();
    });
    button.addEventListener("mouseenter", () =>
      applyTrendHighlight(button.dataset.trendPlayer),
    );
    button.addEventListener("mouseleave", () => applyTrendHighlight());
  });
}

function renderTrendChart(payload) {
  state.rankingsVisualModule?.renderMobileTrend(document.querySelector("#mobile-trend-preview"), payload);
  state.trendPayload = payload;
  state.activeTrendPlayer = null;
  bindSupportingPanelPayload(elements.trendChart, payload);
  const { players, seasons } = payload;
  if (!players.length || !seasons.length) {
    elements.trendChart.innerHTML = `
      <text class="chart-loading" x="560" y="290" text-anchor="middle">
        No players qualified in this schedule.
      </text>`;
    elements.trendLegend.innerHTML = "";
    matchLegendHeightToChart(elements.trendChart, elements.trendLegend);
    return;
  }

  const width = 1120;
  const height = 580;
  const margin = { top: 28, right: 24, bottom: 86, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allPoints = players.flatMap((player) => player.seasons);
  const minimum = Math.min(0, ...allPoints.map((point) => point.rolling_average));
  const maximum = Math.max(...allPoints.map((point) => point.rolling_average));
  const padding = Math.max(0.5, (maximum - minimum) * 0.08);
  const yMin = minimum < 0 ? minimum - padding : 0;
  const yMax = maximum + padding;
  const x = (season) => {
    const index = seasons.indexOf(season);
    return margin.left + (index / Math.max(1, seasons.length - 1)) * plotWidth;
  };
  const y = (value) =>
    margin.top + ((yMax - value) / Math.max(1e-9, yMax - yMin)) * plotHeight;

  elements.trendChart.innerHTML = "";
  const grid = svgElement("g", { class: "chart-grid" });
  const tickCount = 5;
  for (let index = 0; index <= tickCount; index += 1) {
    const value = yMin + ((yMax - yMin) * index) / tickCount;
    const yPosition = y(value);
    grid.appendChild(
      svgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: yPosition,
        y2: yPosition,
      }),
    );
    grid.appendChild(
      svgElement(
        "text",
        { x: margin.left - 12, y: yPosition + 4, "text-anchor": "end" },
        compactNumber(value),
      ),
    );
  }
  seasons.forEach((season) => {
    const xPosition = x(season);
    grid.appendChild(
      svgElement("line", {
        x1: xPosition,
        x2: xPosition,
        y1: margin.top,
        y2: height - margin.bottom,
        class: "vertical-grid",
      }),
    );
    grid.appendChild(
      svgElement(
        "text",
        {
          x: xPosition,
          y: height - margin.bottom + 23,
          "text-anchor": "end",
          transform: `rotate(-42 ${xPosition} ${height - margin.bottom + 23})`,
        },
        season,
      ),
    );
  });
  grid.appendChild(
    svgElement(
      "text",
      {
        x: 18,
        y: margin.top + plotHeight / 2,
        "text-anchor": "middle",
        transform: `rotate(-90 18 ${margin.top + plotHeight / 2})`,
        class: "axis-title",
      },
      "Rolling Wins Contributed",
    ),
  );
  elements.trendChart.appendChild(grid);

  const lineLayer = svgElement("g", { class: "trend-lines" });
  players.forEach((player, playerIndex) => {
    const color = playerColor(playerIndex);
    const group = svgElement("g", {
      class: "trend-player",
      "data-trend-player": player.player_id,
      style: `--player-color: ${color}`,
    });
    const contiguousSegments = [];
    player.seasons.forEach((point, index) => {
      const previous = player.seasons[index - 1];
      if (!previous || point.season_start !== previous.season_start + 1) {
        contiguousSegments.push([]);
      }
      contiguousSegments.at(-1).push(point);
    });
    contiguousSegments
      .filter((segment) => segment.length > 1)
      .forEach((segment) => {
        group.appendChild(
          svgElement("polyline", {
            points: segment
              .map((point) => `${x(point.season)},${y(point.rolling_average)}`)
              .join(" "),
            class: "trend-line",
            fill: "none",
          }),
        );
      });
    player.seasons.forEach((point) => {
      const windowDetail = trendWindowDetail(point);
      const circle = svgElement("circle", {
        cx: x(point.season),
        cy: y(point.rolling_average),
        r: point.qualifying_window ? 4.7 : 3.1,
        class: [
          "trend-point",
          point.window_span < point.window_years
            ? "partial-window"
            : "complete-window",
          point.window_span === point.window_years && point.window_size < point.window_years
            ? "zero-filled-window"
            : "",
          point.zero_filled_season ? "zero-filled-season" : "",
          point.qualifying_window ? "top-window" : "",
        ].join(" "),
        tabindex: "0",
        role: "img",
        "data-panel-point": JSON.stringify({
          player_id: String(player.player_id),
          player_name: player.player_name,
          ...point,
        }),
        "aria-label": `${player.player_name}, ${point.season}, rolling average ${number(point.rolling_average)}, ${windowDetail}`,
      });
      circle.addEventListener("mouseenter", (event) => {
        applyTrendHighlight(player.player_id);
        showTrendTooltip(event, player, point);
      });
      circle.addEventListener("mousemove", (event) =>
        showTrendTooltip(event, player, point),
      );
      circle.addEventListener("mouseleave", () => {
        hideTrendTooltip();
        applyTrendHighlight();
      });
      circle.addEventListener("focus", (event) => {
        applyTrendHighlight(player.player_id);
        showTrendTooltip(event, player, point);
      });
      circle.addEventListener("blur", () => {
        hideTrendTooltip();
        applyTrendHighlight();
      });
      group.appendChild(circle);
    });
    lineLayer.appendChild(group);
  });
  elements.trendChart.appendChild(lineLayer);
  renderTrendLegend(players, payload.window_years, payload.qualification_rank);
  applyTrendHighlight();
  matchLegendHeightToChart(elements.trendChart, elements.trendLegend);
}

async function loadTrends() {
  state.trendController?.abort();
  state.trendController = new AbortController();
  setTrendLoading();
  const params = new URLSearchParams({
    stat_version: apiStatVersion(),
    phase: selectedTrendPhase(),
    window_years: String(selectedTrendWindow()),
    garbage_time_mode: elements.garbageTimeMode.value,
  });
  addSelectedExperimentParam(params);
  try {
    const payload = await requestRankingPanel({
      panel: "rolling-trends",
      url: "/api/rankings/rolling-trends",
      params,
      signal: state.trendController.signal,
    });
    renderTrendChart(payload);
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false;
    elements.trendChart.innerHTML = "";
    const mobileTrend = document.querySelector("#mobile-trend-preview");
    if (mobileTrend) mobileTrend.textContent = "Career trends could not load. Try changing the schedule or reloading.";
    elements.trendError.textContent = error.message;
    elements.trendError.hidden = false;
    return false;
  }
}

function visibleLiftPlayers() {
  if (!state.liftPayload) return [];
  const group = selectedLiftGroup();
  if (group === "top") {
    return state.liftPayload.players.filter((player) => player.qualifies_top);
  }
  if (group === "bottom") {
    return state.liftPayload.players.filter((player) => player.qualifies_bottom);
  }
  return state.liftPayload.players;
}

function highlightedLiftPlayerIds() {
  return state.activeLiftPlayer ? new Set([state.activeLiftPlayer]) : new Set();
}

function applyLiftHighlight(temporaryPlayerId = null) {
  if (!state.liftPayload) return;
  const highlighted = temporaryPlayerId
    ? new Set([temporaryPlayerId])
    : highlightedLiftPlayerIds();
  const hasHighlight = highlighted.size > 0;
  document.querySelectorAll("[data-lift-player]").forEach((node) => {
    const active = highlighted.has(node.dataset.liftPlayer);
    node.classList.toggle("is-highlighted", active);
    node.classList.toggle("is-muted", hasHighlight && !active);
  });
}

function liftWindowDetail(point) {
  const missing = point.window_span - point.window_appearances;
  if (point.window_span < point.window_years) {
    return `${point.window_span}-season partial average`;
  }
  return missing === 0
    ? `${point.window_years}-season window; every season compared`
    : `${point.window_years}-season window; ${missing} missing comparison${missing === 1 ? "" : "s"} = 0`;
}

function showLiftTooltip(event, player, point) {
  const populationDetail = `All Seasons Full-season WC #${point.career_full_season_rank}`;
  const seasonDetail = point.comparison_season
    ? `Regular #${point.regular_season_rank} (${number(point.regular_wins_contributed)} WC) → postseason #${point.postseason_rank} (${number(point.postseason_wins_contributed)} WC): ${signedRank(point.season_rank_change)}`
    : "No postseason comparison; season counts as 0";
  const qualifying = [
    point.qualifying_top_window ? `Top-10 window · rank ${point.top_rank}` : "",
    point.qualifying_bottom_window ? `Bottom-10 window · rank ${point.bottom_rank}` : "",
  ].filter(Boolean).join(" · ");
  elements.liftTooltip.innerHTML = `
    <strong>${escapeHtml(player.player_name)}</strong>
    <span>${escapeHtml(populationDetail)} · ${number(point.career_full_season_wins_contributed)} WC</span>
    <span>${escapeHtml(point.season)} · ${escapeHtml(seasonDetail)}</span>
    <span>${point.window_years}-season average: ${signedNumber(point.rolling_average)} · ${liftWindowDetail(point)}</span>
    ${qualifying ? `<em>${escapeHtml(qualifying)}</em>` : ""}`;
  const wrap = elements.liftChart.parentElement.getBoundingClientRect();
  const targetBounds = event.currentTarget?.getBoundingClientRect?.();
  const clientX = Number.isFinite(event.clientX)
    ? event.clientX
    : targetBounds?.left ?? wrap.left + wrap.width / 2;
  const clientY = Number.isFinite(event.clientY)
    ? event.clientY
    : targetBounds?.top ?? wrap.top + 40;
  elements.liftTooltip.style.left = `${Math.max(8, Math.min(clientX - wrap.left + 14, wrap.width - 260))}px`;
  elements.liftTooltip.style.top = `${Math.max(8, clientY - wrap.top - 42)}px`;
  elements.liftTooltip.hidden = false;
}

function hideLiftTooltip() {
  elements.liftTooltip.hidden = true;
}

function liftLegendRank(player) {
  const group = selectedLiftGroup();
  if (group === "top") return `WC #${player.career_full_season_rank} · T#${player.best_top_rank}`;
  if (group === "bottom") return `WC #${player.career_full_season_rank} · B#${player.best_bottom_rank}`;
  const ranks = [];
  if (player.best_top_rank !== null) ranks.push(`T#${player.best_top_rank}`);
  if (player.best_bottom_rank !== null) ranks.push(`B#${player.best_bottom_rank}`);
  return `WC #${player.career_full_season_rank} · ${ranks.join(" / ")}`;
}

function renderLiftLegend(players) {
  const groupLabel = {
    top: "top 10",
    bottom: "bottom 10",
    both: "top or bottom 10",
  }[selectedLiftGroup()];
  elements.liftLegendSummary.textContent = `${players.length} career top-100 players reached the ${groupLabel} in at least one full ${state.liftPayload.window_years}-year window`;
  elements.liftLegend.innerHTML = players
    .map((player) => {
      const colorIndex = state.liftPayload.players.indexOf(player);
      return `
        <button
          type="button"
          class="legend-player"
          data-lift-player="${escapeHtml(player.player_id)}"
        >
          <span class="legend-swatch" style="--player-color: ${playerColor(colorIndex)}"></span>
          <span>${escapeHtml(player.player_name)}</span>
          <small>${liftLegendRank(player)}</small>
        </button>`;
    })
    .join("");
  elements.liftLegend.querySelectorAll(".legend-player").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeLiftPlayer =
        state.activeLiftPlayer === button.dataset.liftPlayer
          ? null
          : button.dataset.liftPlayer;
      applyLiftHighlight();
    });
    button.addEventListener("mouseenter", () =>
      applyLiftHighlight(button.dataset.liftPlayer),
    );
    button.addEventListener("mouseleave", () => applyLiftHighlight());
  });
}

function renderLiftChart(payload = state.liftPayload) {
  state.rankingsVisualModule?.renderMobileLift(document.querySelector("#mobile-lift-preview"), payload, selectedLiftGroup());
  state.liftPayload = payload;
  bindSupportingPanelPayload(elements.liftChart, payload);
  const players = visibleLiftPlayers();
  const { seasons } = payload;
  if (!players.length || !seasons.length) {
    elements.liftChart.innerHTML = `
      <text class="chart-loading" x="560" y="290" text-anchor="middle">
        No qualifying postseason rank changes.
      </text>`;
    elements.liftLegend.innerHTML = "";
    matchLegendHeightToChart(elements.liftChart, elements.liftLegend);
    return;
  }

  const width = 1120;
  const height = 580;
  const margin = { top: 28, right: 24, bottom: 86, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allPoints = players.flatMap((player) => player.seasons);
  const magnitude = Math.max(
    1,
    ...allPoints.map((point) => Math.abs(point.rolling_average)),
  );
  const bound = magnitude * 1.1;
  const yMin = -bound;
  const yMax = bound;
  const x = (season) => {
    const index = seasons.indexOf(season);
    return margin.left + (index / Math.max(1, seasons.length - 1)) * plotWidth;
  };
  const y = (value) =>
    margin.top + ((yMax - value) / (yMax - yMin)) * plotHeight;

  elements.liftChart.innerHTML = "";
  const grid = svgElement("g", { class: "chart-grid" });
  const tickCount = 6;
  for (let index = 0; index <= tickCount; index += 1) {
    const value = yMin + ((yMax - yMin) * index) / tickCount;
    const yPosition = y(value);
    grid.appendChild(
      svgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: yPosition,
        y2: yPosition,
        class: Math.abs(value) < 1e-9 ? "zero-line" : "",
      }),
    );
    grid.appendChild(
      svgElement(
        "text",
        { x: margin.left - 12, y: yPosition + 4, "text-anchor": "end" },
        compactNumber(value),
      ),
    );
  }
  seasons.forEach((season) => {
    const xPosition = x(season);
    grid.appendChild(
      svgElement("line", {
        x1: xPosition,
        x2: xPosition,
        y1: margin.top,
        y2: height - margin.bottom,
        class: "vertical-grid",
      }),
    );
    grid.appendChild(
      svgElement(
        "text",
        {
          x: xPosition,
          y: height - margin.bottom + 23,
          "text-anchor": "end",
          transform: `rotate(-42 ${xPosition} ${height - margin.bottom + 23})`,
        },
        season,
      ),
    );
  });
  grid.appendChild(
    svgElement(
      "text",
      {
        x: 18,
        y: margin.top + plotHeight / 2,
        "text-anchor": "middle",
        transform: `rotate(-90 18 ${margin.top + plotHeight / 2})`,
        class: "axis-title",
      },
      "Postseason rank change",
    ),
  );
  elements.liftChart.appendChild(grid);

  const lineLayer = svgElement("g", { class: "trend-lines" });
  players.forEach((player) => {
    const colorIndex = payload.players.indexOf(player);
    const color = playerColor(colorIndex);
    const group = svgElement("g", {
      class: "trend-player",
      "data-lift-player": player.player_id,
      style: `--player-color: ${color}`,
    });
    const contiguousSegments = [];
    player.seasons.forEach((point, index) => {
      const previous = player.seasons[index - 1];
      if (!previous || point.season_start !== previous.season_start + 1) {
        contiguousSegments.push([]);
      }
      contiguousSegments.at(-1).push(point);
    });
    contiguousSegments
      .filter((segment) => segment.length > 1)
      .forEach((segment) => {
        group.appendChild(
          svgElement("polyline", {
            points: segment
              .map((point) => `${x(point.season)},${y(point.rolling_average)}`)
              .join(" "),
            class: "trend-line",
            fill: "none",
          }),
        );
      });
    player.seasons.forEach((point) => {
      const circle = svgElement("circle", {
        cx: x(point.season),
        cy: y(point.rolling_average),
        r: point.qualifying_top_window || point.qualifying_bottom_window ? 4.7 : 3.1,
        class: [
          "trend-point",
          point.window_span < point.window_years
            ? "partial-window"
            : "complete-window",
          point.window_span === point.window_years && point.window_appearances < point.window_years
            ? "zero-filled-window"
            : "",
          point.zero_filled_season ? "zero-filled-season" : "",
          point.qualifying_top_window ? "top-window" : "",
          point.qualifying_bottom_window ? "bottom-window" : "",
        ].join(" "),
        tabindex: "0",
        role: "img",
        "data-panel-point": JSON.stringify({
          player_id: String(player.player_id),
          player_name: player.player_name,
          ...point,
        }),
        "aria-label": `${player.player_name}, All Seasons Full-season Wins Contributed rank ${point.career_full_season_rank}, ${point.season}, rolling postseason rank change ${signedNumber(point.rolling_average)}, ${liftWindowDetail(point)}`,
      });
      circle.addEventListener("mouseenter", (event) => {
        applyLiftHighlight(player.player_id);
        showLiftTooltip(event, player, point);
      });
      circle.addEventListener("mousemove", (event) =>
        showLiftTooltip(event, player, point),
      );
      circle.addEventListener("mouseleave", () => {
        hideLiftTooltip();
        applyLiftHighlight();
      });
      circle.addEventListener("focus", (event) => {
        applyLiftHighlight(player.player_id);
        showLiftTooltip(event, player, point);
      });
      circle.addEventListener("blur", () => {
        hideLiftTooltip();
        applyLiftHighlight();
      });
      group.appendChild(circle);
    });
    lineLayer.appendChild(group);
  });
  elements.liftChart.appendChild(lineLayer);
  renderLiftLegend(players);
  applyLiftHighlight();
  const groupLabel = {
    top: "top-10 qualifiers",
    bottom: "bottom-10 qualifiers",
    both: "top/bottom-10 qualifiers",
  }[selectedLiftGroup()];
  matchLegendHeightToChart(elements.liftChart, elements.liftLegend);
}

async function loadLiftTrends() {
  state.liftController?.abort();
  state.liftController = new AbortController();
  setLiftLoading();
  const params = new URLSearchParams({
    stat_version: apiStatVersion(),
    window_years: String(selectedLiftWindow()),
    garbage_time_mode: elements.garbageTimeMode.value,
  });
  addSelectedExperimentParam(params);
  try {
    const payload = await requestRankingPanel({
      panel: "postseason-lift-trends",
      url: "/api/rankings/postseason-lift-trends",
      params,
      signal: state.liftController.signal,
    });
    state.activeLiftPlayer = null;
    renderLiftChart(payload);
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false;
    elements.liftChart.innerHTML = "";
    const mobileLift = document.querySelector("#mobile-lift-preview");
    if (mobileLift) mobileLift.textContent = "Postseason rank changes could not load. Try reloading.";
    elements.liftError.textContent = error.message;
    elements.liftError.hidden = false;
    return false;
  }
}

async function loadSelectedStatistic() {
  setSeasonWinsLoading();
  setTopGamesLoading();
  setHighValueRecordsLoading();
  setTrendLoading();
  setLiftLoading();
  const generation = resetDeferredPanelLoads();
  const rankingsLoaded = await loadRankings();
  if (
    generation !== state.deferredPanelGeneration
    || rankingsLoaded !== true
  ) return;
  state.deferredPanelsReady = true;
  loadVisibleDeferredPanels();
}

const DEFERRED_PANEL_LOADERS = Object.freeze({
  seasonWins: loadSeasonWinsLeaders,
  topGames: loadTopGames,
  highValueRecords: loadHighValueRecords,
  trends: loadTrends,
  lift: loadLiftTrends,
});

const DEFERRED_PANEL_ERRORS = Object.freeze({
  seasonWins: elements.seasonWinsError,
  topGames: elements.topGamesError,
  highValueRecords: elements.highValueRecordsError,
  trends: elements.trendError,
  lift: elements.liftError,
});

const DEFERRED_PANEL_CONTROLLERS = Object.freeze({
  seasonWins: "seasonWinsController",
  topGames: "topGamesController",
  highValueRecords: "highValueRecordsController",
  trends: "trendController",
  lift: "liftController",
});

function resetDeferredPanelLoads() {
  state.deferredPanelGeneration += 1;
  state.deferredPanelsReady = false;
  state.liftPayload = null;
  clearShareableRankings();
  Object.keys(state.deferredPanels).forEach((key) => {
    state.deferredPanels[key] = false;
    const controllerKey = DEFERRED_PANEL_CONTROLLERS[key];
    state[controllerKey]?.abort();
    state[controllerKey] = null;
  });
  state.deferredPanelLoads.clear();
  state.deferredPanelQueue = Promise.resolve();
  return state.deferredPanelGeneration;
}

function loadDeferredPanel(key, force = false) {
  if (!state.deferredPanelsReady) return state.deferredPanelQueue;
  if (
    !force
    && (state.deferredPanels[key] || state.deferredPanelLoads.has(key))
  ) {
    return state.deferredPanelQueue;
  }
  if (force) {
    state.deferredPanels[key] = false;
    const controllerKey = DEFERRED_PANEL_CONTROLLERS[key];
    state[controllerKey]?.abort();
    state[controllerKey] = null;
  }
  const generation = state.deferredPanelGeneration;
  const token = Symbol(key);
  state.deferredPanelLoads.set(key, token);
  const queuedLoad = state.deferredPanelQueue.then(async () => {
    if (
      generation !== state.deferredPanelGeneration
      || !state.deferredPanelsReady
      || state.deferredPanelLoads.get(key) !== token
    ) return;
    const loaded = await DEFERRED_PANEL_LOADERS[key]();
    if (
      generation !== state.deferredPanelGeneration
      || state.deferredPanelLoads.get(key) !== token
    ) return;
    state.deferredPanels[key] = loaded === true;
  });
  state.deferredPanelQueue = queuedLoad
    .catch((error) => {
      if (
        generation !== state.deferredPanelGeneration
        || state.deferredPanelLoads.get(key) !== token
      ) return;
      state.deferredPanels[key] = false;
      if (error?.name !== "AbortError") {
        const errorElement = DEFERRED_PANEL_ERRORS[key];
        if (errorElement) {
          errorElement.textContent = error?.message || "This panel could not be loaded.";
          errorElement.hidden = false;
        }
      }
    })
    .finally(() => {
      if (
        generation === state.deferredPanelGeneration
        && state.deferredPanelLoads.get(key) === token
      ) state.deferredPanelLoads.delete(key);
    });
  return state.deferredPanelQueue;
}

function reloadDeferredPanel(key) {
  return loadDeferredPanel(key, true);
}

// Every deferred panel is now a disclosure, so the one rule is the same for all
// five: a panel that is open is loaded, and a panel that is closed costs
// nothing until somebody opens it.
function loadVisibleDeferredPanels() {
  if (!state.deferredPanelsReady) return;
  if (elements.seasonWinsDetails?.open) loadDeferredPanel("seasonWins");
  if (elements.topGamesDetails?.open) loadDeferredPanel("topGames");
  if (elements.highValueRecordsDetails?.open) {
    loadDeferredPanel("highValueRecords");
  }
  if (elements.trendsSection?.open) loadDeferredPanel("trends");
  if (elements.liftSection?.open) loadDeferredPanel("lift");
}

function setupDeferredPanelLoading() {
  [
    [elements.seasonWinsDetails, "seasonWins"],
    [elements.topGamesDetails, "topGames"],
    [elements.highValueRecordsDetails, "highValueRecords"],
  ].forEach(([details, key]) => {
    details?.addEventListener("toggle", () => {
      if (details.open) loadDeferredPanel(key);
    });
  });
  [
    [elements.trendsSection, "trends"],
    [elements.liftSection, "lift"],
  ].forEach(([details, key]) => {
    details?.addEventListener("toggle", () => {
      rememberOpenPanels();
      syncUrl();
      if (details.open) loadDeferredPanel(key);
    });
  });
}

function isDesktopExperimentDevice() {
  const runtimeGuard = state.storageModule?.experimentCreationGuard?.();
  if (runtimeGuard) return runtimeGuard.creationAllowed;
  const mobileHint = navigator.userAgentData?.mobile;
  if (mobileHint === true) return false;
  return window.matchMedia?.("(min-width: 760px) and (pointer: fine)").matches ?? true;
}

function showDesktopRequiredMessage() {
  elements.desktopRequiredMessage.hidden = false;
  elements.desktopRequiredMessage.scrollIntoView({ behavior: "smooth", block: "center" });
}

function openExperimentBuilder({ manageOnly = false } = {}) {
  if (!isDesktopExperimentDevice()) {
    showDesktopRequiredMessage();
    return false;
  }
  elements.desktopRequiredMessage.hidden = true;
  elements.experimentDialogTitle.textContent = manageOnly
    ? "Manage my experiments"
    : "Create an experiment";
  if (!elements.experimentDialog.open) elements.experimentDialog.showModal();
  if (manageOnly) {
    document.querySelector("#local-experiment-manager")?.scrollIntoView({ block: "start" });
  } else {
    elements.experimentName.focus();
  }
  return true;
}

function selectedExperimentSeasons() {
  return Array.from(elements.experimentSeasons.selectedOptions, (option) =>
    Number(option.value));
}

function rawUiMultipliers() {
  return Object.fromEntries(
    Array.from(elements.rawMultiplierControls.querySelectorAll("[data-raw-group]"),
      (input) => [input.dataset.rawGroup, Number(input.value)]),
  );
}

function rawParentMultipliers() {
  const values = rawUiMultipliers();
  return Object.fromEntries(
    CONTRACT_RAW_GROUPS.map((group) => [group, Number(values[group] ?? 1)]),
  );
}

function syncRawMultiplierDisplays() {
  const values = rawUiMultipliers();
  elements.rawMultiplierControls.querySelectorAll("[data-raw-output-for]").forEach((output) => {
    const value = values[output.dataset.rawOutputFor];
    output.textContent = Number.isFinite(value) ? `${value.toFixed(2)}×` : "—";
  });
}

function contextMagnifiers() {
  return Object.fromEntries(
    Array.from(elements.contextMagnifierControls.querySelectorAll("[data-context-key]"),
      (input) => [input.dataset.contextKey, Number(input.value)]),
  );
}

function advancedOverrides() {
  return Object.fromEntries(
    Array.from(elements.advancedOutcomeGroups.querySelectorAll("[data-coefficient-key]"))
      .filter((input) => input.value !== "")
      .map((input) => [input.dataset.coefficientKey, Number(input.value)]),
  );
}

function catalogFieldByKey(key) {
  return state.experimentCatalog?.raw_fields?.find((field) => field.key === key) || null;
}

function advancedDisplayGroup(field) {
  return VIRTUAL_RAW_FIELD_GROUP.get(field.key) || field.group;
}

function sliderMultiplierForField(field, multipliers, parents) {
  const displayGroup = advancedDisplayGroup(field);
  return Number(multipliers[displayGroup] ?? parents[field.group] ?? 1);
}

function automaticallyBalancedOverrides(overrides, explicitKeys, multipliers, parents) {
  const balanced = { ...overrides };
  const editable = (state.experimentCatalog?.raw_fields || [])
    .filter((field) => field.classification === "editable_leaf");
  const byTemplate = new Map();
  editable.forEach((field) => {
    (field.dependent_templates || []).forEach((templateKey) => {
      if (!byTemplate.has(templateKey)) byTemplate.set(templateKey, []);
      byTemplate.get(templateKey).push(field);
    });
  });
  Array.from(byTemplate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([, fields]) => {
      const requested = new Map(fields.map((field) => [
        field.key,
        explicitKeys.has(field.key)
          ? Number(overrides[field.key])
          : Number(field.baseline) * sliderMultiplierForField(field, multipliers, parents),
      ]));
      const total = Array.from(requested.values()).reduce((sum, value) => sum + value, 0);
      if (total <= 1 + 1e-12) return;
      const amplified = fields.filter((field) =>
        !explicitKeys.has(field.key)
        && sliderMultiplierForField(field, multipliers, parents) > 1 + 1e-12);
      if (!amplified.length) return;
      const protectedFields = fields.filter((field) =>
        explicitKeys.has(field.key)
        || sliderMultiplierForField(field, multipliers, parents) > 1 + 1e-12);
      const reducibleFields = fields.filter((field) => !protectedFields.includes(field));
      const protectedTotal = protectedFields.reduce(
        (sum, field) => sum + requested.get(field.key),
        0,
      );
      const reducibleTotal = reducibleFields.reduce(
        (sum, field) => sum + requested.get(field.key),
        0,
      );
      if (protectedTotal > 1 + 1e-12 || reducibleTotal <= 0) return;
      const scale = Math.max(0, 1 - protectedTotal) / reducibleTotal;
      reducibleFields.forEach((field) => {
        balanced[field.key] = requested.get(field.key) * scale;
      });
    });
  return balanced;
}

function virtualGroupOverrides(explicit, multipliers, parents) {
  const overrides = { ...explicit };
  Object.entries(VIRTUAL_RAW_GROUP_FIELDS).forEach(([virtualGroup, keys]) => {
    keys.forEach((key) => {
      if (Object.hasOwn(overrides, key)) return;
      const field = catalogFieldByKey(key);
      if (!field) return;
      const virtualMultiplier = Number(multipliers[virtualGroup] ?? 1);
      const parentMultiplier = Number(parents[field.group] ?? 1);
      if (Math.abs(virtualMultiplier - parentMultiplier) <= 1e-12) return;
      overrides[key] = Number(field.baseline) * virtualMultiplier;
    });
  });
  return overrides;
}

function configurationOverrides() {
  const explicit = advancedOverrides();
  const multipliers = rawUiMultipliers();
  const parents = rawParentMultipliers();
  const overrides = virtualGroupOverrides(explicit, multipliers, parents);
  return automaticallyBalancedOverrides(
    overrides,
    new Set(Object.keys(explicit)),
    multipliers,
    parents,
  );
}

function experimentDraft() {
  if (elements.linkReliabilityK.checked) {
    elements.reliabilityKDefense.value = elements.reliabilityKOffense.value;
  }
  if (elements.linkLambda.checked) {
    elements.lambdaDefense.value = elements.lambdaOffense.value;
  }
  return {
    schema_version: ORIGINAL_CONFIG_SCHEMA,
    name: elements.experimentName.value.trim(),
    selected_seasons: selectedExperimentSeasons(),
    raw: {
      parent_multipliers: rawParentMultipliers(),
      overrides: configurationOverrides(),
    },
    context: {
      magnifiers: contextMagnifiers(),
      reliability_k: {
        offense: Number(elements.reliabilityKOffense.value),
        defense: Number(elements.reliabilityKDefense.value),
      },
      lambda: {
        offense: Number(elements.lambdaOffense.value),
        defense: Number(elements.lambdaDefense.value),
      },
    },
    engine_version: ORIGINAL_ENGINE_VERSION,
    time_modes: ["all_minutes", "competitive"],
  };
}

function outcomeGroupForField(field) {
  const key = field.key.toLowerCase();
  if (key.includes("screen_templates")) return "screens-helpers";
  // Match defensive concepts before the broader `blocks_and_turnovers`
  // namespace; otherwise blocks, steals, pressure, and defensive rebounds
  // are incorrectly presented as negative offense.
  if (key.includes("defended_field_goals")) return "defended-field-goals";
  if (key.includes("pressure_defense")) return "pressure-defense";
  if (key.includes("block_action") || key.includes("named_steal")) return "blocks-steals";
  if (key.includes("defensive_rebound") || key.includes("boxout")) {
    return "rebounds-boxouts";
  }
  if (key.includes("missed_")) return "missed-shots";
  if (key.includes("turnover")) return "turnovers";
  if (key.includes("shortfall")) return "offensive-shortfalls";
  if (
    key.includes("retained_fouls.fouled_player_share")
    || key.includes("retained_fouls.shooter_share_when_distinct")
    || key.includes("identified_fouler_penalty")
    || key.includes("fouls_and_violations")
  ) return "fouls-violations";
  if (key.includes("retained_fouls") || key.includes("ft_") || key.includes("free_throw")) {
    return "free-throws";
  }
  if (key.includes("made_outcome_templates.fg") || key.includes("long_oreb_templates.fg")) {
    return "field-goals";
  }
  return field.group === "defense" ? "blocks-steals" : "field-goals";
}

function templateKeyForField(field) {
  // Block and steal coefficients participate in downstream turnover-derived
  // relationships, but they are independent controls in the editor. Keep
  // their cards separate from the negative-offense turnover template.
  if (field.key.includes("block_action")) {
    return "v6.blocks_and_turnovers.block_action";
  }
  if (field.key.includes("named_steal")) {
    return "v6.blocks_and_turnovers.named_steal";
  }
  if (Array.isArray(field.dependent_templates) && field.dependent_templates.length) {
    return field.dependent_templates[0];
  }
  if (field.key.endsWith(".policy_remainder")) {
    return field.key.slice(0, -".policy_remainder".length);
  }
  const retainedTemplate = field.key.match(
    /^(.*retained_fouls\.oreb_completion\.positive_templates\.[^.]+)\.[^.]+$/,
  );
  if (retainedTemplate) return retainedTemplate[1];
  if (field.key.includes("defended_field_goals")) {
    return "v7.defended_field_goals.location_coefficients";
  }
  if (field.key.includes("pressure_defense")) {
    return "v6.blocks_and_turnovers.pressure_defense";
  }
  if (field.key.includes("defensive_rebound")) {
    return "v6.blocks_and_turnovers.defensive_rebound";
  }
  if (field.key.includes("retained_fouls.fouled_player_share")
      || field.key.includes("retained_fouls.shooter_share_when_distinct")) {
    return "v6.retained_fouls.fouled_player_share";
  }
  if (field.key.includes("defensive_boxout")) {
    return "v6.aggregate_helpers.defensive_boxout";
  }
  if (field.key.includes("turnover")) return "v7.negative_actions.turnover";
  return field.key;
}

function readableTemplateName(templateKey, fields) {
  const exactNames = {
    "v6.blocks_and_turnovers.block_action": "Block value",
    "v6.blocks_and_turnovers.named_steal": "Steal value",
    "v6.blocks_and_turnovers.defensive_rebound": "Defensive rebound value",
    "v6.blocks_and_turnovers.pressure_defense": "Pressure-defense value",
    "v6.aggregate_helpers.defensive_boxout": "Defensive boxout value",
    "v6.retained_fouls.fouled_player_share": "Who receives retained-foul value",
    "v7.defended_field_goals.location_coefficients": "Shot-location values",
    "v7.negative_actions.turnover": "Turnover penalty",
  };
  if (exactNames[templateKey]) return exactNames[templateKey];
  const name = templateKey.split(".").at(-1);
  const madeNames = {
    fg_assisted: "Assisted field goal",
    fg_assisted_after_oreb: "Assisted field goal after an offensive rebound",
    fg_self_created: "Self-created field goal",
    fg_self_created_after_oreb: "Self-created field goal after an offensive rebound",
    ft_ordinary: "Free throw",
    ft_assisted: "Assisted free throw",
    ft_assisted_after_oreb: "Assisted free throw after an offensive rebound",
    ft_after_oreb: "Free throw after an offensive rebound",
  };
  if (templateKey.includes("made_outcome_templates") && madeNames[name]) return madeNames[name];
  if (templateKey.includes("long_oreb_templates") && madeNames[name]) {
    return `${madeNames[name]} · long rebound sequence`;
  }
  const screenNames = {
    scorer_screen: "Scorer and screen helper",
    scorer_oreb_screen: "Scorer, rebounder, and screen helper",
    scorer_assister_screen: "Scorer, assister, and screen helper",
    scorer_assister_oreb_screen: "Scorer, assister, rebounder, and screen helper",
  };
  if (templateKey.includes("screen_templates") && screenNames[name]) return screenNames[name];
  if (fields.length === 1) {
    return readableRoleName(fields[0]);
  }
  return String(name || templateKey)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function readableRoleName(field) {
  const exactNames = {
    "v6.blocks_and_turnovers.block_action_coefficient": "Block value",
    "v6.blocks_and_turnovers.named_steal_action_coefficient": "Steal value",
    "v7.negative_actions.turnover_accountability_coefficient": "Turnover penalty",
    "v7.negative_actions.turnover_scope.identified_actor_coefficient": "Identified player penalty",
    "v7.negative_actions.turnover_scope.team_coded_exact_five_total_coefficient": "Team turnover total",
    "v7.negative_actions.turnover_scope.team_coded_per_player_coefficient": "Team turnover per player",
    "v6.blocks_and_turnovers.pressure_defense.five_player_total_coefficient": "Five-player pressure value",
    "v6.blocks_and_turnovers.pressure_defense.per_player_coefficient": "Pressure value per player",
    "v7.defended_field_goals.location_coefficients.near_rim": "Near rim",
    "v7.defended_field_goals.location_coefficients.at_rim_bonus": "At-rim bonus",
    "v7.defended_field_goals.at_rim_total": "Total at-rim value",
    "v7.defended_field_goals.location_coefficients.six_to_ten": "6–10 feet",
    "v7.defended_field_goals.location_coefficients.ten_to_fifteen": "10–15 feet",
    "v7.defended_field_goals.location_coefficients.long_two": "Long two",
    "v7.defended_field_goals.location_coefficients.three_pointer": "Three-pointer",
    "v7.defended_field_goals.location_coefficients.two_pointer_unclassified": "Other two-pointer",
    "v7.negative_actions.missed_three_coefficient": "Missed three-pointer penalty",
    "v7.negative_actions.missed_two_coefficient": "Missed two-pointer penalty",
    "v7.negative_actions.regular_ft_shortfall_coefficient": "Missed free-throw penalty",
    "v6.retained_fouls.oreb_completion.shortfall_shooter_coefficient": "Retained-foul shortfall penalty",
    "v6.fouls_and_violations.offensive_lane_lost_point_violator_coefficient": "Offensive lane-violation penalty",
    "v6.aggregate_helpers.defensive_boxout_contested_dreb_pool_share": "Contested-rebound boxout helper",
    "v6.aggregate_helpers.defensive_boxout_uncontested_dreb_pool_share": "Uncontested-rebound boxout helper",
    "v6.aggregate_helpers.offensive_boxout_oreb_pool_share": "Offensive-rebound boxout helper",
    "v6.retained_fouls.fouled_player_share.away_from_play": "Foul-draw value",
    "v6.retained_fouls.fouled_player_share.clear_path": "Clear-path foul-draw value",
    "v6.retained_fouls.fouled_player_share.flagrant": "Flagrant-foul draw value",
    "v6.retained_fouls.fouled_player_share.other_retained": "Other retained-foul draw value",
    "v6.retained_fouls.fouled_player_share.transition_take": "Transition-take foul-draw value",
    "v6.retained_fouls.shooter_share_when_distinct": "Shooter value when the foul drawer differs",
    "lab.virtual.retained_fouls.identified_fouler_penalty_coefficient": "Retained-foul defender penalty",
    "v6.fouls_and_violations.administrative_bonus_shooter_coefficient": "Administrative free-throw value",
    "v6.fouls_and_violations.defensive_lane_replacement_shooter_coefficient": "Replacement free-throw value",
    "v6.fouls_and_violations.defensive_lane_identified_violator_coefficient": "Defensive lane-violation penalty",
    "v6.fouls_and_violations.defensive_three_seconds_identified_violator_coefficient": "Defensive three-seconds penalty",
    "v6.fouls_and_violations.ordinary_identified_fouler_coefficient": "Ordinary foul penalty",
    "v6.fouls_and_violations.technical_identified_offender_coefficient": "Technical-foul penalty",
  };
  if (exactNames[field.key]) return exactNames[field.key];
  const role = field.key.split(".").at(-1);
  const roleNames = {
    scorer: "Scorer value",
    assister: "Assister value",
    ft_assister: "Assister value",
    oreb_pool: "Offensive rebound value",
    screen_assister: "Screen helper value",
    policy_remainder: "Policy remainder",
    retained_ft_shooter: "Free-throw shooter value",
    foul_drawer: "Fouled-player value",
    contested_action_coefficient: "Contested rebound value",
    uncontested_action_coefficient: "Uncontested rebound value",
  };
  if (roleNames[role]) return roleNames[role];
  return field.label
    .replace(/^DFG\s*·\s*/i, "")
    .replace(/\s+coefficient$/i, "");
}

function advancedRoleExplanation(field) {
  const role = field.key.split(".").at(-1);
  if (role === "policy_remainder") {
    return "The unassigned portion of this play. It is calculated as 1 minus the editable role values so the policy continues to total 1.";
  }
  if (field.key.includes("turnover_scope.team_coded_exact_five_total")) {
    return "The total penalty for a team turnover when the play-by-play does not identify one player. The five players on the floor share this amount.";
  }
  if (field.key.includes("turnover_scope.team_coded_per_player")) {
    return "Each on-court player’s share of a team turnover. It is read-only and always equals the team turnover total divided by five.";
  }
  if (field.key.includes("turnover_scope.identified_actor")) {
    return "The penalty assigned when the play-by-play identifies the player responsible for the turnover. It follows the editable turnover penalty.";
  }
  if (field.key.includes("turnover_accountability")) {
    return "The negative value charged for a turnover. Identified-player and team-coded turnover penalties are calculated from this setting.";
  }
  if (field.key.includes("missed_three")) {
    return "The negative offensive value charged to the shooter for a missed three-pointer.";
  }
  if (field.key.includes("missed_two")) {
    return "The negative offensive value charged to the shooter for a missed two-pointer.";
  }
  if (field.key.includes("regular_ft_shortfall")) {
    return "The negative offensive value charged when an ordinary free-throw trip produces less value than expected.";
  }
  if (field.key.includes("shortfall_shooter")) {
    return "The negative value charged to the shooter when a retained-possession foul sequence finishes below its expected value.";
  }
  if (field.key.includes("offensive_lane_lost_point")) {
    return "The negative value charged to the identified offensive player when a lane violation removes a point.";
  }
  if (field.key.includes("fouled_player_share.away_from_play")) {
    return "The share of retained-foul value awarded to the player who drew the foul. Related retained-foul draw values and the distinct shooter share are recalculated from it.";
  }
  if (field.key.includes("fouled_player_share")) {
    return "The calculated foul-draw share for this retained-foul type. It follows the editable foul-draw value.";
  }
  if (field.key.includes("shooter_share_when_distinct")) {
    return "The calculated share left for the free-throw shooter when the shooter and foul drawer are different players.";
  }
  if (field.key.includes("identified_fouler_penalty")) {
    return "The defensive penalty charged to the identified player who committed a retained-possession foul.";
  }
  if (field.key.includes("administrative_bonus_shooter")) {
    return "The value assigned to the shooter on an administrative bonus free throw.";
  }
  if (field.key.includes("defensive_lane_replacement_shooter")) {
    return "The value assigned to the replacement free throw created by a defensive lane violation.";
  }
  if (field.key.includes("defensive_lane_identified_violator")) {
    return "The penalty charged to the identified defender for a defensive lane violation.";
  }
  if (field.key.includes("defensive_three_seconds")) {
    return "The penalty charged to the identified defender for a defensive three-seconds violation.";
  }
  if (field.key.includes("ordinary_identified_fouler")) {
    return "The defensive penalty charged to the identified player for an ordinary foul.";
  }
  if (field.key.includes("technical_identified_offender")) {
    return "The penalty charged to the identified player for a technical foul.";
  }
  if (field.key.includes("block_action")) {
    return "The direct defensive value awarded to the player identified as blocking the shot.";
  }
  if (field.key.includes("named_steal")) {
    return "The direct defensive value awarded to the player identified as creating the steal.";
  }
  if (field.key.includes("pressure_defense.five_player_total")) {
    return "The total defensive value shared by the five players on the floor when pressure is credited to the lineup rather than one defender.";
  }
  if (field.key.includes("pressure_defense.per_player")) {
    return "Each on-court player’s calculated share of the five-player pressure value.";
  }
  if (field.key.includes("defensive_rebound")) {
    return field.key.includes("contested")
      ? "The defensive value awarded for securing a contested defensive rebound."
      : "The defensive value awarded for securing an uncontested defensive rebound.";
  }
  if (field.key.includes("boxout")) {
    return "The helper share reserved for a recorded boxout on this rebound outcome.";
  }
  if (field.key.includes("defended_field_goals")) {
    return field.classification === "derived_read_only"
      ? "The complete at-rim value, calculated from the near-rim value plus the at-rim bonus."
      : "The defensive value applied to a defended shot from this location.";
  }
  if (field.classification === "derived_read_only") {
    return `This value cannot be edited directly. It is recalculated from related policy values: ${field.derivation || field.description}`;
  }
  const roleExplanations = {
    scorer: "The share of this completed play awarded to the scorer.",
    assister: "The share of this completed play awarded to the assister.",
    ft_assister: "The share of this completed free-throw play awarded to the assister.",
    oreb_pool: "The share of this completed play reserved for the offensive rebounder.",
    screen_assister: "The share of this completed play awarded to the screen helper.",
  };
  return roleExplanations[role] || field.description || "Editable play-credit value.";
}

function advancedRoleMarkup(field, templateKey) {
  const baseline = Number(field.baseline);
  const common = `data-template-key="${escapeHtml(templateKey)}" data-baseline="${baseline}"`;
  const roleName = readableRoleName(field);
  const explanation = advancedRoleExplanation(field);
  if (field.classification === "editable_leaf") {
    return `
      <div class="advanced-role" data-advanced-role="${escapeHtml(field.key)}" ${common} data-basic-group="${escapeHtml(advancedDisplayGroup(field))}">
        <div class="advanced-role-heading">
          <span>${escapeHtml(roleName)}</span>
          <div class="advanced-role-actions">
            <span class="auto-balanced-badge" data-auto-balanced-badge hidden>Auto-balanced</span>
            <button class="advanced-reset" type="button" data-reset-coefficient="${escapeHtml(field.key)}">Use slider</button>
          </div>
        </div>
        <details class="advanced-role-explanation"><summary>What this controls</summary><p>${escapeHtml(explanation)}</p></details>
        <dl class="coefficient-values">
          <div><dt>V9</dt><dd>${baseline.toFixed(3)}</dd></div>
          <div><dt>After slider</dt><dd data-inherited-value>${baseline.toFixed(3)}</dd></div>
          <div class="edited-value"><dt>Edited</dt><dd><input data-coefficient-key="${escapeHtml(field.key)}" type="number" min="${field.minimum ?? 0}" max="${field.maximum ?? 1}" step="0.001" placeholder="After slider" aria-label="Edited ${escapeHtml(field.label)}" /></dd></div>
        </dl>
      </div>`;
  }
  return `
    <div class="advanced-role derived-role" data-advanced-role="${escapeHtml(field.key)}" ${common}>
      <div class="advanced-role-heading"><span>${escapeHtml(roleName)}</span><span class="derived-badge">Calculated · read-only</span></div>
      <details class="advanced-role-explanation"><summary>How this is calculated</summary><p>${escapeHtml(explanation)}</p></details>
      <dl class="coefficient-values">
        <div><dt>V9</dt><dd>${baseline.toFixed(3)}</dd></div>
        <div><dt>Current inputs</dt><dd data-inherited-value>${baseline.toFixed(3)}</dd></div>
        <div><dt>Calculated</dt><dd><output data-derived-value>${baseline.toFixed(3)}</output></dd></div>
      </dl>
    </div>`;
}

function renderAdvancedCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.raw_fields)) {
    elements.advancedOutcomeGroups.innerHTML = '<p class="advanced-loading">The verified coefficient catalog is unavailable.</p>';
    return;
  }
  state.experimentCatalog = catalog;
  const fields = catalog.raw_fields.filter((field) =>
    ["editable_leaf", "derived_read_only"].includes(field.classification));
  const grouped = new Map(OUTCOME_GROUPS.map((group) => [group.key, new Map()]));
  fields.forEach((field) => {
    const outcomeKey = outcomeGroupForField(field);
    const templateKey = templateKeyForField(field);
    const outcomeTemplates = grouped.get(outcomeKey);
    if (!outcomeTemplates.has(templateKey)) outcomeTemplates.set(templateKey, []);
    outcomeTemplates.get(templateKey).push(field);
  });
  elements.advancedOutcomeGroups.innerHTML = OUTCOME_GROUPS.map((outcome) => {
    const templates = grouped.get(outcome.key);
    const roleCount = Array.from(templates.values())
      .reduce((total, templateFields) => total + templateFields.length, 0);
    const cards = Array.from(templates.entries()).map(([templateKey, templateFields]) => `
      <details class="advanced-template-card" data-template-card="${escapeHtml(templateKey)}">
        <summary class="advanced-template-summary">
          <div><h5>${escapeHtml(readableTemplateName(templateKey, templateFields))}</h5><span>${templateFields.length} related role${templateFields.length === 1 ? "" : "s"}</span></div>
          <dl class="template-total"><dt>Template total</dt><dd data-template-total>Reviewing…</dd></dl>
          <span class="advanced-expand-label">View roles</span>
        </summary>
        <div class="advanced-template-body">
          <div class="advanced-role-list">${templateFields.map((field) => advancedRoleMarkup(field, templateKey)).join("")}</div>
          <p class="template-invalid-message" role="alert" hidden>Related roles exceed the template total. Reset or reduce an edited value before running.</p>
        </div>
      </details>`).join("");
    return `
      <details class="advanced-outcome-group" data-outcome-group="${outcome.key}">
        <summary class="advanced-outcome-heading">
          <div><h4>${escapeHtml(outcome.label)}</h4><p>${escapeHtml(outcome.description)}</p></div>
          <span class="advanced-outcome-count">${roleCount} setting${roleCount === 1 ? "" : "s"} · expand</span>
        </summary>
        <div class="advanced-template-grid">${cards}</div>
      </details>`;
  }).join("");
  elements.advancedOutcomeGroups.querySelectorAll("[data-coefficient-key]").forEach((input) => {
    input.addEventListener("input", () => {
      delete elements.rawMultiplierControls.dataset.activeRawGroup;
      refreshAdvancedStates();
      invalidateExperimentReview();
    });
  });
  elements.advancedOutcomeGroups.querySelectorAll("[data-reset-coefficient]").forEach((button) => {
    button.addEventListener("click", () => {
      const selector = `[data-coefficient-key="${CSS.escape(button.dataset.resetCoefficient)}"]`;
      const input = elements.advancedOutcomeGroups.querySelector(selector);
      if (input) input.value = "";
      refreshAdvancedStates();
      invalidateExperimentReview();
    });
  });
  refreshAdvancedStates();
}

function exactAdvancedKeys(record, expectedKeys, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`${label} is missing from the expanded configuration.`);
  }
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} does not exactly match the verified coefficient catalog.`);
  }
}

function advancedPresentationModel(catalog, expandedRaw) {
  if (!catalog || !Array.isArray(catalog.raw_fields) || !expandedRaw) {
    throw new Error("The verified catalog or expanded raw configuration is unavailable.");
  }
  const fields = catalog.raw_fields.filter((field) =>
    ["editable_leaf", "derived_read_only"].includes(field.classification));
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  if (fieldsByKey.size !== fields.length) {
    throw new Error("The verified coefficient catalog contains duplicate field identities.");
  }
  const editableKeys = fields
    .filter((field) => field.classification === "editable_leaf")
    .map((field) => field.key);
  const derivedKeys = fields
    .filter((field) => field.classification === "derived_read_only")
    .map((field) => field.key);
  exactAdvancedKeys(expandedRaw.effective_leaves, editableKeys, "Expanded editable values");
  exactAdvancedKeys(expandedRaw.derived_values, derivedKeys, "Expanded derived values");

  const values = {};
  for (const field of fields) {
    const source = field.classification === "editable_leaf"
      ? expandedRaw.effective_leaves
      : expandedRaw.derived_values;
    const value = source[field.key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Expanded value ${field.key} is not finite.`);
    }
    values[field.key] = Object.is(value, -0) ? 0 : value;
  }

  const governedTemplateKeys = new Set(
    fields
      .filter((field) => field.classification === "derived_read_only"
        && field.key.endsWith(".policy_remainder"))
      .map((field) => templateKeyForField(field)),
  );
  exactAdvancedKeys(
    expandedRaw.template_totals,
    governedTemplateKeys,
    "Expanded template totals",
  );
  const fieldsByTemplate = new Map();
  for (const field of fields) {
    const templateKey = templateKeyForField(field);
    if (!fieldsByTemplate.has(templateKey)) fieldsByTemplate.set(templateKey, []);
    fieldsByTemplate.get(templateKey).push(field.key);
  }
  const templateTotals = {};
  for (const templateKey of governedTemplateKeys) {
    const allocated = expandedRaw.template_totals[templateKey];
    const roleKeys = fieldsByTemplate.get(templateKey);
    if (typeof allocated !== "number" || !Number.isFinite(allocated) || !roleKeys?.length) {
      throw new Error(`Expanded template ${templateKey} is incomplete.`);
    }
    const closure = roleKeys.reduce((total, key) => total + values[key], 0);
    if (!Number.isFinite(closure) || Math.abs(closure - 1) > 1e-10) {
      throw new Error(`Expanded template ${templateKey} does not close to 1.`);
    }
    templateTotals[templateKey] = {
      allocated: Object.is(allocated, -0) ? 0 : allocated,
      closure: Object.is(closure, -0) ? 0 : closure,
    };
  }
  return { fieldsByKey, values, templateTotals };
}

function advancedPreviewDraft() {
  return {
    schema_version: ORIGINAL_CONFIG_SCHEMA,
    name: "Advanced display preview",
    selected_seasons: [2026],
    raw: {
      parent_multipliers: rawParentMultipliers(),
      overrides: configurationOverrides(),
    },
    context: {
      magnifiers: Object.fromEntries(
        [
          "general_offense",
          "general_defense",
          "teammate_offense",
          "teammate_defense",
          "opponent_offense",
          "opponent_defense",
        ].map((factor) => [factor, 1]),
      ),
      reliability_k: { offense: 0, defense: 0 },
      lambda: { offense: 1, defense: 1 },
    },
    engine_version: ORIGINAL_ENGINE_VERSION,
    time_modes: ["all_minutes", "competitive"],
  };
}

function advancedDisplayNumber(value) {
  return (Object.is(value, -0) ? 0 : value).toFixed(3);
}

function markAdvancedExpansionPending() {
  const parents = rawUiMultipliers();
  elements.advancedOutcomeGroups.dataset.expansionState = "pending";
  delete elements.advancedOutcomeGroups.dataset.expansionError;
  elements.rawMultiplierControls.querySelectorAll(".experiment-slider-card").forEach((card) => {
    card.classList.remove("is-invalid");
  });
  elements.advancedOutcomeGroups.querySelectorAll("[data-advanced-role]").forEach((role) => {
    delete role.dataset.effectiveValue;
    const input = role.querySelector("[data-coefficient-key]");
    if (input) {
      const inherited = Number(role.dataset.baseline)
        * Number(parents[role.dataset.basicGroup] ?? 1);
      role.querySelector("[data-inherited-value]").textContent = Number.isFinite(inherited)
        ? advancedDisplayNumber(inherited)
        : "Unavailable";
      const edited = input.value !== "";
      role.classList.remove("is-auto-balanced");
      const balancedBadge = role.querySelector("[data-auto-balanced-badge]");
      if (balancedBadge) balancedBadge.hidden = true;
      role.classList.toggle("is-edited", edited);
      role.classList.toggle("is-inherited", !edited);
    } else {
      role.querySelector("[data-inherited-value]").textContent = "Reviewing…";
      role.querySelector("[data-derived-value]").textContent = "Reviewing…";
    }
  });
  elements.advancedOutcomeGroups.querySelectorAll("[data-template-card]").forEach((card) => {
    card.classList.remove("is-invalid");
    card.classList.add("is-refreshing");
    card.querySelector("[data-template-total]").textContent = "Reviewing…";
    const message = card.querySelector(".template-invalid-message");
    message.textContent = "Recomputing exact governed values…";
    message.hidden = false;
  });
}

function formattedAdvancedExpansionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const fieldMatch = message.match(/^raw\.(?:overrides|effective)\.(.+) must be a finite number in \[0, 1\]\.$/u);
  if (fieldMatch) {
    const field = catalogFieldByKey(fieldMatch[1]);
    const role = field ? readableRoleName(field) : "A play-credit coefficient";
    const group = field ? advancedDisplayGroup(field) : null;
    const slider = group
      ? elements.rawMultiplierControls.querySelector(`[data-raw-group="${CSS.escape(group)}"]`)
      : null;
    const sliderLabel = slider?.closest("label")?.querySelector("span")?.textContent.trim();
    return `${role} would exceed one full possession. Reduce${sliderLabel ? ` the ${sliderLabel} slider` : " this value"} until the coefficient is 1.000 or less.`;
  }
  const templateMatch = message.match(/^(.+) allocates ([^,]+), above 1\.$/u);
  if (templateMatch) {
    const card = elements.advancedOutcomeGroups.querySelector(
      `[data-template-card="${CSS.escape(templateMatch[1])}"]`,
    );
    const label = card?.querySelector("h5")?.textContent.trim() || "A complete play";
    const value = Number(templateMatch[2]);
    return `${label} would allocate ${Number.isFinite(value) ? value.toFixed(3) : templateMatch[2]} of a possession. The maximum is 1.000; reduce one of its sliders or Advanced edits.`;
  }
  if (message === "Near-rim coefficient plus at-rim bonus must be at most 1.") {
    return "The near-rim value plus the at-rim bonus would exceed one full possession. Their combined maximum is 1.000.";
  }
  return message;
}

function advancedExpansionErrorTarget(error) {
  const message = error instanceof Error ? error.message : String(error);
  const fieldMatch = message.match(/^raw\.(?:overrides|effective)\.(.+) must be/u);
  if (fieldMatch) {
    return elements.advancedOutcomeGroups
      .querySelector(`[data-advanced-role="${CSS.escape(fieldMatch[1])}"]`)
      ?.closest("[data-template-card]") || null;
  }
  const templateMatch = message.match(/^(.+) allocates /u);
  if (templateMatch) {
    return elements.advancedOutcomeGroups.querySelector(
      `[data-template-card="${CSS.escape(templateMatch[1])}"]`,
    );
  }
  if (message.includes("Near-rim coefficient plus at-rim bonus")) {
    return elements.advancedOutcomeGroups.querySelector(
      '[data-template-card="v7.defended_field_goals.location_coefficients"]',
    );
  }
  return null;
}

function markAdvancedExpansionInvalid(error) {
  elements.advancedOutcomeGroups.dataset.expansionState = "invalid";
  const message = formattedAdvancedExpansionError(error);
  const target = advancedExpansionErrorTarget(error);
  elements.advancedOutcomeGroups.dataset.expansionError = message;
  const activeRawGroup = elements.rawMultiplierControls.dataset.activeRawGroup;
  if (activeRawGroup) {
    elements.rawMultiplierControls.querySelector(
      `[data-raw-group="${CSS.escape(activeRawGroup)}"]`,
    )?.closest(".experiment-slider-card")?.classList.add("is-invalid");
  }
  elements.advancedOutcomeGroups.querySelectorAll("[data-advanced-role]").forEach((role) => {
    delete role.dataset.effectiveValue;
    const output = role.querySelector("[data-derived-value]");
    if (output) output.textContent = "Unavailable";
  });
  elements.advancedOutcomeGroups.querySelectorAll("[data-template-card]").forEach((card) => {
    card.classList.remove("is-refreshing");
    card.classList.toggle("is-invalid", !target || card === target);
    card.querySelector("[data-template-total]").textContent = !target || card === target
      ? "Above 1"
      : "Not recalculated";
    const invalidMessage = card.querySelector(".template-invalid-message");
    invalidMessage.textContent = message;
    invalidMessage.hidden = Boolean(target && card !== target);
  });
}

function applyAdvancedPresentation(model) {
  const multipliers = rawUiMultipliers();
  const parents = rawParentMultipliers();
  const renderedKeys = new Set();
  elements.advancedOutcomeGroups.querySelectorAll("[data-advanced-role]").forEach((role) => {
    const key = role.dataset.advancedRole;
    const field = model.fieldsByKey.get(key);
    if (!field || renderedKeys.has(key)) {
      throw new Error(`Advanced field ${key} is missing or rendered more than once.`);
    }
    renderedKeys.add(key);
    const value = model.values[key];
    role.dataset.effectiveValue = String(value);
    const input = role.querySelector("[data-coefficient-key]");
    if (field.classification === "editable_leaf" && input) {
      const edited = input.value !== "";
      const requested = Number(field.baseline)
        * sliderMultiplierForField(field, multipliers, parents);
      if (!Number.isFinite(requested)) throw new Error(`Requested slider value ${key} is not finite.`);
      const afterSlider = edited ? requested : value;
      role.querySelector("[data-inherited-value]").textContent = advancedDisplayNumber(afterSlider);
      const autoBalanced = !edited && Math.abs(value - requested) > 1e-12;
      role.classList.toggle("is-auto-balanced", autoBalanced);
      const balancedBadge = role.querySelector("[data-auto-balanced-badge]");
      if (balancedBadge) balancedBadge.hidden = !autoBalanced;
      role.classList.toggle("is-edited", edited);
      role.classList.toggle("is-inherited", !edited);
    } else if (field.classification === "derived_read_only" && !input) {
      const display = advancedDisplayNumber(value);
      role.querySelector("[data-inherited-value]").textContent = display;
      role.querySelector("[data-derived-value]").textContent = display;
    } else {
      throw new Error(`Advanced field ${key} does not match its catalog classification.`);
    }
  });
  if (renderedKeys.size !== model.fieldsByKey.size) {
    throw new Error("Not every catalog-driven Advanced field is rendered exactly once.");
  }

  const renderedTemplates = new Set();
  elements.advancedOutcomeGroups.querySelectorAll("[data-template-card]").forEach((card) => {
    const templateKey = card.dataset.templateCard;
    if (renderedTemplates.has(templateKey)) {
      throw new Error(`Advanced template ${templateKey} is rendered more than once.`);
    }
    renderedTemplates.add(templateKey);
    const total = model.templateTotals[templateKey];
    card.classList.remove("is-refreshing", "is-invalid");
    const invalidMessage = card.querySelector(".template-invalid-message");
    invalidMessage.hidden = true;
    if (!total) {
      card.querySelector("[data-template-total]").textContent = "Independent";
      delete card.dataset.allocatedTotal;
      delete card.dataset.templateTotal;
      delete card.dataset.closedTotal;
      return;
    }
    card.dataset.allocatedTotal = String(total.allocated);
    card.dataset.templateTotal = String(total.allocated);
    card.dataset.closedTotal = String(total.closure);
    card.querySelector("[data-template-total]").textContent =
      `${advancedDisplayNumber(total.allocated)} / 1.000`;
  });
  if (Object.keys(model.templateTotals).some((key) => !renderedTemplates.has(key))) {
    throw new Error("An expanded governed template is absent from the Advanced editor.");
  }
  elements.advancedOutcomeGroups.dataset.expansionState = "ready";
  delete elements.advancedOutcomeGroups.dataset.expansionError;
  delete elements.rawMultiplierControls.dataset.activeRawGroup;
}

function refreshAdvancedStates() {
  if (!elements.advancedOutcomeGroups.querySelector("[data-advanced-role]")) {
    state.advancedRefreshPromise = Promise.resolve(null);
    return state.advancedRefreshPromise;
  }
  const revision = ++state.advancedRefreshRevision;
  markAdvancedExpansionPending();
  validateExperimentDraft({ announce: false });
  const refresh = (async () => {
    try {
      const expand = state.runtimeModule?.expandOriginalExperimentConfiguration;
      if (typeof expand !== "function") {
        throw new Error("The verified browser configuration expander is unavailable.");
      }
      const configuration = await expand(advancedPreviewDraft(), state.experimentCatalog);
      if (revision !== state.advancedRefreshRevision) return null;
      const model = advancedPresentationModel(
        state.experimentCatalog,
        configuration.expanded_raw,
      );
      applyAdvancedPresentation(model);
      validateExperimentDraft({ announce: false });
      return model;
    } catch (error) {
      if (revision !== state.advancedRefreshRevision) return null;
      markAdvancedExpansionInvalid(error);
      validateExperimentDraft({ announce: false });
      return null;
    }
  })();
  state.advancedRefreshPromise = refresh;
  return refresh;
}

async function awaitAdvancedRefreshSettled() {
  let pending;
  do {
    pending = state.advancedRefreshPromise;
    await pending;
  } while (pending !== state.advancedRefreshPromise);
}

function formatStorageBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1_000_000) return `${Math.max(1, Math.ceil(bytes / 1_000))} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function formatRuntimeRange(estimate) {
  const low = Number(estimate?.runtime_seconds_low || 0);
  const high = Number(estimate?.runtime_seconds_high || low);
  const format = (seconds) => seconds < 60
    ? `${Math.ceil(seconds)} sec`
    : seconds < 3600
    ? `${Math.ceil(seconds / 60)} min`
    : `${(seconds / 3600).toFixed(1)} hr`;
  return `${format(low)}–${format(high)}`;
}

function updateAllSeasonsEstimate() {
  const estimate = state.experimentManifest?.all_seasons_estimate;
  if (!estimate) return;
  elements.allSeasonsDownloadEstimate.textContent = formatStorageBytes(estimate.download_bytes);
  elements.allSeasonsStorageEstimate.textContent = formatStorageBytes(estimate.storage_bytes);
  elements.allSeasonsRuntimeEstimate.textContent = formatRuntimeRange(estimate);
}

function syncAllSeasonsSelection({ fromCheckbox = false } = {}) {
  if (fromCheckbox) {
    Array.from(elements.experimentSeasons.options).forEach((option) => {
      option.selected = elements.experimentAllSeasons.checked;
    });
  }
  const selectedCount = selectedExperimentSeasons().length;
  const allSelected = selectedCount === elements.experimentSeasons.options.length;
  elements.experimentAllSeasons.checked = allSelected;
  elements.allSeasonsWarning.hidden = !allSelected;
  if (!allSelected) elements.confirmAllSeasons.checked = false;
  updateAllSeasonsEstimate();
  invalidateExperimentReview();
}

function syncLinkedSideControl(kind) {
  const linked = kind === "k" ? elements.linkReliabilityK : elements.linkLambda;
  const offense = kind === "k" ? elements.reliabilityKOffense : elements.lambdaOffense;
  const defense = kind === "k" ? elements.reliabilityKDefense : elements.lambdaDefense;
  defense.disabled = linked.checked;
  if (linked.checked) defense.value = offense.value;
  invalidateExperimentReview();
}

function validateExperimentDraft({ announce = true } = {}) {
  const errors = [];
  if (!elements.experimentName.value.trim()) errors.push("Enter an experiment name.");
  if (!selectedExperimentSeasons().length) errors.push("Choose at least one season.");
  if (elements.experimentAllSeasons.checked && !elements.confirmAllSeasons.checked) {
    errors.push("Confirm the All Seasons download and storage estimate.");
  }
  elements.experimentForm.querySelectorAll('input[type="number"]').forEach((input) => {
    if (!input.checkValidity() || !Number.isFinite(Number(input.value))) {
      const label = input.closest("label")?.querySelector("span")?.textContent || "A numeric setting";
      errors.push(`${label} is outside its allowed range.`);
    }
  });
  const advancedRoleCount = elements.advancedOutcomeGroups.querySelectorAll(
    "[data-advanced-role]",
  ).length;
  const expansionState = elements.advancedOutcomeGroups.dataset.expansionState;
  if (advancedRoleCount && expansionState !== "ready") {
    errors.push(expansionState === "pending"
      ? "Advanced derived values are still being reviewed."
      : elements.advancedOutcomeGroups.dataset.expansionError
        || "Advanced derived values could not be verified.");
  } else {
    const invalidTemplates = elements.advancedOutcomeGroups.querySelectorAll(
      ".advanced-template-card.is-invalid",
    ).length;
    if (invalidTemplates) {
      errors.push(`${invalidTemplates} Advanced template${invalidTemplates === 1 ? " does" : "s do"} not close.`);
    }
  }
  elements.experimentValidationErrors.innerHTML = errors
    .map((error) => `<li>${escapeHtml(error)}</li>`)
    .join("");
  elements.experimentValidationSummary.textContent = errors.length
    ? "This configuration cannot run yet."
    : `${selectedExperimentSeasons().length} season${selectedExperimentSeasons().length === 1 ? "" : "s"} · both time modes · ${Object.keys(advancedOverrides()).length} Advanced edit${Object.keys(advancedOverrides()).length === 1 ? "" : "s"}.`;
  elements.experimentForm.classList.toggle("has-invalid-settings", errors.length > 0);
  const calculationReady = Boolean(
    state.experimentClient?.reviewRun
    && state.experimentClient?.start
    && state.runtimeModule?.expandOriginalExperimentConfiguration
    && state.experimentCatalog,
  );
  elements.runExperiment.disabled = errors.length > 0
    || state.experimentStarting
    || Boolean(state.activeExperimentId)
    || !calculationReady;
  if (announce && errors.length) elements.experimentValidationErrors.focus?.();
  return errors;
}

function invalidateExperimentReview() {
  state.experimentReview = null;
  validateExperimentDraft({ announce: false });
}

function resetExperimentEditor() {
  delete elements.rawMultiplierControls.dataset.activeRawGroup;
  elements.experimentName.value = "My V9 experiment";
  Array.from(elements.experimentSeasons.options).forEach((option) => {
    option.selected = option.value === "2026";
  });
  elements.experimentAllSeasons.checked = false;
  elements.confirmAllSeasons.checked = false;
  elements.allSeasonsWarning.hidden = true;
  elements.rawMultiplierControls.querySelectorAll("[data-raw-group]").forEach((input) => {
    input.value = "1";
  });
  syncRawMultiplierDisplays();
  elements.contextMagnifierControls.querySelectorAll("[data-context-key]").forEach((input) => {
    input.value = "1";
  });
  elements.linkReliabilityK.checked = true;
  elements.reliabilityKOffense.value = "0";
  elements.reliabilityKDefense.value = "0";
  elements.reliabilityKDefense.disabled = true;
  elements.linkLambda.checked = true;
  elements.lambdaOffense.value = "1";
  elements.lambdaDefense.value = "1";
  elements.lambdaDefense.disabled = true;
  elements.advancedOutcomeGroups.querySelectorAll("[data-coefficient-key]").forEach((input) => {
    input.value = "";
  });
  refreshAdvancedStates();
  invalidateExperimentReview();
}

function inferredVirtualRawSettings(raw, overrides) {
  const settings = {};
  const presentationOverrides = { ...overrides };
  Object.entries(VIRTUAL_RAW_GROUP_FIELDS).forEach(([virtualGroup, keys]) => {
    const ratios = keys.map((key) => {
      const field = catalogFieldByKey(key);
      if (!field || !Number(field.baseline)) return null;
      const effective = Object.hasOwn(overrides, key)
        ? Number(overrides[key])
        : Number(field.baseline) * Number(raw[field.group] ?? 1);
      return effective / Number(field.baseline);
    });
    const coordinated = ratios.every(Number.isFinite)
      && ratios.every((value) => Math.abs(value - ratios[0]) <= 1e-12)
      && ratios[0] >= 0
      && ratios[0] <= 2;
    settings[virtualGroup] = coordinated ? ratios[0] : 1;
    keys.forEach((key, index) => {
      if (coordinated) {
        delete presentationOverrides[key];
        return;
      }
      const field = catalogFieldByKey(key);
      if (field && Number.isFinite(ratios[index])) {
        presentationOverrides[key] = Number(field.baseline) * ratios[index];
      }
    });
  });
  return { settings, presentationOverrides };
}

function applyExperimentConfiguration(configuration) {
  if (!configuration) return;
  delete elements.rawMultiplierControls.dataset.activeRawGroup;
  elements.experimentName.value = configuration.name || "Copied experiment";
  const seasons = new Set((configuration.selected_seasons || configuration.selectedSeasons || []).map(Number));
  Array.from(elements.experimentSeasons.options).forEach((option) => {
    option.selected = seasons.has(Number(option.value));
  });
  const raw = configuration.raw?.parent_multipliers || configuration.raw?.parentMultipliers || {};
  const overrides = configuration.raw?.overrides || {};
  const virtual = inferredVirtualRawSettings(raw, overrides);
  elements.rawMultiplierControls.querySelectorAll("[data-raw-group]").forEach((input) => {
    input.value = Object.hasOwn(virtual.settings, input.dataset.rawGroup)
      ? virtual.settings[input.dataset.rawGroup]
      : raw[input.dataset.rawGroup] ?? 1;
  });
  syncRawMultiplierDisplays();
  const multipliers = rawUiMultipliers();
  const parents = rawParentMultipliers();
  const generatedVirtual = virtualGroupOverrides({}, multipliers, parents);
  const generated = automaticallyBalancedOverrides(
    generatedVirtual,
    new Set(),
    multipliers,
    parents,
  );
  Object.entries(generated).forEach(([key, value]) => {
    if (
      Object.hasOwn(virtual.presentationOverrides, key)
      && Math.abs(Number(virtual.presentationOverrides[key]) - Number(value)) <= 1e-12
    ) delete virtual.presentationOverrides[key];
  });
  const context = configuration.context?.magnifiers || {};
  elements.contextMagnifierControls.querySelectorAll("[data-context-key]").forEach((input) => {
    input.value = context[input.dataset.contextKey] ?? 1;
  });
  const reliability = configuration.context?.reliability_k || configuration.context?.reliabilityK || {};
  const lambda = configuration.context?.lambda || {};
  elements.reliabilityKOffense.value = reliability.offense ?? 0;
  elements.reliabilityKDefense.value = reliability.defense ?? reliability.offense ?? 0;
  elements.linkReliabilityK.checked = Number(elements.reliabilityKOffense.value) === Number(elements.reliabilityKDefense.value);
  elements.reliabilityKDefense.disabled = elements.linkReliabilityK.checked;
  elements.lambdaOffense.value = lambda.offense ?? 1;
  elements.lambdaDefense.value = lambda.defense ?? lambda.offense ?? 1;
  elements.linkLambda.checked = Number(elements.lambdaOffense.value) === Number(elements.lambdaDefense.value);
  elements.lambdaDefense.disabled = elements.linkLambda.checked;
  elements.advancedOutcomeGroups.querySelectorAll("[data-coefficient-key]").forEach((input) => {
    input.value = Object.hasOwn(virtual.presentationOverrides, input.dataset.coefficientKey)
      ? virtual.presentationOverrides[input.dataset.coefficientKey]
      : "";
  });
  syncAllSeasonsSelection();
  refreshAdvancedStates();
}

function experimentIdentifier(row) {
  return row.experimentId || row.experiment_id || row.id;
}

function experimentDisplayName(row) {
  return row.name || "Untitled experiment";
}

function experimentStatus(row) {
  return row.progress?.status || row.status || (row.published ? "complete" : "draft");
}

function serverExperiment(experimentId = selectedExperimentId()) {
  return state.serverExperimentCatalog.find(
    (row) => String(experimentIdentifier(row)) === String(experimentId),
  ) || null;
}

function isServerV10Experiment(experimentId = selectedExperimentId()) {
  return Boolean(serverExperiment(experimentId));
}

function renderExperimentSelector(experiments) {
  state.localExperimentCatalog = experiments;
  const selected = elements.statVersion.value;
  const completed = [...experiments, ...state.serverExperimentCatalog].filter((row) =>
    row.published
    && experimentStatus(row) === "complete"
    && row.stale !== true
    && row.requiresRerun !== true);
  elements.officialRankingOptions
    .querySelectorAll("option[data-featured-experiment]")
    .forEach((option) => option.remove());
  completed.filter((row) => row.featured_ranking).forEach((row) => {
    const option = document.createElement("option");
    option.value = `experiment:${experimentIdentifier(row)}`;
    option.textContent = experimentDisplayName(row);
    option.dataset.featuredExperiment = "true";
    // Featured experiments sit below the official statistics, above V9.
    const v9Option = elements.officialRankingOptions.querySelector('option[value="original"]');
    if (v9Option) v9Option.before(option);
    else elements.officialRankingOptions.append(option);
  });
  const ordinary = completed.filter((row) => !row.featured_ranking);
  elements.myExperimentOptions.innerHTML = ordinary.length
    ? ordinary.map((row) => {
        return `<option value="experiment:${escapeHtml(experimentIdentifier(row))}">${escapeHtml(experimentDisplayName(row))}</option>`;
      }).join("")
    : '<option value="local:none" disabled>No completed experiments available</option>';
  const values = Array.from(elements.statVersion.options, (option) => option.value);
  const requested = state.requestedStatVersion;
  if (requested && values.includes(requested)) {
    elements.statVersion.value = requested;
    state.requestedStatVersion = null;
  } else if (values.includes(selected)) elements.statVersion.value = selected;
  else elements.statVersion.value = defaultOfficialRanking();
}

async function refreshServerExperiments() {
  const sources = [
    { root: "/api/v10-experiments", kind: "legacy" },
    { root: "/api/v10-genuine-experiments", kind: "genuine" },
    {
      root: "/api/v10-unbounded-side-budget-experiments",
      kind: "unbounded-side-budget",
    },
  ];
  const catalogs = await Promise.all(sources.map(async ({ root, kind }) => {
    try {
      const response = await fetch(`${root}/suites?limit=5`);
      if (!response.ok) return [];
      const payload = await response.json();
      if (payload.available === false) return [];
      const details = await Promise.all((payload.rows || []).map(async (suite) => {
        const detailResponse = await fetch(`${root}/suites/${encodeURIComponent(suite.suite_id)}`);
        return detailResponse.ok ? detailResponse.json() : null;
      }));
      return details
        .filter((detail) => detail?.suite?.status === "complete")
        .flatMap((detail) =>
          (detail.arms || [])
            .filter((arm) => arm.status === "complete")
            .map((arm) => ({
              ...arm,
              name: detail.suite?.manifest?.coverage_scope === "all_history"
                ? arm.label
                : `2025–26 · ${arm.label}`,
              published: true,
              selected_seasons: detail.suite?.manifest?.season_end_years || [2026],
              featured_ranking: detail.suite?.manifest?.coverage_scope === "all_history",
              server_v10_experiment: true,
              server_experiment_api: kind,
            })),
        );
    } catch (_error) {
      return [];
    }
  }));
  state.serverExperimentCatalog = catalogs.flat();
  renderExperimentSelector(state.localExperimentCatalog);
  return state.serverExperimentCatalog;
}

function seasonEndYearFromDashboardValue(value) {
  if (value === "All Seasons") return null;
  const startYear = Number(String(value).slice(0, 4));
  return Number.isInteger(startYear) ? startYear + 1 : null;
}

function longestConsecutiveSeasonSpan(seasons) {
  const values = [...new Set([...seasons].map(Number).filter(Number.isInteger))]
    .sort((left, right) => left - right);
  let longest = 0;
  let current = 0;
  let previous = null;
  values.forEach((season) => {
    current = previous !== null && season === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = season;
  });
  return longest;
}

function updateRollingWindowAvailability(allowedSeasons) {
  const availableSpan = allowedSeasons === null
    ? Number.POSITIVE_INFINITY
    : longestConsecutiveSeasonSpan(allowedSeasons);
  [elements.trendWindows, elements.liftWindows].forEach((inputs) => {
    inputs.forEach((input) => {
      input.disabled = Number(input.value) > availableSpan;
    });
    const selected = inputs.find((input) => input.checked);
    if (selected?.disabled) {
      const replacement = inputs
        .filter((input) => !input.disabled)
        .sort((left, right) => Number(right.value) - Number(left.value))[0];
      if (replacement) replacement.checked = true;
    }
  });
}

async function updateSourceSeasonAvailability() {
  const generation = state.deferredPanelGeneration;
  const source = elements.statVersion.value;
  const experimentId = selectedExperimentId();
  let allowedSeasons = null;
  const serverExperimentSelected = Array.isArray(state.serverExperimentCatalog)
    ? state.serverExperimentCatalog.find((row) => String(
        row.experimentId || row.experiment_id || row.id,
      ) === String(experimentId))
    : null;
  if (serverExperimentSelected) {
    const selected = serverExperimentSelected.selectedSeasons
      || serverExperimentSelected.selected_seasons
      || [2026];
    allowedSeasons = new Set(selected.map(Number));
  } else if (experimentId && state.experimentClient?.getExperiment) {
    const experiment = await state.experimentClient.getExperiment(experimentId);
    const selected = experiment?.selectedSeasons || experiment?.selected_seasons
      || experiment?.configuration?.selected_seasons || [];
    allowedSeasons = new Set(selected.map(Number));
  } else if (!experimentId && state.sourceSeasonEndYears?.[source]) {
    // A server statistic that has calculated fewer seasons than the page
    // lists (V12 and V13, while their seasons are still being run) offers only those.
    const calculated = state.sourceSeasonEndYears[source];
    const covered = state.seasonValues.every((season) => {
      const seasonEndYear = seasonEndYearFromDashboardValue(season);
      return !seasonEndYear || calculated.has(seasonEndYear);
    });
    if (!covered) allowedSeasons = calculated;
  }
  if (
    generation !== state.deferredPanelGeneration
    || source !== elements.statVersion.value
  ) return false;
  const hasRankingSeasonPicker = Array.isArray(state.seasonValues)
    && Boolean(elements.seasonCheckboxes);
  state.allowedSeasonValues = hasRankingSeasonPicker && allowedSeasons
    ? new Set(state.seasonValues.filter((season) => {
        const seasonEndYear = seasonEndYearFromDashboardValue(season);
        return seasonEndYear && allowedSeasons.has(seasonEndYear);
      }))
    : null;
  updateRollingWindowAvailability(allowedSeasons);
  [elements.season].forEach((select) => {
    Array.from(select.options).forEach((option) => {
      if (!option.dataset.officialLabel) option.dataset.officialLabel = option.textContent;
      const seasonEndYear = seasonEndYearFromDashboardValue(option.value);
      option.disabled = Boolean(allowedSeasons && seasonEndYear && !allowedSeasons.has(seasonEndYear));
      option.hidden = option.disabled;
      option.textContent = option.dataset.officialLabel;
    });
    const allOption = Array.from(select.options).find((option) => option.value === "All Seasons");
    if (allOption && allowedSeasons) {
      allOption.textContent = allowedSeasons.size === 13
        ? "All seasons"
        : `Selected seasons (${allowedSeasons.size})`;
    }
    if (select.selectedOptions[0]?.disabled) select.value = "All Seasons";
  });
  if (!hasRankingSeasonPicker) return true;
  elements.seasonCheckboxes.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.disabled = Boolean(
      state.allowedSeasonValues && !state.allowedSeasonValues.has(input.value),
    );
  });
  state.selectedSeasons = selectedRankingSeasons();
  setCheckedRankingSeasons(state.selectedSeasons);
  syncLegacySeasonSelect();
  updateSeasonPickerPresentation();
  return true;
}

function localExperimentCard(row) {
  const experimentId = experimentIdentifier(row);
  const seasons = row.selectedSeasons || row.selected_seasons || [];
  const completedSeasons = row.progress?.completedSeasons || row.completedSeasons || [];
  const progress = completedSeasons.length
    ? `${completedSeasons.length}/${seasons.length} seasons`
    : experimentStatus(row);
  const stale = row.stale
    ? '<span class="experiment-stale">Older data release · view only until rerun</span>'
    : "";
  const storedError = row.progress?.error || row.error || null;
  const failureDetails = storedError?.details;
  const residualDetail = Number.isFinite(failureDetails?.residual)
    && Number.isFinite(failureDetails?.tolerance)
    ? ` ${failureDetails.field || "Value"} residual ${failureDetails.residual}; tolerance ${failureDetails.tolerance}.`
    : "";
  const failureMessage = storedError?.message
    ? `${storedError.message}${residualDetail}`
    : "";
  const failure = failureMessage
    ? `<span class="experiment-error">${escapeHtml(failureMessage)}</span>`
    : "";
  const open = row.published
    && experimentStatus(row) === "complete"
    && row.stale !== true
    && row.requiresRerun !== true
    ? `<button type="button" data-experiment-action="open" data-experiment-id="${escapeHtml(experimentId)}">Open in Rankings</button>`
    : "";
  const resume = ["interrupted", "cancelled"].includes(experimentStatus(row))
    && row.stale !== true
    && row.requiresRerun !== true
    && completedSeasons.length < seasons.length
    ? `<button type="button" data-experiment-action="resume" data-experiment-id="${escapeHtml(experimentId)}">Resume</button>`
    : "";
  return `
    <article class="local-experiment-card" data-local-experiment="${escapeHtml(experimentId)}">
      <div><strong>${escapeHtml(experimentDisplayName(row))}</strong><span>${escapeHtml(progress)}</span>${stale}${failure}</div>
      <div class="local-experiment-actions">
        ${open}
        ${resume}
        <button type="button" data-experiment-action="rename" data-experiment-id="${escapeHtml(experimentId)}">Rename</button>
        <button type="button" data-experiment-action="clone" data-experiment-id="${escapeHtml(experimentId)}">Clone</button>
        <button type="button" data-experiment-action="rerun" data-experiment-id="${escapeHtml(experimentId)}">Rerun</button>
        <button class="delete-experiment" type="button" data-experiment-action="delete" data-experiment-id="${escapeHtml(experimentId)}">Delete</button>
      </div>
    </article>`;
}

async function refreshLocalExperiments() {
  if (!state.experimentClient?.listAll) {
    renderExperimentSelector([]);
    elements.localExperimentList.innerHTML = "<p>No local experiments yet.</p>";
    return [];
  }
  const experiments = await state.experimentClient.listAll();
  const before = elements.statVersion.value;
  renderExperimentSelector(experiments);
  elements.localExperimentList.innerHTML = experiments.length
    ? experiments.map(localExperimentCard).join("")
    : "<p>No local experiments yet.</p>";
  if (before !== elements.statVersion.value) {
    const generation = resetDeferredPanelLoads();
    await updateSourceSeasonAvailability();
    if (generation !== state.deferredPanelGeneration) return experiments;
    const restored = restorePlayerContextSelection(
      new URLSearchParams(window.location.search),
    );
    if (!restored && state.selectedContextPlayerId) {
      closePlayerContext({ updateUrl: false, restoreFocus: false });
    }
    if (state.dashboardReady) await loadSelectedStatistic();
  }
  return experiments;
}

async function handleLocalExperimentAction(event) {
  const button = event.target.closest("[data-experiment-action]");
  if (!button || !state.experimentClient) return;
  const { experimentAction: action, experimentId } = button.dataset;
  button.disabled = true;
  try {
    if (action === "open") {
      const current = await state.experimentClient.getExperiment(experimentId);
      if (!current || current.stale === true || current.requiresRerun === true) {
        throw new Error(
          "Rerun this experiment under the receipt-bound local release before viewing it.",
        );
      }
      elements.statVersion.value = `experiment:${experimentId}`;
      elements.experimentDialog.close();
      const generation = resetDeferredPanelLoads();
      await updateSourceSeasonAvailability();
      if (generation !== state.deferredPanelGeneration) return;
      updateV8Presentation();
      await loadSelectedStatistic();
      return;
    }
    if (action === "resume") {
      const current = await state.experimentClient.getExperiment(experimentId);
      if (!current || current.stale === true || current.requiresRerun === true) {
        throw new Error("This experiment cannot resume under the current receipt-bound release.");
      }
      state.activeExperimentId = experimentId;
      state.experimentClient.resume(experimentId);
      elements.cancelExperiment.hidden = false;
      elements.experimentRuntimeStatus.textContent = "Resuming from the last completed season checkpoint in a fresh calculation pass.";
      return;
    }
    if (action === "rename") {
      const current = await state.experimentClient.getExperiment(experimentId);
      const name = window.prompt("Rename this local experiment", experimentDisplayName(current));
      if (name?.trim()) await state.experimentClient.rename(experimentId, name.trim());
    }
    if (action === "clone") {
      const current = await state.experimentClient.getExperiment(experimentId);
      const clone = await state.experimentClient.clone(experimentId, {
        name: `${experimentDisplayName(current)} copy`.slice(0, 80),
      });
      const cloned = typeof clone === "string"
        ? await state.experimentClient.getExperiment(clone)
        : clone;
      applyExperimentConfiguration(cloned.configuration || cloned);
      elements.experimentDialogTitle.textContent = "Edit cloned experiment";
      document.querySelector("#original-experiment-form")?.scrollIntoView({ block: "start" });
    }
    if (action === "rerun") {
      const current = await state.experimentClient.getExperiment(experimentId);
      const bootstrap = manifestBootstrap();
      const configuration = current.configuration;
      const reviewed = await state.experimentClient.reviewRun({
        configuration,
        manifestUrl: bootstrap.url,
        manifestSha256: bootstrap.sha256,
        selectedSeasons: configuration.selected_seasons,
      });
      const rerunId = await state.experimentClient.rerun(experimentId, {
        configuration,
        manifestUrl: bootstrap.url,
        manifestSha256: bootstrap.sha256,
        confirmation: {
          confirmed: true,
          all_seasons_confirmed: reviewed.review.all_seasons,
          review_receipt: reviewed.review.review_receipt,
        },
      });
      state.activeExperimentId = typeof rerunId === "string"
        ? rerunId
        : experimentIdentifier(rerunId);
      showInitialExperimentRunProgress(reviewed);
    }
    if (action === "delete") {
      const confirmed = window.confirm(
        "Delete this experiment, its progress, and its local results from this browser? Verified shared packages may remain cached.",
      );
      if (confirmed) await state.experimentClient.delete(experimentId);
    }
    await refreshLocalExperiments();
  } catch (error) {
    elements.experimentRuntimeError.textContent = error.message;
    elements.experimentRuntimeError.hidden = false;
  } finally {
    button.disabled = false;
  }
}

function manifestBootstrap() {
  const relativeUrl = document.querySelector(
    'meta[name="original-package-manifest"]',
  )?.content;
  const sha256 = document.querySelector(
    'meta[name="original-package-manifest-sha256"]',
  )?.content || "";
  if (!relativeUrl || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(
      "A checksum-bound local V9 package manifest has not been configured.",
    );
  }
  // The same manifest URL is sent to a module worker, where relative URLs
  // would otherwise resolve from /dashboard-assets/ instead of this page.
  const url = new URL(relativeUrl, document.baseURI).toString();
  if (new URL(url).origin !== window.location.origin) {
    throw new Error(
      "The V9 package manifest must use the dashboard origin.",
    );
  }
  return { url, sha256 };
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadVerifiedCatalogForEditor() {
  const bootstrap = manifestBootstrap();
  if (!bootstrap.sha256) {
    throw new Error("The trusted package-manifest checksum has not been embedded in this release.");
  }
  const response = await fetch(bootstrap.url, { cache: "no-cache" });
  if (!response.ok) throw new Error("The V9 package manifest is not available.");
  const manifestBytes = await response.arrayBuffer();
  const actualManifestSha = await sha256Hex(manifestBytes);
  if (actualManifestSha !== bootstrap.sha256) {
    throw new Error("The V9 package manifest failed its release checksum.");
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const catalogResponse = await fetch(manifest.catalog.url, { cache: "force-cache" });
  if (!catalogResponse.ok) throw new Error("The signed coefficient catalog could not be downloaded.");
  const catalogBytes = await catalogResponse.arrayBuffer();
  const actualCatalogSha = await sha256Hex(catalogBytes);
  if (actualCatalogSha !== manifest.catalog.sha256) {
    throw new Error("The coefficient catalog failed its package checksum.");
  }
  const catalog = JSON.parse(new TextDecoder().decode(catalogBytes));
  state.experimentManifest = manifest;
  renderAdvancedCatalog(catalog);
  updateAllSeasonsEstimate();
  return { manifest, catalog };
}

function runtimeEventDetail(event) {
  return event?.detail || event?.data || event || {};
}

function experimentSeasonLabel(seasonEndYear) {
  const year = Number(seasonEndYear);
  if (!Number.isInteger(year)) return "selected season";
  return `${year - 1}–${String(year).slice(-2).padStart(2, "0")}`;
}

function formattedGameCount(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value));
}

function showInitialExperimentRunProgress(reviewBundle) {
  const selected = new Set((reviewBundle?.selectedSeasons || []).map(Number));
  const seasons = reviewBundle?.manifest?.seasons || [];
  const totalGames = seasons
    .filter((season) => selected.has(Number(season.season_end_year)))
    .reduce((sum, season) => sum + Number(season.game_count || 0), 0);
  updateExperimentRunProgress({
    stage: "preparing",
    completedGames: 0,
    totalGames,
    currentGameId: null,
    seasonEndYear: null,
    seasonCompletedGames: 0,
    seasonTotalGames: null,
  });
}

function updateExperimentRunProgress(progress, terminalType = null) {
  const current = progress || state.experimentRunProgress;
  if (!current) return;
  state.experimentRunProgress = { ...current };
  elements.experimentRunProgress.hidden = false;

  const total = Math.max(0, Number(current.totalGames) || 0);
  const completed = Math.min(total, Math.max(0, Number(current.completedGames) || 0));
  const seasonTotal = Math.max(0, Number(current.seasonTotalGames) || 0);
  const seasonCompleted = Math.min(
    seasonTotal,
    Math.max(0, Number(current.seasonCompletedGames) || 0),
  );
  const seasonLabel = experimentSeasonLabel(current.seasonEndYear);
  const globalCount = `${formattedGameCount(completed)} of ${formattedGameCount(total)} selected games`;
  elements.experimentRunProgressBar.max = total || 1;
  elements.experimentRunProgressBar.value = completed;

  if (terminalType === "cancelled") {
    elements.experimentRunProgressLabel.textContent = "Experiment cancelled";
    elements.experimentRunProgressCount.textContent = globalCount;
    elements.experimentRunProgressDetail.textContent = "Completed seasons were kept; the unfinished season was removed.";
    return;
  }
  if (terminalType === "error") {
    elements.experimentRunProgressLabel.textContent = "Experiment stopped";
    elements.experimentRunProgressCount.textContent = globalCount;
    elements.experimentRunProgressDetail.textContent = "The run stopped safely before incomplete results could be published.";
    return;
  }

  const stage = terminalType === "complete" ? "complete" : current.stage;
  if (stage === "calculating-games") {
    elements.experimentRunProgressLabel.textContent = `Calculating ${seasonLabel}`;
    elements.experimentRunProgressCount.textContent = `Game ${formattedGameCount(seasonCompleted)} of ${formattedGameCount(seasonTotal)}`;
    elements.experimentRunProgressDetail.textContent = current.currentGameId
      ? `${globalCount} complete · game ID ${current.currentGameId}`
      : `${globalCount} complete · preparing the first game`;
    return;
  }
  if (stage === "saving-results") {
    elements.experimentRunProgressLabel.textContent = `Saving ${seasonLabel}`;
    elements.experimentRunProgressCount.textContent = globalCount;
    elements.experimentRunProgressDetail.textContent = "All games in this season are calculated; player results are being verified and saved locally.";
    return;
  }
  if (stage === "checkpointing") {
    elements.experimentRunProgressLabel.textContent = `Checking ${seasonLabel}`;
    elements.experimentRunProgressCount.textContent = globalCount;
    elements.experimentRunProgressDetail.textContent = "The season calculation is complete and its local receipt is being verified.";
    return;
  }
  if (stage === "season-complete") {
    elements.experimentRunProgressLabel.textContent = `${seasonLabel} complete`;
    elements.experimentRunProgressCount.textContent = globalCount;
    elements.experimentRunProgressDetail.textContent = "Season results passed and were saved on this device.";
    return;
  }
  if (stage === "complete") {
    elements.experimentRunProgressLabel.textContent = "Experiment complete";
    elements.experimentRunProgressCount.textContent = `${formattedGameCount(total)} of ${formattedGameCount(total)} games`;
    elements.experimentRunProgressBar.value = total;
    elements.experimentRunProgressDetail.textContent = "Every selected game passed. The experiment is ready under My Experiments.";
    return;
  }
  if (stage === "verifying-packages" || stage === "preparing-calculation") {
    elements.experimentRunProgressLabel.textContent = `Preparing ${seasonLabel}`;
    elements.experimentRunProgressCount.textContent = globalCount;
    elements.experimentRunProgressDetail.textContent = stage === "verifying-packages"
      ? "Downloading and verifying this season’s local calculation packages."
      : "Packages passed; decoding the game inputs before calculation.";
    return;
  }
  elements.experimentRunProgressLabel.textContent = "Preparing experiment";
  elements.experimentRunProgressCount.textContent = globalCount;
  elements.experimentRunProgressDetail.textContent = "Verifying the signed catalog and selected season packages.";
}

async function handleExperimentRuntimeEvent(event) {
  const detail = runtimeEventDetail(event);
  const type = detail.type || event?.type || "state";
  const season = detail.seasonEndYear || detail.season_end_year;
  const messages = {
    ready: "Browser-local calculation worker ready.",
    state: detail.status ? `Experiment ${detail.status}.` : "Experiment state updated.",
    "season-started": season ? `Calculating season ${season}…` : "Calculating the next season…",
    "shard-verified": detail.kind ? `Verified ${detail.kind} package.` : "Verified a package shard.",
    "season-checkpoint": season ? `Season ${season} passed and was checkpointed.` : "Season checkpoint saved.",
    "worker-recycle": "Season checkpoints are safe. Reclaiming memory before the next calculation pass…",
    complete: "Experiment complete. It is now available under My Experiments.",
    cancelled: "Experiment cancelled. Incomplete result rows were removed; verified packages were retained.",
    error: detail.message || detail.error?.message || "The browser-local run stopped safely.",
  };
  elements.experimentRuntimeStatus.textContent = messages[type] || messages.state;
  if (detail.status === "running" && detail.experimentId && !state.activeExperimentId) {
    state.activeExperimentId = detail.experimentId;
  }
  if (detail.runProgress || ["complete", "cancelled", "error"].includes(type)) {
    updateExperimentRunProgress(detail.runProgress, type);
  }
  elements.cancelExperiment.hidden = !["state", "season-started", "shard-verified", "season-checkpoint"].includes(type);
  if (type === "worker-recycle") elements.cancelExperiment.hidden = false;
  if (type === "ready" && detail.recoveredExperimentIds?.length) await refreshLocalExperiments();
  if (["complete", "cancelled", "error"].includes(type)) {
    state.activeExperimentId = null;
    elements.cancelExperiment.hidden = true;
    invalidateExperimentReview();
    await refreshLocalExperiments();
  }
}

async function reviewExperimentRun() {
  await awaitAdvancedRefreshSettled();
  const errors = validateExperimentDraft();
  if (errors.length) return;
  if (!state.experimentClient?.reviewRun) {
    throw new Error("The browser-local calculation engine is unavailable.");
  }
  const bootstrap = manifestBootstrap();
  if (!bootstrap.sha256) {
    throw new Error("This release is missing its trusted package-manifest checksum, so an experiment cannot run safely.");
  }
  elements.experimentRuntimeError.hidden = true;
  elements.experimentRuntimeStatus.textContent = "Checking package sizes, device storage, and the frozen configuration…";
  const draft = experimentDraft();
  const configuration = await state.runtimeModule.expandOriginalExperimentConfiguration(
    draft,
    state.experimentCatalog,
  );
  state.experimentReview = await state.experimentClient.reviewRun({
    configuration,
    manifestUrl: bootstrap.url,
    manifestSha256: bootstrap.sha256,
    selectedSeasons: selectedExperimentSeasons(),
  });
  const review = state.experimentReview.review || state.experimentReview;
  const estimate = review.estimate || review.storage || {};
  const download = estimate.download_bytes ?? estimate.downloadBytes;
  const storage = estimate.storage_bytes ?? estimate.storageBytes;
  const runtime = estimate.runtime_seconds_low !== undefined
    ? formatRuntimeRange(estimate)
    : estimate.runtimeLabel;
  elements.experimentValidationSummary.textContent = [
    `${selectedExperimentSeasons().length} season${selectedExperimentSeasons().length === 1 ? "" : "s"}`,
    download !== undefined ? `${formatStorageBytes(download)} download` : "verified packages",
    storage !== undefined ? `${formatStorageBytes(storage)} device storage` : "storage checked",
    runtime || "runtime estimated",
    "both time modes",
  ].join(" · ");
  return state.experimentReview;
}

async function startExperimentRun(event) {
  event.preventDefault();
  if (state.experimentStarting || state.activeExperimentId) return;
  state.experimentStarting = true;
  elements.runExperiment.disabled = true;
  elements.experimentRuntimeError.hidden = true;
  try {
    const review = await reviewExperimentRun();
    if (!review) return;
    const experimentId = await state.experimentClient.start(review, {
      confirmed: true,
      allSeasonsConfirmed: elements.experimentAllSeasons.checked
        && elements.confirmAllSeasons.checked,
    });
    state.activeExperimentId = typeof experimentId === "string"
      ? experimentId
      : experimentIdentifier(experimentId);
    showInitialExperimentRunProgress(review);
    elements.cancelExperiment.hidden = false;
    elements.experimentRuntimeStatus.textContent = "Experiment started in a dedicated Web Worker. You can close this dialog while it runs.";
    await refreshLocalExperiments();
  } catch (error) {
    elements.experimentRuntimeError.textContent = error.message;
    elements.experimentRuntimeError.hidden = false;
  } finally {
    state.experimentStarting = false;
    validateExperimentDraft({ announce: false });
  }
}

async function cancelExperimentRun() {
  if (!state.activeExperimentId || !state.experimentClient?.cancel) return;
  elements.cancelExperiment.disabled = true;
  try {
    await state.experimentClient.cancel(state.activeExperimentId);
  } catch (error) {
    elements.experimentRuntimeError.textContent = error.message;
    elements.experimentRuntimeError.hidden = false;
  } finally {
    elements.cancelExperiment.disabled = false;
  }
}

function rankingCardAvailabilityReason() {
  if (!state.rankingCardModule) return "The ranking-card renderer is still loading.";
  const rankingsPayload = state.rankingsPayload;
  const rankingScope = currentRankingScope();
  const scopeSignature = rankingScopeSignature(rankingScope);
  if (!rankingsPayload?.rows?.length || state.rankingsScopeSignature !== scopeSignature) {
    return "The current rankings are still loading.";
  }
  if (rankingScope.search) return "Clear the player search to create a genuine top-10 card.";
  if (rankingsPayload.rows.length < 10) return "At least ten ranked players are required to create this card.";
  return null;
}

function updateRankingCardAvailability() {
  const reason = rankingCardAvailabilityReason();
  elements.shareRankingCard.disabled = Boolean(reason);
  elements.shareRankingCard.title = reason || "Create a social image from the current top ten";
  if (reason && state.rankingsPayload && state.rankingsScopeSignature === rankingScopeSignature()) {
    elements.shareStatus.textContent = reason;
  } else if (!state.rankingCardRequestToken) {
    elements.shareStatus.textContent = "";
  }
}

function rankingCardSiteLabel() {
  const hostname = String(window.location.hostname || "").replace(/^www\./u, "");
  return hostname && !new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)
    ? hostname
    : "VALUE CONTRIBUTED";
}

function rankingCardScopeIsCurrent(cardToken, rankingsPayload, scopeSignature) {
  return (
    state.rankingCardRequestToken === cardToken
    && state.rankingsPayload === rankingsPayload
    && state.rankingsScopeSignature === scopeSignature
    && rankingScopeSignature() === scopeSignature
  );
}

function closeRankingCardDialog() {
  if (elements.rankingCardDialog.open) elements.rankingCardDialog.close();
  if (state.rankingCardArtifact?.objectUrl) {
    URL.revokeObjectURL(state.rankingCardArtifact.objectUrl);
  }
  state.rankingCardArtifact = null;
  elements.rankingCardPreview.removeAttribute("src");
  delete elements.rankingCardPreview.dataset.rankingCardModel;
  elements.rankingCardPreview.alt = "";
  elements.rankingCardActionStatus.textContent = "";
}

function rankingCardDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("The ranking-card preview could not be read.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function shareCurrentRankingCard() {
  const reason = rankingCardAvailabilityReason();
  if (reason) {
    elements.shareStatus.textContent = reason;
    updateRankingCardAvailability();
    return;
  }
  const rankingsPayload = state.rankingsPayload;
  const rankingScope = currentRankingScope();
  const scopeSignature = rankingScopeSignature(rankingScope);
  const cardToken = Symbol("ranking-card");
  state.rankingCardRequestToken = cardToken;
  elements.shareRankingCard.disabled = true;
  elements.shareStatus.textContent = "Building your ranking card…";
  try {
    const model = state.rankingCardModule.buildRankingCardModel({
      sourceName: statVersionLabel(),
      isExperiment: rankingScope.source.startsWith("experiment:"),
      season: rankingScope.season,
      phase: scheduleLabel(rankingScope.phase),
      timeMode: garbageTimeLabel(),
      sortBy: rankingScope.sortBy,
      sortDirection: rankingScope.sortDirection,
      rows: rankingsPayload.rows,
      siteLabel: rankingCardSiteLabel(),
    });
    const blob = await state.rankingCardModule.renderRankingCardPng(model);
    if (!rankingCardScopeIsCurrent(cardToken, rankingsPayload, scopeSignature)) {
      throw new Error("The ranking source or filters changed. Build the card again from the current results.");
    }
    const previewUrl = await rankingCardDataUrl(blob);
    if (!rankingCardScopeIsCurrent(cardToken, rankingsPayload, scopeSignature)) {
      throw new Error("The ranking source or filters changed. Build the card again from the current results.");
    }
    closeRankingCardDialog();
    const fileName = state.rankingCardModule.rankingCardFileName(model);
    const file = new File([blob], fileName, { type: "image/png" });
    const objectUrl = URL.createObjectURL(blob);
    state.rankingCardArtifact = { blob, file, fileName, model, objectUrl };
    elements.rankingCardPreview.src = previewUrl;
    elements.rankingCardPreview.alt = state.rankingCardModule.rankingCardAltText(model);
    elements.rankingCardPreview.dataset.rankingCardModel = JSON.stringify(model);
    elements.rankingCardDialogMeta.textContent = `${model.sourceName} · ${model.phase} · ${model.timeMode} · ${model.metricLabel}`;
    const shareData = { files: [file] };
    elements.nativeShareRankingCard.hidden = !(
      typeof navigator.share === "function"
      && typeof navigator.canShare === "function"
      && navigator.canShare(shareData)
    );
    const copySupported = Boolean(navigator.clipboard?.write && window.ClipboardItem);
    elements.copyRankingCard.disabled = !copySupported;
    elements.copyRankingCard.title = copySupported
      ? "Copy the PNG to your clipboard"
      : "This browser does not support copying PNG images";
    if (!elements.rankingCardDialog.open) elements.rankingCardDialog.showModal();
    elements.shareStatus.textContent = "Ranking card ready. Nothing was uploaded.";
  } catch (error) {
    if (state.rankingCardRequestToken === cardToken) {
      elements.shareStatus.textContent = error.message;
    }
  } finally {
    if (state.rankingCardRequestToken === cardToken) {
      state.rankingCardRequestToken = null;
      elements.shareRankingCard.disabled = Boolean(rankingCardAvailabilityReason());
    }
  }
}

async function nativeShareRankingCard() {
  const artifact = state.rankingCardArtifact;
  if (!artifact || typeof navigator.share !== "function") return;
  try {
    await navigator.share({
      files: [artifact.file],
      title: `${artifact.model.title} · ${artifact.model.sourceName}`,
      text: `${artifact.model.title}, ranked by ${artifact.model.metricLabel}.`,
    });
    elements.rankingCardActionStatus.textContent = "Ranking card shared.";
  } catch (error) {
    if (error.name !== "AbortError") elements.rankingCardActionStatus.textContent = error.message;
  }
}

async function copyRankingCardImage() {
  const artifact = state.rankingCardArtifact;
  if (!artifact || !navigator.clipboard?.write || !window.ClipboardItem) return;
  try {
    await navigator.clipboard.write([
      new window.ClipboardItem({ "image/png": artifact.blob }),
    ]);
    elements.rankingCardActionStatus.textContent = "PNG copied to your clipboard.";
  } catch (error) {
    elements.rankingCardActionStatus.textContent = error.message;
  }
}

function downloadRankingCardImage() {
  const artifact = state.rankingCardArtifact;
  if (!artifact) return;
  const link = document.createElement("a");
  link.href = artifact.objectUrl;
  link.download = artifact.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  elements.rankingCardActionStatus.textContent = "PNG download started.";
}

async function initializeRankingCardSharing() {
  try {
    state.rankingCardModule = await import("./ranking-card.js?v=20260902-ranking-card-v2");
    updateRankingCardAvailability();
  } catch (error) {
    elements.shareRankingCard.disabled = true;
    elements.shareStatus.textContent = `Ranking-card sharing is unavailable: ${error.message}`;
  }
}

async function initializeExperimentLab() {
  try {
    const bootstrap = manifestBootstrap();
    const [runtimeModule, storageModule] = await Promise.all([
      import("./experiments/runtime-client.js?v=20260907-lean-runtime-v1"),
      import("./experiments/storage-guard.js"),
    ]);
    state.runtimeModule = runtimeModule;
    state.storageModule = storageModule;
    if (typeof runtimeModule.createOriginalExperimentClient !== "function") {
      throw new Error("The browser-local runtime module has no client factory.");
    }
    const verifiedCatalog = await loadVerifiedCatalogForEditor();
    state.experimentClient = await runtimeModule.createOriginalExperimentClient({
      manifestAuthority: {
        ...bootstrap,
        releaseId: verifiedCatalog.manifest.release_id,
      },
    });
    if (state.experimentClient.subscribe) {
      state.experimentClient.subscribe(handleExperimentRuntimeEvent);
    } else {
      ["ready", "state", "season-started", "shard-verified", "season-checkpoint", "worker-recycle", "complete", "cancelled", "error"]
        .forEach((type) => window.addEventListener(`vc-experiment:${type}`, handleExperimentRuntimeEvent));
    }
    if (!isDesktopExperimentDevice()) elements.desktopRequiredMessage.hidden = false;
    await state.experimentClient.markStaleReleases(
      verifiedCatalog.manifest.release_id,
    );
    await refreshLocalExperiments();
    await awaitAdvancedRefreshSettled();
    validateExperimentDraft({ announce: false });
    elements.experimentRuntimeStatus.textContent = "Browser-local engine ready. Packages are verified before calculation.";
  } catch (error) {
    renderExperimentSelector(state.localExperimentCatalog);
    elements.experimentRuntimeStatus.textContent = "Official rankings are ready. The local experiment engine is not available in this build.";
    elements.experimentRuntimeError.textContent = error.message;
    elements.experimentRuntimeError.hidden = false;
  }
}

window.ValueContributedOriginalUI = Object.freeze({
  applyExperimentConfiguration,
  experimentDraft,
  openExperimentBuilder,
  refreshLocalExperiments,
  renderAdvancedCatalog,
  shareCurrentRankingCard,
});

if (EXPERIMENTS_ON) {
  window.addEventListener("vc-experiment:catalog-ready", (event) => {
    if (event.detail?.catalog) renderAdvancedCatalog(event.detail.catalog);
  });
}

const mobileRankingsToggle = document.querySelector("#mobile-rankings-toggle");
const mobileRankingsPanel = document.querySelector("#rankings-panel");
if (mobileRankingsToggle && mobileRankingsPanel) {
  const storageKey = "value-contributed:mobile-rankings-open";
  const setRankingsOpen = (open) => {
    mobileRankingsPanel.classList.toggle("is-mobile-collapsed", !open);
    mobileRankingsToggle.setAttribute("aria-expanded", String(open));
    mobileRankingsToggle.querySelector(".rankings-toggle-action").textContent = open ? "Collapse section −" : "Expand section +";
  };
  let rememberedOpen = false;
  try { rememberedOpen = sessionStorage.getItem(storageKey) === "true"; } catch { /* Local preference is optional. */ }
  setRankingsOpen(rememberedOpen);
  mobileRankingsToggle.addEventListener("click", () => {
    const open = mobileRankingsToggle.getAttribute("aria-expanded") !== "true";
    setRankingsOpen(open);
    try { sessionStorage.setItem(storageKey, String(open)); } catch { /* Keep working without storage. */ }
  });
}

async function initialize(experimentLabReady = Promise.resolve()) {
  const params = new URLSearchParams(window.location.search);
  // The Ranking picker is gone and V13 is the statistic (note of 2026-09-27):
  // a link naming another official statistic opens on the default instead of
  // on a statistic the page gives no way back from. An experiment named by a
  // link is still honoured.
  const linkedStatVersion = params.get("stat_version");
  const requestedStatVersion = OFFICIAL_RANKING_SLUGS.has(linkedStatVersion) ? null : linkedStatVersion;
  state.requestedStatVersion = requestedStatVersion;
  let unavailableLocalExperimentMessage = null;
  let localDefaultSource = "original";

  try {
    state.multiSeasonModule = await import("./multi-season-rankings.js?v=20260902-multi-season-v1");
    state.rankingsVisualModule = await import("./rankings-visuals.js?v=v13-charts-20260927-19");
    restoreOpenPanels(params);
    state.rankingsVisualWorkspace = state.rankingsVisualModule.createRankingsVisualWorkspace({
      panelElements: elements.chartPanels,
      onPanelsChange: () => {
        rememberOpenPanels();
        // Panels restored from a link open before the page has chosen its
        // statistic and seasons; writing the address then would record the
        // placeholder values of the controls (V11, All Seasons) over the real ones.
        // The first table load writes the whole address, open panels included.
        if (state.rankingsPayload) syncUrl();
      },
      // The table above every chart already says what the selection is, so the
      // charts on this page no longer print "N of M drawn".
      drawnNotes: false,
      loadVisualPayload: loadRankingsVisualPayload,
      loadComparisonPayload: loadRankingsComparisonPayload,
      loadHistoryPayload: loadRankingsHistoryPayload,
      loadTypeTrendsPayload: loadRankingsTypeTrendsPayload,
    });
    let serverDefaultSource = null;
    let v11Options = null;
    let v10Options = null;
    try {
      const sourceResponse = await fetch("/api/sources");
      if (sourceResponse.ok) {
        const sourcePayload = await sourceResponse.json();
        // With the switch off the site publishes one statistic, the default,
        // so the hidden picker holds nothing else a link could name (note of
        // 2026-09-28).
        const offered = new Set(
          (sourcePayload.sources ?? [])
            .map((row) => row.id)
            .filter((id) => EXPERIMENTS_ON || id === sourcePayload.default_source),
        );
        state.offeredSources = offered;
        // Every earlier official statistic is offered only when /api/sources
        // lists it, so a deployment that publishes V11 alone shows V11 alone.
        OFFICIAL_RANKINGS
          .filter((ranking) => ranking.value !== "v11")
          .forEach((ranking) => setOfficialRankingOption(
            ranking.value,
            ranking.label,
            { present: offered.has(SOURCE_ID_FOR_RANKING[ranking.value] ?? ranking.value) },
          ));
        serverDefaultSource = RANKING_FOR_SOURCE_ID[sourcePayload.default_source]
          ?? sourcePayload.default_source
          ?? null;
        // The seasons each server statistic has actually calculated. V12
        // seasons arrive one completed run at a time, so its picker offers
        // only those while the page season list stays the full V11 history.
        state.sourceSeasonEndYears = Object.fromEntries(
          (sourcePayload.sources ?? [])
            .filter((row) => Array.isArray(row.season_end_years))
            .map((row) => [row.id, new Set(row.season_end_years.map(Number))]),
        );
        // A statistic that describes itself (V12, V13) is described on the page.
        state.sourceDescriptions = Object.fromEntries(
          (sourcePayload.sources ?? [])
            .filter((row) => typeof row.description === "string" && row.description)
            .map((row) => [row.id, row.description]),
        );
      }
    } catch {
      serverDefaultSource = null;
    }
    try {
      // V11 is the official statistic; it stays in the selector for as long as
      // at least one season has been calculated. When the site offers V13
      // alone the page bootstraps from the V13 options, as the published site
      // does, so the V11 options are not asked for.
      const v11Offered = !state.offeredSources || state.offeredSources.has("v11");
      const v11Response = v11Offered ? await fetch("/api/v11/options") : null;
      v11Options = v11Response?.ok ? await v11Response.json() : null;
      setOfficialRankingOption("v11", "V11", {
        present: (v11Options?.seasons ?? []).length > 0 && v11Offered,
      });
    } catch {
      // V11 leaves the selector when its API is unavailable.
      v11Options = null;
      setOfficialRankingOption("v11", "V11", { present: false });
    }
    localDefaultSource = defaultOfficialRanking(serverDefaultSource);
    // The page bootstraps its season list, game-time modes and run ids from the
    // options endpoint of the statistic it is about to show. V9 owns
    // /api/rankings/options; V10 and V11 each answer for themselves.
    const bootstrapSource = OFFICIAL_RANKING_SLUGS.has(requestedStatVersion)
      && officialRankingValues().has(requestedStatVersion)
      ? requestedStatVersion
      : localDefaultSource;
    if (bootstrapSource === "v10" && !v10Options) {
      const v10Response = await fetch("/api/v10/options");
      v10Options = v10Response.ok ? await v10Response.json() : null;
    }
    // V12 opens on the V11 season list when V11 has one, and narrows it to
    // its own completed seasons (updateSourceSeasonAvailability), so moving
    // between the two never loses a season from the picker.
    let v12Options = null;
    if (bootstrapSource === "v12" && !(v11Options?.seasons ?? []).length) {
      const v12Response = await fetch("/api/v12/options");
      v12Options = v12Response.ok ? await v12Response.json() : null;
    }
    // V13 opens the same way: on the V11 season list, narrowed to the
    // seasons V13 has completed; its own list only when V11 has none.
    let v13Options = null;
    if (bootstrapSource === "v13" && !(v11Options?.seasons ?? []).length) {
      const v13Response = await fetch("/api/v13/options");
      v13Options = v13Response.ok ? await v13Response.json() : null;
    }
    const payload = bootstrapSource === "v11"
      ? serverBootstrapOptions("v11", v11Options)
      : bootstrapSource === "v12"
        ? serverBootstrapOptions("v12", v12Options ?? v11Options)
        : bootstrapSource === "v13"
        ? serverBootstrapOptions("v13", v13Options ?? v11Options)
        : bootstrapSource === "v10"
        ? serverBootstrapOptions("v10", v10Options)
        : await originalBootstrapOptions();
    state.officialRunIds = Object.fromEntries(
      (payload.stat_versions || []).map((row) => [row.value, row.run_id]),
    );
    state.v8RunId = payload.v8_run_id
      || state.officialRunIds.original
      || payload.run?.run_id
      || null;
    // A shared link can still name an experiment — `experiment:<id>` from the
    // browser lab, `local:<id>` from an older one. Neither exists with the
    // switch off, so the page says one plain line and shows the official
    // statistic instead of failing.
    const localExperimentRequested = /^(experiment|local):/.test(
      String(requestedStatVersion || ""),
    );
    if (localExperimentRequested) await experimentLabReady;
    const availableStatVersions = Array.from(
      elements.statVersion.options,
      (option) => option.value,
    );
    if (localExperimentRequested && !availableStatVersions.includes(requestedStatVersion)) {
      unavailableLocalExperimentMessage = EXPERIMENTS_ON
        ? "The requested browser-local experiment is not complete or available in this browser."
          + ` ${officialRankingLabel(localDefaultSource)} is shown instead.`
        : `Experiments are switched off for now, so ${officialRankingLabel(localDefaultSource)} is shown instead.`;
      elements.statVersion.value = localDefaultSource;
      state.requestedStatVersion = null;
    }
    if (!unavailableLocalExperimentMessage && (
      OFFICIAL_RANKING_SLUGS.has(requestedStatVersion)
      || availableStatVersions.includes(requestedStatVersion)
    )) {
      elements.statVersion.value = requestedStatVersion;
      state.requestedStatVersion = null;
    } else {
      elements.statVersion.value = localDefaultSource;
    }
    if (!elements.statVersion.value) {
      // A deep link can name a statistic this server does not serve.
      elements.statVersion.value = localDefaultSource;
    }
    elements.breakdownMode.value = params.get("breakdown_mode") === "vc"
      ? "vc"
      : "wc";

    elements.season.innerHTML = payload.seasons
      .map(
        (season) =>
          `<option value="${escapeHtml(season)}">${escapeHtml(season)}</option>`,
      )
      .join("");
    state.seasonValues = payload.seasons.filter((season) => season !== "All Seasons");
    renderRankingSeasonCheckboxes();
    if (!params.getAll("season").length && payload.default_season) {
      params.append("season", payload.default_season);
    }
    restoreRankingSeasonSelection(params);

    const validGarbageTimeModes = payload.garbage_time_modes.map(
      (mode) => mode.value,
    );
    const requestedGarbageTimeMode = params.get("garbage_time_mode");
    elements.garbageTimeMode.value = validGarbageTimeModes.includes(
      requestedGarbageTimeMode,
    )
      ? requestedGarbageTimeMode
      : payload.default_garbage_time_mode;

    const validPhases = ["All", "Regular Season", "PlayIn", "Playoffs", "Postseason"];
    const requestedPhase = params.get("phase");
    elements.phase.value = validPhases.includes(requestedPhase)
      ? requestedPhase
      : "All";
    elements.search.value = params.get("search") || "";
    const requestedLimit = params.get("limit");
    elements.limit.value = ["25", "50", "100", "250", "all"].includes(requestedLimit)
      ? requestedLimit
      : DEFAULT_RANKING_LIMIT;

    const requestedTrendPhase = params.get("trend_phase");
    const validTrendPhases = ["All", "Regular Season", "Postseason"];
    const trendPhase = validTrendPhases.includes(requestedTrendPhase)
      ? requestedTrendPhase
      : "All";
    const trendPhaseInput = document.querySelector(
      `input[name="trend-phase"][value="${trendPhase}"]`,
    );
    if (trendPhaseInput) trendPhaseInput.checked = true;

    const requestedTrendWindow = Number(params.get("trend_window"));
    const trendWindow = [1, 3, 5].includes(requestedTrendWindow)
      ? requestedTrendWindow
      : 3;
    const trendWindowInput = document.querySelector(
      `input[name="trend-window"][value="${trendWindow}"]`,
    );
    if (trendWindowInput) trendWindowInput.checked = true;

    const requestedLiftWindow = Number(params.get("lift_window"));
    const liftWindow = [1, 3, 5].includes(requestedLiftWindow)
      ? requestedLiftWindow
      : 3;
    const liftWindowInput = document.querySelector(
      `input[name="lift-window"][value="${liftWindow}"]`,
    );
    if (liftWindowInput) liftWindowInput.checked = true;

    const requestedLiftGroup = params.get("lift_group");
    const liftGroup = ["top", "bottom"].includes(requestedLiftGroup)
      ? requestedLiftGroup
      : "top";
    const liftGroupInput = document.querySelector(
      `input[name="lift-group"][value="${liftGroup}"]`,
    );
    if (liftGroupInput) liftGroupInput.checked = true;

    // The panel reads one schedule or the other now. A link written when it
    // was a dropdown may still say "All" or "Playoffs": both fall to the
    // regular season, which is what the panel opens on.
    const gamePhase = ["Regular Season", "Postseason"].includes(
      params.get("game_phase"),
    )
      ? params.get("game_phase")
      : "Regular Season";
    const gamePhaseInput = document.querySelector(
      `input[name="top-games-phase"][value="${gamePhase}"]`,
    );
    if (gamePhaseInput) gamePhaseInput.checked = true;

    const requestedGameOutcome = params.get("game_outcome");
    const gameOutcome = ["Both", "Wins", "Losses"].includes(requestedGameOutcome)
      ? requestedGameOutcome
      : "Both";
    const gameOutcomeInput = document.querySelector(
      `input[name="top-games-outcome"][value="${gameOutcome}"]`,
    );
    if (gameOutcomeInput) gameOutcomeInput.checked = true;

    const requestedSeasonWinsLimit = params.get("season_wins_limit");
    if (elements.seasonWinsLimit) {
      elements.seasonWinsLimit.value = ["25", "35", "60"].includes(
        requestedSeasonWinsLimit,
      )
        ? requestedSeasonWinsLimit
        : "25";
    }

    const requestedSort = LEGACY_CONTEXT_SORTS[params.get("sort_by")] ?? params.get("sort_by");
    const validSorts = [
      "value_contributed",
      "wins_contributed",
      "losses_contributed",
      "value_per_game",
      "games_played",
      "wins",
      "losses",
      "offense_value",
      "defense_value",
      "hustle_value",
      "side_context_raw_pct",
      "offense_context_pct",
      "defense_context_pct",
    ];
    state.sortBy = validSorts.includes(requestedSort)
      ? requestedSort
      : "wins_contributed";
    state.sortDirection = params.get("sort_direction") === "asc" ? "asc" : "desc";

    const requestedHighValueSort = params.get("high_value_sort_by");
    const validHighValueSorts = [
      "games_played",
      "wins",
      "value_contributed",
      "wins_contributed",
      "winning_percentage",
    ];
    state.highValueSortBy = validHighValueSorts.includes(requestedHighValueSort)
      ? requestedHighValueSort
      : "games_played";
    state.highValueSortDirection =
      params.get("high_value_sort_direction") === "asc" ? "asc" : "desc";
    // Same fallback as the games panel: an older link that names All or
    // Playoffs lands on the regular season.
    const highValuePhase = ["Regular Season", "Postseason"].includes(
      params.get("high_value_phase"),
    )
      ? params.get("high_value_phase")
      : "Regular Season";
    const highValuePhaseInput = document.querySelector(
      `input[name="high-value-phase"][value="${highValuePhase}"]`,
    );
    if (highValuePhaseInput) highValuePhaseInput.checked = true;

    restorePlayerContextSelection(params);
    updateV8Presentation();

    if (!await updateSourceSeasonAvailability()) return;
    await loadSelectedStatistic();
    state.dashboardReady = true;
    if (unavailableLocalExperimentMessage) {
      elements.error.textContent = unavailableLocalExperimentMessage;
      elements.error.hidden = false;
    }
  } catch (error) {
    elements.body.innerHTML = "";
    elements.error.textContent = error.message;
    elements.error.hidden = false;
    elements.trendChart.innerHTML = "";
    elements.liftChart.innerHTML = "";
    elements.topGamesBody.innerHTML = "";
    elements.highValueRecordsBody.innerHTML = "";
  }
}

elements.season.addEventListener("change", () => {
  const selected = elements.season.value === "All Seasons"
    ? availableRankingSeasons()
    : [elements.season.value].filter((season) => availableRankingSeasons().includes(season));
  if (!selected.length) return;
  state.selectedSeasons = selected;
  state.seasonScopeAll = elements.season.value === "All Seasons";
  setCheckedRankingSeasons(selected);
  syncLegacySeasonSelect();
  updateSeasonPickerPresentation();
  invalidatePlayerContextScope();
  loadRankings();
});
elements.seasonCheckboxes.addEventListener("change", (event) => {
  const input = event.target.closest('input[type="checkbox"]');
  if (!input) return;
  updateSeasonPickerPresentation();
});
elements.seasonShortcuts.forEach((button) => {
  button.addEventListener("click", () => setStagedSeasonShortcut(button.dataset.seasonShortcut));
});
elements.applySeasons.addEventListener("click", applyRankingSeasonSelection);
elements.phase.addEventListener("change", () => {
  invalidatePlayerContextScope();
  loadRankings();
});
elements.statVersion.addEventListener("change", async () => {
  if (!hasPlayerContext()) closePlayerContext();
  const generation = resetDeferredPanelLoads();
  await updateSourceSeasonAvailability();
  if (generation !== state.deferredPanelGeneration) return;
  updateV8Presentation();
  await loadSelectedStatistic();
});
elements.breakdownMode.addEventListener("change", () => {
  invalidatePlayerContextScope();
  loadRankings();
});
elements.garbageTimeMode.addEventListener("change", () => {
  invalidatePlayerContextScope();
  loadSelectedStatistic();
});
elements.limit.addEventListener("change", loadRankings);
elements.body.addEventListener("click", (event) => {
  const trigger = event.target.closest(".view-context");
  if (!trigger) return;
  openPlayerContext(trigger.dataset.playerId, trigger.dataset.playerName, trigger);
});
elements.body.addEventListener("keydown", (event) => {
  const trigger = event.target.closest(".view-context");
  if (!trigger || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  openPlayerContext(trigger.dataset.playerId, trigger.dataset.playerName, trigger);
});
elements.contextDialogClose.addEventListener("click", () => closePlayerContext());
elements.contextDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closePlayerContext();
});
elements.contextDialog.addEventListener("click", (event) => {
  if (event.target === elements.contextDialog) closePlayerContext();
});
elements.contextPagePrevious.addEventListener("click", () => {
  if (state.contextPage <= 1) return;
  state.contextPage -= 1;
  syncUrl();
  loadPlayerContext();
});
elements.contextPageNext.addEventListener("click", () => {
  state.contextPage += 1;
  syncUrl();
  loadPlayerContext();
});
elements.topGamesPhases.forEach((input) => {
  input.addEventListener("change", () => reloadDeferredPanel("topGames"));
});
elements.topGamesOutcomes.forEach((input) => {
  input.addEventListener("change", () => reloadDeferredPanel("topGames"));
});
elements.seasonWinsPhases.forEach((input) => {
  input.addEventListener("change", () => reloadDeferredPanel("seasonWins"));
});
elements.seasonWinsLimit?.addEventListener("change", () => {
  reloadDeferredPanel("seasonWins");
});
elements.highValuePhases.forEach((input) => {
  input.addEventListener("change", () => reloadDeferredPanel("highValueRecords"));
});
elements.highValueSortableHeadings.forEach((heading) => {
  const button = heading.querySelector("button[data-high-value-sort]");
  button.addEventListener("click", () => {
    const sortBy = button.dataset.highValueSort;
    if (state.highValueSortBy === sortBy) {
      state.highValueSortDirection =
        state.highValueSortDirection === "desc" ? "asc" : "desc";
    } else {
      state.highValueSortBy = sortBy;
      state.highValueSortDirection = "desc";
    }
    reloadDeferredPanel("highValueRecords");
  });
});
elements.highValueMobileSort.addEventListener("change", () => {
  state.highValueSortBy = elements.highValueMobileSort.value;
  state.highValueSortDirection = "desc";
  reloadDeferredPanel("highValueRecords");
});
elements.highValueMobileSortDirection.addEventListener("click", () => {
  state.highValueSortDirection =
    state.highValueSortDirection === "desc" ? "asc" : "desc";
  reloadDeferredPanel("highValueRecords");
});
elements.trendPhases.forEach((input) => {
  input.addEventListener("change", () => {
    syncUrl();
    reloadDeferredPanel("trends");
  });
});
elements.trendWindows.forEach((input) => {
  input.addEventListener("change", () => {
    syncUrl();
    reloadDeferredPanel("trends");
  });
});
elements.liftWindows.forEach((input) => {
  input.addEventListener("change", () => {
    syncUrl();
    reloadDeferredPanel("lift");
  });
});
elements.liftGroups.forEach((input) => {
  input.addEventListener("change", () => {
    state.activeLiftPlayer = null;
    syncUrl();
    if (state.deferredPanels.lift && state.liftPayload) renderLiftChart();
  });
});
elements.sortableHeadings.forEach((heading) => {
  const button = heading.querySelector("button[data-sort]");
  button.addEventListener("click", () => {
    const sortBy = button.dataset.sort;
    if (state.sortBy === sortBy) {
      state.sortDirection = state.sortDirection === "desc" ? "asc" : "desc";
    } else {
      state.sortBy = sortBy;
      state.sortDirection = "desc";
    }
    loadRankings();
  });
});
elements.mobileSort.addEventListener("change", () => {
  state.sortBy = elements.mobileSort.value;
  state.sortDirection = "desc";
  loadRankings();
});
elements.mobileSortDirection.addEventListener("click", () => {
  state.sortDirection = state.sortDirection === "desc" ? "asc" : "desc";
  loadRankings();
});
elements.search.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadRankings, 250);
});
window.addEventListener("resize", () => {
  matchLegendHeightToChart(elements.trendChart, elements.trendLegend);
  matchLegendHeightToChart(elements.liftChart, elements.liftLegend);
});
// Every control below belongs to the browser-local experiment builder, whose
// markup the page only carries when the switch is on.
if (EXPERIMENTS_ON) {
  elements.closeExperimentBuilder.addEventListener("click", () => elements.experimentDialog.close());
  elements.experimentDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    elements.experimentDialog.close();
  });
  elements.experimentDialog.addEventListener("click", (event) => {
    if (event.target === elements.experimentDialog) elements.experimentDialog.close();
  });
  elements.experimentAllSeasons.addEventListener("change", () => {
    syncAllSeasonsSelection({ fromCheckbox: true });
  });
  elements.experimentSeasons.addEventListener("change", () => syncAllSeasonsSelection());
  elements.confirmAllSeasons.addEventListener("change", invalidateExperimentReview);
  elements.linkReliabilityK.addEventListener("change", () => syncLinkedSideControl("k"));
  elements.linkLambda.addEventListener("change", () => syncLinkedSideControl("lambda"));
  elements.reliabilityKOffense.addEventListener("input", () => {
    if (elements.linkReliabilityK.checked) {
      elements.reliabilityKDefense.value = elements.reliabilityKOffense.value;
    }
    invalidateExperimentReview();
  });
  elements.lambdaOffense.addEventListener("input", () => {
    if (elements.linkLambda.checked) elements.lambdaDefense.value = elements.lambdaOffense.value;
    invalidateExperimentReview();
  });
  elements.reliabilityKDefense.addEventListener("input", invalidateExperimentReview);
  elements.lambdaDefense.addEventListener("input", invalidateExperimentReview);
  elements.experimentName.addEventListener("input", invalidateExperimentReview);
  elements.rawMultiplierControls.querySelectorAll("[data-raw-group]").forEach((input) => {
    input.addEventListener("input", () => {
      elements.rawMultiplierControls.dataset.activeRawGroup = input.dataset.rawGroup;
      syncRawMultiplierDisplays();
      refreshAdvancedStates();
      invalidateExperimentReview();
    });
  });
  elements.contextMagnifierControls.querySelectorAll("[data-context-key]").forEach((input) => {
    input.addEventListener("input", invalidateExperimentReview);
  });
  elements.resetAllAdvanced.addEventListener("click", () => {
    elements.advancedOutcomeGroups.querySelectorAll("[data-coefficient-key]").forEach((input) => {
      input.value = "";
    });
    refreshAdvancedStates();
    invalidateExperimentReview();
  });
  elements.resetExperiment.addEventListener("click", resetExperimentEditor);
  elements.experimentForm.addEventListener("submit", startExperimentRun);
  elements.cancelExperiment.addEventListener("click", cancelExperimentRun);
  elements.localExperimentList.addEventListener("click", handleLocalExperimentAction);
}
elements.shareRankingCard.addEventListener("click", shareCurrentRankingCard);
elements.nativeShareRankingCard.addEventListener("click", nativeShareRankingCard);
elements.copyRankingCard.addEventListener("click", copyRankingCardImage);
elements.downloadRankingCard.addEventListener("click", downloadRankingCardImage);
elements.closeRankingCard.addEventListener("click", closeRankingCardDialog);
elements.rankingCardDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeRankingCardDialog();
});
elements.rankingCardDialog.addEventListener("click", (event) => {
  if (event.target === elements.rankingCardDialog) closeRankingCardDialog();
});

window.addEventListener("popstate", async () => {
  invalidatePlayerContextScope({ resetPage: false });
  const previousStatVersion = elements.statVersion.value;
  const previousGarbageTimeMode = elements.garbageTimeMode.value;
  const params = new URLSearchParams(window.location.search);
  const optionValues = (select) => Array.from(select.options, (option) => option.value);
  const requestedStatVersion = params.get("stat_version");
  if (optionValues(elements.statVersion).includes(requestedStatVersion)) {
    elements.statVersion.value = requestedStatVersion;
  }
  restoreRankingSeasonSelection(params);
  const requestedPhase = params.get("phase");
  if (optionValues(elements.phase).includes(requestedPhase)) {
    elements.phase.value = requestedPhase;
  }
  const requestedTimeMode = params.get("garbage_time_mode");
  if (optionValues(elements.garbageTimeMode).includes(requestedTimeMode)) {
    elements.garbageTimeMode.value = requestedTimeMode;
  }
  const requestedLimit = params.get("limit");
  elements.limit.value = optionValues(elements.limit).includes(requestedLimit)
    ? requestedLimit : DEFAULT_RANKING_LIMIT;
  elements.search.value = params.get("search") || "";
  const requestedSort = params.get("sort_by");
  if (optionValues(elements.mobileSort).includes(requestedSort)) {
    state.sortBy = requestedSort;
  }
  state.sortDirection = params.get("sort_direction") === "asc" ? "asc" : "desc";
  if (isV8()) {
    elements.breakdownMode.value = params.get("breakdown_mode") === "vc"
      ? "vc"
      : "wc";
  }
  if (!restorePlayerContextSelection(params)) {
    closePlayerContext({ updateUrl: false });
  }
  updateV8Presentation();
  const selectedStatisticScopeChanged =
    elements.statVersion.value !== previousStatVersion
    || elements.garbageTimeMode.value !== previousGarbageTimeMode;
  if (selectedStatisticScopeChanged) {
    const generation = resetDeferredPanelLoads();
    await updateSourceSeasonAvailability();
    if (generation !== state.deferredPanelGeneration) return;
    loadSelectedStatistic();
  } else {
    loadRankings();
  }
});

// On a phone the filters fold behind one bar that says what they are set to,
// so the player cards come first (owner's note, 2026-09-27). The bar and the
// fold only exist at phone width; a desktop always shows the filters.
function setupFilterToggle() {
  const toggle = document.querySelector("#filters-toggle");
  const filters = document.querySelector("#ranking-filters");
  const summary = document.querySelector("#filters-summary");
  if (!toggle || !filters) return;
  const describe = () => {
    const chosen = (select) => select?.selectedOptions?.[0]?.textContent?.trim() ?? "";
    summary.textContent = [
      elements.seasonSelectionSummary?.textContent?.trim(),
      chosen(elements.phase),
      chosen(document.querySelector("#limit")),
    ].filter(Boolean).join(" · ");
  };
  toggle.addEventListener("click", () => {
    describe();
    const open = filters.classList.toggle("is-collapsed") === false;
    toggle.setAttribute("aria-expanded", String(open));
  });
  filters.addEventListener("change", () => requestAnimationFrame(describe));
  filters.addEventListener("click", () => requestAnimationFrame(describe));
  new MutationObserver(describe).observe(elements.seasonSelectionSummary, { childList: true, characterData: true, subtree: true });
  describe();
}

setupFilterToggle();
setupMobileCharts();
setupDeferredPanelLoading();
initializeRankingCardSharing();
// With the switch off nothing experimental is started: no /api/v10-*-experiments
// probe, no browser runtime module, no worker and no IndexedDB. This is the one
// place any of that begins, so the whole feature is one branch away.
if (EXPERIMENTS_ON) {
  resetExperimentEditor();
  const serverExperimentReady = refreshServerExperiments();
  const experimentLabReady = initializeExperimentLab();
  initialize(Promise.all([serverExperimentReady, experimentLabReady]));
  if (/\/experiments\/?$/.test(window.location.pathname)) {
    openExperimentBuilder();
  }
} else {
  initialize();
}
