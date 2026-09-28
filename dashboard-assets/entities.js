import { renderMobileScatter } from "./mobile-chart-previews.js?v=type-trends-mobile-20260927-1";
import { mobilePhoto, setupMobilePage, prepareMobileTable, mobileRosterSort, renderMobileLines, foldMobileNote } from "./mobile-page-ui.js?v=mobile-pages-20260923-6";
import {
  createOriginalExperimentClient,
  createV9EntitySourceAdapter,
  experimentsSwitchedOn,
} from "./experiments/index.js";
import {
  buildPlayerContributionChart,
  buildSeasonGameChart,
} from "./entity-chart-model.js";
import {
  mergePlayerSeasonProfiles,
  mergeTeamSeasonProfiles,
} from "./comparison-model.js";
import {
  beeswarmOffsets,
  confidenceWords,
  createStyleLandscapeView,
  styleCatalog,
  styleVisual,
  sideLandscape,
} from "./rankings-visuals.js";
import {
  PHONE_LABEL_TYPE,
  careerPathLayout,
  careerPathModel,
  carouselModel,
  laneLabelLayout,
  contextBarsPair,
  contextBarsModel,
  forTeam,
  levelBarsMarkup,
  maskedMeasurements,
  radarChartMarkup,
  rankLaneModel,
  ringWords,
  spokeReach,
  spokeScale,
  typeRegions,
} from "./profile-sections.js?v=mobile-pages-20260923-6";
// Side-effect import: team-directory.js is a classic script shared with the
// rankings page and publishes itself on globalThis.
import "./team-directory.js";
// Side-effect import: name-fold.js is the same UMD shape and carries the
// site's one name-folding rule — the rule `src/name_search.py` runs in
// Python and in SQL, so "jokic" finds Jokić here too.
import "./name-fold.js";
import "./page-notice.js";
// Side-effect import: page-notice.js turns a browser's own "Failed to
// fetch" into a sentence a reader can act on, and leaves a message this
// site wrote alone.

const TEAM_DIRECTORY = globalThis.ValueContributedTeamDirectory ?? null;
const { readableError } = globalThis.ValueContributedPageNotice;
const { foldName } = globalThis.ValueContributedNameFold;
const UNKNOWN_TEAM_LABEL = TEAM_DIRECTORY?.UNKNOWN_TEAM ?? "—";

const V9_RELEASE_ID = "60a96635-f13d-42a3-a18e-bf02df29f9b5";
// V12 is answered by V11's own routes under /api/v12, so every rule written
// for V11's shape of answer applies to it too. V13 is answered the same way
// under /api/v13.
const V11_SHAPED_SOURCES = new Set(["v11", "v12", "v13"]);

function isV11Shaped() {
  return V11_SHAPED_SOURCES.has(elements.source.value);
}
const FALLBACK_HEADSHOT = new URL("./assets/player-silhouette.svg", import.meta.url).href;
const SEASONS = Array.from({ length: 13 }, (_, index) => 2014 + index);
const COLORS = ["#1f6b50", "#8a4a24", "#315e79", "#65537c", "#826618", "#8a2d2d", "#337a87", "#765b39", "#4d6a45", "#805b77", "#67707a"];
const DASHES = [
  "", "8 4", "2 3", "12 4 2 4", "4 3 1 3", "14 4",
  "1 4", "10 3 3 3", "6 2 1 2", "3 5", "16 3 2 3 2 3",
];
// The page names itself from the last segment of its own URL, so /teams,
// /teams/, /teams/index.html and /value-contributed-site/teams/ all read the
// same. A hosting prefix and a trailing slash are never part of the answer.
function pageSegment() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  return /\.x?html?$/i.test(last) ? (segments.at(-2) ?? "") : last;
}

const state = {
  kind: pageSegment() === "teams" ? "teams" : "players",
  adapter: null,
  experimentClient: null,
  controller: null,
  supportingControllers: new Map(),
  payload: null,
  selectedEntityId: null,
  rosterSortBy: "value_contributed",
  rosterSortDirection: "desc",
  rosterOffset: 0,
  teamChartPlayerIds: [],
  teamOthersVisible: false,
  // The team contribution chart and the top-games table carry their own
  // seasons and schedule; the filters bar above the roster does not reach
  // them. An empty chart season list means every season.
  teamChartSeasons: [],
  teamChartSchedule: "all",
  teamChartMetric: "wins_contributed",
  teamGamesSeason: "",
  teamGamesSchedule: "all",
  chartPayload: null,
  chartController: null,
  typeColors: null,
  typeColorsRequest: null,
  directoryOffset: 0,
  // Which seasons the contribution chart draws: "all", one of the presets, or
  // one season label.
  chartSeasonChoice: "all",
  sources: [],
  unavailableSource: null,
  selectedSeasons: [],
  // The one season a team profile describes. The roster, the totals and the
  // contribution chart follow the whole selection; the profile is one season,
  // because a franchise changes too much between seasons for a blend of
  // several to describe anything.
  profileSeason: null,
  // The season the similar-players list compares, chosen in that panel alone:
  // one season label, "span" for the whole selection, or null for the
  // profile's own season.
  similaritySeason: null,
  pendingGameId: null,
};

const byId = (id) => document.getElementById(id);

// The Players page has no filters bar. It is always V13, every season, the
// full season, competitive minutes and Wins Contributed; the contribution
// chart and the similar-players list carry their own season choices, and the
// one control left, player search, sits in the header. Teams keeps the bar.
const PLAYER_PAGE_SOURCE = "v13";

// Compare is tabled with the experiments (owner's note, 2026-09-28): its page
// and code stay, but with the site-wide switch off no link leads to it.
const COMPARE_ON = experimentsSwitchedOn();

function fixedPlayerPage() {
  return state.kind === "players";
}

// The team directory keeps its search in the filters bar; a team profile
// moves it into the header, so going back puts it where it was.
function returnSearchToControls() {
  const label = byId("entity-search")?.closest("label");
  const controls = byId("entity-controls");
  const seasons = controls?.querySelector(".entity-season-control");
  if (label && seasons && label.parentNode !== seasons.parentNode) seasons.before(label);
}

function placeSearch(slotId) {
  const label = byId("entity-search")?.closest("label");
  const slot = byId(slotId);
  if (label && slot && label.parentNode !== slot) slot.append(label);
}

// Where the filters live. Above the directory they are the directory's own
// controls; once a player or a franchise is chosen they belong under his card,
// because the card is what the reader came for and the controls act on it.
let controlsHome = null;

function placeControls(afterId) {
  const controls = byId("entity-controls");
  if (!controls) return;
  if (!controlsHome) {
    controlsHome = { parent: controls.parentNode, next: controls.nextSibling };
  }
  const anchor = afterId ? byId(afterId) : null;
  if (anchor) anchor.insertAdjacentElement("afterend", controls);
  else controlsHome.parent.insertBefore(controls, controlsHome.next);
}

function updateMobileFilterScope() {
  const heading = document.querySelector('.entity-controls .mobile-panel-heading h2');
  if (!heading) return;
  let caption = heading.querySelector('.mobile-filter-scope');
  if (!caption) { caption=document.createElement('span');caption.className='mobile-filter-scope';heading.append(caption); }
  caption.textContent = `${selectedScopeLabel()} · ${elements.schedule.selectedOptions[0]?.textContent} · ${elements.metric.value==='wins_contributed'?'Wins Contributed':'Value Contributed'}`;
}

function showHero(visible) {
  const hero = byId("entity-hero");
  if (hero) hero.hidden = !visible;
}
const elements = {
  source: byId("entity-source"),
  search: byId("entity-search"),
  searchLabel: byId("entity-search-label"),
  scope: byId("entity-scope"),
  seasonPicker: byId("entity-season-picker"),
  seasonSummary: byId("entity-season-summary"),
  seasonOptions: byId("entity-season-options"),
  seasonApply: byId("entity-season-apply"),
  seasonStatus: byId("entity-season-status"),
  schedule: byId("entity-schedule"),
  timeMode: byId("entity-time-mode"),
  metric: byId("entity-metric"),
  loading: byId("entity-loading"),
  empty: byId("entity-empty"),
  error: byId("entity-error"),
  directory: byId("entity-directory"),
  directoryTitle: byId("directory-title"),
  directoryMeta: byId("directory-meta"),
  directoryGrid: byId("directory-grid"),
  playerProfile: byId("player-profile"),
  teamProfile: byId("team-profile"),
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function number(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function integer(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("en-US");
}

function percent(value, { alreadyPercent = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const normalized = alreadyPercent ? Number(value) / 100 : Number(value);
  return new Intl.NumberFormat("en-US", {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
  }).format(normalized);
}

function sharePercent(ratioValue, percentValue) {
  if (percentValue !== null && percentValue !== undefined && Number.isFinite(Number(percentValue))) {
    return percent(percentValue, { alreadyPercent: true });
  }
  return percent(ratioValue);
}

function seasonLabel(year) {
  return `${Number(year) - 1}-${String(year).slice(-2).padStart(2, "0")}`;
}

function selectedSeasonLabels() {
  return [...state.selectedSeasons].sort((left, right) => left - right).map(seasonLabel);
}

// What the selected source says it can answer. A deployment can narrow a
// statistic's capabilities (the published static site serves no per-game
// anatomy), so a control whose panel cannot be filled is never drawn.
function sourceCan(panel) {
  const source = state.sources.find((row) => row.id === elements.source.value);
  return (source?.capabilities ?? {})[panel] !== false;
}

function allAvailableSeasonYears() {
  const source = state.sources.find((row) => row.id === elements.source.value);
  return (source?.scope?.season_end_years ?? source?.selected_seasons ?? SEASONS)
    .map(Number).sort((left, right) => left - right);
}

function scopeIsAll() {
  const available = allAvailableSeasonYears();
  return state.selectedSeasons.length === available.length
    && available.every((year) => state.selectedSeasons.includes(year));
}

function scopeIsExact() {
  return state.selectedSeasons.length === 1;
}

function scopeIsMulti() {
  return state.selectedSeasons.length > 1 && !scopeIsAll();
}

// The chosen profile season, but only while it is still inside the selection.
// A reader who narrows the picker past the season he had chosen gets the most
// recent season of what he now has, which is what the page then shows him.
function profileSeasonInScope() {
  if (!state.profileSeason) return null;
  // Only V11 (and V12 and V13, through V11's routes) publishes a profile that is one
  // season of a wider selection.
  if (!isV11Shaped()) return null;
  return selectedSeasonLabels().includes(state.profileSeason)
    ? state.profileSeason : null;
}

function selectedScopeLabel() {
  if (scopeIsAll()) return "All Seasons";
  const labels = selectedSeasonLabels();
  if (labels.length === 1) return labels[0];
  const contiguous = state.selectedSeasons.every((year, index) =>
    index === 0 || year === state.selectedSeasons[index - 1] + 1);
  return contiguous
    ? `${labels[0]}–${labels.at(-1)} · ${labels.length} seasons`
    : `${labels.length} selected seasons`;
}

// Wherever a team is visible text it is the three-letter abbreviation; an id
// the directory does not know renders as an em dash, never as a number.
function teamLabel(value) {
  if (!value) return UNKNOWN_TEAM_LABEL;
  const supplied = value.abbreviation ?? value.team_abbreviation;
  if (TEAM_DIRECTORY) return TEAM_DIRECTORY.teamLabel(value.team_id ?? value.id, supplied);
  return supplied ?? UNKNOWN_TEAM_LABEL;
}

function teamName(value) {
  if (!value) return "Unknown team";
  const supplied = value.name ?? value.team_name;
  if (TEAM_DIRECTORY) {
    return TEAM_DIRECTORY.teamName(value.team_id ?? value.id, supplied)
      ?? teamLabel(value);
  }
  return supplied ?? teamLabel(value);
}

function teamId(value) {
  return Number(value?.team_id ?? value?.id ?? value);
}

function playerId(value) {
  return Number(value?.player_id ?? value?.id ?? value);
}

function showError(message = "") {
  elements.error.textContent = message;
  elements.error.hidden = !message;
  if (message) elements.empty.hidden = true;
}

function showEmpty(message) {
  elements.empty.textContent = message;
  elements.empty.hidden = false;
  showError();
}

function setLoading(message = "Loading analytics…") {
  elements.loading.textContent = message;
  elements.loading.hidden = false;
  elements.empty.hidden = true;
  elements.directory.hidden = true;
  hideTeamLandscapePanel();
  elements.playerProfile.hidden = true;
  elements.teamProfile.hidden = true;
  byId("entity-main").setAttribute("aria-busy", "true");
  showError();
}

function finishLoading() {
  elements.loading.hidden = true;
  byId("entity-main").setAttribute("aria-busy", "false");
}

function abortError() {
  return new DOMException("This request was superseded by newer filters.", "AbortError");
}

async function yieldToUi(signal) {
  if (signal?.aborted) throw abortError();
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (signal?.aborted) throw abortError();
}

function directoryPageSize() {
  return state.kind === "teams" ? 30 : 50;
}

function hideTeamLandscapePanel() {
  const panel = byId("team-landscape-panel");
  if (panel) panel.hidden = true;
}

function sourceIdFromRankings(value) {
  const raw = String(value ?? "v9");
  if (raw === "original" || raw === "v9") return "v9";
  if (raw.startsWith("local:")) return `experiment:${raw.slice(6)}`;
  return raw;
}

function urlState() {
  const params = new URLSearchParams(window.location.search);
  const entityKey = state.kind === "players" ? "player_id" : "team_id";
  const id = /^\d+$/.test(params.get(entityKey) ?? "") ? Number(params.get(entityKey)) : null;
  const seasons = params.getAll("season").filter((value) => /^\d{4}-\d{2}$/.test(value));
  const profileSeason = params.get("profile_season");
  return {
    profileSeason: /^\d{4}-\d{2}$/.test(profileSeason ?? "") ? profileSeason : null,
    source: sourceIdFromRankings(
      params.get("source")
        ?? params.get("stat_version")
        ?? state.sources.find((row) => row.kind === "official" && row.default)?.id
        ?? state.sources.find((row) => row.kind === "official")?.id
        ?? "v9",
    ),
    id,
    gameId: /^\d+$/.test(params.get("game_id") ?? "") ? params.get("game_id") : null,
    search: id ? "" : params.get("search") ?? "",
    seasons,
    schedule: params.get("schedule") ?? "all",
    timeMode: params.get("time_mode") ?? params.get("garbage_time_mode") ?? "competitive",
    metric: params.get("metric") ?? "wins_contributed",
    outcome: params.get("outcome") ?? "both",
    similarityMode: params.get("similarity_mode") ?? "career",
    similaritySeason: /^(\d{4}-\d{2}|span)$/.test(params.get("similarity_season") ?? "")
      ? params.get("similarity_season") : null,
    lens: ["equal_dimension", "concept_balanced", "style"].includes(params.get("lens"))
      ? params.get("lens") : "concept_balanced",
    rolling: params.get("rolling") ?? "raw",
    // The owner's note: one season is drawn game by game, several are drawn
    // season by season — which is the "season" view. The cumulative curve over
    // team games is still a click away, and still URL-addressable.
    teamChartView: params.get("team_chart_view") === "cumulative" ? "cumulative" : "season",
    teamChartPlayerIds: (params.get("chart_players") ?? "").split(",")
      .filter((value) => /^\d+$/.test(value))
      .map(Number)
      .filter((value, index, values) => value > 0 && values.indexOf(value) === index)
      .slice(0, 10),
    teamOthersVisible: params.get("chart_others") === "1",
    teamChartSeasons: params.getAll("chart_season").filter((value) => /^\d{4}-\d{2}$/.test(value)),
    teamChartSchedule: params.get("chart_schedule") ?? "all",
    teamChartMetric: params.get("chart_metric") === "value_contributed" ? "value_contributed" : "wins_contributed",
    teamGamesSeason: /^\d{4}-\d{2}$/.test(params.get("games_season") ?? "") ? params.get("games_season") : "",
    teamGamesSchedule: params.get("games_schedule") ?? "all",
    playerChartMetrics: (params.get("player_chart_metrics")
      ?? params.get("player_chart_metric")
      ?? params.get("metric")
      ?? "wins_contributed").split(",")
      .filter((value) => ["value_contributed", "wins_contributed"].includes(value)),
    playerChartMode: ["cumulative", "games", "games_cumulative"].includes(params.get("player_chart_mode"))
      ? params.get("player_chart_mode") : "period",
    playerChartSeasons: params.get("player_chart_seasons") ?? "all",
    directoryOffset: /^\d+$/.test(params.get("directory_offset") ?? "")
      ? Number(params.get("directory_offset"))
      : 0,
    rosterOffset: /^\d+$/.test(params.get("roster_offset") ?? "")
      ? Number(params.get("roster_offset"))
      : 0,
  };
}

function applyUrlState() {
  const values = urlState();
  if (fixedPlayerPage()) {
    // A link that names one season (a similar player, a top game) opens the
    // profile on that season; the page itself still covers every season.
    if (!values.profileSeason && values.seasons.length === 1) {
      values.profileSeason = values.seasons[0];
    }
    values.seasons = [];
    values.schedule = "all";
    values.timeMode = "competitive";
    values.metric = "wins_contributed";
    if ([...elements.source.options].some((option) => option.value === PLAYER_PAGE_SOURCE)) {
      values.source = PLAYER_PAGE_SOURCE;
    }
  }
  // Teams is always V13 too; its filters bar keeps seasons, schedule, game
  // time and metric, and the metric is the roster's opening sort.
  if (state.kind === "teams"
      && [...elements.source.options].some((option) => option.value === PLAYER_PAGE_SOURCE)) {
    values.source = PLAYER_PAGE_SOURCE;
  }
  state.selectedEntityId = values.id;
  state.pendingGameId = values.gameId;
  elements.search.value = values.search;
  elements.source.querySelectorAll("[data-unavailable-source]").forEach((option) => option.remove());
  state.unavailableSource = null;
  if ([...elements.source.options].some((option) => option.value === values.source)) {
    elements.source.value = values.source;
  } else if (values.source !== "v9") {
    const unavailable = document.createElement("option");
    unavailable.value = values.source;
    unavailable.textContent = "Unavailable browser-local experiment";
    unavailable.dataset.unavailableSource = "true";
    unavailable.disabled = true;
    unavailable.selected = true;
    elements.source.append(unavailable);
    state.unavailableSource = values.source;
  }
  setScopeOptions(elements.source.value, values.seasons);
  state.profileSeason = values.profileSeason;
  for (const [select, value] of [[elements.schedule, values.schedule],
    [elements.timeMode, values.timeMode], [elements.metric, values.metric]]) {
    if ([...select.options].some((option) => option.value === value)) select.value = value;
  }
  state.directoryOffset = values.directoryOffset;
  state.rosterOffset = values.rosterOffset;
  byId("player-games-outcome").value = values.outcome;
  byId("team-games-outcome").value = values.outcome;
  byId("player-similarity-mode").value = values.similarityMode;
  byId("player-v10-lens").value = values.lens;
  byId("team-v10-lens").value = values.lens;
  byId("team-rolling").value = values.rolling;
  byId("team-chart-view").value = values.teamChartView;
  state.teamChartPlayerIds = values.teamChartPlayerIds;
  state.teamOthersVisible = values.teamOthersVisible;
  state.teamChartSeasons = values.teamChartSeasons;
  state.teamChartSchedule = ["all", "regular_season", "postseason"].includes(values.teamChartSchedule)
    ? values.teamChartSchedule : "all";
  state.teamChartMetric = values.teamChartMetric;
  state.teamGamesSeason = values.teamGamesSeason;
  state.teamGamesSchedule = ["all", "regular_season", "postseason"].includes(values.teamGamesSchedule)
    ? values.teamGamesSchedule : "all";
  byId("team-chart-schedule").value = state.teamChartSchedule;
  byId("team-chart-metric").value = state.teamChartMetric;
  byId("team-games-schedule").value = state.teamGamesSchedule;
  if (state.kind === "teams") {
    state.rosterSortBy = elements.metric.value;
    state.rosterSortDirection = "desc";
  }
  const chartMetrics = new Set(values.playerChartMetrics.length
    ? values.playerChartMetrics : ["wins_contributed"]);
  byId("player-chart-metrics").querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = chartMetrics.has(input.value);
  });
  byId("player-chart-mode").value = values.playerChartMode;
  state.chartSeasonChoice = values.playerChartSeasons;
  state.similaritySeason = values.similaritySeason;
}

function filters({ supporting = false } = {}) {
  const exactSeason = scopeIsExact();
  // A profile answers over exactly the seasons the picker has selected, so a
  // multi-season selection travels as the list of labels rather than as
  // "career" — which used to make every style panel describe the most recent
  // season alone. One season is still one label, unchanged.
  const result = {
    source: elements.source.value,
    scope: exactSeason ? "season" : "all",
    season: exactSeason ? selectedSeasonLabels()[0] : selectedSeasonLabels(),
    schedule: elements.schedule.value,
    time_mode: elements.timeMode.value,
    metric: elements.metric.value,
  };
  if (state.kind === "players" && state.selectedEntityId) result.player_id = state.selectedEntityId;
  if (state.kind === "teams" && state.selectedEntityId) result.team_id = state.selectedEntityId;
  if (state.kind === "players") result.lens = byId("player-v10-lens").value;
  if (state.kind === "teams") result.lens = byId("team-v10-lens").value;
  // The profile's own season travels beside the selection, so a link restores
  // the season card the reader chose rather than the newest one. The
  // most-similar list belongs to the profile, so it answers for that season
  // too, which is why a supporting request carries it as well.
  if (profileSeasonInScope()) {
    result.profile_season = profileSeasonInScope();
  }
  if (!state.selectedEntityId) result.search = elements.search.value.trim();
  if (!state.selectedEntityId) {
    result.limit = directoryPageSize();
    result.offset = state.directoryOffset;
  } else if (supporting) result.limit = 10;
  return result;
}

function syncUrl(mode = "replace") {
  const current = filters();
  const params = new URLSearchParams();
  params.set("source", current.source);
  if (state.selectedEntityId) params.set(state.kind === "players" ? "player_id" : "team_id", String(state.selectedEntityId));
  else if (current.search) params.set("search", current.search);
  if (!scopeIsAll()) selectedSeasonLabels().forEach((season) => params.append("season", season));
  params.set("schedule", current.schedule);
  params.set("time_mode", current.time_mode);
  params.set("metric", current.metric);
  if ((state.kind === "players" ? byId("player-v10-lens") : byId("team-v10-lens")).value !== "concept_balanced") {
    params.set("lens", (state.kind === "players" ? byId("player-v10-lens") : byId("team-v10-lens")).value);
  }
  if (state.kind === "players" && state.pendingGameId) params.set("game_id", state.pendingGameId);
  const outcome = state.kind === "players" ? byId("player-games-outcome").value : byId("team-games-outcome").value;
  if (outcome !== "both") params.set("outcome", outcome);
  if (state.kind === "players" && byId("player-similarity-mode").value !== "career") {
    params.set("similarity_mode", byId("player-similarity-mode").value);
  }
  if (state.kind === "players" && state.similaritySeason) {
    params.set("similarity_season", state.similaritySeason);
  }
  if (state.kind === "players") {
    const chartMetrics = selectedPlayerChartMetrics();
    if (chartMetrics.length !== 1 || chartMetrics[0] !== current.metric) {
      params.set("player_chart_metrics", chartMetrics.join(","));
    }
    if (byId("player-chart-mode").value !== "period") {
      params.set("player_chart_mode", byId("player-chart-mode").value);
    }
    if (state.chartSeasonChoice && state.chartSeasonChoice !== "all") {
      params.set("player_chart_seasons", state.chartSeasonChoice);
    }
  }
  if (profileSeasonInScope()) params.set("profile_season", profileSeasonInScope());
  if (state.kind === "teams") {
    if (byId("team-chart-view").value === "cumulative") params.set("team_chart_view", "cumulative");
    if (byId("team-rolling").value !== "raw") params.set("rolling", byId("team-rolling").value);
    if (state.teamChartPlayerIds.length) params.set("chart_players", state.teamChartPlayerIds.join(","));
    if (state.teamOthersVisible) params.set("chart_others", "1");
    state.teamChartSeasons.forEach((season) => params.append("chart_season", season));
    if (state.teamChartSchedule !== "all") params.set("chart_schedule", state.teamChartSchedule);
    if (state.teamChartMetric !== "wins_contributed") params.set("chart_metric", state.teamChartMetric);
    if (state.teamGamesSeason) params.set("games_season", state.teamGamesSeason);
    if (state.teamGamesSchedule !== "all") params.set("games_schedule", state.teamGamesSchedule);
  }
  if (state.kind === "teams" && state.rosterOffset > 0) params.set("roster_offset", String(state.rosterOffset));
  if (!state.selectedEntityId && state.directoryOffset > 0) {
    params.set("directory_offset", String(state.directoryOffset));
  }
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", `${window.location.pathname}?${params}`);
  updateEntityNavigation();
}

function updateEntityNavigation() {
  const rankingParams = new URLSearchParams();
  rankingParams.set("stat_version", elements.source.value === "v9" ? "original" : elements.source.value);
  const rankingSeasons = scopeIsAll() ? ["All Seasons"] : selectedSeasonLabels();
  rankingSeasons.forEach((season) => rankingParams.append("season", season));
  rankingParams.set("phase", {
    all: "All",
    regular_season: "Regular Season",
    play_in: "PlayIn",
    playoffs: "Playoffs",
    postseason: "Postseason",
  }[elements.schedule.value] ?? "All");
  rankingParams.set("garbage_time_mode", elements.timeMode.value);
  rankingParams.set("sort_by", elements.metric.value === "wins_contributed"
    ? "wins_contributed" : "value_contributed");
  const rankingsLink = document.querySelector("[data-rankings-nav]");
  if (rankingsLink) rankingsLink.href = `/?${rankingParams}`;
  document.querySelectorAll("[data-entity-nav]").forEach((link) => {
    const params = new URLSearchParams();
    params.set("source", elements.source.value);
    if (!scopeIsAll()) selectedSeasonLabels().forEach((season) => params.append("season", season));
    params.set("schedule", elements.schedule.value);
    params.set("time_mode", elements.timeMode.value);
    params.set("metric", elements.metric.value);
    link.href = `/${link.dataset.entityNav}?${params}`;
  });
  const compareLink = document.querySelector("[data-compare-nav]");
  if (compareLink) {
    const params = new URLSearchParams();
    params.set("source", elements.source.value);
    params.set("metric", elements.metric.value);
    params.set("schedule", elements.schedule.value);
    params.set("time_mode", elements.timeMode.value);
    compareLink.href = `/compare/${state.kind}?${params}`;
  }
}

function entityUrl(kind, id, { season = null } = {}) {
  const params = new URLSearchParams();
  params.set("source", elements.source.value);
  params.set(kind === "players" ? "player_id" : "team_id", String(id));
  if (season) params.set("season", season);
  else if (!scopeIsAll()) selectedSeasonLabels().forEach((value) => params.append("season", value));
  params.set("schedule", elements.schedule.value);
  params.set("time_mode", elements.timeMode.value);
  params.set("metric", elements.metric.value);
  return `/${kind}?${params}`;
}

function comparisonUrl(kind, id, name) {
  const params = new URLSearchParams({
    source: elements.source.value,
    mode: scopeIsExact() ? "season" : "span",
    schedule: elements.schedule.value,
    time_mode: elements.timeMode.value,
    metric: elements.metric.value,
  });
  const prefix = kind === "players" ? "p1" : "t1";
  params.set(prefix, String(id));
  params.set(`${prefix}_name`, name);
  if (!scopeIsAll()) selectedSeasonLabels().forEach((season) => params.append(`${prefix}_season`, season));
  return `/compare/${kind}?${params}`;
}

function summaryCard(label, value, detail = "") {
  return `<div class="summary-card" data-summary="${escapeHtml(label)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</div>`;
}

function responsibilityValue(source, side) {
  return source?.[side]
    ?? source?.[`${side}_value`]
    ?? source?.[`${side}_value_contributed`]
    ?? source?.[`${side}_responsibility`]
    ?? 0;
}

function responsibilityCell(source, side, total) {
  const value = responsibilityValue(source, side);
  const share = Number(total) === 0 ? null : Number(value) / Number(total);
  return `<span class="responsibility-cell"><span>${number(value)}</span><small>${percent(share)}</small></span>`;
}

function sourceTitle(source) {
  if (source?.label) return source.label;
  const id = String(source?.public_id ?? source?.id ?? "");
  if (id === "v9") return "V9";
  return /^v\d+$/.test(id) ? id.toUpperCase() : "Unknown source";
}

// The hero carried an eyebrow, a heading, a sentence and a source card above
// every profile.  A reader who has chosen a player wants the player: the
// heading and the sentence belong to the directory, which is the only view
// that still draws them, and the eyebrow and the status card are gone from
// both views.  Which statistic is answering is on the Source control.
function renderSource(source) {
  document.title = state.selectedEntityId
    ? document.title
    : `${state.kind === "teams" ? "Team" : "Player"} and Team Analytics · Value Contributed`;
  void source;
}

function stableSeriesKey(item, index) {
  const hasSnakeIdentity = item && Object.hasOwn(item, "player_id");
  const identity = hasSnakeIdentity ? item.player_id : item?.playerId;
  if (identity === null) return "others";
  if (identity !== undefined) return `player:${identity}`;
  return String(item?.key ?? `series:${index}`);
}

function seriesColor(item, index) {
  // A series may name its own ink — the postseason half of one season is drawn
  // in the site's warm colour so it cannot be mistaken for another season.
  if (item?.color) return item.color;
  return stableSeriesKey(item, index) === "others"
    ? COLORS[COLORS.length - 1]
    : COLORS[index % COLORS.length];
}

function applySeriesHighlight(container, activeKey, lockedKey = null) {
  const resolvedKey = activeKey ?? lockedKey;
  const hasHighlight = resolvedKey !== null;
  container.classList.toggle("has-series-highlight", hasHighlight);
  container.querySelectorAll("[data-chart-series]").forEach((element) => {
    const matches = hasHighlight && element.dataset.chartSeries === resolvedKey;
    element.classList.toggle("is-highlighted", matches);
    element.classList.toggle("is-muted", hasHighlight && !matches);
  });
  container.querySelectorAll(".chart-legend-item").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.chartSeries === lockedKey ? "true" : "false");
  });
}

function bindSeriesHighlighting(container) {
  let lockedKey = null;
  const interactive = [...container.querySelectorAll("[data-chart-series]")];
  interactive.forEach((element) => {
    const key = element.dataset.chartSeries;
    element.addEventListener("pointerenter", () => applySeriesHighlight(container, key, lockedKey));
    element.addEventListener("pointerleave", () => applySeriesHighlight(container, null, lockedKey));
    element.addEventListener("focusin", () => applySeriesHighlight(container, key, lockedKey));
    element.addEventListener("focusout", () => applySeriesHighlight(container, null, lockedKey));
  });
  container.querySelectorAll(".chart-legend-item").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.chartSeries;
      lockedKey = lockedKey === key ? null : key;
      applySeriesHighlight(container, lockedKey, lockedKey);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      lockedKey = null;
      applySeriesHighlight(container, null, null);
      event.preventDefault();
    });
  });
}

function lineChart(container, series, {
  xLabels = [],
  selectedIndex = null,
  valueKey = "value",
  label = "Contribution chart",
  interactiveSeries = false,
  fitViewport = false,
  xAxisTitle = "",
} = {}) {
  container.classList.remove("has-series-highlight");
  if (!series.length || !series.some((item) => item.points?.some(Boolean))) {
    container.innerHTML = '<p class="similarity-empty">No chart points match this scope.</p>';
    return;
  }
  const contentWidth = Math.max(760, Math.min(1800, xLabels.length * 18));
  const measuredWidth = Math.floor(container.getBoundingClientRect().width || container.clientWidth || 760);
  const width = fitViewport ? Math.max(320, measuredWidth - 2) : contentWidth;
  const height = container.classList.contains("tall-chart") ? 390 : 300;
  const margin = { top: 28, right: 28, bottom: xAxisTitle ? 66 : 52, left: 64 };
  const values = series.flatMap((item) => item.points.filter(Boolean).map((point) => Number(point[valueKey] ?? 0)));
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const x = (index) => margin.left + (xLabels.length <= 1 ? 0 : index * (width - margin.left - margin.right) / (xLabels.length - 1));
  const y = (value) => margin.top + (maximum - value) * (height - margin.top - margin.bottom) / (maximum - minimum);
  const path = (points) => points.map((point, index) => `${index ? "L" : "M"}${x(point.index)} ${y(Number(point[valueKey] ?? 0))}`).join(" ");
  const ticks = Array.from({ length: 5 }, (_, index) => minimum + (maximum - minimum) * index / 4);
  const selectedBand = Number.isInteger(selectedIndex)
    ? `<rect class="selected-band" x="${x(selectedIndex) - 24}" y="${margin.top}" width="48" height="${height - margin.top - margin.bottom}" />`
    : "";
  const labelStride = Math.max(1, Math.ceil(xLabels.length / 14));
  const markerStride = Math.max(1, Math.ceil(xLabels.length / 180));
  container.setAttribute("aria-label", label);
  container.innerHTML = `
    <div class="chart-legend">${series.map((item, index) => {
      const color = seriesColor(item, index);
      const dash = DASHES[index % DASHES.length];
      const key = escapeHtml(stableSeriesKey(item, index));
      const swatch = `<svg viewBox="0 0 24 4" aria-hidden="true" focusable="false"><line x1="0" x2="24" y1="2" y2="2" stroke="currentColor" stroke-width="3" ${dash ? `stroke-dasharray="${dash}"` : ""}/></svg>`;
      return interactiveSeries
        ? `<button type="button" class="chart-legend-item" style="color:${color}" data-chart-series="${key}" aria-controls="${escapeHtml(`${container.id}-series-${index}`)}" aria-pressed="false" aria-label="Highlight ${escapeHtml(item.label)} series">${swatch}${escapeHtml(item.label)}</button>`
        : `<span style="color:${color}">${swatch}${escapeHtml(item.label)}</span>`;
    }).join("")}</div>
    <svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false" style="width:${fitViewport ? "100%" : `${width}px`}">
      ${selectedBand}
      ${xLabels.map((item, index) => item?.separator
        ? `<line class="season-separator" x1="${x(index)}" x2="${x(index)}" y1="${margin.top}" y2="${height - margin.bottom}"/>${item.forceLabel ? "" : `<text class="season-label" x="${x(index) + 5}" y="${margin.top + 12}">${escapeHtml(item.season ?? "New season")}</text>`}`
        : "").join("")}
      ${ticks.map((tick) => `<line class="${Math.abs(tick) < 1e-12 ? "zero-line" : "grid-line"}" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"/><text x="${margin.left - 10}" y="${y(tick) + 4}" text-anchor="end">${escapeHtml(number(tick, 2))}</text>`).join("")}
      ${xLabels.map((item, index) => (item?.forceLabel || index % labelStride === 0 || index === xLabels.length - 1) ? `<text x="${x(index)}" y="${height - (xAxisTitle ? 34 : 22)}" text-anchor="middle">${escapeHtml(item.short ?? item.label ?? item)}</text>` : "").join("")}
      ${xAxisTitle ? `<text class="axis-title" x="${margin.left + (width - margin.left - margin.right) / 2}" y="${height - 8}" text-anchor="middle">${escapeHtml(xAxisTitle)}</text>` : ""}
      ${series.map((item, seriesIndex) => {
        const dash = DASHES[seriesIndex % DASHES.length];
        const color = seriesColor(item, seriesIndex);
        const segments = [];
        let active = [];
        for (const point of item.points) {
          if (point === null) { if (active.length) segments.push(active); active = []; }
          else active.push(point);
        }
        if (active.length) segments.push(active);
        const visiblePaths = segments.map((points) => `<path class="series-line" d="${path(points)}" stroke="${color}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`).join("");
        const hitPaths = interactiveSeries
          ? segments.map((points) => `<path class="series-hit" d="${path(points)}"/>`).join("")
          : "";
        const points = item.points.filter((point) => point && (point.index % markerStride === 0 || point.index === xLabels.length - 1)).map((point) => `<circle class="series-point chart-tooltip-target" cx="${x(point.index)}" cy="${y(Number(point[valueKey] ?? 0))}" r="4" fill="${color}"><title>${escapeHtml(`${item.label} · ${point.tooltip ?? xLabels[point.index]?.label ?? xLabels[point.index] ?? ""} · ${number(point[valueKey], 3)}`)}</title></circle>`).join("");
        if (!interactiveSeries) return `${visiblePaths}${points}`;
        const key = escapeHtml(stableSeriesKey(item, seriesIndex));
        return `<g id="${escapeHtml(`${container.id}-series-${seriesIndex}`)}" class="chart-series" data-chart-series="${key}">${hitPaths}${visiblePaths}${points}</g>`;
      }).join("")}
    </svg>`;
  if (interactiveSeries) bindSeriesHighlighting(container);
  renderMobileLines(container, series, {xLabels, title:label, unit:label.includes("WC")?"WC":"VC", recent:container.id === "player-career-chart", picker:!container.id.startsWith("team-")});
}

function renderDirectory(payload) {
  renderSource(payload.source);
  showHero(true);
  if (fixedPlayerPage()) placeSearch("entity-hero-search");
  else {
    returnSearchToControls();
    placeControls(null);
    updateMobileFilterScope();
  }
  elements.directory.hidden = false;
  elements.playerProfile.hidden = true;
  elements.teamProfile.hidden = true;
  const rows = payload.rows ?? [];
  elements.directoryTitle.textContent = state.kind === "players" ? "Players" : "NBA franchises";
  elements.directoryMeta.textContent = `${integer(payload.pagination?.total ?? rows.length)} result${(payload.pagination?.total ?? rows.length) === 1 ? "" : "s"}`;
  elements.directoryGrid.innerHTML = rows.length ? rows.map((row) => {
    if (state.kind === "players") {
      const directoryTeams = row.teams ?? [];
      const latestTeam = row.latest_team ?? row.team ?? directoryTeams.at(0);
      return `<a class="directory-card" href="${entityUrl("players", playerId(row))}">${mobilePhoto(playerId(row))}<strong>${escapeHtml(row.player_name ?? row.name)}</strong><span>${escapeHtml(teamLabel(latestTeam))}<br>${integer(row.games ?? row.games_played)} GP · ${number(row.value_contributed)} VC</span></a>`;
    }
    return `<a class="directory-card" href="${entityUrl("teams", teamId(row))}"><strong>${escapeHtml(row.name ?? row.team_name)}</strong><span>${escapeHtml(teamLabel(row))}<br>${integer(row.games ?? row.games_played)} games</span></a>`;
  }).join("") : '<p class="similarity-empty">No entities match this search and scope.</p>';
  const pagination = payload.pagination ?? { limit: directoryPageSize(), offset: 0, total: rows.length };
  const limit = Number(pagination.limit) || directoryPageSize();
  const offset = Number(pagination.offset) || 0;
  const total = Number(pagination.total) || 0;
  const controls = byId("directory-pagination");
  controls.querySelector("span").textContent = total
    ? `${integer(offset + 1)}–${integer(Math.min(total, offset + rows.length))} of ${integer(total)}`
    : "0 results";
  controls.querySelector('[data-directory-page="previous"]').disabled = offset <= 0;
  controls.querySelector('[data-directory-page="next"]').disabled = offset + limit >= total;
  renderTeamLandscapePanel();
}

// The team directory gets the whole league's style map beneath it, for whichever
// seasons are selected. A statistic with no team style model simply has no panel.
async function renderTeamLandscapePanel() {
  const panel = byId("team-landscape-panel");
  if (!panel) return;
  if (state.kind !== "teams" || state.selectedEntityId) { panel.hidden = true; return; }
  const season = scopeIsExact() ? selectedSeasonLabels()[0] : null;
  state.supportingControllers.get("team_landscape")?.abort();
  const controller = new AbortController();
  state.supportingControllers.set("team_landscape", controller);
  const container = byId("team-landscape-chart");
  const note = byId("team-landscape-note");
  panel.hidden = false;
  container.innerHTML = '<p class="similarity-empty">Loading the team style map…</p>';
  byId("team-landscape-table").innerHTML = "";
  try {
    const landscape = await state.adapter.query(elements.source.value, "team_landscape", {
      source: elements.source.value,
      scope: season ? "season" : "all",
      season: season ?? undefined,
      schedule: "regular_season",
      time_mode: elements.timeMode.value,
      metric: elements.metric.value,
    }, { signal: controller.signal });
    const view = createStyleLandscapeView({
      container, tableContainer: byId("team-landscape-table"), landscape, kind: "team",
      hrefFor: (row) => entityUrl("teams", row.team_id, { season: row.season }),
      searchId: "team-landscape-search",
      tableSummary: "View the team style map as a table",
      emptyNote: "This statistic publishes no team style model, so there is no map to draw.",
    });
    if (!view) { panel.hidden = true; return; }
    note.textContent = `${integer(view.rows.length)} regular-season team seasons${season ? ` in ${season}` : " across every selected season"}, placed by the two summary directions of the team description and coloured by style. Colour and the two-letter badge are the style; face size is player minutes.`;
  } catch (caught) {
    if (caught.name === "AbortError") return;
    // A source without the panel is not an error the reader needs to see.
    panel.hidden = true;
  }
}

function normalizeCareer(payload) {
  return payload.seasons ?? payload.career?.rows ?? [];
}

// The chart's own seasons, independent of the rest of the page: "all", a
// "last-N" shortcut, or a comma-separated list of season labels. One or two
// seasons are drawn game by game; three or more are drawn one point a season,
// because a dozen overlapping game lines is not a chart anyone can read.
const CHART_GAME_SEASON_LIMIT = 2;

function chartSeasonLabels(available) {
  const choice = String(state.chartSeasonChoice ?? "all");
  const shortcut = /^last-(\d+)$/.exec(choice);
  if (choice === "all") return available;
  if (shortcut) return available.slice(-Number(shortcut[1]));
  const wanted = new Set(choice.split(",").filter(Boolean));
  const picked = available.filter((season) => wanted.has(season));
  return picked.length ? picked : available;
}

function chartSeasonSummary(available, chosen) {
  if (chosen.length === available.length) return "All seasons";
  const choice = String(state.chartSeasonChoice ?? "");
  const shortcut = /^last-(\d+)$/.exec(choice);
  if (shortcut) return `Last ${shortcut[1]} seasons`;
  if (chosen.length <= 2) return chosen.join(", ");
  return `${chosen.length} seasons`;
}

function renderChartSeasonPicker(available, chosen) {
  const host = byId("player-chart-season-options");
  if (!host) return;
  const picked = new Set(chosen);
  host.innerHTML = [...available].reverse().map((season) => `<label class="season-ranking-option"><input type="checkbox" value="${escapeHtml(season)}" ${picked.has(season) ? "checked" : ""}/><span>${escapeHtml(season)}</span></label>`).join("");
  byId("player-chart-season-summary").textContent = chartSeasonSummary(available, chosen);
  byId("player-chart-season-status").textContent = chosen.length <= CHART_GAME_SEASON_LIMIT
    ? "One or two seasons are drawn game by game. Tick a third to draw one point a season."
    : "Three or more seasons are drawn one point a season; choose By game in View to draw each season as a line of its own.";
  document.querySelectorAll("[data-chart-season-shortcut]").forEach((button) => {
    const count = /^last-(\d+)$/.exec(button.dataset.chartSeasonShortcut)?.[1];
    button.hidden = Boolean(count) && available.length <= Number(count);
  });
}

function selectedPlayerChartMetrics() {
  const selected = [...byId("player-chart-metrics").querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value);
  return selected.length ? selected : ["wins_contributed"];
}

// With one or two seasons the chart is by game, so View is "By game" or
// "Cumulative". With three or more it is by season, and View also offers the
// seasons drawn against each other by game.
function updatePlayerChartControlLabels(drawsGames = true, hasSeasons = true, many = false) {
  const mode = byId("player-chart-mode");
  mode.querySelector('option[value="period"]').textContent = many
    ? "By season" : (drawsGames ? "By game" : "By season");
  mode.querySelector('option[value="cumulative"]').textContent = many ? "Cumulative by season" : "Cumulative";
  for (const [value, words] of [["games", "By game, each season a line"], ["games_cumulative", "Cumulative by game"]]) {
    const option = mode.querySelector(`option[value="${value}"]`);
    if (!option) continue;
    option.textContent = words;
    option.hidden = !many;
    option.disabled = !many;
  }
  // One or two seasons are by game already, so the by-game views fold back
  // into the two that remain.
  if (!many && mode.value === "games") mode.value = "period";
  if (!many && mode.value === "games_cumulative") mode.value = "cumulative";
  const seasonControl = document.querySelector(".player-chart-season-control");
  if (seasonControl) seasonControl.hidden = !hasSeasons;
}

// One point a season for the chosen seasons, the running total restarting at
// the first of them, so "cumulative" is a total over what the reader picked.
function chosenSeasonTotals(payload, seasons, metric) {
  const wanted = new Set(seasons);
  const full = (payload.contribution_chart?.schedules ?? []).find((schedule) => schedule.id === "full");
  const source = full?.points?.length ? full.points : normalizeCareer(payload);
  let running = 0;
  const points = source
    .filter((point) => wanted.has(String(point.season)))
    .sort((left, right) => Number(left.season_end_year) - Number(right.season_end_year))
    .map((point) => {
      running += Number(point[metric] ?? 0);
      return { ...point, [`cumulative_${metric}`]: running };
    });
  return { grain: "season", schedules: [{ id: "full", label: "Full season", points }] };
}

function renderPlayerContributionChart(payload) {
  const bySeason = payload.contribution_chart?.by_season ?? [];
  const available = bySeason.map((row) => String(row.season));
  const view = byId("player-chart-mode").value;
  const cumulative = view === "cumulative" || view === "games_cumulative";
  const chartMetrics = selectedPlayerChartMetrics();
  const metricShort = chartMetrics.map((metric) => metric === "wins_contributed" ? "WC" : "VC").join(" + ");
  const playerChart = byId("player-career-chart");
  playerChart.classList.add("fit-viewport-chart");
  const withMetric = (charts) => charts.flatMap(({ short, chart }) => chart.series.map((row) => ({
    ...row,
    key: `${row.key}-${short.toLowerCase()}`,
    label: chartMetrics.length > 1 ? `${row.label} · ${short}` : row.label,
  })));
  if (available.length) {
    const seasons = chartSeasonLabels(available);
    renderChartSeasonPicker(available, seasons);
    const many = seasons.length > CHART_GAME_SEASON_LIMIT;
    const drawsGames = !many || view === "games" || view === "games_cumulative";
    updatePlayerChartControlLabels(drawsGames, true, many);
    if (drawsGames) {
      const charts = chartMetrics.map((metric) => ({
        short: metric === "wins_contributed" ? "WC" : "VC",
        chart: buildSeasonGameChart(bySeason, { metric, cumulative, seasons }),
      }));
      const first = charts[0].chart;
      const heading = cumulative
        ? `Cumulative ${metricShort} through each season`
        : `${metricShort} by game`;
      byId("career-trend-title").textContent = heading;
      byId("player-chart-note").textContent = [
        cumulative
          ? `Each line is one season's running ${metricShort} total, game by game.`
          : `Each point is one game's ${metricShort}, and each line is one season.`,
        first.singleSeason
          ? "Postseason games are drawn in their own colour."
          : "The seasons are lined up on the game number inside each season, so a short season simply stops earlier.",
        "Point at a game for its date, opponent and result.",
      ].join(" ");
      lineChart(playerChart, withMetric(charts), {
        xLabels: first.labels,
        label: `${heading}: ${first.seasons.join(", ")}`,
        fitViewport: true,
        xAxisTitle: "Game number inside the season",
      });
      return;
    }
    const charts = chartMetrics.map((metric) => ({
      short: metric === "wins_contributed" ? "WC" : "VC",
      chart: buildPlayerContributionChart(chosenSeasonTotals(payload, seasons, metric), {
        metric, cumulative, schedules: ["full"],
      }),
    }));
    const heading = cumulative ? `Cumulative ${metricShort} across seasons` : `${metricShort} by season`;
    byId("career-trend-title").textContent = heading;
    byId("player-chart-note").textContent = cumulative
      ? `Each point adds that season's ${metricShort} to the seasons before it, from ${seasons[0]}.`
      : `Each point is one full season's ${metricShort} total, regular season and postseason together. Keep one or two seasons in Seasons to see them game by game.`;
    lineChart(playerChart, withMetric(charts), {
      xLabels: charts[0].chart.labels.map((label) => ({ ...label, short: label.label })),
      label: heading,
      fitViewport: true,
      xAxisTitle: "Season",
    });
    return;
  }
  updatePlayerChartControlLabels(false, false);
  // A statistic that publishes no per-game rows keeps the season curve it has
  // always drawn rather than an empty frame.
  const fallbackChart = {
    grain: "season",
    selected_season_end_year: null,
    schedules: [{
      id: "full",
      label: "Full season",
      points: payload.trend ?? payload.career?.chart ?? [],
    }],
  };
  const normalizedByMetric = chartMetrics.map((metric) => ({
    short: metric === "wins_contributed" ? "WC" : "VC",
    chart: buildPlayerContributionChart(payload.contribution_chart ?? fallbackChart, {
      metric, cumulative, schedules: ["full"],
    }),
  }));
  const normalized = normalizedByMetric[0].chart;
  const heading = cumulative ? `Cumulative ${metricShort}` : `${metricShort} by season`;
  byId("career-trend-title").textContent = heading;
  byId("player-chart-note").textContent = `${cumulative ? "Lines add season" : "Each point is one season's"} ${metricShort} total.`;
  lineChart(playerChart, withMetric(normalizedByMetric), {
    xLabels: normalized.labels,
    label: heading,
    fitViewport: true,
    xAxisTitle: "Season",
  });
}

function renderCareerTable(payload) {
  const rows = normalizeCareer(payload);
  const selectedSeasons = scopeIsAll() ? new Set() : new Set(selectedSeasonLabels());
  const profile = profileSeasonInScope();
  byId("player-career-body").innerHTML = rows.length ? rows.map((row) => {
    const responsibility = row.responsibility ?? row;
    const teams = row.teams ?? [];
    const label = row.season ?? seasonLabel(row.season_end_year);
    const selected = selectedSeasons.has(label);
    const described = profile === label;
    return `<tr class="${[selected ? "selected-season-row" : "", described ? "described-season-row" : ""].filter(Boolean).join(" ")}"${selected ? ' aria-current="true"' : ""}><td><button type="button" class="season-choice" data-profile-season="${escapeHtml(label)}" aria-pressed="${described}">${escapeHtml(label)}</button>${selected ? '<span class="selected-season-marker">Selected</span>' : ""}</td><td>${teams.map((item) => escapeHtml(teamLabel(item))).join(" · ") || "—"}</td><td class="numeric">${integer(row.appearances ?? row.games ?? row.games_played)}</td><td class="numeric">${number(row.value_contributed ?? row.vc)}</td><td class="numeric">${number(row.wins_contributed ?? row.wc)}</td><td class="numeric">${number(row.value_per_game ?? row.vc_per_game)}</td><td class="numeric">${number(responsibilityValue(responsibility, "offense"))}</td><td class="numeric">${number(responsibilityValue(responsibility, "defense"))}</td><td class="numeric">${row.wins_contributed_rank ? `#${integer(row.wins_contributed_rank)}` : "—"}</td></tr>`;
  }).join("") : '<tr><td colspan="9">No seasons match this schedule.</td></tr>';
  prepareMobileTable(byId("player-career-body"), {kind:"career", main:0});
}

function fingerprintBars(values, { asPercent = false } = {}) {
  const entries = Object.entries(values ?? {}).filter(([, value]) => value !== null
    && value !== undefined && Number.isFinite(Number(value)));
  const maximum = Math.max(1e-12, ...entries.map(([, value]) => Math.abs(Number(value))));
  return `<div class="fingerprint-bars">${entries.map(([key, value]) => `<div class="fingerprint-bar"><span>${escapeHtml(key.replaceAll("_", " "))}</span><div class="fingerprint-track"><div class="fingerprint-fill" style="width:${Math.min(100, Math.abs(Number(value)) / maximum * 100)}%;${Number(value) < 0 ? "background:var(--danger)" : ""}"></div></div><strong class="${Number(value) < 0 ? "negative-value" : ""}">${asPercent ? percent(value) : number(value)}</strong></div>`).join("")}</div>`;
}

// The six on-court context factors in plain words, in the standing order: the
// three that move the offense side first, then the three that move defense.
const CONTEXT_FACTOR_LABELS = Object.freeze({
  general_offense: "Own lineups · offense",
  teammate_offense: "Teammates · offense",
  opponent_defense: "Defenses faced",
  general_defense: "Own lineups · defense",
  teammate_defense: "Teammates · defense",
  opponent_offense: "Offenses faced",
});

function contextFactorLabel(key) {
  return CONTEXT_FACTOR_LABELS[key] ?? String(key).replaceAll("_", " ");
}

// Every factor a row publishes, in the standing order, with plain labels.
function contextFactorRows(context) {
  const published = Object.entries(context ?? {})
    .filter(([, value]) => Number.isFinite(Number(value)));
  const order = Object.keys(CONTEXT_FACTOR_LABELS);
  return published
    .map(([key, value]) => ({ key, label: contextFactorLabel(key), value: Number(value) }))
    .sort((left, right) => {
      const leftIndex = order.indexOf(left.key);
      const rightIndex = order.indexOf(right.key);
      return (leftIndex === -1 ? order.length : leftIndex)
        - (rightIndex === -1 ? order.length : rightIndex);
    });
}

function contextFactorTotal(context) {
  return contextFactorRows(context).reduce((total, row) => total + row.value, 0);
}

function signedAmount(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return "—";
  return `${Number(value) > 0 ? "+" : ""}${number(value, digits)}`;
}

function sourceDisplayLabel(key) {
  // V12 pays a charge as a charge, so its steals are steals alone; V13 keeps
  // V12's categories.
  if (key === "steals" && ["v12", "v13"].includes(elements.source.value)) return "Steals";
  // A statistic that names its own components (V13's /api/sources row) is
  // said in its own words.
  const named = state.sources.find((row) => row.id === elements.source.value)
    ?.component_labels?.[key];
  if (named) return named;
  return ({
    DFG_make: "Shots made vs.", DFG_miss: "Shots missed vs.", scorer: "Scoring",
    assister: "Made-shot assists", ft_assister: "FT creation", screen_assister: "Screen creation",
    terminal_fg_miss_2pt: "2PT miss cost", terminal_fg_miss_3pt: "3PT miss cost",
    regular_ft_shortfall: "FT shortfall", turnover: "Turnover cost", block: "Blocks",
    pressure_defense: "Pressure defense", defensive_rebound: "Defensive rebounds",
    defensive_boxout: "Defensive boxouts", offensive_boxout: "Offensive boxouts",
    oreb_pool: "Offensive rebounds", steal: "Steals", ordinary_foul_penalty: "Foul cost",
    // V11's own thirteen evidence categories, said the way the rest of the
    // page says them rather than as the field names they arrive under.
    scoring: "Scoring", assists: "Assists", offensive_rebounds: "Offensive rebounds",
    screening: "Screen assists", secondary_creation: "Secondary creation",
    turnovers: "Turnovers", blocks: "Blocks", steals: "Steals and charges",
    charges: "Charges", defensive_rebounds: "Defensive rebounds",
    defensive_boxouts: "Defensive box-outs", fouls: "Fouls committed",
    defended_field_goals: "Shots he defended",
    // V12's two added categories.
    goaltending_penalty: "Goaltending penalty",
    // V13's contest pair. The funding side is what defended shots give up to
    // pay for the contests, so it is normally negative.
    contest_credit: "Contests",
    contest_funding: "Contest funding from defended shots",
  })[key] ?? String(key).replaceAll("_", " ");
}

function renderFingerprint(fingerprint = {}, summary = {}, payload = null) {
  const contextUnavailableNote = payload
    ? unavailableAnalyticsNote(payload, "Context effects", "context_decomposition")
    : "No context decomposition is published for this scope.";
  const responsibility = fingerprint.responsibility ?? {};
  const suppliedMix = fingerprint.responsibility_share ?? responsibility.shares ?? {};
  const split = {
    offense: responsibilityValue(responsibility, "offense"),
    defense: responsibilityValue(responsibility, "defense"),
    other: responsibilityValue(responsibility, "other"),
  };
  const splitTotal = split.offense + split.defense + split.other;
  const responsibilityMix = Object.values(suppliedMix).some((value) => Number.isFinite(Number(value)))
    ? suppliedMix
    : Object.fromEntries(Object.entries(split).map(([key, value]) => [key, splitTotal ? value / splitTotal : null]));
  const context = fingerprint.context ?? fingerprint.context_components ?? {};
  const finalValue = Number(summary.value_contributed ?? summary.vc ?? 0);
  const contextRows = contextFactorRows(context);
  const contextValues = Object.fromEntries(contextRows.map((row) => [row.label, finalValue ? row.value / finalValue : null]));
  const contextTotal = contextFactorTotal(context);
  // Raw is the same scope with all six factors switched off. V9 publishes it on
  // the fingerprint; V10 and V11 publish it on the scope row beside it.
  const rawValue = [fingerprint.raw_vc, summary.raw_no_context_value]
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number)[0];
  const sources = fingerprint.sources ?? [];
  const positiveRows = (fingerprint.leading_positive_sources?.length
    ? fingerprint.leading_positive_sources
    : sources.filter((row) => Number(row.value) > 0).sort((left, right) => Number(right.value) - Number(left.value))).slice(0, 6);
  const negativeRows = (fingerprint.leading_negative_sources?.length
    ? fingerprint.leading_negative_sources
    : sources.filter((row) => Number(row.value) < 0).sort((left, right) => Number(left.value) - Number(right.value))).slice(0, 6);
  const sourceValues = (rows) => Object.fromEntries(rows.map((row) => [sourceDisplayLabel(row.key), Number(row.value)]));
  byId("player-fingerprint").innerHTML = `
    <div class="fingerprint-card responsibility-fingerprint"><h3>Final responsibility mix</h3>${fingerprintBars(responsibilityMix, { asPercent: true })}</div>
    <div class="fingerprint-card context-fingerprint"><h3>Raw value, and the six context factors · percentage of final VC</h3>${contextRows.length
      ? `${fingerprintBars(contextValues, { asPercent: true })}<p>${rawValue === undefined
        ? ""
        : `Raw — what this scope would have been with all six switched off — is ${number(rawValue)}. Raw plus the six (${signedAmount(contextTotal)}) is the published ${number(finalValue)}. `}Exact context amounts: ${contextRows.map((row) => `${escapeHtml(row.label)} ${signedAmount(row.value)}`).join(" · ")}</p>`
      : `<p class="similarity-empty">${escapeHtml(contextUnavailableNote)}</p>`}</div>
    <div class="fingerprint-card"><h3>Leading positive value sources</h3>${positiveRows.length ? fingerprintBars(sourceValues(positiveRows)) : '<p class="similarity-empty">No positive governed sources in this scope.</p>'}</div>
    <div class="fingerprint-card"><h3>Leading negative value sources</h3>${negativeRows.length ? fingerprintBars(sourceValues(negativeRows)) : '<p class="similarity-empty">No negative governed sources in this scope.</p>'}</div>${reboundSplitCard(fingerprint.defensive_rebound_split)}`;
}

// V12 also stores its defensive rebounds and box-outs split by whether the
// rebound was contested. The two halves add back to those two categories, so
// they are drawn as a view of them, never as more value.
function reboundSplitSentence(split) {
  if (!split || !Number.isFinite(Number(split.contested))) return "";
  const contested = Number(split.contested);
  const uncontested = Number(split.uncontested ?? 0);
  return `Defensive rebounds and box-outs together are ${number(contested + uncontested)}: `
    + `${number(contested)} from contested rebounds and ${number(uncontested)} from uncontested ones. `
    + "This splits those two categories; it is not extra value.";
}

function reboundSplitCard(split) {
  const sentence = reboundSplitSentence(split);
  if (!sentence) return "";
  const values = {
    "Contested rebounds": Number(split.contested),
    "Uncontested rebounds": Number(split.uncontested ?? 0),
  };
  return `<div class="fingerprint-card"><h3>Defensive rebounds and box-outs, contested or not</h3>${fingerprintBars(values)}<p>${escapeHtml(sentence)}</p></div>`;
}

function footprintRows(rows) {
  return rows.map((row) => {
    const minutes = Number(row.minutes_played ?? row.minutes ?? 0);
    const scale = minutes > 0 ? 36 / minutes : 0;
    const responsibility = row.responsibility ?? row;
    return {
      ...row,
      minutes,
      offense_rate: Number(responsibilityValue(responsibility, "offense")) * scale,
      defense_rate: Number(responsibilityValue(responsibility, "defense")) * scale,
    };
  }).filter((row) => Number.isFinite(row.offense_rate) && Number.isFinite(row.defense_rate));
}

function renderFootprint(container, fallback, sourceRows, { labelFor, title, minMinutes = 0 }) {
  const rows = footprintRows(sourceRows).filter((row) => row.minutes >= minMinutes);
  if (!rows.length) {
    container.innerHTML = '<p class="similarity-empty">No season footprint is available for this scope.</p>';
    fallback.innerHTML = "";
    return;
  }
  const width = 920; const height = 470;
  const margin = { top: 34, right: 40, bottom: 64, left: 72 };
  const xValues = rows.map((row) => row.offense_rate);
  const yValues = rows.map((row) => row.defense_rate);
  const xMin = Math.min(0, ...xValues); const xMax = Math.max(0, ...xValues); const xRange = xMax - xMin || 1;
  const yMin = Math.min(0, ...yValues); const yMax = Math.max(0, ...yValues); const yRange = yMax - yMin || 1;
  const x = (value) => margin.left + (value - xMin) / xRange * (width - margin.left - margin.right);
  const y = (value) => margin.top + (yMax - value) / yRange * (height - margin.top - margin.bottom);
  const maxMinutes = Math.max(1, ...rows.map((row) => row.minutes));
  const ticks = Array.from({ length: 5 }, (_, index) => index / 4);
  container.innerHTML = `<p class="roster-map-status" aria-live="polite">${integer(rows.length)} players at or above ${integer(minMinutes)} minutes · hover or focus a face</p><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <defs>${rows.map((row, index) => { const radius = 8 + 21 * Math.sqrt(Math.max(0, row.minutes) / maxMinutes); return `<clipPath id="roster-face-${playerId(row)}-${index}"><circle cx="${x(row.offense_rate)}" cy="${y(row.defense_rate)}" r="${Math.max(1, radius - 2)}"/></clipPath>`; }).join("")}</defs>
    ${ticks.map((fraction) => { const value = xMin + xRange * fraction; return `<line class="grid-line" x1="${x(value)}" x2="${x(value)}" y1="${margin.top}" y2="${height - margin.bottom}"/><text x="${x(value)}" y="${height - margin.bottom + 22}" text-anchor="middle">${number(value, 2)}</text>`; }).join("")}
    ${ticks.map((fraction) => { const value = yMin + yRange * fraction; return `<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(value)}" y2="${y(value)}"/><text x="${margin.left - 10}" y="${y(value) + 4}" text-anchor="end">${number(value, 2)}</text>`; }).join("")}
    ${rows.map((row, index) => { const radius = 8 + 21 * Math.sqrt(Math.max(0, row.minutes) / maxMinutes); const color = COLORS[index % (COLORS.length - 1)]; const label = labelFor(row); const detail = `${label} · Offense ${number(row.offense_rate)} /36 · Defense ${number(row.defense_rate)} /36 · ${number(row.minutes, 0)} minutes`; return `<g class="footprint-point roster-face-mark" tabindex="0" data-roster-mark="${playerId(row)}" data-roster-detail="${escapeHtml(detail)}"><circle class="roster-face-back" cx="${x(row.offense_rate)}" cy="${y(row.defense_rate)}" r="${radius}" fill="${color}"/><text class="roster-face-initials" x="${x(row.offense_rate)}" y="${y(row.defense_rate) + 4}" text-anchor="middle">${escapeHtml(String(label).split(/\s+/u).slice(0, 2).map((part) => part[0]).join(""))}</text><image href="https://cdn.nba.com/headshots/nba/latest/260x190/${playerId(row)}.png" x="${x(row.offense_rate) - radius}" y="${y(row.defense_rate) - radius * .82}" width="${radius * 2}" height="${radius * 1.64}" preserveAspectRatio="xMidYMid slice" clip-path="url(#roster-face-${playerId(row)}-${index})"/><circle class="roster-face-outline" cx="${x(row.offense_rate)}" cy="${y(row.defense_rate)}" r="${radius}"/><title>${escapeHtml(detail)}</title></g>`; }).join("")}
    <text class="axis-title" x="${width / 2}" y="${height - 14}" text-anchor="middle">Offensive VC per 36</text>
    <text class="axis-title" x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})">Defensive VC per 36</text>
  </svg>`;
  const status = container.querySelector(".roster-map-status");
  const marks = [...container.querySelectorAll("[data-roster-mark]")];
  const applyHighlight = (active = null) => {
    container.classList.toggle("has-footprint-highlight", Boolean(active));
    marks.forEach((mark) => {
      mark.classList.toggle("is-highlighted", mark === active);
      mark.classList.toggle("is-muted", Boolean(active) && mark !== active);
    });
    status.textContent = active?.dataset.rosterDetail
      ?? `${integer(rows.length)} players at or above ${integer(minMinutes)} minutes · hover or focus a face`;
  };
  marks.forEach((mark) => {
    mark.addEventListener("pointerenter", () => applyHighlight(mark));
    mark.addEventListener("pointerleave", () => applyHighlight());
    mark.addEventListener("focusin", () => applyHighlight(mark));
    mark.addEventListener("focusout", () => applyHighlight());
    mark.addEventListener("touchend", () => applyHighlight(), { passive: true });
    mark.addEventListener("touchcancel", () => applyHighlight(), { passive: true });
  });
  container.addEventListener("pointerleave", () => applyHighlight());
  fallback.innerHTML = `<details><summary>View footprint as a table</summary><div class="table-wrap"><table><thead><tr><th>Player / season</th><th>Offense / 36</th><th>Defense / 36</th><th>Minutes</th></tr></thead><tbody>${rows.map((row) => `<tr><th>${escapeHtml(labelFor(row))}</th><td>${number(row.offense_rate)}</td><td>${number(row.defense_rate)}</td><td>${number(row.minutes, 0)}</td></tr>`).join("")}</tbody></table></div></details>`;
  renderMobileScatter(container, rows.map(row=>({...row,player_id:playerId(row),player_name:labelFor(row),_offenseRaw:row.offense_rate,_defenseRaw:row.defense_rate})),{unit:'VC / 36',hrefFor:row=>entityUrl('players',row.player_id)});

}

function renderTeamRosterStory(payload) {
  const mapPanel = byId("team-roster-map-panel");
  const turnoverPanel = byId("team-turnover-panel");
  mapPanel.hidden = !scopeIsExact();
  turnoverPanel.hidden = !scopeIsMulti();
  if (scopeIsExact()) {
    const minimumMinutes = Number(byId("team-roster-map-minutes").value || 0);
    renderFootprint(byId("team-roster-map"), byId("team-roster-map-fallback"), payload.players ?? payload.roster?.rows ?? [], {
      labelFor: (row) => row.player_name,
      title: `${selectedScopeLabel()} roster construction map`,
      minMinutes: minimumMinutes,
    });
  }
  if (!scopeIsMulti()) return;
  const rosters = payload.season_rosters ?? [];
  const transitions = rosters.slice(1).map((current, index) => {
    const previous = rosters[index];
    const previousIds = new Set(previous.players.map((row) => Number(row.player_id)));
    const currentIds = new Set(current.players.map((row) => Number(row.player_id)));
    const previousMinutes = previous.players.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0);
    const currentMinutes = current.players.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0);
    const returningCurrent = current.players.filter((row) => previousIds.has(Number(row.player_id)));
    const departing = previous.players.filter((row) => !currentIds.has(Number(row.player_id)));
    const arriving = current.players.filter((row) => !previousIds.has(Number(row.player_id)));
    return {
      from: previous.season, to: current.season,
      returning: currentMinutes ? returningCurrent.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0) / currentMinutes : 0,
      departing: previousMinutes ? departing.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0) / previousMinutes : 0,
      arriving: currentMinutes ? arriving.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0) / currentMinutes : 0,
      returningNames: returningCurrent.sort((left, right) => Number(right.minutes) - Number(left.minutes)).slice(0, 5).map((row) => row.player_name),
    };
  });
  byId("team-turnover-chart").innerHTML = transitions.length ? transitions.map((row) => `<article class="turnover-card"><div class="turnover-card-head"><strong>${escapeHtml(row.from)} → ${escapeHtml(row.to)}</strong><span>${percent(row.returning)} returning minutes</span></div><div class="turnover-bar" aria-label="${percent(row.returning)} returning and ${percent(row.arriving)} arriving minutes"><span class="returning" style="width:${Math.max(0, Math.min(100, row.returning * 100))}%"></span><span class="arriving" style="width:${Math.max(0, Math.min(100, row.arriving * 100))}%"></span></div><dl><div><dt>Returning</dt><dd>${percent(row.returning)}</dd></div><div><dt>Arriving</dt><dd>${percent(row.arriving)}</dd></div><div><dt>Departing from prior year</dt><dd>${percent(row.departing)}</dd></div></dl><p>${row.returningNames.length ? `Largest returning roles: ${escapeHtml(row.returningNames.join(", "))}` : "No players returned from the prior selected season."}</p></article>`).join("") : '<p class="similarity-empty">Choose at least two seasons with roster data to see turnover.</p>';
}

function renderPlayer(payload) {
  const answered = payload.v10?.selection?.profile_season ?? null;
  const covers = (payload.v10?.selection?.page_seasons ?? []).length;
  if (covers > 1 && answered && answered !== state.profileSeason) {
    state.profileSeason = answered;
    syncUrl("replace");
  }
  if (covers <= 1 && state.profileSeason) {
    state.profileSeason = null;
    syncUrl("replace");
  }
  renderSource(payload.source);
  showHero(false);
  elements.directory.hidden = true;
  hideTeamLandscapePanel();
  elements.teamProfile.hidden = true;
  elements.playerProfile.hidden = false;
  const entity = payload.entity ?? payload.player;
  const summary = payload.summary ?? {};
  if (fixedPlayerPage()) placeSearch("player-hero-search");
  else {
    placeControls("player-hero");
    updateMobileFilterScope();
  }
  byId("player-summary-title").textContent = scopeIsAll()?"Career at a glance":`${selectedScopeLabel()} at a glance`;
  byId("player-name").textContent = entity.player_name;
  document.title = `${entity.player_name} · ${sourceTitle(payload.source)} Player Analytics`;
  byId("player-headshot").src = entity.headshot_url ?? `https://cdn.nba.com/headshots/nba/latest/1040x760/${entity.player_id}.png`;
  byId("player-headshot").alt = `${entity.player_name} headshot`;
  byId("player-headshot").onerror = () => { byId("player-headshot").onerror = null; byId("player-headshot").src = FALLBACK_HEADSHOT; };
  const dataSpan = entity.data_span ? `${entity.data_span.from}–${entity.data_span.to}`
    : [entity.first_game_date, entity.last_game_date].filter(Boolean).join("–");
  byId("player-identity").textContent = dataSpan ? `Data span ${dataSpan}` : "";
  const teams = entity.teams ?? [];
  byId("player-team-links").innerHTML = teams.map((item) => `<a class="entity-pill" href="${entityUrl("teams", teamId(item))}">${escapeHtml(teamName(item))}</a>`).join("");
  const playerCompareLink = byId("player-compare-link");
  if (playerCompareLink) playerCompareLink.href = comparisonUrl("players", entity.player_id, entity.player_name);
  byId("player-summary").innerHTML = [
    summaryCard("Games", integer(summary.games ?? summary.games_played), summary.value_evidence_rows ? `${integer(summary.value_evidence_rows)} value rows` : "True appearances"),
    summaryCard("Value Contributed", number(summary.value_contributed ?? summary.vc)),
    summaryCard("Wins Contributed", number(summary.wins_contributed ?? summary.wc)),
    summaryCard("VC / game", number(summary.value_per_game ?? summary.vc_per_game)),
    summaryCard(`${elements.metric.value === "wins_contributed" ? "WC" : "VC"} rank`, summary.rank ?? summary.relevant_rank ? `#${integer(summary.rank ?? summary.relevant_rank)}` : "—"),
  ].join("");
  renderPlayerContributionChart(payload);
  renderCareerTable(payload);
  renderFingerprint(payload.fingerprint, summary, payload);
  renderV10Analytics(payload, "player");
}

function renderV10Dimensions(rows, targetId) {
  // The player page has no measurement table (removed 2026-09-27).
  if (!byId(targetId)) return;
  byId(targetId).innerHTML = rows.length ? rows.map((row) => {
    const stateLabel = !row.available ? "Missing / unavailable"
      : Number(row.availability_coverage) < 1 ? `Partial · ${percent(row.availability_coverage)}`
        : "Available";
    const resolution = row.available
      ? (row.availability_rule ?? "measured or governed")
      : "Not treated as zero";
    return `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.concept_group.replaceAll("_", " "))}</td><td class="numeric">${row.available ? number(row.value) : "—"}</td><td>${escapeHtml(stateLabel)}</td><td>${escapeHtml(resolution)}</td></tr>`;
  }).join("") : '<tr><td colspan="5">No V10 dimensions are available for this scope.</td></tr>';
}

function conceptRadar(rows, targetId) {
  const grouped = new Map();
  rows.filter((row) => row.available && row.similarity_eligible).forEach((row) => {
    const values = grouped.get(row.concept_group) ?? [];
    const comparable = Number(row.similarity_value);
    if (Number.isFinite(comparable)) values.push(Math.abs(comparable));
    grouped.set(row.concept_group, values);
  });
  const axes = [...grouped].filter(([, values]) => values.length).map(([key, values]) => ({
    key,
    value: values.reduce((sum, value) => sum + value, 0) / values.length,
  }));
  const target = byId(targetId);
  if (axes.length < 3) { target.innerHTML = '<p class="similarity-empty">Comparable concept coverage is insufficient.</p>'; return; }
  const maximum = Math.max(...axes.map((row) => row.value), 1e-12);
  const center = 160; const radius = 112;
  const point = (index, scale = 1) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length;
    return [center + Math.cos(angle) * radius * scale, center + Math.sin(angle) * radius * scale];
  };
  const polygon = axes.map((row, index) => point(index, row.value / maximum).join(",")).join(" ");
  target.innerHTML = `<svg viewBox="0 0 320 320" role="img" aria-label="Population-normalized concept magnitude">${[.25,.5,.75,1].map((scale) => `<polygon class="v10-radar-grid" points="${axes.map((_row,index) => point(index,scale).join(",")).join(" ")}"/>`).join("")}<polygon class="v10-radar-shape" points="${polygon}"/>${axes.map((row,index) => { const [x,y]=point(index,1.13); return `<text x="${x}" y="${y}" text-anchor="middle">${escapeHtml(row.key.replaceAll("_"," "))}</text>`; }).join("")}</svg><p class="chart-note">Axes use population-normalized dimension magnitudes, so seconds and value units cannot overwhelm the other concepts. Exact catalog values and missing states remain in the table.</p>`;
}

function scatterPlot(v10, targetId, kind) {
  const target = v10?.archetype;
  const points = [
    ...(target && Number.isFinite(Number(target.x)) && Number.isFinite(Number(target.y))
      ? [{ x:Number(target.x), y:Number(target.y), label:"Selected", selected:true }] : []),
    ...(v10?.similarity?.matches ?? []).filter((row) => Number.isFinite(Number(row.candidate_x)) && Number.isFinite(Number(row.candidate_y))).map((row) => ({
      x:Number(row.candidate_x), y:Number(row.candidate_y),
      label:kind === "player" ? row.candidate_player_name : row.candidate_team_name,
      selected:false,
    })),
  ];
  const container = byId(targetId);
  if (!points.length) { container.innerHTML = '<p class="similarity-empty">The frozen two-axis projection is unavailable for this scope.</p>'; return; }
  const xValues=points.map((row)=>row.x); const yValues=points.map((row)=>row.y);
  const minX=Math.min(...xValues); const maxX=Math.max(...xValues); const minY=Math.min(...yValues); const maxY=Math.max(...yValues);
  const scale=(value,min,max)=>30+(max===min ? .5 : (value-min)/(max-min))*260;
  container.innerHTML=`<svg viewBox="0 0 320 320" role="img" aria-label="Frozen two-axis projection with nearest neighbors"><line x1="30" x2="290" y1="160" y2="160"/><line x1="160" x2="160" y1="30" y2="290"/>${points.map((row)=>`<g class="${row.selected?"is-selected":"is-neighbor"}"><circle cx="${scale(row.x,minX,maxX)}" cy="${320-scale(row.y,minY,maxY)}" r="${row.selected?8:5}"/><title>${escapeHtml(row.label)} · ${number(row.x,2)}, ${number(row.y,2)}</title></g>`).join("")}</svg><ul class="v10-scatter-key"><li><strong>Selected profile</strong></li>${points.filter((row)=>!row.selected).map((row)=>`<li>${escapeHtml(row.label)}</li>`).join("")}</ul>`;
}

function archetypeTraitLabel(trait) {
  if (trait === null || trait === undefined) return "";
  if (typeof trait !== "object") return String(trait);
  const direction = String(trait.direction ?? "").trim();
  const dimension = String(trait.dimension_key ?? trait.key ?? "")
    .replaceAll("_", " ")
    .replaceAll(".", " · ");
  return [direction, dimension].filter(Boolean).join(" ");
}

// Panels the selected statistic does not publish say so in one plain sentence
// instead of drawing an empty radar, a blank scatter or a NaN table.
function unavailableAnalyticsNote(payload, what, key = null) {
  // A source that explains itself is quoted; otherwise one short sentence.
  const supplied = String(payload?.v10?.availability?.[key]?.reason ?? "").trim();
  if (supplied.includes(" ")) return supplied;
  const label = sourceTitle(payload?.source) || "This statistic";
  return `${what} are not available for ${label}. Choose V10 or V9 to see them.`;
}

// --- V11 styles on the entity pages --------------------------------------------

// Colours for groups a payload names that V11 never drew (V12's sections).
const WHEEL_GROUP_COLORS = Object.freeze(["#1f6b50", "#8a4a24", "#337a87", "#826618", "#315e79", "#805b77", "#65537c"]);

// The four sides of a description, in the order the wheel draws them.
const CONCEPT_GROUPS = Object.freeze([
  { key: "offence", label: "Offense", color: "#1f6b50" },
  { key: "defence", label: "Defense", color: "#315e79" },
  { key: "role_and_shape", label: "Role", color: "#8a4a24" },
  { key: "shot_and_lineup_mix", label: "Shot mix", color: "#65537c" },
]);

function styleProfile(payload) {
  const catalog = styleCatalog(payload?.v10?.style_types);
  return catalog ? { catalog, archetype: payload.v10.archetype ?? null } : null;
}

function styleChip(block, catalog) {
  if (!block) return "";
  const type = catalog?.typeById.get(String(block.id));
  const visual = type ?? styleVisual(block.id);
  const label = block.label ?? type?.label ?? "";
  if (!label) return "";
  return `<span class="style-chip" style="--style-color:${escapeHtml(visual.color)}">${escapeHtml(visual.badge)} ${escapeHtml(label)}</span>`;
}

// A defining measurement, said the way a person would say it.
function styleTraitLabel(trait) {
  if (!trait || typeof trait !== "object") return archetypeTraitLabel(trait);
  const measurement = String(trait.dimension_key ?? trait.key ?? "")
    .replace(/ — share of shots$/u, "")
    .toLocaleLowerCase();
  if (!measurement) return "";
  return `${String(trait.direction) === "low" ? "less" : "more"} ${measurement}`;
}

function renderStyleCallout(targetId, archetype, catalog, kind, selection = null) {
  const target = byId(targetId);
  if (!archetype) {
    target.textContent = kind === "team"
      ? "This team season is outside the style model's coverage."
      : "This player season is outside the style model's coverage.";
    return;
  }
  const type = catalog.typeById.get(String(archetype.id));
  const traits = (archetype.traits ?? []).map(styleTraitLabel).filter(Boolean);
  const fit = confidenceWords(archetype.confidence);
  const thin = archetype.provisional
    ? ` This is a thin record: below ${integer(catalog.minimumMinutes)} minutes the shape is pulled toward the average ${kind === "team" ? "team" : "player"}, and the type is assigned rather than fitted.`
    : "";
  // A selection of several seasons is one described span now, so the callout
  // says how a span is typed rather than warning that only one season is
  // described. A statistic that cannot answer for a span keeps the warning.
  // A team page says which season the profile describes in its own scope line
  // under the strip, so the callout does not say it twice.
  const scope = selection?.spans_more_than_one_season
    ? ` ${selection.type_rule ?? "A span is typed as the type it spent most of its minutes in."}`
    : kind !== "team" && !scopeIsExact() && archetype.season
      ? ` Every panel below describes ${archetype.season}: ${String(elements.source.value || "v11").toUpperCase()} describes one season at a time.`
      : "";
  target.innerHTML = `<span class="style-callout-head">${styleChip(archetype, catalog)}<strong>${escapeHtml(fit)}</strong>${archetype.season ? `<em>${escapeHtml(archetype.season)}</em>` : ""}</span><span>${escapeHtml(type?.description ?? archetype.description ?? "")}${traits.length ? ` Stands out for: ${escapeHtml(traits.join(", "))}.` : ""}${escapeHtml(thin)}${escapeHtml(scope)}</span>`;
}

// The season-by-season strip. On a player page it is a record of how his type
// moved. On a team page it is also the control that chooses which season the
// profile below describes, so each card is a real button: it can be clicked or
// reached with the keyboard, and it says which one is chosen.
function renderTypeHistory(targetId, history, catalog, {
  selectable = false, selectedSeason = undefined, label: heading = null,
} = {}) {
  const target = byId(targetId);
  if (!target) return;
  // A player page marks the season its profile describes itself; a team page
  // is told by the server which row that is.
  const rows = (history ?? []).map((row) => (selectedSeason === undefined
    ? row : { ...row, selected: String(row.season ?? "") === String(selectedSeason ?? "") }));
  if (!rows.length) { target.innerHTML = ""; target.hidden = true; return; }
  target.hidden = false;
  target.classList.toggle("is-selectable", Boolean(selectable));
  target.classList.toggle("has-choice", selectedSeason !== undefined && rows.some((row) => row.selected));
  const label = heading ?? (selectable
    ? "Season by season · choose the season the profile describes"
    : "Season by season");
  target.innerHTML = `<span class="style-history-label">${escapeHtml(label)}</span><ol>${rows.map((row) => {
    const type = catalog.typeById.get(String(row.id));
    const visual = type ?? styleVisual(row.id);
    const season = String(row.season ?? "");
    const name = `${row.label ?? type?.label ?? ""}${row.provisional ? " · thin record" : ""}`;
    const inner = `<i aria-hidden="true">${escapeHtml(visual.badge)}</i><b>${escapeHtml(season)}</b><small>${escapeHtml(name)}</small>`;
    const classes = [row.provisional ? "is-provisional" : "", row.selected ? "is-selected" : ""]
      .filter(Boolean).join(" ");
    if (!selectable) {
      return `<li${classes ? ` class="${classes}"` : ""} style="--style-color:${escapeHtml(visual.color)}">${inner}</li>`;
    }
    // On a player page the chosen season is also the way back: choosing it
    // again returns the profile to every season.
    const target = row.selected && selectedSeason !== undefined ? "" : season;
    const words = target ? "Describe " : "Back to every season from ";
    return `<li${classes ? ` class="${classes}"` : ""} style="--style-color:${escapeHtml(visual.color)}"><button type="button" data-profile-season="${escapeHtml(target)}" aria-pressed="${row.selected ? "true" : "false"}"${row.selected ? ' aria-current="true"' : ""}><span class="sr-only">${words}</span>${inner}</button></li>`;
  }).join("")}</ol>`;
}

// One spoke per measurement, grouped by side, each drawn at this entity's
// percentile inside its own season. The middle ring is the league's median.
function renderProfileWheel(targetId, dimensions, catalog, noteId, wheelGroups = null) {
  const target = byId(targetId);
  // A payload that names its own groups (V12's five value sections, then Role
  // and Shot mix) is drawn in those groups; V11 keeps its four.
  const groupsInUse = wheelGroups?.length
    ? wheelGroups.map((group, index) => ({
      key: String(group.key),
      label: String(group.label ?? group.key),
      color: CONCEPT_GROUPS.find((known) => known.key === String(group.key))?.color
        ?? WHEEL_GROUP_COLORS[index % WHEEL_GROUP_COLORS.length],
    }))
    : CONCEPT_GROUPS;
  const rows = (dimensions ?? [])
    .filter((row) => row.available && Number.isFinite(Number(row.percentile)))
    .map((row) => ({
      label: String(row.label ?? row.key),
      group: String(row.concept_group ?? "role_and_shape"),
      percentile: Number(row.percentile),
      per36: Number(row.per36 ?? row.value),
    }));
  const ordered = groupsInUse.flatMap((group) => rows.filter((row) => row.group === group.key));
  const extra = rows.filter((row) => !groupsInUse.some((group) => group.key === row.group));
  const spokes = [...ordered, ...extra];
  if (spokes.length < 6) {
    target.innerHTML = '<p class="similarity-empty">Too few measurements are recorded in this scope to draw a profile.</p>';
    if (noteId) byId(noteId).textContent = "";
    return;
  }
  const size = 460; const centre = size / 2; const radius = 150;
  const point = (index, scale) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / spokes.length;
    return [centre + Math.cos(angle) * radius * scale, centre + Math.sin(angle) * radius * scale];
  };
  const rings = [0.25, 0.5, 0.75, 1].map((scale) => `<circle class="style-wheel-ring${scale === 0.5 ? " is-middle" : ""}" cx="${centre}" cy="${centre}" r="${radius * scale}"/>`).join("");
  const shape = spokes.map((row, index) => point(index, spokeScale(row.percentile)).map((value) => value.toFixed(1)).join(",")).join(" ");
  const groupColor = (key) => groupsInUse.find((group) => group.key === key)?.color ?? "#607068";
  const lines = spokes.map((row, index) => {
    const [x, y] = point(index, 1);
    const [tipX, tipY] = point(index, spokeScale(row.percentile));
    return `<line class="style-wheel-spoke" x1="${centre}" y1="${centre}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><circle class="style-wheel-dot" cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="3.2" fill="${groupColor(row.group)}"><title>${escapeHtml(row.label)}: ${escapeHtml(percent(row.percentile))} of the league that season, ${escapeHtml(number(row.per36, 2))} per 36</title></circle>`;
  }).join("");
  const labels = groupsInUse.map((group) => {
    const indexes = spokes.map((row, index) => row.group === group.key ? index : -1).filter((index) => index >= 0);
    if (!indexes.length) return "";
    const middle = indexes[Math.floor(indexes.length / 2)];
    const [x, y] = point(middle, 1.23);
    return `<text class="style-wheel-group" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" fill="${group.color}">${escapeHtml(group.label)}</text>`;
  }).join("");
  target.innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Profile against the league, ${spokes.length} measurements">${rings}${lines}<polygon class="style-wheel-shape" points="${shape}"/>${labels}</svg>`;
  if (noteId) {
    const grouping = wheelGroups?.length
      ? groupsInUse.map((group) => group.label.toLowerCase()).join(", ")
      : "offense, defense, role and shot mix";
    byId(noteId).textContent = `Each spoke is one of the ${spokes.length} measurements, grouped by ${grouping}. The distance from the centre is where this ${targetId.startsWith("team") ? "team season" : "season"} sits among the league that season; the darker middle ring is the league's midpoint. Exact numbers are in the measurement table below.`;
  }
}

// A free-throw row carries both halves of every trip, so the bar says what the
// good trips added and what the short ones took back instead of showing only
// the part that hurt.
function renderTypeMix(dimensions, catalog) {
  const panel = byId("team-type-mix-panel");
  if (!panel) return;
  const rows = (dimensions ?? [])
    .filter((row) => String(row.key ?? "").startsWith("type_minute_share_") && row.available)
    .map((row) => {
      const id = String(row.key).slice("type_minute_share_".length);
      const type = catalog.typeById.get(id);
      return {
        id, share: Number(row.value),
        label: type?.label ?? String(row.label ?? id).replace(/^Minutes played by an? /iu, ""),
        ...(type ?? styleVisual(id)),
      };
    })
    .filter((row) => Number.isFinite(row.share) && row.share > 0)
    .sort((left, right) => right.share - left.share);
  panel.hidden = !rows.length;
  if (!rows.length) return;
  byId("team-type-mix").innerHTML = `<div class="type-mix-bar" role="img" aria-label="${escapeHtml(rows.map((row) => `${row.label} ${percent(row.share)}`).join(", "))}">${rows.map((row) => `<span style="width:${(row.share * 100).toFixed(2)}%;background:${escapeHtml(row.color)}" title="${escapeHtml(row.label)} ${escapeHtml(percent(row.share))}"></span>`).join("")}</div><ul class="type-mix-key">${rows.map((row) => `<li><i style="background:${escapeHtml(row.color)}" aria-hidden="true"></i>${escapeHtml(row.label)}<b>${escapeHtml(percent(row.share))}</b></li>`).join("")}</ul>`;
  byId("team-type-mix-note").textContent = "The share of this team's player minutes played by each type. A player's type is his own season, so the mix is the roster the coach actually used.";
}

// --- the profile area ------------------------------------------------------------
//
// One place, organised the way the evidence is: what he scored, what his
// passing created, what he did on the glass, what he defended, the shots he was
// nearest to, what the game around him did to the number, and where he lost
// value. Every block covers exactly the seasons the picker has selected, and
// each says so.

// Which seasons every block below is about, in words rather than by implication.
function renderProfileScope(targetId, selection, kind) {
  const target = byId(targetId);
  if (!target) return;
  const seasons = selection?.seasons ?? [];
  if (!seasons.length) { target.hidden = true; target.textContent = ""; return; }
  // A team profile is one season, whatever the page has selected, so it names
  // that season and says where the other scope lives rather than implying the
  // blocks below cover everything the picker has ticked.
  if (kind === "team") {
    const profile = selection.profile_season ?? seasons.at(-1);
    target.hidden = false;
    target.textContent = [
      `Every block below describes ${profile} alone.`,
      selection.rule ?? "",
      seasons.length > 1
        ? `Choose another of the ${seasons.length} selected seasons from the strip above; the team totals, the roster and the contribution chart cover all ${seasons.length}.`
        : "",
    ].filter(Boolean).join(" ");
    return;
  }
  const span = seasons.length === 1
    ? seasons[0]
    : `${seasons[0]}–${seasons.at(-1)} · ${seasons.length} seasons`;
  const rule = selection?.spans_more_than_one_season
    ? (selection.rule ?? "Every value, attempt and minute is summed over the selected seasons.")
    : "";
  // The Players page chooses the similar players' season in their own panel,
  // so the profile's one-season rule for them would say something untrue.
  const similarity = fixedPlayerPage() ? "" : (selection?.similarity_rule ?? "");
  // The page has two scopes once a reader clicks a season: the selection its
  // controls chose, which the totals and the chart keep, and the one season
  // the described blocks cover. The line says which, and offers the way back.
  const page = selection?.page_seasons ?? seasons;
  const narrowed = page.length > seasons.length;
  const wholeSelection = page.length === 1
    ? page[0]
    : `${page[0]}–${page.at(-1)} · ${page.length} seasons`;
  target.hidden = false;
  target.innerHTML = [
    `<b>Profile: ${escapeHtml(span)}.</b>`,
    escapeHtml([
      narrowed
        ? `The totals, the chart and the top games above cover ${wholeSelection}.`
        : "Every block below covers it.",
      rule,
      similarity,
    ].filter(Boolean).join(" ")),
    narrowed
      ? `<button type="button" class="profile-scope-reset" data-profile-season="">${fixedPlayerPage() ? `Back to all ${page.length} seasons` : `Show all ${page.length} selected seasons`}</button>`
      : "",
  ].filter(Boolean).join(" ");
}

// The mix and the evidence categories the old fingerprint panel carried, kept
// here rather than lost when that panel is replaced by the sections below.
function renderProfileOverview(targetId, payload, kind) {
  const target = byId(targetId);
  if (!target) return;
  const fingerprint = payload.fingerprint ?? {};
  const responsibility = fingerprint.responsibility ?? {};
  const split = {
    Offense: responsibilityValue(responsibility, "offense"),
    Defense: responsibilityValue(responsibility, "defense"),
    Other: responsibilityValue(responsibility, "other"),
  };
  const total = Object.values(split).reduce((sum, value) => sum + Number(value || 0), 0);
  const mix = Object.entries(split).filter(([, value]) => Number.isFinite(Number(value)));
  void kind;
  target.innerHTML = `
    <div class="profile-overview-card is-wide">
      <h3>How the value splits</h3>
      ${total ? `<div class="profile-mix-bar" role="img" aria-label="${escapeHtml(mix.map(([label, value]) => `${label} ${percent(Number(value) / total)}`).join(", "))}">${mix.map(([label, value], index) => `<span class="profile-mix-part part-${index}" style="width:${Math.max(0, Number(value) / total * 100).toFixed(2)}%" title="${escapeHtml(label)} ${escapeHtml(percent(Number(value) / total))}"></span>`).join("")}</div>
      <ul class="profile-mix-key">${mix.map(([label, value], index) => `<li><i class="part-${index}" aria-hidden="true"></i>${escapeHtml(label)}<b>${escapeHtml(percent(Number(value) / total))}</b></li>`).join("")}</ul>`
        : '<p class="similarity-empty">No offense, defense and other split is published for this scope.</p>'}
    </div>`;
}

// One radar, drawn by the shared model so the comparison page's overlay and
// this page's single shape are the same chart with one series or four. Every
// label is printed in full, wrapped onto up to three lines, and the box
// reserves the room the longest one needs.
function radarSvg(slide, { noun = "players", label = "", mobile = false } = {}) {
  return radarChartMarkup(slide.spokes, [{
    name: "",
    // The cost chart is drawn in the warm ink its title and its banner use, so
    // the one chart that reads the other way round never looks like the six
    // that read "more is better".
    color: slide.orientation === "cost" ? "#8a2d2d" : "#28755d",
    marker: "circle",
    readings: slide.spokes.map((spoke) => ({
      present: true, reach: spoke.outward, per36: spoke.per36, value: spoke.value,
      // Only V12's shot types, locations and free throws carry these.
      makes: spoke.makes_per36, misses: spoke.misses_per36,
    })),
  }], {
    noun,
    orientation: slide.orientation,
    comparison: slide.comparison,
    ariaLabel: label,
    ...(mobile ? {radius:72, type:{...PHONE_LABEL_TYPE,size:14,lineHeight:16,charWidth:8.5,maxChars:10,maxLines:4}} : {}),
  });
}

// What the rings mean, said in words under every chart that has rings, with
// the cost chart's own reversed wording.
function ringNote(orientation, noun) {
  const words = ringWords(orientation);
  const middle = orientation === "cost"
    ? `the shots and habits of the middle ${noun === "team seasons" ? "team season" : "player"}`
    : "the league's midpoint";
  return `The rings are the league: the heavier middle ring is ${middle} (${words[50]}), `
    + `and the faint pair either side are ${words[25]} and ${words[75]}. `
    + "A spoke never reaches the exact centre, so a shape is always readable.";
}

// The context amounts are six small signed season totals, so the slide draws
// bars either side of zero rather than a shape, and prints the arithmetic that
// has to close: before, plus the six, is the published total.
function contextSlideMarkup(slide, entries, series, { unit, seriesAttribute = null } = {}) {
  const model = contextBarsModel(entries);
  if (!model.rows.length) {
    return '<p class="chart-note">No context amounts are published for this selection.</p>';
  }
  // Raw, plus what the context did, is the published total — printed so the
  // sum closes on screen rather than being claimed in a caption.
  const heads = model.totals.map((row, index) => {
    const swatch = series.length > 1
      ? `<i class="context-swatch" style="--series-color:${escapeHtml(series[index]?.color ?? "")}" aria-hidden="true"></i>`
      : "";
    const who = row.name ? `<b>${escapeHtml(row.name)}</b>` : "";
    return `<li>${swatch}${who}<span><b>${escapeHtml(number(row.raw, 2))}</b> before context ${row.context >= 0 ? "+" : "−"} <b>${escapeHtml(number(Math.abs(row.context), 2))}</b> from the six factors = <b>${escapeHtml(number(row.total, 2))}</b> published</span></li>`;
  }).join("");
  return `<div class="context-close-wrap"><ul class="context-close">${heads}</ul>`
    + `<p class="chart-note">Amounts are ${escapeHtml(unit)} over ${escapeHtml(slide.spanWords ?? "the selected seasons")}, signed: to the right the factor added value, to the left it took value away.</p></div>`
    + contextBarsPair(model, series, { unit, seriesAttribute });
}

// A carousel of radars: one visible at a time, moved with the arrows, the dots
// or the keyboard, each with its title and one sentence saying how to read it.
function renderRadarCarousel(kind, slides, {
  poolNote, maskedNote, wheel, contextUnit = "Value Contributed", spanWords = "",
  afterSlide = null, start = 0,
}) {
  const noun = kind === "team" ? "team seasons" : "players";
  const host = byId(`${kind}-radar-carousel`);
  const panel = byId(`${kind}-radar-panel`);
  if (!host || !panel) return;
  panel.hidden = !slides.length;
  if (!slides.length) { host.innerHTML = ""; return; }
  host.innerHTML = `
    <div class="radar-carousel-head">
      <button type="button" class="radar-step" data-radar-step="-1" aria-label="Previous chart">‹</button>
      <div class="radar-dots" role="tablist" aria-label="Choose a chart">${slides.map((slide, index) => `<button type="button" role="tab" class="radar-dot-button" data-radar-go="${index}" aria-selected="${index === 0}" aria-controls="${kind}-radar-slide" title="${escapeHtml(slide.label)}"><span class="sr-only">${escapeHtml(slide.label)}</span></button>`).join("")}</div>
      <button type="button" class="radar-step" data-radar-step="1" aria-label="Next chart">›</button>
    </div>
    <div class="radar-slide" id="${kind}-radar-slide" role="tabpanel" tabindex="0" aria-live="polite"></div>`;
  const slideHost = host.querySelector(".radar-slide");
  const dots = [...host.querySelectorAll("[data-radar-go]")];
  let current = Math.min(Math.max(0, start), slides.length - 1);
  const draw = () => {
    const slide = slides[current];
    dots.forEach((dot, index) => dot.setAttribute("aria-selected", String(index === current)));
    const omitted = slide.omitted.length
      ? `<p class="radar-omitted">Not drawn, because these seasons record no comparison for ${escapeHtml(kind === "team" ? "them" : "him")}: ${escapeHtml(slide.omitted.join(", "))}.</p>`
      : "";
    // A measurement almost nobody records is a tie at one number, and a place
    // in a tie is not a reading, so it is a table row rather than a spoke.
    const tied = (slide.tied ?? []).length
      ? `<p class="radar-omitted">Left off the chart because ${escapeHtml(kind === "team" ? "they are" : "he is")} level with most of the league here, which is not a place in it: ${escapeHtml(slide.tied.join(", "))}.</p>`
      : "";
    const trimmed = slide.available > slide.shown
      ? ` The ${slide.shown} spokes drawn are the first ${slide.shown} of the ${slide.available} the profile publishes, in the same order for everyone; all of them are in the table.`
      : "";
    // The numbers used to sit in a disclosure under every chart, and every
    // chart had one, which buried the picture in tables. Each vertex still
    // carries its own reading on hover and on focus, so a number is one
    // pointer away rather than one page of tables away.
    const body = slide.kind === "wheel"
      ? `<div class="radar-wheel-host" id="${kind}-radar-overall"></div><p class="chart-note" id="${kind}-radar-overall-note"></p>`
      : slide.kind === "radar"
        ? `<div class="radar-figure desktop-profile-radar">${radarSvg(slide, { noun, label: `${slide.label}, ${slide.shown} measurements` })}</div><div class="radar-figure mobile-profile-radar">${radarSvg(slide, { noun, label: `${slide.label}, ${slide.shown} measurements`, mobile:true })}<p class="mobile-radar-value" aria-live="polite" hidden></p></div><p class="radar-rings">${escapeHtml(ringNote(slide.orientation, noun))} Point at a spoke, or move the keyboard focus to it, for its own number.</p>`
        : slide.kind === "bars"
          ? `<div class="radar-figure is-wide is-stack">${contextSlideMarkup({ ...slide, spanWords }, [{ name: "", section: { axes: slide.axes } }], [{ name: "", color: "#28755d" }], { unit: contextUnit })}</div>`
          : `<div class="radar-figure is-wide is-stack">${levelBarsMarkup(slide.spokes, [{ name: "", color: "#28755d", readings: slide.spokes.map((spoke) => ({ present: true, reach: spoke.outward })) }], { noun, orientation: slide.orientation })}</div><p class="chart-note">Fewer than three measurements can be compared here, so they are bars rather than a shape.</p>`;
    slideHost.innerHTML = `
      <div class="radar-slide-head">
        <h4>${escapeHtml(slide.label)} <span class="radar-slide-count">${current + 1} of ${slides.length}</span></h4>
        <p class="radar-how${slide.orientation === "cost" ? " is-cost" : ""}">${escapeHtml(slide.howToRead)}${escapeHtml(trimmed)}</p>
      </div>
      ${body}
      ${typeof afterSlide === "function" ? afterSlide(slide) : ""}
      ${omitted}${tied}
      <p class="radar-pool">${escapeHtml(slide.percentileRule || poolNote)}</p>
      ${maskedNote ? `<p class="radar-pool">${escapeHtml(maskedNote)}</p>` : ""}`;
    slideHost.classList.toggle("is-cost", slide.orientation === "cost");
    const mobileRadar=slideHost.querySelector('.mobile-profile-radar');
    if(mobileRadar) {
      let selected=null;
      const readout=mobileRadar.querySelector('.mobile-radar-value');
      mobileRadar.querySelectorAll('[tabindex]').forEach(mark=>{
        const choose=()=>{selected=selected===mark?null:mark;readout.hidden=!selected;readout.textContent=selected?.querySelector('title')?.textContent??selected?.getAttribute('aria-label')??'';};
        mark.addEventListener('click',choose);
        mark.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();choose();}});
      });
    }
    // On a phone the slide's notes (how to read it, the rings, what was left
    // off, and who it is compared with) fold behind one link at its foot
    // rather than one link each. A desktop shows them where they are.
    const notes = [...slideHost.querySelectorAll(".radar-how,.radar-rings,.radar-omitted,.radar-pool")];
    if (notes.length && window.matchMedia?.("(max-width: 760px)").matches) {
      const group = document.createElement("div");
      group.className = "radar-notes";
      notes.forEach((note) => group.append(note));
      slideHost.append(group);
      foldMobileNote(group, "How to read this profile");
    }
    if (slide.kind === "wheel" && typeof wheel === "function") {
      wheel(`${kind}-radar-overall`, `${kind}-radar-overall-note`);
    }
  };
  const go = (index) => {
    current = (index + slides.length) % slides.length;
    host.dataset.current = String(current);
    draw();
  };
  host.querySelectorAll("[data-radar-step]").forEach((button) => button.addEventListener(
    "click", () => go(current + Number(button.dataset.radarStep)),
  ));
  dots.forEach((dot) => dot.addEventListener("click", () => go(Number(dot.dataset.radarGo))));
  slideHost.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") { event.preventDefault(); go(current + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); go(current - 1); }
  });
  draw();
}

// Every section in numbers, most of it as one plain table. The defended shots
// keep a table of their own, because attempts, the credit the misses earned and
// the penalty the makes cost are four numbers a percentile cannot stand for.
// Every radar used to be followed by a disclosure of its own numbers, and the
// page then repeated all of them again in a stack of sections. Both are gone.
// One table is left: where the shots he defended came from, because a share of
// his own attempts is a different fact from a place in the league, and no
// spoke on the defense chart says it.
function renderProfileSectionTables(kind, slides, defendedShots) {
  void slides;
  const host = byId(`${kind}-profile-sections`);
  if (!host) return;
  const rows = defendedShots ?? [];
  host.innerHTML = rows.length
    ? `<h3 class="profile-table-heading">Shots ${kind === "team" ? "it" : "he"} defended, by where they came from</h3>`
      + `<p class="chart-note">Share of attempts is a share of ${kind === "team" ? "its" : "his"} own defended shots, not a place in the league — the defense chart above is the place in the league.</p>`
      + defendedShotTable(rows)
    : "";
  if(rows.length)prepareMobileTable(host.querySelector("tbody"),{kind:"defended",main:0});
}

function defendedShotTable(rows) {
  return `<div class="table-wrap radar-table" role="region" tabindex="0" aria-label="Defended shots by location"><table><thead><tr><th>Where the shot came from</th><th class="numeric">Attempts defended</th><th class="numeric">Share of attempts</th><th class="numeric">Misses forced</th><th class="numeric">Makes allowed</th><th class="numeric">Net</th><th class="numeric">Net per 36</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.label ?? String(row.location).replaceAll("_", " "))}</td><td class="numeric">${escapeHtml(integer(row.attempts))}</td><td class="numeric">${escapeHtml(percent(row.attempt_share))}</td><td class="numeric">${escapeHtml(number(row.miss_credit, 1))}</td><td class="numeric">${escapeHtml(number(row.make_penalty, 1))}</td><td class="numeric ${Number(row.net) < 0 ? "negative-value" : ""}">${escapeHtml(number(row.net, 1))}</td><td class="numeric">${escapeHtml(number(row.net_per36, 2))}</td></tr>`).join("")}</tbody></table></div>`;
}

// --- where a season or a career sits on the map ----------------------------------

function mapFrame(points, { width = 900, height = 470 } = {}) {
  const margin = { top: 30, right: 44, bottom: 56, left: 60 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const pad = (values) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    const range = (high - low) || 1;
    return [low - range * 0.12, high + range * 0.12];
  };
  const [xLow, xHigh] = pad(xs);
  const [yLow, yHigh] = pad(ys);
  return {
    width, height, margin,
    x: (value) => margin.left + (value - xLow) / (xHigh - xLow)
      * (width - margin.left - margin.right),
    y: (value) => margin.top + (yHigh - value) / (yHigh - yLow)
      * (height - margin.top - margin.bottom),
  };
}

// A career across the map: only the selected seasons, joined in time order.
// Thirteen labelled points in one corner is what the owner's screenshot showed,
// so the axes zoom to the path's own extent, the type regions stay faintly
// behind it, and only the first season, the last season and every change of
// type carry a name and a badge. Every other season is a small dot that says
// which season it is on hover and on focus.
function renderCareerPath(kind, path, regions, catalog, season, containerId = `${kind}-v10-scatter`) {
  const container = byId(containerId);
  const tableContainer = byId(`${containerId}-table`);
  byId(`${containerId}-title`).textContent = kind === "team"
    ? "The style this franchise moved through" : "The path this career took";
  container.className = "rankings-visual-chart style-map";
  if (!path.length) {
    container.innerHTML = '<p class="similarity-empty">No selected season carries a place on the map.</p>';
    if (tableContainer) tableContainer.innerHTML = "";
    return;
  }
  // The frame is the path's own extent, so a career that lives in one corner
  // of the league fills the chart instead of hiding in it. The regions are
  // drawn behind and clipped by the frame.
  const frame = mapFrame(path.length > 1 ? path : [
    { x: path[0].x - 1, y: path[0].y - 1 }, { x: path[0].x + 1, y: path[0].y + 1 },
  ]);
  const visualFor = (id) => catalog?.typeById.get(String(id)) ?? styleVisual(id);
  const marks = careerPathLayout(path, { x: frame.x, y: frame.y });
  const line = marks.map((point) => `${point.px.toFixed(1)},${point.py.toFixed(1)}`).join(" ");
  const inside = (px, py) => px > frame.margin.left && px < frame.width - frame.margin.right
    && py > frame.margin.top && py < frame.height - frame.margin.bottom;
  const clear = (px, py) => marks.every((mark) => Math.hypot(mark.px - px, mark.py - py) > 46);
  container.innerHTML = `<svg viewBox="0 0 ${frame.width} ${frame.height}" role="img" aria-label="${escapeHtml(kind === "team" ? "Style across the selected seasons" : "Career path across the selected seasons")}">
    ${regions.map((region) => {
      const visual = visualFor(region.id);
      const cx = frame.x(region.x);
      const cy = frame.y(region.y);
      const label = inside(cx, cy) && clear(cx, cy)
        ? `<text class="path-region-label" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" fill="${escapeHtml(visual.color)}">${escapeHtml(visual.label ?? region.id)}</text>`
        : "";
      return `<ellipse class="path-region" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${Math.abs(frame.x(region.x + region.rx) - cx).toFixed(1)}" ry="${Math.abs(frame.y(region.y + region.ry) - cy).toFixed(1)}" fill="${escapeHtml(visual.color)}"/>${label}`;
    }).join("")}
    <polyline class="path-line" points="${line}"/>
    ${marks.map((point, index) => {
      const visual = visualFor(point.id);
      const last = index === marks.length - 1;
      const reading = `${point.season} · ${point.label}${point.provisional ? " · thin record" : ""} · ${number(point.minutes, 0)} minutes`;
      const badge = point.labelled
        ? `<text class="path-point-badge" x="${point.px.toFixed(1)}" y="${(point.py + 3.5).toFixed(1)}" text-anchor="middle">${escapeHtml(visual.badge)}</text>`
        : "";
      const name = point.labelled
        ? `<text class="path-point-label" x="${point.px.toFixed(1)}" y="${(point.py - 13).toFixed(1)}" text-anchor="middle">${escapeHtml(point.season)}</text>`
        : "";
      return `<g class="path-point${last ? " is-last" : ""}${point.labelled ? " is-named" : ""}" tabindex="0" aria-label="${escapeHtml(reading)}"><circle cx="${point.px.toFixed(1)}" cy="${point.py.toFixed(1)}" r="${point.labelled ? (last ? 9 : 8) : 4.5}" fill="${escapeHtml(visual.color)}"/>${badge}${name}<title>${escapeHtml(reading)}</title></g>`;
    }).join("")}
  </svg>`;
  const named = marks.filter((point) => point.labelled).length;
  byId(`${containerId}-note`).textContent = `${path.length} selected season${path.length === 1 ? "" : "s"}, joined oldest to newest. ${named} of them are named — the first, the last and every change of type; point at any other mark for its season. The faint areas are where each type sat in ${season}.`;
  if (tableContainer) tableContainer.innerHTML = "";
}

// One season: everybody of the same type on one lane, ordered by the page's own
// metric, with this player, his ten closest and the leaders marked. The names
// are laid out on two rows and a name with no room is dropped, so no label ever
// covers another.
function renderRankLane(kind, lane, typeLabel, season, containerId = `${kind}-v10-scatter`) {
  const container = byId(containerId);
  const tableContainer = byId(`${containerId}-table`);
  const metricWord = elements.metric.value === "wins_contributed"
    ? "Wins Contributed" : "Value Contributed";
  byId(`${containerId}-title`).textContent = `Where ${kind === "team" ? "this team ranks among" : "he ranks among"} ${kind === "team" ? `${typeLabel.toLowerCase()} teams` : pluralRole(typeLabel)}`;
  container.className = "rankings-visual-chart rank-lane";
  if (!lane.peers.length) {
    container.innerHTML = '<p class="similarity-empty">No other season of this type is published for the selected scope.</p>';
    if (tableContainer) tableContainer.innerHTML = "";
    return;
  }
  const width = 900;
  const height = 230;
  const margin = { left: 46, right: 46, top: 76, bottom: 46 };
  const low = Math.min(lane.lowest, 0);
  const high = Math.max(lane.highest, low + 1e-9);
  const x = (value) => margin.left + (value - low) / (high - low) * (width - margin.left - margin.right);
  const baseline = margin.top + 34;
  const offsets = beeswarmOffsets(lane.peers.map((peer) => x(peer.total)), { radius: 6, maxOffset: 28 });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => low + (high - low) * fraction);
  const candidates = new Map(lane.leaders.slice(0, 3).map((peer) => [peer.id, peer]));
  if (lane.selected) candidates.set(lane.selected.id, lane.selected);
  const names = laneLabelLayout(
    [...candidates.values()].map((peer) => ({
      id: peer.id, name: peer.name, selected: Boolean(peer.selected), x: x(peer.total),
    })),
    { rows: [0, -16], minimumGap: 96, keep: lane.selected?.id ?? null },
  );
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`Every ${typeLabel} in ${season} by ${metricWord}`)}">
    <line class="lane-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${baseline}" y2="${baseline}"/>
    ${ticks.map((value) => `<line class="lane-tick" x1="${x(value).toFixed(1)}" x2="${x(value).toFixed(1)}" y1="${baseline - 6}" y2="${baseline + 6}"/><text class="lane-tick-label" x="${x(value).toFixed(1)}" y="${baseline + 26}" text-anchor="middle">${escapeHtml(number(value, 1))}</text>`).join("")}
    <text class="lane-axis-title" x="${((margin.left + width - margin.right) / 2).toFixed(1)}" y="${height - 10}" text-anchor="middle">${escapeHtml(metricWord)}</text>
    ${lane.median === null ? "" : `<line class="lane-median" x1="${x(lane.median).toFixed(1)}" x2="${x(lane.median).toFixed(1)}" y1="${baseline - 26}" y2="${baseline + 26}"/>`}
    ${lane.peers.map((peer, index) => {
      const cx = x(peer.total);
      const cy = baseline + offsets[index];
      const className = peer.selected ? "is-selected" : peer.similar ? "is-similar" : "";
      return `<circle class="lane-mark ${className}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${peer.selected ? 8 : 5}" tabindex="0"><title>${escapeHtml(`${peer.name} · #${peer.rank} of ${lane.count} · ${number(peer.total, 3)} ${metricWord}`)}</title></circle>`;
    }).join("")}
    ${names.map((label) => `<text class="lane-name${label.selected ? " is-selected" : ""}" x="${label.x.toFixed(1)}" y="${(margin.top - 22 + label.dy).toFixed(1)}" text-anchor="middle">${escapeHtml(label.name)}</text>`).join("")}
  </svg>`;
  byId(`${containerId}-note`).textContent = [
    `Every ${typeLabel.toLowerCase()}${kind === "team" ? " team" : ""} in ${season} on one line, left to right by ${metricWord}.`,
    lane.selected
      ? `This one is the heavy mark, ranked ${lane.selected.rank} of ${lane.count}.`
      : "This season is not among them.",
    `The ten most similar seasons are ringed, the tall tick is the middle of the type, and ${names.length} name${names.length === 1 ? " is" : "s are"} printed; point at any mark for the rest.`,
  ].join(" ");
  if (tableContainer) tableContainer.innerHTML = "";
}

// "Rebounding big, light rim protection" reads "rebounding bigs, light rim
// protection" in a sentence: the noun before the comma takes the plural.
function pluralRole(label) {
  const text = String(label ?? "").toLowerCase();
  const [head, ...rest] = text.split(", ");
  return [`${head}s`, ...rest].join(", ");
}

// A statistic with a defensive role axis (V12) draws its defensive map from the
// same landscape rows: the defensive role, place and history stand in for the
// offensive ones, so every chart below reads them unchanged.
function sideView(payload, side) {
  const v10 = payload.v10 ?? {};
  if (side !== "defense") {
    return {
      archetype: v10.archetype, history: v10.type_history ?? [],
      similar: v10.similarity?.offense?.same_season ?? v10.similarity?.same_season ?? v10.similarity?.matches ?? [],
      containerId: null,
    };
  }
  return {
    archetype: v10.defense_role, history: v10.defense_history ?? [],
    similar: v10.similarity?.defense?.same_season ?? [],
    containerId: "player-v10-defense-scatter",
  };
}

// Where a profile sits on the map. A whole-league cloud told a reader almost
// nothing about the one season he came to look at, so it is two charts now:
// several seasons draw the path this career took between the types, and one
// season draws every player of the same type on one line, with him on it.
async function renderStyleMap(payload, kind) {
  const containerId = `${kind}-v10-scatter`;
  const container = byId(containerId);
  const tableContainer = byId(`${containerId}-table`);
  const season = payload.v10?.archetype?.season ?? (scopeIsExact() ? selectedSeasonLabels()[0] : null);
  container.className = "rankings-visual-chart style-map";
  container.innerHTML = '<p class="similarity-empty">Loading the league map…</p>';
  if (tableContainer) tableContainer.innerHTML = "";
  if (!season) {
    container.innerHTML = '<p class="similarity-empty">The map needs one season; this profile has no season to place.</p>';
    return;
  }
  const selection = payload.v10?.selection ?? null;
  const years = selection?.season_end_years ?? state.selectedSeasons;
  const path = careerPathModel(payload.v10?.type_history ?? [], years);
  const wantsPath = path.length > 1;
  const controller = new AbortController();
  state.supportingControllers.get(`${kind}_style_map`)?.abort();
  state.supportingControllers.set(`${kind}_style_map`, controller);
  try {
    const landscape = await state.adapter.query(
      elements.source.value,
      kind === "team" ? "team_landscape" : "player_landscape",
      {
        source: elements.source.value, scope: "season", season,
        schedule: kind === "team" ? "regular_season" : elements.schedule.value,
        time_mode: elements.timeMode.value, metric: elements.metric.value,
        limit: 1000, offset: 0,
      },
      { signal: controller.signal },
    );
    const rows = (landscape?.rows ?? []).filter((row) => String(row.season) === String(season));
    const catalog = styleCatalog(kind === "team"
      ? landscape?.team_types ?? payload.v10?.style_types
      : landscape?.player_types ?? payload.v10?.style_types);
    if (wantsPath) {
      renderCareerPath(kind, path, typeRegions(rows), catalog, season);
      return;
    }
    const typeId = payload.v10?.archetype?.id ?? null;
    const typeLabel = catalog?.typeById.get(String(typeId))?.label
      ?? payload.v10?.archetype?.label ?? "this type";
    const similarIds = (payload.v10?.similarity?.same_season
      ?? payload.v10?.similarity?.matches ?? [])
      .map((match) => Number(match.player_id ?? match.team_id));
    renderRankLane(kind, rankLaneModel(rows, {
      entityId: state.selectedEntityId,
      typeId,
      metric: elements.metric.value,
      similarIds,
      idOf: (row) => Number(kind === "team" ? row.team_id : row.player_id),
      nameOf: (row) => String(kind === "team"
        ? teamLabel({ team_id: row.team_id, abbreviation: row.team_abbreviation })
        : row.player_name ?? ""),
      typeOf: (row) => String((kind === "team" ? row.team_type : row.player_type)?.id ?? ""),
    }), typeLabel, season);
  } catch (caught) {
    if (caught.name === "AbortError") return;
    container.innerHTML = `<p class="similarity-empty">${escapeHtml(readableError(caught))}</p>`;
  }
}

// The same two charts for one side of a two-axis statistic (V12's defensive
// role): its own history, its own landscape and its own container.
async function renderSideStyleMap(payload, kind, side) {
  const view = sideView(payload, side);
  const containerId = view.containerId ?? `${kind}-v10-scatter`;
  const container = byId(containerId);
  const tableContainer = byId(`${containerId}-table`);
  const season = view.archetype?.season ?? (scopeIsExact() ? selectedSeasonLabels()[0] : null);
  container.className = "rankings-visual-chart style-map";
  container.innerHTML = '<p class="similarity-empty">Loading the league map…</p>';
  if (tableContainer) tableContainer.innerHTML = "";
  if (!season) {
    container.innerHTML = '<p class="similarity-empty">The map needs one season; this profile has no season to place.</p>';
    return;
  }
  const selection = payload.v10?.selection ?? null;
  const years = selection?.season_end_years ?? state.selectedSeasons;
  const path = careerPathModel(view.history, years);
  const wantsPath = path.length > 1;
  const controller = new AbortController();
  state.supportingControllers.get(`${kind}_style_map_${side}`)?.abort();
  state.supportingControllers.set(`${kind}_style_map_${side}`, controller);
  try {
    const landscape = await state.adapter.query(
      elements.source.value,
      kind === "team" ? "team_landscape" : "player_landscape",
      {
        source: elements.source.value, scope: "season", season,
        schedule: kind === "team" ? "regular_season" : elements.schedule.value,
        time_mode: elements.timeMode.value, metric: elements.metric.value,
        limit: 1000, offset: 0,
      },
      { signal: controller.signal },
    );
    const sided = side === "defense" ? sideLandscape(landscape, "defense") : landscape;
    const rows = (sided?.rows ?? []).filter((row) => String(row.season) === String(season));
    const catalog = styleCatalog(kind === "team"
      ? sided?.team_types ?? payload.v10?.style_types
      : sided?.player_types ?? payload.v10?.style_types);
    if (wantsPath) {
      renderCareerPath(kind, path, typeRegions(rows), catalog, season, containerId);
      return;
    }
    const typeId = view.archetype?.id ?? null;
    const typeLabel = catalog?.typeById.get(String(typeId))?.label
      ?? view.archetype?.label ?? "this type";
    const similarIds = view.similar.map((match) => Number(match.player_id ?? match.team_id));
    renderRankLane(kind, rankLaneModel(rows, {
      entityId: state.selectedEntityId,
      typeId,
      metric: elements.metric.value,
      similarIds,
      idOf: (row) => Number(kind === "team" ? row.team_id : row.player_id),
      nameOf: (row) => String(kind === "team"
        ? teamLabel({ team_id: row.team_id, abbreviation: row.team_abbreviation })
        : row.player_name ?? ""),
      typeOf: (row) => String((kind === "team" ? row.team_type : row.player_type)?.id ?? ""),
    }), typeLabel, season, containerId);
  } catch (caught) {
    if (caught.name === "AbortError") return;
    container.innerHTML = `<p class="similarity-empty">${escapeHtml(readableError(caught))}</p>`;
  }
}

// V11 compares one season with the same season or with every season, so the
// mode toggle says that instead of "career".
function syncSimilarityModeLabels(hasStyles) {
  const select = byId("player-similarity-mode");
  if (!select) return;
  const career = select.querySelector('option[value="career"]');
  const season = select.querySelector('option[value="season"]');
  if (career) career.textContent = hasStyles ? "All seasons" : "Career";
  if (season) season.textContent = hasStyles ? "Same season" : "Selected Season";
}

function renderStyleProfile(payload, kind, style) {
  const v10 = payload.v10;
  const sections = v10.profile_sections ?? [];
  const dimensions = v10.dimensions ?? [];
  if (kind === "player") syncSimilarityModeLabels(true);
  // The lens select belongs to V10's three-lens similarity; V11 has one.
  byId(`${kind}-v10-lens-control`).hidden = true;
  byId(`${kind}-v10-radar-title`).textContent = "Profile against the league";
  byId(`${kind}-v10-scatter-title`).textContent = "Where this season sits on the map";
  renderStyleCallout(
    `${kind}-v10-archetype`, style.archetype, style.catalog, kind, v10.selection,
  );
  renderV10Dimensions(dimensions, `${kind}-v10-dimensions`);
  renderTypeHistory(`${kind}-type-history`, v10.type_history, style.catalog, {
    selectable: kind === "team" && (v10.type_history ?? []).length > 1,
  });
  renderProfileScope(`${kind}-profile-scope`, v10.selection, kind);
  renderProfileOverview(`${kind}-profile-overview`, payload, kind);
  // The scoring and playmaking bars drew exactly what the scoring and
  // playmaking radars draw, from the same rows, so the radars are the profile
  // and the bars are gone.
  byId(`${kind}-style-sources`).hidden = true;
  // The sections are the profile. When a deployment publishes none — an older
  // build, or the pooled comparison a section needs — the whole-profile wheel
  // it used to be stands in its place rather than an empty carousel.
  const masked = maskedMeasurements(dimensions);
  const slides = carouselModel(sections, {
    masked: new Set(masked.map((row) => row.key)), kind,
  });
  const maskedNote = masked.length
    ? `These seasons record no ${masked.slice(0, 4).map((row) => row.label.toLowerCase()).join(", ")}`
      + `${masked.length > 4 ? ` and ${masked.length - 4} more` : ""}, so nothing is `
      + "drawn for them rather than a zero."
    : "";
  const seasons = v10.selection?.seasons ?? [];
  renderRadarCarousel(kind, slides, {
    // The context bars are season totals in Value Contributed, whatever the
    // page's metric is, because that is the only currency the breakdown
    // publishes: raw plus the six factors is Value Contributed exactly.
    contextUnit: "Value Contributed",
    spanWords: seasons.length > 1
      ? `${seasons[0]} to ${seasons.at(-1)}, summed`
      : (seasons[0] ?? "the selected season"),
    // The slide's rule rather than the raw section's: a team page says "team
    // seasons" where a player page says "players".
    poolNote: slides.find((slide) => slide.percentileRule)?.percentileRule
      ?? (kind === "team"
        ? "Compared with every described team season of the same season."
        : "Compared with every described player of the same seasons."),
    maskedNote,
    wheel: (targetId, noteId) => renderProfileWheel(
      targetId, dimensions, style.catalog, noteId,
    ),
  });
  const hasSections = slides.length > 1;
  byId(`${kind}-overall-radar-panel`).hidden = hasSections;
  if (!hasSections) {
    renderProfileWheel(`${kind}-v10-radar`, dimensions, style.catalog, `${kind}-v10-radar-note`);
  }
  renderProfileSectionTables(kind, slides, v10.defended_shots ?? []);
  if (kind === "player") {
    // V11's own defended-shot table lives inside the Defense section above;
    // the fourteen-column V10 table stays in the page for V10 and V9.
    const shots = v10.defended_shots ?? [];
    const panel = byId("player-defended-v10-panel");
    if (panel) panel.hidden = hasSections;
    if (!shots.length) {
      const shotNote = unavailableAnalyticsNote(payload, "Defended-shot breakdowns", "defended_shots");
      byId("player-v10-dfg-chart").innerHTML = `<p class="similarity-empty">${escapeHtml(shotNote)}</p>`;
      byId("player-v10-dfg-body").innerHTML = `<tr><td colspan="14">${escapeHtml(shotNote)}</td></tr>`;
    } else renderDefendedShots(shots);
    byId("player-fingerprint-panel").hidden = hasSections;
  } else {
    renderTypeMix(dimensions, style.catalog);
  }
  renderStyleMap(payload, kind);
}

// Every section's numbers in one table, with a makes and a misses column where
// the section publishes both halves (V12's shot types, locations and free
// throws). The radar draws the net; the table says how it was made up.
function sectionValueTable(slide) {
  const axes = slide.axes ?? [];
  if (!axes.length) return "";
  const halves = axes.some((axis) => Number.isFinite(Number(axis.makes)));
  const head = `<tr><th>${escapeHtml(slide.label)}</th><th class="numeric">Value</th>`
    + (halves ? '<th class="numeric">Makes</th><th class="numeric">Misses</th>' : "")
    + '<th class="numeric">Per 36</th><th class="numeric">League middle per 36</th><th class="numeric">Percentile</th></tr>';
  const body = axes.map((axis) => {
    const cells = halves
      ? `<td class="numeric">${Number.isFinite(Number(axis.makes)) ? escapeHtml(number(axis.makes, 2)) : "—"}</td>`
        + `<td class="numeric">${Number.isFinite(Number(axis.misses)) ? escapeHtml(number(axis.misses, 2)) : "—"}</td>`
      : "";
    const place = axis.percentile === null || axis.percentile === undefined
      ? "—" : escapeHtml(percent(axis.percentile));
    return `<tr${axis.chart ? "" : ' class="is-table-only"'}><td title="${escapeHtml(axis.description ?? "")}">${escapeHtml(axis.label)}</td>`
      + `<td class="numeric ${Number(axis.value) < 0 ? "negative-value" : ""}">${escapeHtml(number(axis.value, 2))}</td>${cells}`
      + `<td class="numeric">${escapeHtml(number(axis.per36, 2))}</td>`
      + `<td class="numeric">${axis.league_median_per36 == null ? "—" : escapeHtml(number(axis.league_median_per36, 2))}</td>`
      + `<td class="numeric">${place}</td></tr>`;
  }).join("");
  return `<div class="table-wrap radar-table" role="region" tabindex="0" aria-label="${escapeHtml(slide.label)} in numbers"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// A statistic with its own profile sections (V12 from rung 7): the same
// carousel, wheel and scope line as V11's profile. With a style build it also
// draws the type callout, the type history and the map; without one it leaves
// them out rather than drawing panels it cannot fill.
function renderSectionsProfile(payload, kind, style = null) {
  const v10 = payload.v10;
  const sections = v10.profile_sections ?? [];
  const dimensions = v10.dimensions ?? [];
  const groups = v10.wheel_groups ?? null;
  if (kind === "player") syncSimilarityModeLabels(Boolean(style));
  byId(`${kind}-v10-lens-control`).hidden = true;
  byId(`${kind}-v10-radar-title`).textContent = "Profile against the league";
  const defenseBlock = kind === "player" ? v10.style_types?.defense ?? null : null;
  const defenseCatalog = defenseBlock ? styleCatalog(defenseBlock) : null;
  for (const id of ["player-v10-defense-role", "player-defense-history", "player-v10-defense-map"]) {
    if (kind === "player" && byId(id)) byId(id).hidden = !defenseCatalog;
  }
  if (style) {
    renderStyleCallout(`${kind}-v10-archetype`, style.archetype, style.catalog, kind, v10.selection);
    if (defenseCatalog) {
      byId(`${kind}-v10-archetype`).insertAdjacentHTML("afterbegin", '<span class="role-side-label">Offensive role</span>');
      renderStyleCallout("player-v10-defense-role", v10.defense_role, defenseCatalog, kind, v10.selection);
      byId("player-v10-defense-role").insertAdjacentHTML("afterbegin", '<span class="role-side-label">Defensive role</span>');
    }
    if (v10.profile_unit) {
      byId(`${kind}-v10-archetype`).insertAdjacentHTML(
        "beforeend", `<span> ${escapeHtml(v10.profile_unit)}</span>`,
      );
    }
    byId(`${kind}-v10-scatter-title`).textContent = "Where this season sits on the map";
  } else {
    byId(`${kind}-v10-archetype`).textContent = v10.profile_unit ?? "";
  }
  renderV10Dimensions(dimensions, `${kind}-v10-dimensions`);
  if (style) {
    const playerPicks = kind === "player" && fixedPlayerPage() && (v10.type_history ?? []).length > 1;
    renderTypeHistory(`${kind}-type-history`, v10.type_history, style.catalog, playerPicks ? {
      selectable: true,
      selectedSeason: profileSeasonInScope(),
      label: profileSeasonInScope()
        ? "Season by season · choose another season, or the highlighted one again for every season"
        : "Season by season · choose a season to describe it alone",
    } : {
      selectable: kind === "team" && (v10.type_history ?? []).length > 1,
    });
    if (defenseCatalog) renderTypeHistory("player-defense-history", v10.defense_history, defenseCatalog);
  } else {
    byId(`${kind}-type-history`)?.replaceChildren();
  }
  renderProfileScope(`${kind}-profile-scope`, v10.selection, kind);
  renderProfileOverview(`${kind}-profile-overview`, payload, kind);
  byId(`${kind}-style-sources`).hidden = true;
  const slides = carouselModel(sections, { kind, wheelGroups: groups });
  const seasons = v10.selection?.seasons ?? [];
  const carouselOptions = {
    contextUnit: "Value Contributed",
    spanWords: seasons.length > 1
      ? `${seasons[0]} to ${seasons.at(-1)}, summed`
      : (seasons[0] ?? "the selected season"),
    poolNote: slides.find((slide) => slide.percentileRule)?.percentileRule
      ?? "Compared with every player of the same seasons.",
    maskedNote: "",
    wheel: (targetId, noteId) => renderProfileWheel(targetId, dimensions, null, noteId, groups),
  };
  if (kind === "player" && fixedPlayerPage()) {
    renderPlayerCarouselWithMatchups(payload, sections, groups, carouselOptions);
  } else renderRadarCarousel(kind, slides, carouselOptions);
  byId(`${kind}-overall-radar-panel`).hidden = true;
  const host = byId(`${kind}-profile-sections`);
  // The player page is the charts alone: every spoke carries its own number
  // on hover and on focus, so the "in numbers" tables beneath were a second
  // copy of the same readings.
  if (host && kind === "player") host.innerHTML = "";
  else if (host) {
    host.innerHTML = slides.filter((slide) => slide.kind !== "wheel")
      .map((slide) => `<h3 class="profile-table-heading">${escapeHtml(slide.label)} in numbers</h3>${sectionValueTable(slide)}`)
      .join("");
  }
  const scatter = byId(`${kind}-v10-scatter`);
  if (style && kind === "player" && fixedPlayerPage()) {
    renderTypeTimeline(payload);
    if (defenseCatalog) renderSideStyleMap(payload, kind, "defense");
  } else if (style) {
    renderStyleMap(payload, kind);
    if (defenseCatalog) renderSideStyleMap(payload, kind, "defense");
  } else if (scatter) {
    scatter.innerHTML = `<p class="similarity-empty">${escapeHtml(unavailableAnalyticsNote(payload, "Player types", "archetypes"))}</p>`;
  }
  if (kind === "player") {
    const panel = byId("player-defended-v10-panel");
    if (panel) panel.hidden = true;
    byId("player-fingerprint-panel").hidden = true;
  }
}

// --- matchups on the radars ------------------------------------------------------
//
// V13 knows who guarded whom. Two radars say what kinds of player those were —
// the scorers he guarded and the defenders who guarded him, by type — and each
// of those two names his three most frequent matchups beneath it: the players
// he guarded, and the defenders who guarded him. The answer is fetched once per
// selection and kept.
const matchupAnswers = new Map();
const MATCHUPS_SHOWN = 3;

function profileYears(payload) {
  return (payload.v10?.selection?.season_end_years ?? []).map(Number);
}

function fetchPlayerMatchups(payload) {
  const years = profileYears(payload);
  const key = `${state.selectedEntityId}:${years.join(",")}`;
  if (!matchupAnswers.has(key)) {
    const params = new URLSearchParams();
    years.forEach((year) => params.append("season", seasonLabel(year)));
    params.set("schedule", elements.schedule.value);
    matchupAnswers.set(key, fetch(`/api/v13/players/${Number(state.selectedEntityId)}/matchups?${params}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null));
  }
  return matchupAnswers.get(key);
}

// The matchups belong to the two matchup radars only.
const OFFENSE_SLIDES = new Set(["guarded_by_types"]);
const DEFENSE_SLIDES = new Set(["guarded_types"]);

function matchupListMarkup(slide, answer) {
  if (!answer) return "";
  const defense = DEFENSE_SLIDES.has(slide.key);
  if (!defense && !OFFENSE_SLIDES.has(slide.key)) return "";
  const rows = (defense ? answer.top_guarded : answer.top_defenders) ?? [];
  if (!rows.length) return "";
  const heading = defense ? "Players he guarded most" : "Defenders who guarded him most";
  const verb = defense ? "scored on him" : "he scored";
  const items = rows.slice(0, MATCHUPS_SHOWN).map((row) => {
    const shooting = row.fga ? `${integer(row.fgm)} of ${integer(row.fga)} shooting` : "no shots";
    return `<li><span class="type-who">${mobilePhoto(row.player_id)}<a href="${entityUrl("players", row.player_id)}">${escapeHtml(row.player_name)}</a></span><span>${escapeHtml(integer(row.possessions))} possessions over ${escapeHtml(integer(row.games))} games · ${escapeHtml(number(row.points_per100, 1))} points ${verb} per 100 · ${escapeHtml(shooting)}</span></li>`;
  }).join("");
  return `<div class="matchup-list"><h5>${escapeHtml(heading)}</h5><ol>${items}</ol></div>`;
}

function renderPlayerCarouselWithMatchups(payload, sections, groups, options) {
  const draw = (extra = [], afterSlide = null) => {
    const host = byId("player-radar-carousel");
    const start = Number(host?.dataset.current ?? 0) || 0;
    const slides = carouselModel([...sections, ...extra], { kind: "player", wheelGroups: groups });
    renderRadarCarousel("player", slides, { ...options, afterSlide, start });
  };
  draw();
  if (elements.source.value !== "v13") return;
  const wanted = state.selectedEntityId;
  const years = profileYears(payload).join(",");
  fetchPlayerMatchups(payload).then((answer) => {
    if (!answer || state.selectedEntityId !== wanted
      || profileYears(state.payload ?? {}).join(",") !== years) return;
    draw(
      [answer.guarded_types?.section, answer.guarded_by_types?.section].filter(Boolean),
      (slide) => matchupListMarkup(slide, answer),
    );
  });
}

// --- his types, season by season -------------------------------------------------
//
// In place of the career path: every season of his career in a column, each of
// the four areas of the game in a row, so a change of type reads as a change of
// colour along the row.
const AREA_TITLES = Object.freeze({
  scoring: "Scoring", playmaking: "Playmaking", rebounding: "Rebounding", defense: "Defense",
});

function renderTypeTimeline(payload) {
  const container = byId("player-v10-scatter");
  const title = byId("player-v10-scatter-title");
  const note = byId("player-v10-scatter-note");
  const table = byId("player-v10-scatter-table");
  if (!container || !title) return;
  container.className = "type-view";
  if (table) table.innerHTML = "";
  title.textContent = "His types, season by season";
  const types = payload.v10?.v13_types;
  const history = [...(types?.history ?? [])].sort((a, b) => a.season_end_year - b.season_end_year);
  if (!history.length) {
    note.textContent = "";
    container.innerHTML = `<p class="similarity-empty">${escapeHtml(types
      ? "No season of this career carries a type."
      : unavailableAnalyticsNote(payload, "Player types", "archetypes"))}</p>`;
    return;
  }
  note.textContent = "Each column is one season and each row one area of the game; a change of colour is a change of type. Point at a cell for its full name.";
  const head = history.map((row) => `<th scope="col">${escapeHtml(row.season)}</th>`).join("");
  const body = Object.entries(AREA_TITLES).map(([area, words]) => `<tr><th scope="row">${escapeHtml(words)}</th>${history.map((row, index) => {
    const entry = row.areas?.[area];
    const previous = history[index - 1]?.areas?.[area];
    const changed = previous && previous.id !== entry?.id;
    return `<td><span class="type-cell${changed ? " is-change" : ""}" style="--type-color:${escapeHtml(entry?.color ?? "#67707a")}" title="${escapeHtml(`${row.season} · ${words}: ${entry?.label ?? "No type"}`)}">${escapeHtml(entry?.label ?? "—")}</span></td>`;
  }).join("")}</tr>`).join("");
  container.innerHTML = `<div class="table-wrap type-timeline-wrap" role="region" tabindex="0" aria-label="Types season by season"><table class="type-timeline"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderV10Analytics(payload, kind) {
  const section = byId(kind === "player" ? "v10-player-analytics" : "v10-team-analytics");
  const v10 = payload.v10;
  section.hidden = !v10;
  if (!v10) return;
  const style = styleProfile(payload);
  // A statistic that names its own wheel groups (V12's value sections) keeps
  // its own sections, wheel and tables; its style build, when there is one,
  // adds the type, the history, the map and similarity beside them.
  if (v10.wheel_groups && (v10.profile_sections ?? []).length) {
    renderSectionsProfile(payload, kind, style);
    return;
  }
  if (style) {
    renderStyleProfile(payload, kind, style);
    return;
  }
  if ((v10.profile_sections ?? []).length) {
    renderSectionsProfile(payload, kind);
    return;
  }
  if (kind === "player") syncSimilarityModeLabels(false);
  // The lens chooses between V10's three similarity models; V12 and V13 have one.
  byId(`${kind}-v10-lens-control`).hidden = ["v12", "v13"].includes(elements.source.value);
  byId(`${kind}-v10-radar-title`).textContent = "Concept radar";
  byId(`${kind}-v10-radar-note`).textContent = "";
  byId(`${kind}-v10-scatter-title`).textContent = "Frozen PCA position";
  byId(`${kind}-v10-scatter-note`).textContent = "";
  byId(`${kind}-v10-scatter`).className = "v10-scatter";
  byId(`${kind}-v10-scatter-table`).innerHTML = "";
  byId(`${kind}-type-history`)?.replaceChildren();
  // A statistic without profile sections keeps exactly the panels it had: the
  // whole-profile radar, the fourteen-column defended-shot table and the
  // fingerprint block, and none of the V11 blocks above them.
  byId(`${kind}-overall-radar-panel`).hidden = false;
  byId(`${kind}-radar-panel`).hidden = true;
  byId(`${kind}-profile-sections`).innerHTML = "";
  byId(`${kind}-profile-overview`).innerHTML = "";
  byId(`${kind}-profile-scope`).hidden = true;
  byId(`${kind}-style-sources`).hidden = true;
  if (kind === "player") {
    byId("player-defended-v10-panel").hidden = false;
    byId("player-fingerprint-panel").hidden = false;
  }
  if (kind === "team") byId("team-type-mix-panel").hidden = true;
  const dimensions = v10.dimensions ?? [];
  if (!dimensions.length && !v10.archetype) {
    const note = unavailableAnalyticsNote(payload, "Style lens, archetype and concept radar", "dimensions");
    byId(`${kind}-v10-archetype`).textContent = note;
    byId(`${kind}-v10-dimensions`).innerHTML = `<tr><td colspan="5">${escapeHtml(note)}</td></tr>`;
    byId(`${kind}-v10-radar`).innerHTML = `<p class="similarity-empty">${escapeHtml(note)}</p>`;
    byId(`${kind}-v10-scatter`).innerHTML = `<p class="similarity-empty">${escapeHtml(note)}</p>`;
    if (kind === "player") {
      const shotNote = unavailableAnalyticsNote(payload, "Defended-shot breakdowns", "defended_shots");
      byId("player-v10-dfg-chart").innerHTML = `<p class="similarity-empty">${escapeHtml(shotNote)}</p>`;
      byId("player-v10-dfg-body").innerHTML = `<tr><td colspan="14">${escapeHtml(shotNote)}</td></tr>`;
    }
    return;
  }
  const archetype = v10.archetype;
  byId(`${kind}-v10-archetype`).textContent = archetype
    ? `Archetype ${archetype.stable_cluster_id}. Representative: ${archetype.representative_name}. ${(archetype.traits ?? []).map(archetypeTraitLabel).filter(Boolean).join(" · ")}`
    : (kind === "team" && v10.archetype_policy?.status === "omitted_by_owner_policy"
      ? "Official team archetypes are omitted by the owner-approved V10 release policy. Three-lens roster similarity and the concept radar remain available."
      : "This profile is outside the frozen archetype assignment coverage.");
  renderV10Dimensions(v10.dimensions ?? [], `${kind}-v10-dimensions`);
  conceptRadar(v10.dimensions ?? [], `${kind}-v10-radar`);
  if (kind === "team" && v10.archetype_policy?.status === "omitted_by_owner_policy") {
    byId("team-v10-scatter").innerHTML = '<p class="similarity-empty">Team transport-space scatter is omitted with the official team archetype model; no incomplete distance was invented.</p>';
  } else {
    scatterPlot(v10, `${kind}-v10-scatter`, kind);
  }
  if (kind !== "player") return;
  renderDefendedShots(v10.defended_shots ?? []);
}

function renderDefendedShots(dfg) {
  const maximum = Math.max(1e-12, ...dfg.flatMap((row) => [Math.abs(Number(row.gross_miss_credit ?? 0)), Math.abs(Number(row.gross_make_penalty ?? 0))]));
  byId("player-v10-dfg-chart").innerHTML = dfg.map((row) => `<div class="v10-dfg-row"><strong>${escapeHtml(row.location.replaceAll("_"," "))}</strong><div class="v10-dfg-axis"><span class="v10-dfg-credit" style="width:${Math.abs(Number(row.gross_miss_credit ?? 0))/maximum*48}%" aria-label="${number(row.gross_miss_credit)} miss credit"></span><i></i><span class="v10-dfg-penalty" style="width:${Math.abs(Number(row.gross_make_penalty ?? 0))/maximum*48}%" aria-label="${number(row.gross_make_penalty)} make penalty"></span></div><em>${number(row.net_value)}</em></div>`).join("");
  byId("player-v10-dfg-body").innerHTML = dfg.length ? dfg.map((row) => `<tr><td>${escapeHtml(row.location.replaceAll("_"," "))}</td><td class="numeric">${row.reported_fga==null?"—":number(row.reported_fga,1)}</td><td class="numeric">${number(row.scorable_fga,1)}</td><td class="numeric">${number(row.fgm,1)}</td><td class="numeric">${number(row.misses,1)}</td><td class="numeric">${percent(row.normal_fg_pct)}</td><td class="numeric">${number(row.expected_points)}</td><td class="numeric">${number(row.actual_points)}</td><td class="numeric">${number(row.gross_miss_credit)}</td><td class="numeric">${number(row.gross_make_penalty)}</td><td class="numeric">${number(row.miss_coefficient,2)}</td><td class="numeric">${number(row.make_coefficient,2)}</td><td class="numeric">${number(row.net_value)}</td><td>${row.complete_coverage?"Complete":"Missing/coarse"}</td></tr>`).join("") : '<tr><td colspan="14">No scorable defended-shot rows in this scope.</td></tr>';
}

function gameResponsibility(row) {
  return row.responsibility ?? {
    offense: row.offense ?? row.offense_value,
    defense: row.defense ?? row.defense_value,
    other: row.other ?? row.other_value,
  };
}

function renderGames(payload, kind) {
  const target = byId(kind === "players" ? "player-games-body" : "team-games-body");
  const rows = payload.rows ?? [];
  const entityKind = kind === "players" ? "player" : "team";
  // The build column exists only where the source can answer for one game.
  const canBuild = sourceCan("player_game_anatomy");
  const header = byId(`${kind === "players" ? "player" : "team"}-games-build-header`);
  if (header) header.hidden = !canBuild;
  target.innerHTML = rows.length ? rows.map((row) => {
    const responsibility = gameResponsibility(row);
    const entityCell = kind === "players"
      ? `<td>${escapeHtml(teamLabel(row.team))}</td>`
      : `<td>${mobilePhoto(row.player_id)}<a href="${entityUrl("players", row.player_id)}">${escapeHtml(row.player_name)}</a></td>`;
    const buildCell = canBuild
      ? `<td><button class="game-anatomy-button" type="button" data-game-anatomy="${escapeHtml(row.game_id)}" data-player-id="${playerId(row)}" data-game-season="${escapeHtml(row.season ?? seasonLabel(row.season_end_year))}">See build</button></td>`
      : "";
    return `<tr><td>${integer(row.rank)}</td><td>${escapeHtml(row.game_date ?? row.date)}</td><td>${escapeHtml(row.season ?? seasonLabel(row.season_end_year))}</td>${entityCell}<td>${escapeHtml(row.location === "away" ? "@ " : "vs. ")}${escapeHtml(teamLabel(row.opponent))}</td><td>${escapeHtml(row.result ?? row.outcome ?? (row.win_loss ? "W" : "L"))}</td><td class="numeric">${number(row.value_contributed ?? row.vc)}</td><td class="numeric">${number(responsibilityValue(responsibility, "offense"))}</td><td class="numeric">${number(responsibilityValue(responsibility, "defense"))}</td><td class="numeric">${number(responsibilityValue(responsibility, "other"))}</td>${buildCell}</tr>`;
  }).join("") : `<tr><td colspan="${canBuild ? 11 : 10}">No top ${entityKind} games match these filters. Zero-minute value rows are excluded.</td></tr>`;
  prepareMobileTable(target, {kind:kind === "players"?"player-games":"team-games", main:kind === "players"?1:3, hidden:[9,10], more:kind !== "players"});
  const meta = byId(`${kind === "players" ? "player" : "team"}-games-meta`);
  meta.textContent = rows.length
    ? `Top ${integer(rows.length)} matching performance${rows.length === 1 ? "" : "s"}, ranked by Value Contributed. Zero-minute value rows are excluded.`
    : "No matching appearances.";
}

function renderGameAnatomy(payload) {
  const sources = [...(payload.sources ?? [])]
    .sort((left, right) => Math.abs(Number(right.value)) - Math.abs(Number(left.value))
      || String(left.key).localeCompare(String(right.key)));
  const contexts = payload.contexts ?? [];
  const responsibility = payload.responsibility ?? {};
  const sourceMagnitude = Math.max(1e-12, sources.reduce((sum, row) => sum + Math.abs(Number(row.value ?? 0)), 0));
  const finalValue = Number(payload.closure?.final_value ?? payload.stages?.at(-1)?.value ?? 0);
  const sourceRows = sources.map((item) => {
    const share = Math.abs(Number(item.value)) / sourceMagnitude;
    return `<div class="anatomy-component"><span>${escapeHtml(item.label ?? item.key)}</span><div class="anatomy-track"><span class="${Number(item.value) < 0 ? "negative" : "positive"}" style="width:${Math.min(100, share * 100)}%"></span></div><strong class="${Number(item.value) < 0 ? "negative-value" : ""}">${percent(share)}<small>raw ${number(item.value)}</small></strong></div>`;
  }).join("") || '<p class="chart-note">No nonzero components.</p>';
  const contextRows = contexts.map((item) => {
    const share = Math.abs(finalValue) > 1e-12 ? Number(item.value) / finalValue : null;
    return `<div class="anatomy-component"><span>${escapeHtml(item.label ?? item.key)}</span><div class="anatomy-track"><span class="${Number(item.value) < 0 ? "negative" : "positive"}" style="width:${share === null ? 0 : Math.min(100, Math.abs(share) * 100)}%"></span></div><strong class="${Number(item.value) < 0 ? "negative-value" : ""}">${share === null ? "—" : percent(share)}<small>raw ${number(item.value)}</small></strong></div>`;
  }).join("") || `<p class="chart-note">${escapeHtml(payload.contexts_note ?? "No nonzero context effects.")}</p>`;
  // A stage only flows into the next when both are counted in the same unit.
  // V11 measures its evidence in points and publishes a share, so the two are
  // shown as what they are rather than as one chain.
  const stages = payload.stages ?? [];
  const stageCards = stages.map((stage, index) => {
    const flows = index < stages.length - 1
      && (stage.unit ?? null) === (stages[index + 1].unit ?? null);
    const unit = stage.unit ? `<small>${escapeHtml(stage.unit)}</small>` : "";
    return `<div><span>${escapeHtml(stage.label)}</span><strong>${number(stage.value)}</strong>${unit}${flows ? '<i aria-hidden="true">→</i>' : ""}</div>`;
  }).join("");
  const sourceScale = payload.sources_unit
    ? `Percent of total absolute raw source activity; the signed quantity below each is in ${escapeHtml(payload.sources_unit)}, not in the share above.`
    : "Percent of total absolute raw source activity; signed raw quantity is retained below.";
  const contextScale = payload.contexts_note
    ? ""
    : '<p class="anatomy-scale-note">Percent of final VC; signed context amount is retained below.</p>';
  const closure = payload.closure?.kind === "responsibility"
    ? `Close: offense ${number(responsibility.offense)} + defense ${number(responsibility.defense)} + other ${number(responsibility.other)} = ${number(payload.closure.final_value)} Value Contributed, the player's share of his team's value in this game.`
    : `Receipt-checked close: raw + context ${number(payload.closure?.raw_plus_context)} = final VC ${number(payload.closure?.final_value)}.`;
  byId("game-anatomy-title").textContent = `${payload.player_name} · ${payload.game_date}`;
  byId("game-anatomy-meta").textContent = `${teamLabel(payload.team)} ${payload.location === "away" ? "at" : "vs."} ${teamLabel(payload.opponent)} · ${payload.result} · ${payload.season_type}`;
  byId("game-anatomy-content").innerHTML = `
    <div class="anatomy-stages">${stageCards}</div>
    <div class="anatomy-columns"><section><h3>Governed source composition</h3><p class="anatomy-scale-note">${sourceScale}</p>${sourceRows}${payload.defensive_rebound_split ? `<p class="anatomy-scale-note">${escapeHtml(reboundSplitSentence(payload.defensive_rebound_split))}</p>` : ""}</section><section><h3>Context effects</h3>${contextScale}${contextRows}<h3>Final responsibility</h3>${fingerprintBars(responsibility)}</section></div>
    <p class="anatomy-closure">${escapeHtml(closure)}</p>`;
}

async function openGameAnatomy(button) {
  const dialog = byId("game-anatomy-dialog");
  const player = Number(button.dataset.playerId);
  const gameId = button.dataset.gameAnatomy;
  byId("game-anatomy-title").textContent = "Loading game contribution anatomy…";
  byId("game-anatomy-meta").textContent = "";
  byId("game-anatomy-content").innerHTML = '<p class="entity-state">Reading governed source and context values…</p>';
  if (!dialog.open) dialog.showModal();
  try {
    const payload = await state.adapter.query(elements.source.value, "player_game_anatomy", {
      source: elements.source.value,
      player_id: player,
      game_id: gameId,
      // A game anatomy link identifies one canonical player-game. It must not
      // be excluded by whatever season scope happened to be restored first.
      scope: "all",
      schedule: "all",
      time_mode: elements.timeMode.value,
      metric: "value_contributed",
    });
    renderGameAnatomy(payload);
  } catch (caught) {
    byId("game-anatomy-content").innerHTML = `<p class="similarity-empty">${escapeHtml(readableError(caught))}</p>`;
  }
}

function explanationText(match) {
  const explanation = match.explanation ?? match.explanations ?? {};
  const similarities = match.strongest_similarities ?? explanation.similarities
    ?? explanation.closest_meaningful_features ?? [];
  const differences = match.largest_differences ?? explanation.differences
    ?? explanation.largest_weighted_feature_differences ?? [];
  const label = (item) => String(item.label ?? item.feature ?? item.key ?? "feature").replaceAll("_", " ").replaceAll(".", " · ");
  const parts = [];
  if (similarities.length) parts.push(`Closest: ${similarities.map(label).join(", ")}`);
  if (differences.length) parts.push(`Different: ${differences.map(label).join(", ")}`);
  return parts.join(". ");
}

function teamExplanationText(match) {
  const parts = [];
  const explanation = match.explanation ?? match.explanations ?? {};
  const roles = match.closest_player_roles ?? explanation.closest_player_roles
    ?? explanation.transport_flows ?? [];
  if (roles.length) {
    parts.push(`Closest roles: ${roles.slice(0, 3).map((role) => `${role.source_player_name ?? role.target_player_name ?? role.source_player_id ?? role.target_player_id} ↔ ${role.match_player_name ?? role.candidate_player_name ?? role.match_player_id ?? role.candidate_player_id}`).join(", ")}`);
  }
  const familyValues = match.family_differences ?? explanation.family_differences ?? {};
  const families = Object.entries(familyValues)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]));
  if (families.length) {
    parts.push(`Largest family gap: ${families[0][0].replaceAll("_", " ")} ${number(families[0][1], 3)}`);
  }
  parts.push(`${integer(match.shared_player_count)} shared players · ${percent(match.minute_coverage)} minute coverage · ${percent(match.dimension_coverage)} dimension coverage`);
  return parts.join(". ");
}

function unavailableMessage(payload, type) {
  const reasons = {
    season_required: "Choose one season to use Selected Season mode.",
    exact_season_required: "Choose one exact season to compare team seasons.",
    complete_history_required: "Career similarity becomes available only after all 13 seasons finish for this source.",
    selected_span_not_supported: "Choose one exact season or All Seasons for similarity; custom spans are not silently treated as careers.",
    insufficient_data: "This player does not reach the fixed appearance and minute thresholds.",
    target_ineligible: "This player does not reach the fixed appearance and minute thresholds.",
    insufficient_candidate_pool: "Too few eligible players are available for a comparison.",
    eligible_pool_too_small: "Too few eligible players are available for a comparison.",
    season_incomplete: "The selected season is not complete for this source.",
    zero_signal: "The eligible comparison pool has no varying signal.",
    zero_final_value: "This player has zero aggregate final value in the comparison scope, so responsibility shares and similarity are undefined.",
    feature_variance_zero: "The eligible comparison pool has no varying signal.",
    incomplete_team_season_pool: "This experiment does not contain every team in each selected season.",
    dimension_coverage_below_threshold: "Comparable feature coverage is below the required 75%.",
    similarity_artifact_not_built: "Similar players are not available here yet.",
    not_available_for_v11: "V11 publishes no similarity model, so similar players and teams are not available for it.",
  };
  if (reasons[payload.reason]) return reasons[payload.reason];
  // A source may answer with its own plain sentence rather than a reason key.
  const supplied = String(payload.reason ?? "").trim();
  if (supplied.includes(" ")) return supplied;
  return `${type} similarity is unavailable for this scope.`;
}

// The similar-players list picks its own season, inside the panel, rather than
// asking the reader to narrow the whole page. Every season of the career is
// offered, newest first; the list starts on the season the profile describes.
function similaritySeasonChoices() {
  return normalizeCareer(state.payload ?? {})
    .map((row) => String(row.season ?? (row.season_end_year ? seasonLabel(row.season_end_year) : "")))
    .filter(Boolean)
    .reverse();
}

// V13 also compares a whole span: his seasons blended into one description
// against every other player's blend over the same seasons. It is the list's
// starting point unless the profile describes one season.
const SPAN_SIMILARITY = "span";

function spanSimilarityAvailable() {
  return elements.source.value === "v13" && similaritySeasonChoices().length > 1;
}

function currentSimilaritySeason() {
  const choices = similaritySeasonChoices();
  const span = spanSimilarityAvailable();
  const wanted = state.similaritySeason
    ?? profileSeasonInScope()
    ?? (span ? SPAN_SIMILARITY : state.payload?.v10?.selection?.profile_season)
    ?? null;
  if (wanted === SPAN_SIMILARITY && span) return SPAN_SIMILARITY;
  return choices.includes(wanted) ? wanted : (choices[0] ?? null);
}

function spanLabel() {
  const choices = similaritySeasonChoices();
  return choices.length > 1 ? `${choices.at(-1)} to ${choices[0]}` : (choices[0] ?? "");
}

function renderSimilaritySeasonMenu() {
  const select = byId("player-similarity-season");
  if (!select) return;
  const choices = similaritySeasonChoices();
  const current = currentSimilaritySeason();
  select.innerHTML = (spanSimilarityAvailable()
    ? `<option value="${SPAN_SIMILARITY}">Whole span · ${escapeHtml(spanLabel())}</option>` : "")
    + choices.map((season) => `<option value="${escapeHtml(season)}">${escapeHtml(season)}</option>`).join("");
  if (current) select.value = current;
  select.closest("label").hidden = !isV11Shaped() || !choices.length;
  // A span is compared with other spans over the same seasons, so "same
  // season" and "every season" do not apply to it.
  byId("player-similarity-mode-control").hidden = current === SPAN_SIMILARITY;
}

async function loadPlayerSpanSimilarity(target, signal) {
  const params = new URLSearchParams();
  similaritySeasonChoices().forEach((season) => params.append("season", season));
  params.set("schedule", elements.schedule.value);
  params.set("time_mode", elements.timeMode.value);
  params.set("limit", "10");
  const response = await fetch(`/api/v13/players/${Number(state.selectedEntityId)}/span-similarity?${params}`, { signal });
  if (!response.ok) throw new Error(`The whole-span comparison is unavailable (${response.status}).`);
  const payload = await response.json();
  target.setAttribute("aria-busy", "false");
  renderSimilarity({
    source: state.payload?.source,
    status: payload.status,
    reason: payload.reason,
    mode: "span",
    season: spanLabel(),
    span: payload,
    matches: (payload.matches ?? []).map((match) => ({
      ...match,
      style: match.player_type ?? null,
      explanation_text: `${match.player_type?.label ?? "No type"} over ${match.seasons_played} season${match.seasons_played === 1 ? "" : "s"} of the span (${match.span}), ${integer(match.minutes)} minutes.`,
    })),
  }, "players", {});
}

// One season's most-similar lists come with that season's profile, which the
// server keeps warm, so the panel asks for the profile of the season it shows.
async function loadPlayerSeasonSimilarity() {
  renderSimilaritySeasonMenu();
  const season = currentSimilaritySeason();
  const target = byId("player-similarity");
  state.supportingControllers.get("player_similarity")?.abort();
  const controller = new AbortController();
  state.supportingControllers.set("player_similarity", controller);
  if (!season) {
    target.innerHTML = '<div class="similarity-empty">No season of this career carries a player description.</div>';
    return;
  }
  target.innerHTML = '<div class="similarity-empty">Loading the most similar players…</div>';
  target.setAttribute("aria-busy", "true");
  if (season === SPAN_SIMILARITY) {
    try {
      await loadPlayerSpanSimilarity(target, controller.signal);
    } catch (caught) {
      if (caught.name === "AbortError") return;
      target.setAttribute("aria-busy", "false");
      target.innerHTML = `<div class="similarity-empty">${escapeHtml(readableError(caught))}</div>`;
    }
    return;
  }
  try {
    const request = { ...filters({ supporting: true }), scope: "season", season };
    delete request.profile_season;
    delete request.limit;
    const profile = await state.adapter.query(elements.source.value, "player_profile", request, { signal: controller.signal });
    const similarity = profile.v10?.similarity ?? {};
    const mode = byId("player-similarity-mode").value;
    const list = (mode === "career" ? similarity.all_seasons : similarity.same_season)
      ?? similarity.matches ?? [];
    target.setAttribute("aria-busy", "false");
    renderSimilarity({
      source: profile.source,
      status: list.length ? "available" : "unavailable",
      reason: list.length ? null : (similarity.reason ?? "insufficient_candidate_pool"),
      mode: mode === "career" ? "career" : "season",
      season,
      matches: list.map((match) => ({
        ...match,
        style: match.player_type ?? null,
        explanation_text: typeof match.explanation === "string" ? match.explanation : null,
      })),
    }, "players", similarity);
  } catch (caught) {
    if (caught.name === "AbortError") return;
    target.setAttribute("aria-busy", "false");
    target.innerHTML = `<div class="similarity-empty">${escapeHtml(readableError(caught))}</div>`;
  }
}

// Beside the combined list: the most similar seasons on offense alone and on
// defense alone, each with the role that side gives them.
function renderSimilaritySides(mode, similarity = state.payload?.v10?.similarity ?? {}) {
  const host = byId("player-similarity-sides");
  if (!host) return;
  if (!similarity.offense || !similarity.defense) { host.hidden = true; host.innerHTML = ""; return; }
  const key = mode === "season" ? "same_season" : "all_seasons";
  const list = (rows, roleOf) => (rows ?? []).slice(0, 5).map((match) => {
    const season = match.season ?? (match.season_end_year ? seasonLabel(match.season_end_year) : "");
    const role = roleOf(match);
    return `<li><a href="${entityUrl("players", match.player_id, { season })}">${escapeHtml(match.player_name)}</a> <span class="similarity-season">${escapeHtml(season)}</span> <b>${escapeHtml(number(match.similarity, 1))}</b>${role ? `<small>${escapeHtml(role)}</small>` : ""}</li>`;
  }).join("");
  host.hidden = false;
  host.innerHTML = `<div><h3>On offense</h3><ol>${list(similarity.offense[key], (m) => m.player_type?.label)}</ol></div>`
    + `<div><h3>On defense</h3><ol>${list(similarity.defense[key], (m) => m.defense_type?.label)}</ol></div>`;
}

function renderSimilarity(payload, kind, similarity = undefined) {
  const target = byId(kind === "players" ? "player-similarity" : "team-similarity");
  // The player panel has no explanatory paragraph (removed 2026-09-27); the
  // team panel keeps its one sentence.
  if (kind === "teams" && state.payload?.v10?.style_types) {
    byId("team-similarity-note").textContent = "Regular-season only. Team seasons are described the same way, and 100 means the two descriptions are identical while 50 means they are as close as the closest one pair in twenty.";
  }
  if (payload.status !== "available" || !(payload.matches ?? []).length) {
    target.innerHTML = `<div class="similarity-empty">${escapeHtml(unavailableMessage(payload, kind === "players" ? "Player" : "Team-season"))}</div>`;
    if (kind === "players") renderSimilaritySides(payload.mode, {});
    return;
  }
  const catalog = styleCatalog(state.payload?.v10?.style_types);
  if (kind === "players") renderSimilaritySides(payload.mode, similarity);
  target.innerHTML = payload.matches.map((match) => {
    const score = match.similarity ?? match.score;
    const comparisonSeason = match.season
      ?? (match.season_end_year ? seasonLabel(match.season_end_year) : null)
      ?? (payload.season_end_year ? seasonLabel(payload.season_end_year) : null);
    const heading = kind === "players"
      ? `${mobilePhoto(match.player_id)}<a href="${entityUrl("players", match.player_id, { season: comparisonSeason })}">${escapeHtml(match.player_name)}</a>${comparisonSeason ? `<span class="similarity-season">${escapeHtml(comparisonSeason)}</span>` : match.span ? `<span class="similarity-season">${escapeHtml(match.span)}</span>` : ""}`
      : `<a href="${entityUrl("teams", match.team_id, { season: match.season ?? seasonLabel(match.season_end_year) })}">${escapeHtml(teamLabel(match.team))} · ${escapeHtml(match.season ?? seasonLabel(match.season_end_year))}</a>`;
    // A source that publishes its own plain sentence about a match is quoted.
    const detail = match.explanation_text
      ?? (kind === "players" ? explanationText(match) : teamExplanationText(match));
    // A two-axis statistic (V12) names the defensive role beside the offensive one.
    const chip = styleChip(match.style, catalog) + styleChip(match.defense_type, null);
    return `<article class="similarity-card"><div class="similarity-score" aria-label="${number(score, 1)} out of 100">${number(score, 1)}</div><div><h3>${heading}</h3>${chip}<p>${escapeHtml(detail)}</p></div></article>`;
  }).join("");
}

function shortChartDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return String(value ?? "");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(match[2]) - 1]} ${Number(match[3])}`;
}

function normalizeCumulative(payload, exactSeason = scopeIsExact()) {
  const raw = payload.cumulative_series ?? payload.who_built_total?.points ?? [];
  if (!raw.length) return { series: [], labels: [] };
  const allSeasons = !exactSeason;
  if (raw[0].points) {
    const labelsMap = new Map();
    raw.forEach((series) => series.points.forEach((point) => labelsMap.set(point.game_id ?? point.x, {
      label: point.game_date ?? point.label ?? point.x,
      season: point.season ?? (point.season_end_year ? seasonLabel(point.season_end_year) : null),
      gameNumber: point.game_number ?? null,
    })));
    let previousSeason = null;
    const labels = [...labelsMap.entries()].map(([key, detail]) => {
      const separator = detail.season !== null && detail.season !== previousSeason;
      previousSeason = detail.season ?? previousSeason;
      return {
        key,
        label: detail.label,
        short: allSeasons ? (separator ? detail.season : "") : shortChartDate(detail.label),
        separator,
        forceLabel: allSeasons && separator,
        season: detail.season,
        gameNumber: detail.gameNumber,
      };
    });
    return { labels, series: raw.map((series, index) => ({ key: stableSeriesKey(series, index), player_id: series.player_id, label: series.label ?? series.player_name, points: series.points.map((point) => ({ index: labels.findIndex((label) => label.key === (point.game_id ?? point.x)), value: point.cumulative ?? point.value, tooltip: `Game ${point.game_number ?? "—"} · ${point.game_date ?? point.label}` })) })) };
  }
  const labels = raw.map((point) => {
    const pointSeason = seasonLabel(point.season_end_year);
    return {
      key: point.game_id,
      label: point.game_date,
      short: allSeasons ? (point.season_separator ? pointSeason : "") : shortChartDate(point.game_date),
      separator: Boolean(point.season_separator),
      forceLabel: allSeasons && Boolean(point.season_separator),
      season: pointSeason,
      gameNumber: point.game_number,
    };
  });
  const identities = new Map();
  raw.forEach((point) => point.values?.forEach((value) => identities.set(value.player_id ?? "others", value.player_name)));
  const series = [...identities.entries()].map(([id, label]) => ({
    key: id === "others" ? "others" : `player:${id}`,
    player_id: id === "others" ? null : id,
    label,
    points: raw.map((point, index) => {
      const value = point.values.find((item) => (item.player_id ?? "others") === id);
      return value ? { index, value: value.cumulative, tooltip: `Game ${point.game_number} · ${point.game_date}` } : null;
    }),
  }));
  return { labels, series };
}

function normalizeSeasonSeries(payload) {
  const source = payload.season_series ?? payload.contribution_chart ?? {};
  const series = source.series ?? [];
  const keys = [];
  for (const item of series) for (const point of item.points ?? []) {
    const key = source.mode === "season_totals" ? point.season_end_year : point.game_id;
    if (!keys.some((entry) => entry.key === key)) keys.push({ key, label: point.season ?? point.game_date, short: source.mode === "season_totals" ? String(point.season_end_year) : String(point.game_date).slice(5) });
  }
  keys.sort((left, right) => String(left.label).localeCompare(String(right.label)));
  const rolling = source.mode === "team_games" && byId("team-rolling").value === "rolling";
  return {
    labels: keys,
    series: series.map((item, index) => ({
      key: stableSeriesKey(item, index),
      player_id: item.player_id,
      label: item.player_name ?? item.label,
      points: keys.map((entry, index) => {
        const point = (item.points ?? []).find((candidate) =>
          (source.mode === "season_totals" ? candidate.season_end_year : candidate.game_id) === entry.key);
        if (!point) return null;
        return {
          index,
          value: rolling ? point.rolling : (point.raw ?? point.value),
          tooltip: source.mode === "season_totals" ? point.season : `${point.game_date} · raw ${number(point.raw)} · ${point.window_size}-game window`,
        };
      }),
    })),
    mode: source.mode,
    display: rolling ? "rolling" : "raw",
  };
}

function chartFallback(target, normalized, heading) {
  const visibleSeries = normalized.series.slice(0, 11);
  target.innerHTML = `<details><summary>View ${escapeHtml(heading)} as a table</summary><div class="table-wrap" role="region" tabindex="0" aria-label="${escapeHtml(heading)} table"><table><thead><tr><th>Point</th>${visibleSeries.map((series) => `<th>${escapeHtml(series.label)}</th>`).join("")}</tr></thead><tbody>${normalized.labels.map((label, index) => `<tr><th>${escapeHtml(label.label)}</th>${visibleSeries.map((series) => `<td class="numeric">${number(series.points.find((point) => point?.index === index)?.value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}

// The roster's three Context columns, the way the rankings table draws them:
// what he would have been paid with the six on-court factors switched off,
// then the three offense-side factors together and the three defense-side
// ones. Null when the source publishes no context for him.
const OFFENSE_CONTEXT_KEYS = ["general_offense", "teammate_offense", "opponent_defense"];
const DEFENSE_CONTEXT_KEYS = ["general_defense", "teammate_defense", "opponent_offense"];

function rosterContextSides(row) {
  const context = row.context ?? {};
  const keys = [...OFFENSE_CONTEXT_KEYS, ...DEFENSE_CONTEXT_KEYS];
  if (!keys.every((key) => Number.isFinite(Number(context[key])))) return null;
  const add = (list) => list.reduce((total, key) => total + Number(context[key]), 0);
  const offense = add(OFFENSE_CONTEXT_KEYS);
  const defense = add(DEFENSE_CONTEXT_KEYS);
  return { raw: Number(row.value_contributed) - offense - defense, offense, defense };
}

function rosterSortValue(row, key) {
  if (["offense", "defense", "other"].includes(key)) {
    return responsibilityValue(row.responsibility ?? row, key);
  }
  if (["context_raw", "offense_context", "defense_context"].includes(key)) {
    const sides = rosterContextSides(row);
    return sides ? sides[{ context_raw: "raw", offense_context: "offense", defense_context: "defense" }[key]] : null;
  }
  const aliases = {
    games: row.games ?? row.games_played,
    minutes: row.minutes ?? row.minutes_played,
    loss_value_contributed: row.loss_value_contributed ?? row.losses_contributed ?? row.loss_vc
      ?? Number(row.value_contributed) - Number(row.wins_contributed),
    value_per_game: row.value_per_game
      ?? (Number(row.games ?? row.games_played) ? Number(row.value_contributed) / Number(row.games ?? row.games_played) : null),
    losses: row.losses ?? Number(row.games ?? row.games_played) - Number(row.wins),
    player_type: row.player_type?.label ?? "",
    seasons_played: row.seasons_played ?? (row.seasons ?? []).length,
  };
  return aliases[key] ?? row[key];
}

function sortedRoster(payload) {
  const rows = [...(payload.players ?? payload.roster?.rows ?? [])];
  const direction = state.rosterSortDirection === "asc" ? 1 : -1;
  rows.sort((left, right) => {
    const a = rosterSortValue(left, state.rosterSortBy);
    const b = rosterSortValue(right, state.rosterSortBy);
    if (["player_name", "player_type"].includes(state.rosterSortBy)) {
      const comparison = String(a ?? "").localeCompare(String(b ?? ""), "en", { sensitivity: "base" });
      if (comparison) return comparison * direction;
    } else {
      const leftNumber = Number(a);
      const rightNumber = Number(b);
      const comparison = (Number.isFinite(leftNumber) ? leftNumber : -Infinity)
        - (Number.isFinite(rightNumber) ? rightNumber : -Infinity);
      if (comparison) return comparison * direction;
    }
    return Number(left.player_id) - Number(right.player_id);
  });
  return rows;
}

// Each type's own colour, as V13 publishes it: the colours the rankings
// page's "by player type" chart draws, so a type reads the same everywhere.
// Until they arrive (or for a source without them) the shared fallback holds.
async function loadTypeColors() {
  if (state.typeColors || state.typeColorsRequest) return state.typeColorsRequest;
  state.typeColorsRequest = fetch("/api/v13/type-trends")
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const colors = new Map((payload?.types ?? [])
        .filter((type) => /^#[0-9a-f]{6}$/iu.test(String(type.color ?? "")))
        .map((type) => [String(type.id), String(type.color)]));
      if (colors.size) state.typeColors = colors;
    })
    .catch(() => {});
  return state.typeColorsRequest;
}

function typeColor(id) {
  return state.typeColors?.get(String(id)) ?? styleVisual(id).color;
}

function rosterTypeCell(row) {
  const type = row.player_type;
  if (!type?.label) return '<span class="roster-type is-absent">Not described</span>';
  const defense = row.defense_role;
  const defenseChip = defense?.label
    ? `<span class="roster-type is-defense" style="--type-color:${escapeHtml(typeColor(defense.id))}">${escapeHtml(defense.label)}<small>on defense</small></span>`
    : "";
  // Which of his seasons the type describes stays in the hover text, so the
  // chip itself is only the type.
  const note = type.mixed
    ? `The type he played most of his minutes here as; ${integer(type.described_seasons)} of his seasons here are described.`
    : type.provisional ? "A thin record: the type is assigned rather than fitted." : "";
  return `<span class="roster-type"${note ? ` title="${escapeHtml(note)}"` : ""} style="--type-color:${escapeHtml(typeColor(type.id))}">${escapeHtml(type.label)}</span>${defenseChip}`;
}

const ROSTER_PAGE_SIZE = 10;

function rosterShareCell(amount, total, className, label) {
  const value = Number(amount);
  const base = Number(total);
  const share = Number.isFinite(value) && Math.abs(base) > 1e-12 ? `${number((value / base) * 100, 1)}%` : "—";
  return `<td class="numeric category-cell ${className}" data-label="${label}"><span class="category-value${value < 0 ? " negative-value" : ""}">${Number.isFinite(value) ? number(value) : "—"}</span><span class="category-percent">${share}</span></td>`;
}

function rosterContextCells(sides, total) {
  const base = Number(total);
  const cell = (amount, label, className, visibility) => {
    const share = sides && Math.abs(base) > 1e-12 ? (amount / base) * 100 : null;
    return `<td class="numeric category-cell context-composition-cell context-column ${visibility} ${className}" data-label="${label}"><span class="category-percent context-primary-percentage${share < 0 ? " negative-value" : ""}">${share === null ? "—" : `${number(share, 1)}%`}</span><span class="category-value context-raw-amount${amount < 0 ? " negative-value" : ""}">${sides ? `raw ${number(amount)}` : "—"}</span></td>`;
  };
  return [
    cell(sides?.raw, "Raw VC", "context-raw-cell", "context-raw-column"),
    cell(sides?.offense, "Offense Context", "context-offense-total-cell", "context-collapsed-column"),
    cell(sides?.defense, "Defense Context", "context-defense-total-cell", "context-collapsed-column"),
  ].join("");
}

function renderRoster(payload) {
  const allRows = sortedRoster(payload);
  const pageSize = ROSTER_PAGE_SIZE;
  const maximumOffset = Math.max(0, Math.floor(Math.max(0, allRows.length - 1) / pageSize) * pageSize);
  state.rosterOffset = Math.min(state.rosterOffset, maximumOffset);
  const rows = allRows.slice(state.rosterOffset, state.rosterOffset + pageSize);
  byId("team-roster-body").innerHTML = rows.length ? rows.map((row, index) => {
    const responsibility = row.responsibility ?? row;
    const total = row.value_contributed;
    const loss = row.loss_value_contributed ?? row.losses_contributed ?? row.loss_vc
      ?? (Number(row.value_contributed) - Number(row.wins_contributed));
    const perGame = row.value_per_game
      ?? (Number(row.games_played ?? row.games) ? Number(row.value_contributed) / Number(row.games_played ?? row.games) : null);
    // A source that publishes no context for this player gets no empty
    // disclosure to open.
    const contextRows = contextFactorRows(row.context);
    const contextDetails = contextRows.length
      ? `${COMPARE_ON ? '<span aria-hidden="true">·</span>' : ""}<details class="context-details roster-context"><summary class="compare-player-link">Context</summary><dl>${contextRows.map((item) => `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(signedAmount(item.value))}</dd>`).join("")}</dl></details>`
      : "";
    const games = row.games ?? row.games_played;
    const losses = row.losses ?? (Number.isFinite(Number(games)) && Number.isFinite(Number(row.wins)) ? Number(games) - Number(row.wins) : null);
    return `<tr>
      <td class="rank-number" data-label="Rank">${integer(state.rosterOffset + index + 1)}</td>
      <td class="player-cell">${mobilePhoto(row.player_id)}<a class="player-name player-profile-link" href="${entityUrl("players", row.player_id)}">${escapeHtml(row.player_name)}</a><span class="player-row-actions">${COMPARE_ON ? `<a class="compare-player-link" href="${comparisonUrl("players", row.player_id, row.player_name)}">Compare</a>` : ""}${contextDetails}</span></td>
      <td class="roster-type-cell" data-label="Type">${rosterTypeCell(row)}</td>
      <td class="numeric total-cell" data-label="Wins VC">${number(row.wins_contributed)}</td>
      <td class="numeric total-cell" data-label="VC">${number(row.value_contributed)}</td>
      <td class="numeric total-cell" data-label="Loss VC">${number(loss)}</td>
      <td class="numeric rate-cell" data-label="VC / game"><span class="rate-value${Number(perGame) < 0 ? " negative-value" : ""}">${number(perGame)}</span></td>
      ${rosterShareCell(responsibilityValue(responsibility, "offense"), total, "category-offense-cell", "Offense")}
      ${rosterShareCell(responsibilityValue(responsibility, "defense"), total, "category-defense-cell", "Defense")}
      ${rosterContextCells(rosterContextSides(row), total)}
      <td class="numeric summary-cell" data-label="GP">${integer(games)}</td>
      <td class="numeric summary-cell" data-label="Wins">${integer(row.wins)}</td>
      <td class="numeric summary-cell" data-label="Losses">${integer(losses)}</td>
    </tr>`;
  }).join("") : '<tr class="empty-row"><td colspan="15">No roster rows match this scope.</td></tr>';
  const footer = payload.roster?.footer ?? payload.roster_footer ?? payload.summary ?? {};
  const responsibility = footer.responsibility ?? footer;
  const footerValue = footer.value_contributed ?? footer.team_value_contributed;
  const footerWins = footer.wins_contributed ?? footer.team_wins_contributed;
  const footerGames = footer.games ?? footer.games_played;
  byId("team-roster-foot").innerHTML = `<tr><td class="rank-number"></td><th class="player-cell" scope="row">Team total</th><td>—</td><td class="numeric total-cell">${number(footerWins)}</td><td class="numeric total-cell">${number(footerValue)}</td><td class="numeric total-cell">${number(footer.loss_value_contributed ?? footer.losses_contributed ?? (Number(footerValue) - Number(footerWins)))}</td><td class="numeric">—</td>${rosterShareCell(responsibilityValue(responsibility, "offense"), footerValue, "category-offense-cell", "Offense")}${rosterShareCell(responsibilityValue(responsibility, "defense"), footerValue, "category-defense-cell", "Defense")}<td class="numeric context-column context-raw-column">—</td><td class="numeric context-column context-collapsed-column">—</td><td class="numeric context-column context-collapsed-column">—</td><td class="numeric summary-cell">${integer(footerGames)}</td><td class="numeric summary-cell">${integer(footer.wins)}</td><td class="numeric summary-cell">${integer(footer.losses)}</td></tr>`;
  // Phones read the roster as cards: player, type and the rankings' five
  // headline numbers, with the rest behind "More stats".
  // The card helper names cells from the last header row, which here holds
  // only the grouped columns; each cell already carries its own name, so it
  // is kept across the helper.
  const rosterCells = [...byId("team-roster-body").querySelectorAll("td")];
  const ownLabels = rosterCells.map((cell) => cell.dataset.label ?? "");
  prepareMobileTable(byId("team-roster-body"), {kind:"roster", main:1, hidden:[5,9,10,11,12,13,14]});
  rosterCells.forEach((cell, index) => { cell.dataset.label = ownLabels[index]; });
  const mobileSort = document.querySelector(".mobile-roster-sort select");
  if (mobileSort) mobileSort.value = state.rosterSortBy;
  const pagination = byId("team-roster-pagination");
  pagination.querySelector("span").textContent = allRows.length
    ? `${integer(state.rosterOffset + 1)}–${integer(state.rosterOffset + rows.length)} of ${integer(allRows.length)} players`
    : "0 players";
  pagination.querySelector('[data-roster-page="previous"]').disabled = state.rosterOffset <= 0;
  pagination.querySelector('[data-roster-page="next"]').disabled = state.rosterOffset + pageSize >= allRows.length;
  document.querySelectorAll("[data-roster-sort]").forEach((button) => {
    const active = button.dataset.rosterSort === state.rosterSortBy;
    const heading = button.closest("th");
    heading.setAttribute("aria-sort", active
      ? (state.rosterSortDirection === "asc" ? "ascending" : "descending")
      : "none");
    heading.classList.toggle("active-sort", active);
    const arrow = button.querySelector(".sort-arrow");
    if (arrow) arrow.textContent = active ? (state.rosterSortDirection === "asc" ? "↑" : "↓") : "↕";
  });
}

function teamChartPlayerIds(payload) {
  const explicit = payload.who_built_total?.players ?? [];
  if (explicit.length) {
    return explicit.map((row) => Number(row.player_id))
      .filter((value) => Number.isSafeInteger(value) && value > 0)
      .slice(0, 10);
  }
  const firstPoint = (payload.cumulative_series ?? [])[0];
  return (firstPoint?.values ?? []).map((row) => Number(row.player_id))
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .slice(0, 10);
}

function filterTeamPlayerOptions() {
  // The site's one folding rule, so "jokic" finds Jokić in the picker too.
  const query = foldName(byId("team-chart-player-search").value);
  byId("team-chart-player-options").querySelectorAll("label[data-search]").forEach((label) => {
    label.hidden = Boolean(query) && !label.dataset.search.includes(query);
  });
}

function updateTeamPlayerPickerState() {
  const options = [...byId("team-chart-player-options").querySelectorAll('input[data-team-player-id]')];
  const selected = options.filter((input) => input.checked);
  const atLimit = selected.length >= 10;
  options.forEach((input) => { input.disabled = atLimit && !input.checked; });
  const limitHint = atLimit ? " (max; uncheck one to add another)" : "";
  byId("team-chart-others").checked = state.teamOthersVisible;
  byId("team-chart-player-summary").textContent = `${integer(selected.length)} player${selected.length === 1 ? "" : "s"} selected${limitHint} · All Other Players ${state.teamOthersVisible ? "shown" : "hidden"}`;
}

function renderTeamPlayerPicker(payload) {
  const roster = [...(payload.players ?? payload.roster?.rows ?? [])]
    .sort((left, right) => String(left.player_name).localeCompare(String(right.player_name), "en", { sensitivity: "base" })
      || Number(left.player_id) - Number(right.player_id));
  const selected = state.teamChartPlayerIds.length ? state.teamChartPlayerIds
    : teamChartPlayerIds(payload).slice(0, matchMedia("(max-width: 760px)").matches ? 5 : 10);
  if (selected.length) state.teamChartPlayerIds = selected;
  const selectedIds = new Set(state.teamChartPlayerIds);
  const target = byId("team-chart-player-options");
  target.querySelectorAll("label").forEach((label) => label.remove());
  const othersLabel = document.createElement("label");
  othersLabel.className = "team-other-option";
  othersLabel.dataset.otherOption = "true";
  const othersInput = document.createElement("input");
  othersInput.id = "team-chart-others";
  othersInput.type = "checkbox";
  othersInput.value = "others";
  othersInput.checked = state.teamOthersVisible;
  const othersName = document.createElement("span");
  othersName.textContent = "All Other Players";
  othersLabel.append(othersInput, othersName);
  target.append(othersLabel);
  roster.forEach((row) => {
    const label = document.createElement("label");
    label.dataset.search = `${foldName(row.player_name)}${row.player_id}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(row.player_id);
    input.dataset.teamPlayerId = String(row.player_id);
    input.checked = selectedIds.has(Number(row.player_id));
    const name = document.createElement("span");
    name.textContent = row.player_name;
    label.append(input, name);
    target.append(label);
  });
  updateTeamPlayerPickerState();
  filterTeamPlayerOptions();
}

function renderTeam(payload) {
  // The source resolves the profile season — it falls back to the newest
  // selected one when the chosen season has left the selection — so the page
  // follows its answer rather than its own guess.
  const answered = payload.scopes?.profile?.season
    ?? payload.v10?.selection?.profile_season ?? null;
  if (answered && answered !== state.profileSeason) {
    state.profileSeason = answered;
    syncUrl("replace");
  }
  renderSource(payload.source);
  showHero(false);
  // The filters bar belongs to the totals and the roster, so it sits between
  // them; the team search moves up into the header, as it does for players.
  placeControls("team-summary-section");
  placeSearch("team-hero-search");
  updateMobileFilterScope();
  elements.directory.hidden = true;
  hideTeamLandscapePanel();
  elements.playerProfile.hidden = true;
  elements.teamProfile.hidden = false;
  const entity = payload.entity ?? payload.team;
  const summary = payload.summary ?? {};
  byId("team-name").textContent = teamName(entity);
  byId("team-monogram").textContent = teamLabel(entity);
  byId("team-identity").textContent = "Historical display names follow game date";
  const teamCompareLink = byId("team-compare-link");
  if (teamCompareLink) teamCompareLink.href = comparisonUrl("teams", teamId(entity), teamName(entity));
  document.title = `${teamName(entity)} · ${sourceTitle(payload.source)} Team Analytics`;
  byId("team-summary").innerHTML = [
    summaryCard("Games", integer(summary.games ?? summary.games_played)),
    summaryCard("Record", `${integer(summary.wins)}–${integer(summary.losses)}`, percent(summary.win_percentage ?? (Number(summary.games_played) ? Number(summary.wins) / Number(summary.games_played) : null))),
    summaryCard("Unique players", integer(summary.unique_players ?? (payload.players ?? payload.roster?.rows ?? []).length)),
    summaryCard("Offense", number(responsibilityValue(summary.responsibility ?? summary, "offense"))),
    summaryCard("Defense", number(responsibilityValue(summary.responsibility ?? summary, "defense"))),
  ].join("");
  renderRoster(payload);
  if (!state.typeColors) loadTypeColors().then(() => { if (state.typeColors && state.payload) renderRoster(state.payload); });
  renderTeamRosterStory(payload);
  renderV10Analytics(payload, "team");
}

// The chart's own seasons: every season the source covers unless the reader
// picked some in the chart's picker.
function teamChartSeasonLabels() {
  const available = allAvailableSeasonYears().map(seasonLabel);
  const picked = available.filter((season) => state.teamChartSeasons.includes(season));
  return picked.length ? picked : available;
}

function teamChartFilters() {
  const seasons = teamChartSeasonLabels();
  const result = {
    source: elements.source.value,
    scope: seasons.length === 1 ? "season" : "all",
    season: seasons.length === 1 ? seasons[0] : seasons,
    schedule: state.teamChartSchedule,
    time_mode: elements.timeMode.value,
    metric: state.teamChartMetric,
    team_id: state.selectedEntityId,
    lens: byId("team-v10-lens").value,
  };
  if (state.teamChartPlayerIds.length) {
    result.chart_player_ids = state.teamChartPlayerIds.join(",");
  }
  return result;
}

function renderTeamChartSeasonPicker(staged = null) {
  const available = allAvailableSeasonYears().map(seasonLabel);
  const applied = teamChartSeasonLabels();
  const chosen = staged ?? applied;
  const picked = new Set(chosen);
  if (!staged) {
    byId("team-chart-season-options").innerHTML = [...available].reverse()
      .map((season) => `<label class="season-ranking-option"><input type="checkbox" value="${escapeHtml(season)}" ${picked.has(season) ? "checked" : ""}/><span>${escapeHtml(season)}</span></label>`).join("");
  }
  const summary = !chosen.length ? "Choose seasons"
    : chosen.length === available.length ? "All seasons"
      : chosen.length <= 2 ? chosen.join(", ") : `${chosen.length} seasons`;
  byId("team-chart-season-summary").textContent = summary;
  const dirty = chosen.length > 0
    && (chosen.length !== applied.length || chosen.some((season, index) => season !== applied[index]));
  byId("team-chart-season-apply").disabled = !dirty;
  byId("team-chart-season-status").textContent = !chosen.length
    ? "Choose at least one season, then apply."
    : chosen.length === 1
      ? "One season is drawn game by game."
      : "Two or more seasons are drawn one point a season. Keep one to see every game.";
}

async function loadTeamChart() {
  if (state.kind !== "teams" || !state.selectedEntityId) return;
  state.chartController?.abort();
  const controller = new AbortController();
  state.chartController = controller;
  const workspace = document.querySelector(".team-chart-workspace");
  workspace.setAttribute("aria-busy", "true");
  renderTeamChartSeasonPicker();
  try {
    await yieldToUi(controller.signal);
    const payload = await state.adapter.query(elements.source.value, "team_profile", teamChartFilters(), { signal: controller.signal });
    await yieldToUi(controller.signal);
    state.chartPayload = payload;
    renderTeamPlayerPicker(payload);
    renderTeamChart(payload);
  } catch (caught) {
    if (caught.name === "AbortError") return;
    state.chartPayload = null;
    for (const id of ["team-cumulative-chart", "team-cumulative-fallback", "team-season-chart", "team-season-fallback"]) {
      byId(id).innerHTML = "";
    }
    byId("team-chart-note").textContent = `No chart for this selection. ${readableError(caught)}`;
  } finally {
    if (state.chartController === controller) workspace.setAttribute("aria-busy", "false");
  }
}

function renderTeamChart(payload) {
  if (!payload) return;
  const metricShort = state.teamChartMetric === "wins_contributed" ? "WC" : "VC";
  const exactSeason = teamChartSeasonLabels().length === 1;
  const cumulative = normalizeCumulative(payload, exactSeason);
  const seasonal = normalizeSeasonSeries(payload);
  cumulative.series = cumulative.series.filter((series) => stableSeriesKey(series, 0) === "others" ? state.teamOthersVisible : state.teamChartPlayerIds.includes(Number(series.player_id)));
  seasonal.series = seasonal.series.filter((series) => stableSeriesKey(series, 0) === "others" ? state.teamOthersVisible : state.teamChartPlayerIds.includes(Number(series.player_id)));
  const chartView = byId("team-chart-view").value;
  // One selected season is drawn game by game; several are drawn season by
  // season. Which one it is comes from the answer, not from the control, so a
  // source that can only answer by season never mislabels itself.
  const byGame = seasonal.mode !== "season_totals";
  byId("team-chart-view").querySelector('option[value="season"]').textContent = byGame
    ? "Player contribution by game" : "Player contribution by season";
  byId("team-cumulative-view").hidden = chartView !== "cumulative";
  byId("team-season-view").hidden = chartView !== "season";
  byId("team-rolling-control").hidden = chartView !== "season" || seasonal.mode === "season_totals";
  const note = byId("team-chart-note");
  let seasonalHeading;
  let seasonalLabel;
  if (seasonal.mode === "season_totals") {
    seasonalHeading = `Player ${metricShort} by season`;
    seasonalLabel = `${metricShort} by player and season`;
  } else if (seasonal.display === "rolling") {
    seasonalHeading = `Rolling player ${metricShort}`;
    seasonalLabel = `Trailing 10-game average ${metricShort} by player`;
  } else {
    seasonalHeading = `Player ${metricShort} by team game`;
    seasonalLabel = `${metricShort} by player and team game`;
  }
  if (chartView === "cumulative") {
    byId("team-chart-panel-title").textContent = `Cumulative ${metricShort} over team games`;
    note.textContent = exactSeason
      ? `The x-axis follows this team's games in chronological order, with dates shown along the axis. Each selected player's running ${metricShort} total ends at the right edge. All Other Players is available in the player picker and starts hidden. Hover or select a line to isolate it.`
      : `The x-axis follows every team game chronologically; labels and dividers mark each new season. Each selected player's running ${metricShort} total ends at the right edge. All Other Players is available in the player picker and starts hidden. Hover or select a line to isolate it.`;
    lineChart(byId("team-cumulative-chart"), cumulative.series, {
      xLabels: cumulative.labels,
      label: `Cumulative ${metricShort} by player over chronological team games`,
      interactiveSeries: true,
      fitViewport: true,
      xAxisTitle: exactSeason
        ? "Team games in chronological order · dates shown along the axis"
        : "Team games in chronological order · labels mark each new season",
    });
    chartFallback(byId("team-cumulative-fallback"), cumulative, "cumulative contribution");
  } else {
    byId("team-chart-panel-title").textContent = seasonalHeading;
    if (seasonal.mode === "season_totals") {
      note.textContent = `Each point is one selected player's non-cumulative ${metricShort} total for that season. A gap means the player did not represent this franchise in that season. All Other Players can be added from the player picker. Hover or select a line to isolate it.`;
    } else if (seasonal.display === "rolling") {
      note.textContent = `Each point is a trailing average over up to 10 chronological team games; tooltips retain the exact raw game value and actual window size. All Other Players can be added from the player picker.`;
    } else {
      note.textContent = `Each point is one selected player's ${metricShort} in that chronological team game; values do not accumulate. Switch to 10-game rolling to smooth the series. All Other Players can be added from the player picker.`;
    }
    lineChart(byId("team-season-chart"), seasonal.series, {
      xLabels: seasonal.labels,
      label: seasonalLabel,
      interactiveSeries: true,
      fitViewport: true,
      xAxisTitle: seasonal.mode === "season_totals" ? "Season" : "Team games in chronological order",
    });
    chartFallback(byId("team-season-fallback"), seasonal, seasonalLabel);
  }
}

function mergeDirectoryPayloads(payloads) {
  const byEntity = new Map();
  for (const payload of payloads) {
    for (const row of payload.rows ?? []) {
      const id = state.kind === "players" ? playerId(row) : teamId(row);
      if (!byEntity.has(id)) byEntity.set(id, {
        ...row,
        games_played: 0,
        games: 0,
        wins: 0,
        value_contributed: 0,
        wins_contributed: 0,
        _teams: new Map(),
      });
      const target = byEntity.get(id);
      target.games_played += Number(row.games_played ?? row.games ?? 0);
      target.games = target.games_played;
      target.wins += Number(row.wins ?? 0);
      target.value_contributed += Number(row.value_contributed ?? 0);
      target.wins_contributed += Number(row.wins_contributed ?? 0);
      for (const item of row.teams ?? []) target._teams.set(teamId(item), item);
    }
  }
  const rows = [...byEntity.values()].map((row) => {
    const result = { ...row, teams: [...row._teams.values()] };
    delete result._teams;
    return result;
  }).sort((left, right) => String(left.player_name ?? left.name).localeCompare(String(right.player_name ?? right.name))
    || (state.kind === "players" ? playerId(left) - playerId(right) : teamId(left) - teamId(right)));
  const offset = state.directoryOffset;
  const limit = directoryPageSize();
  return {
    ...payloads[0],
    state: rows.length ? "ready" : "empty",
    rows: rows.slice(offset, offset + limit),
    pagination: { offset, limit, total: rows.length },
  };
}

async function queryScopedPanel(panel, extraFilters = {}, signal = null) {
  const base = { ...filters(), ...extraFilters };
  const needsV10AllSeasonTeamMerge = elements.source.value === "v10"
    && scopeIsAll() && panel === "team_profile";
  // V11 answers a whole team selection in one request: it sums the roster, the
  // totals and the chart over exactly the seasons the page has ticked. Merging
  // thirteen per-season answers in the browser is what used to leave All
  // Seasons showing the most recent season alone.
  if (isV11Shaped() && panel === "team_profile") {
    return state.adapter.query(elements.source.value, panel, base, { signal });
  }
  // A team's top games carry their own season and schedule, set in that
  // table, and V11 answers one season or all of them in one request.
  if (isV11Shaped() && panel === "team_games") {
    return state.adapter.query(elements.source.value, panel, base, { signal });
  }
  if (!scopeIsMulti() && !needsV10AllSeasonTeamMerge) {
    return state.adapter.query(elements.source.value, panel, base, { signal });
  }
  if (panel.includes("similarity")) {
    // V11 answers for a span: the profile it has already returned carries the
    // most recent selected season's neighbours, which is what its own
    // `similarity_rule` says the answer is. Reading them beats a second
    // request, and beats telling a reader to pick one season.
    const style = state.payload?.v10?.similarity;
    const carried = panel.startsWith("player")
      ? (byId("player-similarity-mode").value === "career"
        ? style?.all_seasons : style?.same_season) ?? style?.matches
      : style?.matches;
    if (isV11Shaped() && (carried ?? []).length) {
      return {
        source: state.payload?.source,
        status: "available",
        mode: panel.startsWith("player") ? byId("player-similarity-mode").value : undefined,
        season: style?.season,
        matches: carried.map((match) => ({
          ...match,
          style: match.player_type ?? match.team_type ?? null,
          explanation_text: typeof match.explanation === "string" ? match.explanation : null,
        })),
      };
    }
    return {
      source: state.payload?.source,
      status: "unavailable",
      reason: panel.startsWith("player") ? "selected_span_not_supported" : "exact_season_required",
      matches: [],
    };
  }
  const payloads = await Promise.all(selectedSeasonLabels().flatMap((season) => {
    const offsets = panel === "players" ? [0, 250, 500] : [0];
    return offsets.map((offset) => state.adapter.query(
      elements.source.value,
      panel,
      { ...base, scope: "season", season, ...(["players", "teams"].includes(panel) ? { limit: 250, offset } : {}) },
      { signal },
    ));
  }));
  if (["players", "teams"].includes(panel)) return mergeDirectoryPayloads(payloads);
  if (["player_games", "team_games"].includes(panel)) {
    const rows = payloads.flatMap((payload) => payload.rows ?? [])
      .sort((left, right) => Number(right.value_contributed) - Number(left.value_contributed)
        || String(right.game_date).localeCompare(String(left.game_date)))
      .slice(0, 10).map((row, index) => ({ ...row, rank: index + 1 }));
    return {
      ...payloads[0],
      state: rows.length ? "ready" : "empty",
      rows,
      pagination: { limit: 10, offset: 0, total: rows.length },
    };
  }
  if (panel === "player_profile") {
    return withSpanProfile(
      mergePlayerSeasonProfiles(payloads, selectedSeasonLabels(), elements.metric.value),
      panel, base, signal,
    );
  }
  if (panel === "team_profile") {
    return withSpanProfile(
      mergeTeamSeasonProfiles(payloads, selectedSeasonLabels(), elements.metric.value),
      panel, base, signal,
    );
  }
  throw new Error(`Unsupported multi-season panel ${panel}.`);
}

// A statistic that cannot answer for a span has its seasons fetched one by one
// and added up here, which is right for the totals but leaves every profile
// block describing one of them. V11 does answer for a span, so the profile
// blocks are asked for once over the whole selection and replace the merged
// ones; the totals beside them stay the merge's, which is the same arithmetic.
async function withSpanProfile(merged, panel, base, signal) {
  if (!isV11Shaped()) return merged;
  try {
    const span = await state.adapter.query(elements.source.value, panel, base, { signal });
    if (!span?.v10) return merged;
    // The merge sums per-season answers, which cannot produce a rank: a place
    // in the league over a span is a rank of everybody's span, not of anyone's
    // seasons added up. The span request is that rank, so the card takes it.
    const summary = span.summary?.rank === undefined ? merged.summary : {
      ...merged.summary,
      rank: span.summary.rank,
      rank_metric: span.summary.rank_metric,
    };
    return { ...merged, v10: span.v10, summary, seasons: span.seasons ?? merged.seasons };
  } catch (caught) {
    if (caught.name === "AbortError") throw caught;
    return merged;
  }
}

async function supporting(panel, extraFilters, render) {
  state.supportingControllers.get(panel)?.abort();
  const controller = new AbortController();
  state.supportingControllers.set(panel, controller);
  const target = panel.includes("similarity")
    ? byId(panel.startsWith("player") ? "player-similarity" : "team-similarity")
    : byId(panel.startsWith("player") ? "player-games-body" : "team-games-body");
  if (target.tagName === "TBODY") {
    target.innerHTML = '<tr><td colspan="11">Loading current source and filters…</td></tr>';
    byId(`${panel.startsWith("player") ? "player" : "team"}-games-meta`).textContent = "Loading top 10…";
  } else {
    target.innerHTML = '<div class="similarity-empty">Loading current source and filters…</div>';
  }
  target.setAttribute("aria-busy", "true");
  try {
    await yieldToUi(controller.signal);
    const payload = await queryScopedPanel(panel, {
      ...filters({ supporting: true }),
      ...extraFilters,
    }, controller.signal);
    await yieldToUi(controller.signal);
    render(payload);
    target.setAttribute("aria-busy", "false");
  } catch (caught) {
    if (caught.name === "AbortError") return;
    target.setAttribute("aria-busy", "false");
    if (target.tagName === "TBODY") {
      target.innerHTML = `<tr><td colspan="11">${escapeHtml(readableError(caught))}</td></tr>`;
      byId(`${panel.startsWith("player") ? "player" : "team"}-games-meta`).textContent = "Unavailable";
    } else target.innerHTML = `<div class="similarity-empty">${escapeHtml(readableError(caught))}</div>`;
  }
}

function loadSupporting() {
  if (!state.selectedEntityId) return;
  if (state.kind === "players") {
    supporting("player_games", { outcome: byId("player-games-outcome").value, limit: 10, offset: 0 }, (payload) => {
      renderGames(payload, "players");
      if (state.pendingGameId) {
        openGameAnatomy({ dataset: {
          playerId: String(state.selectedEntityId),
          gameAnatomy: state.pendingGameId,
        } });
      }
    });
    if (isV11Shaped()) loadPlayerSeasonSimilarity();
    else supporting("player_similarity", { mode: byId("player-similarity-mode").value, limit: 5 }, (payload) => renderSimilarity(payload, "players"));
  } else {
    loadTeamGames();
    supporting("team_similarity", { limit: 5 }, (payload) => renderSimilarity(payload, "teams"));
    loadTeamChart();
  }
}

function teamGamesFilters() {
  const available = allAvailableSeasonYears().map(seasonLabel);
  const season = available.includes(state.teamGamesSeason) ? state.teamGamesSeason : "";
  return {
    outcome: byId("team-games-outcome").value,
    limit: 10,
    offset: 0,
    schedule: state.teamGamesSchedule,
    scope: season ? "season" : "all",
    season: season || available,
  };
}

function loadTeamGames() {
  const select = byId("team-games-season");
  const available = allAvailableSeasonYears().map(seasonLabel);
  select.innerHTML = `<option value="">All seasons</option>${[...available].reverse()
    .map((season) => `<option value="${escapeHtml(season)}">${escapeHtml(season)}</option>`).join("")}`;
  select.value = available.includes(state.teamGamesSeason) ? state.teamGamesSeason : "";
  byId("team-games-schedule").value = state.teamGamesSchedule;
  supporting("team_games", teamGamesFilters(), (payload) => renderGames(payload, "teams"));
}

async function load({ historyMode = "replace" } = {}) {
  state.controller?.abort();
  for (const controller of state.supportingControllers.values()) controller.abort();
  state.supportingControllers.clear();
  if (state.selectedEntityId) {
    const prefix = state.kind === "players" ? "player" : "team";
    byId(`${prefix}-games-body`).innerHTML = '<tr><td colspan="11">Loading current source and filters…</td></tr>';
    byId(`${prefix}-games-meta`).textContent = "Loading top 10…";
    byId(`${prefix}-similarity`).innerHTML = '<div class="similarity-empty">Loading current source and filters…</div>';
  }
  const controller = new AbortController();
  state.controller = controller;
  setLoading(state.selectedEntityId ? "Loading profile…" : `Searching ${state.kind}…`);
  if (state.unavailableSource) {
    finishLoading();
    updateEntityNavigation();
    showError("The requested browser-local experiment is unavailable in this browser or needs to be rerun. The requested URL has been preserved.");
    return;
  }
  syncUrl(historyMode);
  try {
    await yieldToUi(controller.signal);
    const panel = state.selectedEntityId
      ? (state.kind === "players" ? "player_profile" : "team_profile")
      : state.kind;
    const payload = await queryScopedPanel(panel, {}, controller.signal);
    await yieldToUi(controller.signal);
    state.payload = payload;
    if (state.selectedEntityId && payload.state === "empty") {
      finishLoading();
      showEmpty(`No ${state.kind === "players" ? "player" : "team"} data matches the selected scope and filters.`);
      return;
    }
    if (state.selectedEntityId) {
      if (state.kind === "players") renderPlayer(payload);
      else renderTeam(payload);
      loadSupporting();
    } else renderDirectory(payload);
    finishLoading();
  } catch (caught) {
    if (caught.name === "AbortError") return;
    finishLoading();
    elements.directory.hidden = true;
    hideTeamLandscapePanel();
    elements.playerProfile.hidden = true;
    elements.teamProfile.hidden = true;
    showError(readableError(caught));
  }
}

function configurePage() {
  document.querySelector(`[data-entity-nav="${state.kind}"]`)?.setAttribute("aria-current", "page");
  if (fixedPlayerPage()) {
    byId("entity-controls").hidden = true;
    document.body.classList.add("fixed-player-page");
    placeSearch("entity-hero-search");
  }
  if (state.kind === "teams") {
    byId("entity-title").textContent = "Find a franchise";
    byId("entity-lede").textContent = "See who built a franchise’s value, follow every roster over time, and compare season-level roster shapes.";
    elements.searchLabel.textContent = "Find a team";
    elements.search.placeholder = "Team name";
    elements.source.closest("label").hidden = true;
  }
}

// What the picker is showing before Apply is pressed, the way the rankings
// page does it: the summary follows the boxes as they are ticked, the status
// line says what to do next, and Apply is live only when the staged selection
// differs from the one the page is already showing.
function stagedSeasonYears() {
  return [...elements.seasonOptions.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => Number(input.value))
    .sort((left, right) => left - right);
}

function stagedScopeLabel(years) {
  const available = allAvailableSeasonYears();
  if (years.length === available.length && available.every((year) => years.includes(year))) {
    return "All Seasons";
  }
  const labels = years.map(seasonLabel);
  if (!labels.length) return "Choose seasons";
  if (labels.length === 1) return labels[0];
  const contiguous = years.every((year, index) => index === 0 || year === years[index - 1] + 1);
  return contiguous
    ? `${labels[0]}–${labels.at(-1)} · ${labels.length} seasons`
    : `${labels.length} selected seasons`;
}

function updateSeasonPickerPresentation() {
  const staged = stagedSeasonYears();
  const applied = [...state.selectedSeasons].sort((left, right) => left - right);
  const dirty = staged.length > 0
    && (staged.length !== applied.length || staged.some((year, index) => year !== applied[index]));
  elements.seasonSummary.textContent = staged.length
    ? stagedScopeLabel(staged) : selectedScopeLabel();
  elements.seasonApply.disabled = !dirty;
  elements.seasonStatus.textContent = !staged.length
    ? "Choose at least one season, then apply."
    : dirty
      ? "Apply this selection to update the profile."
      : `${staged.length} of ${allAvailableSeasonYears().length} seasons selected. `
        + "Choose any combination, or use a five-season shortcut.";
}

function setScopeOptions(sourceId, requested = selectedSeasonLabels()) {
  const selectedSource = state.sources.find((source) => source.id === sourceId);
  const years = selectedSource?.scope?.season_end_years?.map(Number)
    ?? selectedSource?.selected_seasons?.map(Number)
    ?? SEASONS;
  const allowed = new Set(years);
  const requestedYears = (Array.isArray(requested) ? requested : [requested])
    .filter((value) => /^\d{4}-\d{2}$/.test(String(value)))
    .map((value) => Number(String(value).slice(0, 4)) + 1)
    .filter((year) => allowed.has(year));
  state.selectedSeasons = requestedYears.length
    ? [...new Set(requestedYears)].sort((left, right) => left - right)
    : [...years].map(Number).sort((left, right) => left - right);
  // The same markup the rankings page uses, so the picker reads at the same
  // size: `.season-ranking-option` is what carries the row height, the gap and
  // the type size, and a bare <label> inherited the panel's instead.
  elements.seasonOptions.innerHTML = [...years].map(Number).sort((left, right) => right - left)
    .map((year) => `<label class="season-ranking-option"><input type="checkbox" value="${year}" ${state.selectedSeasons.includes(year) ? "checked" : ""}/><span>${escapeHtml(seasonLabel(year))}</span></label>`).join("");
  elements.scope.innerHTML = '<option value="all">All Seasons</option><option value="multi">Selected seasons</option>';
  if (scopeIsExact()) {
    const label = selectedSeasonLabels()[0];
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    elements.scope.append(option);
    elements.scope.value = label;
  } else elements.scope.value = scopeIsAll() ? "all" : "multi";
  updateSeasonPickerPresentation();
  const career = byId("player-similarity-mode").querySelector('option[value="career"]');
  // V11, V12 and V13 compare against every season they cover, however many
  // that is, so their "All seasons" list is always there; the older sources
  // need the full thirteen-season history for a career comparison.
  if (career) career.disabled = !V11_SHAPED_SOURCES.has(sourceId)
    && (years.length !== SEASONS.length || !SEASONS.every((year) => allowed.has(year)));
  if (career?.disabled && byId("player-similarity-mode").value === "career") {
    byId("player-similarity-mode").value = "season";
  }
}

async function bootstrapAdapter() {
  let experimentClient = null;
  const manifestUrl = document.querySelector('meta[name="original-package-manifest"]')?.content;
  const manifestSha256 = document.querySelector('meta[name="original-package-manifest-sha256"]')?.content;
  if (manifestUrl && /^[0-9a-f]{64}$/.test(manifestSha256 ?? "")) {
    try {
      experimentClient = await createOriginalExperimentClient({
        manifestAuthority: { url: manifestUrl, sha256: manifestSha256, releaseId: V9_RELEASE_ID },
      });
      await experimentClient.markStaleReleases(V9_RELEASE_ID);
    } catch (caught) {
      console.warn("Browser-local experiments are unavailable on entity pages.", caught);
      experimentClient = null;
    }
  }
  state.experimentClient = experimentClient;
  state.adapter = createV9EntitySourceAdapter({ experimentClient });
  const sources = await state.adapter.listSources();
  state.sources = sources;
  elements.source.innerHTML = "";
  const official = document.createElement("optgroup");
  official.label = "Official";
  sources.filter((source) => source.kind === "official").forEach((source) => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.label;
    official.append(option);
  });
  elements.source.append(official);
  const experiments = sources.filter((source) => source.kind === "experiment");
  if (experiments.length) {
    const local = document.createElement("optgroup");
    local.label = "My Experiments";
    experiments.forEach((source) => {
      const option = document.createElement("option");
      option.value = source.id;
      option.textContent = source.completion_status === "stale"
        ? `${source.label} (needs rerun)` : source.label;
      local.append(option);
    });
    elements.source.append(local);
  }
}

function bindEvents() {
  let searchTimer = null;
  elements.search.addEventListener("input", () => {
    if (state.selectedEntityId) return;
    state.directoryOffset = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load({ historyMode: "replace" }), 220);
  });
  elements.search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    state.selectedEntityId = null;
    state.directoryOffset = 0;
    load({ historyMode: "push" });
  });
  [elements.source, elements.schedule, elements.timeMode, elements.metric]
    .forEach((control) => control.addEventListener("change", () => {
      if (control === elements.source) {
        state.unavailableSource = null;
        elements.source.querySelectorAll("[data-unavailable-source]").forEach((option) => option.remove());
        setScopeOptions(elements.source.value, selectedSeasonLabels());
      }
      state.directoryOffset = 0;
      state.rosterOffset = 0;
      if (state.kind === "teams" && control === elements.source) {
        state.teamChartPlayerIds = [];
        state.teamOthersVisible = false;
      }
      if (state.kind === "teams" && control === elements.metric) {
        state.rosterSortBy = elements.metric.value;
        state.rosterSortDirection = "desc";
      }
      updatePlayerChartControlLabels();
      load({ historyMode: "push" });
    }));
  document.querySelectorAll("[data-entity-season-shortcut]").forEach((button) => button.addEventListener("click", () => {
    const inputs = [...elements.seasonOptions.querySelectorAll('input[type="checkbox"]')];
    const shortcut = button.dataset.entitySeasonShortcut;
    const selected = shortcut === "all" ? inputs
      : shortcut === "first-five" ? inputs.slice(-5)
        : shortcut === "last-five" ? inputs.slice(0, 5) : [];
    const selectedValues = new Set(selected.map((input) => input.value));
    inputs.forEach((input) => { input.checked = selectedValues.has(input.value); });
    updateSeasonPickerPresentation();
  }));
  elements.seasonOptions.addEventListener("change", (event) => {
    if (event.target.matches('input[type="checkbox"]')) updateSeasonPickerPresentation();
  });
  elements.seasonApply.addEventListener("click", () => {
    const years = [...elements.seasonOptions.querySelectorAll('input[type="checkbox"]:checked')]
      .map((input) => Number(input.value)).sort((left, right) => left - right);
    if (!years.length) {
      elements.seasonStatus.textContent = "Choose at least one season.";
      return;
    }
    state.selectedSeasons = years;
    elements.scope.value = scopeIsAll() ? "all" : (scopeIsExact() ? selectedSeasonLabels()[0] : "multi");
    if (scopeIsExact() && ![...elements.scope.options].some((option) => option.value === selectedSeasonLabels()[0])) {
      elements.scope.add(new Option(selectedSeasonLabels()[0], selectedSeasonLabels()[0]));
      elements.scope.value = selectedSeasonLabels()[0];
    }
    updateSeasonPickerPresentation();
    elements.seasonPicker.open = false;
    state.directoryOffset = 0;
    state.rosterOffset = 0;
    updatePlayerChartControlLabels();
    load({ historyMode: "push" });
  });
  byId("player-games-outcome").addEventListener("change", () => { syncUrl("push"); loadSupporting(); });
  byId("team-games-outcome").addEventListener("change", () => { syncUrl("push"); loadTeamGames(); });
  byId("team-games-season").addEventListener("change", (event) => {
    state.teamGamesSeason = event.target.value;
    syncUrl("push");
    loadTeamGames();
  });
  byId("team-games-schedule").addEventListener("change", (event) => {
    state.teamGamesSchedule = event.target.value;
    syncUrl("push");
    loadTeamGames();
  });
  // The chart's own seasons, schedule and metric. Each change asks for the
  // chart again and starts the player picker over from that answer's leaders.
  const reloadTeamChartScope = () => {
    state.teamChartPlayerIds = [];
    syncUrl("push");
    loadTeamChart();
  };
  byId("team-chart-schedule").addEventListener("change", (event) => {
    state.teamChartSchedule = event.target.value;
    reloadTeamChartScope();
  });
  byId("team-chart-metric").addEventListener("change", (event) => {
    state.teamChartMetric = event.target.value;
    reloadTeamChartScope();
  });
  const stagedTeamChartSeasons = () => [...byId("team-chart-season-options").querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value).reverse();
  byId("team-chart-season-options").addEventListener("change", () => renderTeamChartSeasonPicker(stagedTeamChartSeasons()));
  document.querySelectorAll("[data-team-chart-season-shortcut]").forEach((button) => button.addEventListener("click", () => {
    const inputs = [...byId("team-chart-season-options").querySelectorAll('input[type="checkbox"]')];
    const shortcut = button.dataset.teamChartSeasonShortcut;
    const count = /^last-(\d+)$/.exec(shortcut)?.[1];
    const keep = new Set((shortcut === "all" ? inputs : count ? inputs.slice(0, Number(count)) : []).map((input) => input.value));
    inputs.forEach((input) => { input.checked = keep.has(input.value); });
    renderTeamChartSeasonPicker(stagedTeamChartSeasons());
  }));
  byId("team-chart-season-apply").addEventListener("click", () => {
    const chosen = stagedTeamChartSeasons();
    if (!chosen.length) return;
    const available = allAvailableSeasonYears().map(seasonLabel);
    state.teamChartSeasons = chosen.length === available.length ? [] : chosen;
    byId("team-chart-season-picker").open = false;
    reloadTeamChartScope();
  });
  byId("player-similarity-mode").addEventListener("change", () => {
    syncUrl("push");
    if (isV11Shaped()) loadPlayerSeasonSimilarity();
    else loadSupporting();
  });
  byId("player-similarity-season").addEventListener("change", (event) => {
    state.similaritySeason = event.target.value || null;
    syncUrl("push");
    loadPlayerSeasonSimilarity();
  });
  [byId("player-v10-lens"), byId("team-v10-lens")].forEach((control) => control.addEventListener("change", () => {
    if (!state.selectedEntityId || !state.payload?.v10) return;
    load({ historyMode: "push" });
  }));
  byId("player-chart-metrics").addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    if (!byId("player-chart-metrics").querySelector('input[type="checkbox"]:checked')) {
      event.target.checked = true;
    }
    syncUrl("push");
    if (state.kind === "players" && state.payload) renderPlayerContributionChart(state.payload);
  });
  byId("player-chart-mode").addEventListener("change", () => {
    syncUrl("push");
    if (state.kind === "players" && state.payload) renderPlayerContributionChart(state.payload);
  });
  // The chart's own seasons apply as they are ticked: nothing is fetched, so
  // there is nothing for an Apply button to wait for.
  const redrawChartSeasons = () => {
    syncUrl("push");
    if (state.kind === "players" && state.payload) renderPlayerContributionChart(state.payload);
  };
  byId("player-chart-season-options").addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const inputs = [...byId("player-chart-season-options").querySelectorAll('input[type="checkbox"]')];
    const checked = inputs.filter((input) => input.checked).map((input) => input.value).reverse();
    if (!checked.length) { event.target.checked = true; return; }
    state.chartSeasonChoice = checked.length === inputs.length ? "all" : checked.join(",");
    redrawChartSeasons();
  });
  document.querySelectorAll("[data-chart-season-shortcut]").forEach((button) => button.addEventListener("click", () => {
    state.chartSeasonChoice = button.dataset.chartSeasonShortcut;
    redrawChartSeasons();
  }));
  // A panel opened for the first time draws its charts at the width it now
  // has; drawn while closed they would have measured nothing.
  document.addEventListener("panel-toggle", (event) => {
    if (!event.detail?.open || state.kind !== "teams" || !state.payload || !state.selectedEntityId) return;
    const panel = event.target;
    if (panel.contains(byId("team-cumulative-chart"))) renderTeamChart(state.chartPayload);
    if (panel.id === "team-roster-map-panel") renderTeamRosterStory(state.payload);
    if (panel.id === "v10-team-analytics") renderV10Analytics(state.payload, "team");
  });
  document.addEventListener("panel-toggle", (event) => {
    if (!event.detail?.open || state.kind !== "players" || !state.payload || !state.selectedEntityId) return;
    const panel = event.target;
    if (panel.contains(byId("player-career-chart"))) renderPlayerContributionChart(state.payload);
    if (panel.id === "v10-player-analytics") renderV10Analytics(state.payload, "player");
  });
  byId("team-rolling").addEventListener("change", () => {
    syncUrl("push");
    renderTeamChart(state.chartPayload);
  });
  byId("team-chart-view").addEventListener("change", () => {
    syncUrl("push");
    renderTeamChart(state.chartPayload);
  });
  // Clicking a season card chooses the season the profile describes. It is a
  // real button, so the keyboard reaches it without any handling of its own.
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-profile-season]");
    if (!button) return;
    const season = button.dataset.profileSeason || null;
    if (season === state.profileSeason) return;
    state.profileSeason = season;
    // The similar-players list follows the profile's season again until the
    // reader picks one of its own in that panel.
    state.similaritySeason = null;
    load({ historyMode: "push" });
  });
  byId("team-chart-player-search").addEventListener("input", filterTeamPlayerOptions);
  byId("team-roster-map-minutes").addEventListener("change", () => {
    if (state.kind === "teams" && state.payload) renderTeamRosterStory(state.payload);
  });
  byId("team-chart-player-options").addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    if (event.target.id === "team-chart-others") {
      state.teamOthersVisible = event.target.checked;
      updateTeamPlayerPickerState();
      syncUrl("push");
      renderTeamChart(state.chartPayload);
      return;
    }
    const options = [...byId("team-chart-player-options").querySelectorAll('input[data-team-player-id]')];
    const selected = options.filter((input) => input.checked);
    if (selected.length === 0) {
      event.target.checked = true;
      updateTeamPlayerPickerState();
      return;
    }
    if (selected.length > 10) {
      event.target.checked = false;
      updateTeamPlayerPickerState();
      return;
    }
    state.teamChartPlayerIds = selected.map((input) => Number(input.value));
    updateTeamPlayerPickerState();
    syncUrl("push");
    loadTeamChart();
  });
  [byId("player-games-body"), byId("team-games-body")].forEach((body) => body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-game-anatomy]");
    if (button) openGameAnatomy(button);
  }));
  byId("game-anatomy-close").addEventListener("click", () => byId("game-anatomy-dialog").close());
  byId("game-anatomy-dialog").addEventListener("click", (event) => {
    if (event.target === byId("game-anatomy-dialog")) byId("game-anatomy-dialog").close();
  });
  document.querySelectorAll("[data-roster-sort]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.rosterSort;
    if (state.rosterSortBy === key) state.rosterSortDirection = state.rosterSortDirection === "asc" ? "desc" : "asc";
    else {
      state.rosterSortBy = key;
      state.rosterSortDirection = key === "player_name" ? "asc" : "desc";
    }
    state.rosterOffset = 0;
    syncUrl("replace");
    if (state.payload) renderRoster(state.payload);
  }));
  document.querySelectorAll("[data-roster-page]").forEach((button) => button.addEventListener("click", () => {
    const direction = button.dataset.rosterPage === "next" ? 1 : -1;
    state.rosterOffset = Math.max(0, state.rosterOffset + direction * ROSTER_PAGE_SIZE);
    syncUrl("push");
    if (state.payload) renderRoster(state.payload);
  }));
  document.querySelectorAll("[data-directory-page]").forEach((button) => button.addEventListener("click", () => {
    const direction = button.dataset.directoryPage === "next" ? 1 : -1;
    state.directoryOffset = Math.max(0, state.directoryOffset + direction * directoryPageSize());
    load({ historyMode: "push" });
  }));
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.payload || !state.selectedEntityId) return;
      if (state.kind === "players") {
        renderPlayerContributionChart(state.payload);
      } else {
        renderTeam(state.payload);
        renderTeamChart(state.chartPayload);
      }
    }, 140);
  });
  window.addEventListener("popstate", () => { applyUrlState(); load(); });
}

async function initialize() {
  configurePage();
  bindEvents();
  setupMobilePage();
  mobileRosterSort(key => { state.rosterSortBy=key; state.rosterSortDirection="desc"; state.rosterOffset=0; if(state.payload)renderRoster(state.payload); });
  await bootstrapAdapter();
  applyUrlState();
  await load();
}

initialize().catch((caught) => {
  finishLoading();
  showError(readableError(caught));
});
