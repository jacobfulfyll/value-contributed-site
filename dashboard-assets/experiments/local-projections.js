import { fsum } from "./binary64.js";
import {
  BrowserExperimentError,
  ENGINE_VERSION,
  RESULT_SCHEMA_VERSION,
  TIME_MODES,
} from "./protocol.js";

export const LOCAL_DASHBOARD_PANELS = Object.freeze([
  "rankings",
  "top_games",
  "high_value_records",
  "season_leaders",
  "rolling_graphs",
  "postseason_lift",
  "player_details",
  "responsibility",
  "context",
]);

export const LOCAL_PROJECTION_VERSION =
  "value-contributed-original-browser-local-projections-v1";

const ALL_SEASONS = "All Seasons";
const HIGH_VALUE_GAME_THRESHOLD = 0.4;
const DISPLAY_FIRST_SEASON_START = 2013;
const QUALIFICATION_FIRST_SEASON_START = Object.freeze({ 1: 2013, 3: 2015, 5: 2017 });
const POSTSEASON_LIFT_QUALIFICATION_RANK = 10;
const POSTSEASON_LIFT_CAREER_RANK_CUTOFF = 100;
const CONTEXT_FACTORS = Object.freeze([
  "general_offense",
  "general_defense",
  "teammate_offense",
  "teammate_defense",
  "opponent_offense",
  "opponent_defense",
]);
const OFFENSE_CONTEXT_FACTORS = Object.freeze([
  "general_offense",
  "teammate_offense",
  "opponent_defense",
]);
const DEFENSE_CONTEXT_FACTORS = Object.freeze([
  "general_defense",
  "teammate_defense",
  "opponent_offense",
]);
const RESPONSIBILITY_SIDES = Object.freeze(["offense", "defense", "other"]);
const PHASES = Object.freeze([
  "All",
  "Regular Season",
  "PlayIn",
  "Playoffs",
  "Postseason",
]);
const GRAPH_PHASES = Object.freeze(["All", "Regular Season", "Postseason"]);
const OUTCOMES = Object.freeze(["Both", "Wins", "Losses"]);
const BREAKDOWN_MODES = Object.freeze(["vc", "wc"]);
const WINDOW_YEARS = Object.freeze([1, 3, 5]);
const RANKING_SORTS = Object.freeze([
  "selected_metric",
  "value_contributed",
  "wins_contributed",
  "losses_contributed",
  "value_per_win",
  "value_per_game",
  "value_per_game_rank",
  "value_per_loss",
  "win_loss_difference",
  "postseason_value_per_game_difference",
  "postseason_rank_change",
  "games_played",
  "wins",
  "losses",
  "offense_value",
  "defense_value",
  "other_value",
  "side_context_raw_value",
  "offense_context_value",
  "defense_context_value",
  "general_offense_context_value",
  "general_defense_context_value",
  "teammate_offense_context_value",
  "opponent_offense_context_value",
  "teammate_defense_context_value",
  "opponent_defense_context_value",
]);
const HIGH_VALUE_SORTS = Object.freeze([
  "games_played",
  "wins",
  "value_contributed",
  "wins_contributed",
  "winning_percentage",
]);

const PANEL_SORTS = Object.freeze({
  rankings: new Set([...RANKING_SORTS, "final_value_contributed"]),
  high_value_records: new Set(HIGH_VALUE_SORTS),
  responsibility: new Set([...RANKING_SORTS, "final_value_contributed"]),
  context: new Set([...RANKING_SORTS, "final_value_contributed"]),
});

const PANEL_ALIASES = Object.freeze({
  rankings: "rankings",
  top_games: "top_games",
  "top-games": "top_games",
  high_value_records: "high_value_records",
  "high-value-records": "high_value_records",
  season_leaders: "season_leaders",
  "season-wins-leaders": "season_leaders",
  rolling_graphs: "rolling_graphs",
  "rolling-trends": "rolling_graphs",
  postseason_lift: "postseason_lift",
  "postseason-lift-trends": "postseason_lift",
  player_details: "player_details",
  "player-context": "player_details",
  responsibility: "responsibility",
  context: "context",
});

const COMMON_RANKING_FILTERS = Object.freeze([
  "season",
  "phase",
  "metric",
  "garbage_time_mode",
  "time_mode",
  "breakdown_mode",
  "sort_by",
  "sort_direction",
  "search",
  "limit",
  "offset",
]);
const PANEL_FILTERS = Object.freeze({
  rankings: new Set(COMMON_RANKING_FILTERS),
  top_games: new Set([
    "season", "phase", "outcome", "garbage_time_mode", "time_mode", "limit", "offset",
  ]),
  high_value_records: new Set([
    "phase", "garbage_time_mode", "time_mode", "sort_by", "sort_direction", "limit", "offset",
  ]),
  season_leaders: new Set([
    "phase", "garbage_time_mode", "time_mode", "limit", "offset",
  ]),
  rolling_graphs: new Set([
    "phase", "window_years", "garbage_time_mode", "time_mode",
  ]),
  postseason_lift: new Set([
    "window_years", "garbage_time_mode", "time_mode",
  ]),
  player_details: new Set([
    "player_id", "season", "phase", "garbage_time_mode", "time_mode",
    "breakdown_mode", "page", "per_page", "limit", "offset",
  ]),
  responsibility: new Set(COMMON_RANKING_FILTERS),
  context: new Set(COMMON_RANKING_FILTERS),
});

const TEAM_METADATA = Object.freeze({
  "1610612737": ["ATL", "Atlanta Hawks"],
  "1610612738": ["BOS", "Boston Celtics"],
  "1610612739": ["CLE", "Cleveland Cavaliers"],
  "1610612740": ["NOP", "New Orleans Pelicans"],
  "1610612741": ["CHI", "Chicago Bulls"],
  "1610612742": ["DAL", "Dallas Mavericks"],
  "1610612743": ["DEN", "Denver Nuggets"],
  "1610612744": ["GSW", "Golden State Warriors"],
  "1610612745": ["HOU", "Houston Rockets"],
  "1610612746": ["LAC", "LA Clippers"],
  "1610612747": ["LAL", "Los Angeles Lakers"],
  "1610612748": ["MIA", "Miami Heat"],
  "1610612749": ["MIL", "Milwaukee Bucks"],
  "1610612750": ["MIN", "Minnesota Timberwolves"],
  "1610612751": ["BKN", "Brooklyn Nets"],
  "1610612752": ["NYK", "New York Knicks"],
  "1610612753": ["ORL", "Orlando Magic"],
  "1610612754": ["IND", "Indiana Pacers"],
  "1610612755": ["PHI", "Philadelphia 76ers"],
  "1610612756": ["PHX", "Phoenix Suns"],
  "1610612757": ["POR", "Portland Trail Blazers"],
  "1610612758": ["SAC", "Sacramento Kings"],
  "1610612759": ["SAS", "San Antonio Spurs"],
  "1610612760": ["OKC", "Oklahoma City Thunder"],
  "1610612761": ["TOR", "Toronto Raptors"],
  "1610612762": ["UTA", "Utah Jazz"],
  "1610612763": ["MEM", "Memphis Grizzlies"],
  "1610612764": ["WAS", "Washington Wizards"],
  "1610612765": ["DET", "Detroit Pistons"],
  "1610612766": ["CHA", "Charlotte Hornets"],
});

function projectionError(code, message, details = undefined) {
  return new BrowserExperimentError(code, message, details);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)]));
  }
  return value;
}

function finite(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw projectionError("invalid_projection_row", `${path} must be a finite number.`);
  }
  return number;
}

function safeInteger(
  value,
  path,
  { positive = false, minimum = null, maximum = null } = {},
) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)
      || (positive && number <= 0)
      || (minimum !== null && number < minimum)
      || (maximum !== null && number > maximum)) {
    throw projectionError("invalid_projection_row", `${path} must be a valid integer.`);
  }
  return number;
}

function nonemptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw projectionError("invalid_projection_row", `${path} must be a non-empty string.`);
  }
  return value;
}

function exactNumericRecord(
  value,
  keys,
  path,
  { positive = false, nonnegative = false } = {},
) {
  if (!isRecord(value)) {
    throw projectionError("invalid_projection_row", `${path} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw projectionError(
      "invalid_projection_row",
      `${path} must contain exactly ${expected.join(", ")}.`,
    );
  }
  return Object.fromEntries(keys.map((key) => {
    const number = finite(value[key], `${path}.${key}`);
    if (positive && number <= 0) {
      throw projectionError("invalid_projection_row", `${path}.${key} must be positive.`);
    }
    if (nonnegative && number < 0) {
      throw projectionError("invalid_projection_row", `${path}.${key} cannot be negative.`);
    }
    return [key, number];
  }));
}

function numericComponentMap(value, path) {
  if (!isRecord(value)) {
    throw projectionError("invalid_projection_row", `${path} must be an object.`);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key.length === 0) {
      throw projectionError("invalid_projection_row", `${path} has an empty component key.`);
    }
    return [key, finite(child, `${path}.${key}`)];
  }));
}

function sideComponentRecord(value, path) {
  if (!isRecord(value)) {
    throw projectionError("invalid_projection_row", `${path} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...RESPONSIBILITY_SIDES].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw projectionError(
      "invalid_projection_row",
      `${path} must contain exactly ${expected.join(", ")}.`,
    );
  }
  return Object.fromEntries(RESPONSIBILITY_SIDES.map((side) => [
    side,
    numericComponentMap(value[side], `${path}.${side}`),
  ]));
}

function objectRecord(value, path) {
  if (!isRecord(value)) {
    throw projectionError("invalid_projection_row", `${path} must be an object.`);
  }
  return copy(value);
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= 5e-12 * Math.max(1, Math.abs(left), Math.abs(right));
}

function sha256(value, path) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw projectionError("invalid_projection_row", `${path} must be a lowercase SHA-256.`);
  }
  return value;
}

function seasonLabel(seasonEndYear) {
  const start = seasonEndYear - 1;
  return `${start}-${String(seasonEndYear).slice(-2).padStart(2, "0")}`;
}

function normalizeRow(source, index) {
  const path = `rows[${index}]`;
  if (!isRecord(source)) {
    throw projectionError("invalid_projection_row", `${path} must be an object.`);
  }
  if (source.partial !== undefined && source.partial !== false) {
    throw projectionError(
      "partial_projection_row",
      `${path} is not a checkpointed player-game result.`,
    );
  }
  if (source.schema_version !== RESULT_SCHEMA_VERSION) {
    throw projectionError(
      "invalid_projection_row",
      `${path}.schema_version must match ${RESULT_SCHEMA_VERSION}.`,
    );
  }
  if (source.engine_version !== ENGINE_VERSION) {
    throw projectionError(
      "invalid_projection_row",
      `${path}.engine_version must match ${ENGINE_VERSION}.`,
    );
  }
  const configurationReceipt = sha256(
    source.configuration_receipt,
    `${path}.configuration_receipt`,
  );
  const gameId = String(source.game_id ?? "");
  if (!gameId) throw projectionError("invalid_projection_row", `${path}.game_id is required.`);
  const gameDate = nonemptyString(source.game_date, `${path}.game_date`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)
      || Number.isNaN(Date.parse(`${gameDate}T00:00:00Z`))) {
    throw projectionError("invalid_projection_row", `${path}.game_date must be an ISO date.`);
  }
  const seasonEndYear = safeInteger(source.season_end_year, `${path}.season_end_year`, {
    minimum: 2014,
    maximum: 2026,
  });
  if (source.seasonEndYear !== undefined
      && safeInteger(source.seasonEndYear, `${path}.seasonEndYear`) !== seasonEndYear) {
    throw projectionError("invalid_projection_row", `${path} has conflicting season values.`);
  }
  const seasonType = nonemptyString(source.season_type, `${path}.season_type`);
  if (!["Regular Season", "PlayIn", "Playoffs"].includes(seasonType)) {
    throw projectionError("invalid_projection_row", `${path}.season_type is unsupported.`);
  }
  const timeMode = nonemptyString(source.time_mode, `${path}.time_mode`);
  if (!TIME_MODES.includes(timeMode)) {
    throw projectionError("invalid_projection_row", `${path}.time_mode is unsupported.`);
  }
  if (source.timeMode !== undefined && source.timeMode !== timeMode) {
    throw projectionError("invalid_projection_row", `${path} has conflicting time modes.`);
  }
  const playerId = safeInteger(source.player_id, `${path}.player_id`, { positive: true });
  if (source.canonical_player_id === undefined) {
    throw projectionError(
      "projection_identity_missing",
      `${path} is missing canonical_player_id required by the v2 result contract.`,
    );
  }
  const canonicalPlayerId = safeInteger(
    source.canonical_player_id,
    `${path}.canonical_player_id`,
    { positive: true },
  );
  const playerName = canonicalPlayerId === 202710
    ? "Jimmy Butler III"
    : nonemptyString(source.player_name, `${path}.player_name`);
  const teamId = safeInteger(source.team_id, `${path}.team_id`, { positive: true });
  const opponentId = safeInteger(source.opponent_id, `${path}.opponent_id`, { positive: true });
  if (teamId === opponentId) {
    throw projectionError("invalid_projection_row", `${path} cannot use the same team and opponent.`);
  }
  if (typeof source.win_loss !== "boolean") {
    throw projectionError("invalid_projection_row", `${path}.win_loss must be boolean.`);
  }
  const contexts = exactNumericRecord(source.context_components, CONTEXT_FACTORS, `${path}.context_components`);
  const responsibility = exactNumericRecord(
    source.responsibility,
    RESPONSIBILITY_SIDES,
    `${path}.responsibility`,
    { nonnegative: true },
  );
  const factorLogs = exactNumericRecord(source.factor_logs, CONTEXT_FACTORS, `${path}.factor_logs`);
  const factorMultipliers = exactNumericRecord(
    source.factor_multipliers,
    CONTEXT_FACTORS,
    `${path}.factor_multipliers`,
    { positive: true },
  );
  const rawVc = finite(source.raw_vc, `${path}.raw_vc`);
  sideComponentRecord(source.raw_components, `${path}.raw_components`);
  const offenseContext = finite(source.offense_context, `${path}.offense_context`);
  const defenseContext = finite(source.defense_context, `${path}.defense_context`);
  const totalContext = finite(source.total_context, `${path}.total_context`);
  const finalValue = finite(source.final_value_contributed, `${path}.final_value_contributed`);
  const derivedOffenseContext = fsum(OFFENSE_CONTEXT_FACTORS.map((factor) => contexts[factor]));
  const derivedDefenseContext = fsum(DEFENSE_CONTEXT_FACTORS.map((factor) => contexts[factor]));
  const derivedTotalContext = fsum(CONTEXT_FACTORS.map((factor) => contexts[factor]));
  if (!nearlyEqual(offenseContext, derivedOffenseContext)
      || !nearlyEqual(defenseContext, derivedDefenseContext)
      || !nearlyEqual(totalContext, derivedTotalContext)
      || !nearlyEqual(finalValue, fsum([rawVc, ...CONTEXT_FACTORS.map((factor) => contexts[factor])]))
      || !nearlyEqual(finalValue, fsum(RESPONSIBILITY_SIDES.map((side) => responsibility[side])))) {
    throw projectionError(
      "projection_identity_failed",
      `${path} does not close its context and responsibility identities.`,
    );
  }
  if (source.seconds_played === undefined) {
    throw projectionError(
      "projection_activity_missing",
      `${path} is missing authoritative seconds_played activity required for dashboard parity.`,
    );
  }
  const secondsPlayed = safeInteger(source.seconds_played, `${path}.seconds_played`, {
    minimum: 0,
  });
  if (source.secondsPlayed !== undefined
      && safeInteger(source.secondsPlayed, `${path}.secondsPlayed`, { minimum: 0 }) !== secondsPlayed) {
    throw projectionError("invalid_projection_row", `${path} has conflicting activity fields.`);
  }
  if (source.played !== undefined && typeof source.played !== "boolean") {
    throw projectionError("invalid_projection_row", `${path}.played must be boolean.`);
  }
  const appeared = secondsPlayed > 0;
  if (source.played !== undefined && source.played !== appeared) {
    throw projectionError("invalid_projection_row", `${path} has conflicting activity fields.`);
  }
  const location = source.location;
  if (!["home", "away"].includes(location)) {
    throw projectionError(
      "projection_location_missing",
      `${path}.location must be the verified home/away value.`,
    );
  }
  const combinedOffenseMultiplier = finite(
    source.combined_offense_multiplier,
    `${path}.combined_offense_multiplier`,
  );
  const combinedDefenseMultiplier = finite(
    source.combined_defense_multiplier,
    `${path}.combined_defense_multiplier`,
  );
  if (combinedOffenseMultiplier <= 0 || combinedDefenseMultiplier <= 0) {
    throw projectionError("invalid_projection_row", `${path} has a non-positive combined multiplier.`);
  }
  const signedAdjustedTotal = finite(source.signed_adjusted_total, `${path}.signed_adjusted_total`);
  const positiveTotal = finite(source.positive_total, `${path}.positive_total`);
  if (positiveTotal < 0) {
    throw projectionError("invalid_projection_row", `${path}.positive_total cannot be negative.`);
  }
  const responsibilityFormula = exactNumericRecord(
    source.responsibility_formula,
    RESPONSIBILITY_SIDES,
    `${path}.responsibility_formula`,
    { nonnegative: true },
  );
  const responsibilityEvidence = sideComponentRecord(
    source.responsibility_component_evidence,
    `${path}.responsibility_component_evidence`,
  );
  const responsibilityDisplayClose = objectRecord(
    source.responsibility_display_close,
    `${path}.responsibility_display_close`,
  );
  const contextDisplayClose = objectRecord(
    source.context_display_close,
    `${path}.context_display_close`,
  );
  const responsibilityRowHash = source.responsibility_row_hash
    ?? source.full_responsibility_receipt
    ?? null;
  return {
    game_id: gameId,
    game_date: gameDate,
    season_end_year: seasonEndYear,
    season: seasonLabel(seasonEndYear),
    season_start: seasonEndYear - 1,
    season_type: seasonType,
    time_mode: timeMode,
    team_id: teamId,
    opponent_id: opponentId,
    player_id: canonicalPlayerId,
    source_player_id: playerId,
    canonical_player_id: canonicalPlayerId,
    player_name: playerName,
    win_loss: source.win_loss,
    appeared,
    seconds_played: secondsPlayed,
    location,
    raw_offense: finite(source.raw_offense, `${path}.raw_offense`),
    raw_defense: finite(source.raw_defense, `${path}.raw_defense`),
    raw_other: finite(source.raw_other, `${path}.raw_other`),
    raw_total: finite(source.raw_total, `${path}.raw_total`),
    raw_vc: rawVc,
    context_components: contexts,
    offense_context: offenseContext,
    defense_context: defenseContext,
    total_context: totalContext,
    factor_logs: factorLogs,
    factor_multipliers: factorMultipliers,
    combined_offense_multiplier: combinedOffenseMultiplier,
    combined_defense_multiplier: combinedDefenseMultiplier,
    adjusted_offense: finite(source.adjusted_offense, `${path}.adjusted_offense`),
    adjusted_defense: finite(source.adjusted_defense, `${path}.adjusted_defense`),
    adjusted_other: finite(source.adjusted_other, `${path}.adjusted_other`),
    signed_adjusted_total: signedAdjustedTotal,
    positive_total: positiveTotal,
    final_value_contributed: finalValue,
    responsibility,
    responsibility_basis: exactNumericRecord(
      source.responsibility_basis,
      RESPONSIBILITY_SIDES,
      `${path}.responsibility_basis`,
      { nonnegative: true },
    ),
    responsibility_formula: responsibilityFormula,
    responsibility_display_close: responsibilityDisplayClose,
    responsibility_component_evidence: responsibilityEvidence,
    context_display_close: contextDisplayClose,
    calculation_row_hash: sha256(source.row_hash, `${path}.row_hash`),
    responsibility_row_hash: responsibilityRowHash === null
      ? null
      : sha256(responsibilityRowHash, `${path}.responsibility_row_hash`),
    configuration_receipt: configurationReceipt,
    experiment_id: source.experimentId ?? source.experiment_id ?? null,
  };
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) {
    throw projectionError("invalid_projection_rows", "Stored player-game rows must be an array.");
  }
  const normalized = rows.map(normalizeRow);
  const identities = new Set();
  const configurationReceipts = new Set();
  const experimentIds = new Set();
  for (const row of normalized) {
    const identity = [row.game_id, row.time_mode, row.team_id, row.player_id].join("\u001f");
    if (identities.has(identity)) {
      throw projectionError("duplicate_projection_row", `Duplicate player-game row ${identity}.`);
    }
    identities.add(identity);
    if (row.configuration_receipt !== null) configurationReceipts.add(row.configuration_receipt);
    if (row.experiment_id !== null) experimentIds.add(String(row.experiment_id));
  }
  if (configurationReceipts.size > 1) {
    throw projectionError(
      "mixed_projection_configuration",
      "Player-game rows from different configurations cannot be projected together.",
    );
  }
  if (experimentIds.size > 1) {
    throw projectionError(
      "mixed_projection_experiment",
      "Player-game rows from different browser experiments cannot be projected together.",
    );
  }
  return normalized;
}

function assertConfigurationMatchesRows(configuration, rows) {
  if (!isRecord(configuration)) return;
  if (configuration.published === false) {
    throw projectionError(
      "experiment_not_published",
      "Only complete local experiments can be projected into Rankings.",
    );
  }
  const rowReceipt = rows[0]?.configuration_receipt ?? null;
  const configuredReceipt = configuration.configurationReceipt
    ?? configuration.configuration_receipt
    ?? null;
  if (rowReceipt !== null && configuredReceipt !== null && rowReceipt !== configuredReceipt) {
    throw projectionError(
      "projection_configuration_mismatch",
      "Stored rows do not match the selected experiment configuration receipt.",
    );
  }
  const rowExperimentId = rows.find((row) => row.experiment_id !== null)?.experiment_id ?? null;
  const configuredExperimentId = configuration.experimentId
    ?? configuration.experiment_id
    ?? null;
  if (rowExperimentId !== null && configuredExperimentId !== null
      && String(rowExperimentId) !== String(configuredExperimentId)) {
    throw projectionError(
      "projection_experiment_mismatch",
      "Stored rows do not belong to the selected browser experiment.",
    );
  }
}

function optionChoice(value, choices, path, fallback) {
  const selected = value ?? fallback;
  if (!choices.includes(selected)) {
    throw projectionError("invalid_projection_filter", `${path} is unsupported.`);
  }
  return selected;
}

function optionInteger(value, path, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const selected = value ?? fallback;
  const number = Number(selected);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw projectionError("invalid_projection_filter", `${path} must be an integer from ${minimum} through ${maximum}.`);
  }
  return number;
}

function normalizeSeason(value = ALL_SEASONS) {
  if (value === ALL_SEASONS) return ALL_SEASONS;
  if (Number.isSafeInteger(Number(value)) && String(value).length === 4) {
    return seasonLabel(Number(value));
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) {
    throw projectionError("invalid_projection_filter", "season must be All Seasons or YYYY-YY.");
  }
  const start = Number(value.slice(0, 4));
  const expected = String(start + 1).slice(-2).padStart(2, "0");
  if (value.slice(-2) !== expected) {
    throw projectionError("invalid_projection_filter", "season must name consecutive years.");
  }
  return value;
}

function normalizeTimeMode(options) {
  const snake = options.garbage_time_mode;
  const direct = options.time_mode;
  if (snake !== undefined && direct !== undefined && snake !== direct) {
    throw projectionError("invalid_projection_filter", "time_mode and garbage_time_mode disagree.");
  }
  return optionChoice(direct ?? snake, TIME_MODES, "time mode", "competitive");
}

function phaseMatches(row, phase) {
  if (phase === "All") return true;
  if (phase === "Postseason") return ["PlayIn", "Playoffs"].includes(row.season_type);
  return row.season_type === phase;
}

function selectedRows(rows, options, { graph = false, season = true } = {}) {
  const timeMode = normalizeTimeMode(options);
  const phase = optionChoice(options.phase, graph ? GRAPH_PHASES : PHASES, "phase", "All");
  const selectedSeason = season ? normalizeSeason(options.season) : ALL_SEASONS;
  return {
    timeMode,
    phase,
    season: selectedSeason,
    rows: rows.filter((row) => row.time_mode === timeMode
      && (selectedSeason === ALL_SEASONS || row.season === selectedSeason)
      && phaseMatches(row, phase)),
  };
}

function comparePlayerId(left, right) {
  const leftId = String(left.player_id);
  const rightId = String(right.player_id);
  if (leftId === rightId) return 0;
  return leftId < rightId ? -1 : 1;
}

function compareNullable(left, right, direction = "desc") {
  const leftNull = left === null || left === undefined || Number.isNaN(left);
  const rightNull = right === null || right === undefined || Number.isNaN(right);
  if (leftNull || rightNull) {
    if (leftNull && rightNull) return 0;
    return leftNull ? 1 : -1;
  }
  if (left === right) return 0;
  const sign = direction === "asc" ? 1 : -1;
  return (left < right ? -1 : 1) * sign;
}

function rowNumber(items, comparator, property) {
  [...items].sort(comparator).forEach((item, index) => {
    item[property] = index + 1;
  });
}

function percent(value, denominator) {
  return denominator === 0 ? null : (100 * value) / denominator;
}

function ratio(value, denominator) {
  return denominator === 0 ? null : value / denominator;
}

function sum(rows, getter) {
  return fsum(rows.map(getter));
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = key(row);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

function recentTeamRows(rows) {
  const byTeam = new Map();
  for (const row of rows) {
    const current = byTeam.get(row.team_id);
    if (!current || row.game_date > current.game_date
        || (row.game_date === current.game_date && row.game_id > current.game_id)) {
      byTeam.set(row.team_id, row);
    }
  }
  return [...byTeam.values()].sort((left, right) => {
    if (left.game_date !== right.game_date) return right.game_date.localeCompare(left.game_date);
    if (left.game_id !== right.game_id) return right.game_id.localeCompare(left.game_id);
    return left.team_id - right.team_id;
  });
}

function dashboardTeam(teamId, gameDate, teamMetadata = TEAM_METADATA) {
  const id = String(teamId);
  const configured = teamMetadata[id] ?? teamMetadata[Number(id)] ?? null;
  const pair = Array.isArray(configured)
    ? configured
    : configured && [configured.abbreviation, configured.name];
  let abbreviation = pair?.[0] ?? id;
  let name = pair?.[1] ?? `NBA team ${id}`;
  if (id === "1610612766" && gameDate !== null && gameDate !== undefined
      && String(gameDate) < "2014-07-01") {
    name = "Charlotte Bobcats";
  }
  return { id, abbreviation: String(abbreviation), name: String(name) };
}

function projectionMetadata(configuration, rows, options = {}) {
  const root = isRecord(configuration) ? configuration : {};
  const runId = options.run_id ?? options.experiment_id
    ?? root.experimentId ?? root.experiment_id ?? null;
  const releaseId = options.release_id ?? root.releaseId ?? root.release_id ?? null;
  const configurationReceipt = options.configuration_receipt
    ?? root.configurationReceipt
    ?? root.configuration_receipt
    ?? rows.find((row) => row.configuration_receipt)?.configuration_receipt
    ?? null;
  const calculationReceipt = options.calculation_receipt
    ?? root.experimentReceipt
    ?? root.experiment_receipt
    ?? root.aggregateReceipt
    ?? root.aggregate_receipt
    ?? null;
  return {
    release_id: releaseId,
    run_id: runId,
    configuration_receipt: configurationReceipt,
    calculation_receipt: calculationReceipt,
    certification_status: "browser_local_complete",
    stat_version: options.stat_version ?? "original",
  };
}

function projectionReleaseReceipt(configuration, options = {}) {
  const root = isRecord(configuration) ? configuration : {};
  return options.release_receipt
    ?? root.releaseReceipt
    ?? root.release_receipt
    ?? root.manifestSha256
    ?? root.manifest_sha256
    ?? null;
}

function paginate(rows, options, { defaultLimit = Number.MAX_SAFE_INTEGER } = {}) {
  const offset = optionInteger(options.offset, "offset", 0);
  const limit = optionInteger(options.limit, "limit", defaultLimit, { minimum: 1 });
  return { rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
}

function comparisonByPlayer(seasonRows) {
  const totals = [];
  for (const [playerId, rows] of groupBy(seasonRows, (row) => row.player_id)) {
    const regular = rows.filter((row) => row.season_type === "Regular Season");
    const postseason = rows.filter((row) => ["PlayIn", "Playoffs"].includes(row.season_type));
    const regularGames = regular.filter((row) => row.appeared).length;
    const postseasonGames = postseason.filter((row) => row.appeared).length;
    if (regularGames === 0 || postseasonGames === 0) continue;
    const regularValue = sum(regular, (row) => row.final_value_contributed);
    const postseasonValue = sum(postseason, (row) => row.final_value_contributed);
    totals.push({
      player_id: playerId,
      regular_games: regularGames,
      postseason_games: postseasonGames,
      regular_value_contributed: regularValue,
      postseason_value_contributed: postseasonValue,
      regular_value_per_game: regularValue / regularGames,
      postseason_value_per_game: postseasonValue / postseasonGames,
      regular_wins_contributed: sum(
        regular.filter((row) => row.win_loss),
        (row) => row.final_value_contributed,
      ),
      postseason_wins_contributed: sum(
        postseason.filter((row) => row.win_loss),
        (row) => row.final_value_contributed,
      ),
    });
  }
  rowNumber(
    totals,
    (left, right) => compareNullable(left.regular_wins_contributed, right.regular_wins_contributed)
      || comparePlayerId(left, right),
    "regular_season_rank",
  );
  rowNumber(
    totals,
    (left, right) => compareNullable(left.postseason_wins_contributed, right.postseason_wins_contributed)
      || comparePlayerId(left, right),
    "postseason_rank",
  );
  return new Map(totals.map((row) => [row.player_id, {
    ...row,
    postseason_value_per_game_difference:
      row.postseason_value_per_game - row.regular_value_per_game,
    postseason_rank_change: row.regular_season_rank - row.postseason_rank,
  }]));
}

function rankingRows(prepared, options, teamMetadata) {
  const timeMode = normalizeTimeMode(options);
  const phase = optionChoice(options.phase, PHASES, "phase", "All");
  const season = normalizeSeason(options.season);
  const breakdownMode = optionChoice(options.breakdown_mode, BREAKDOWN_MODES, "breakdown_mode", "vc");
  const metric = optionChoice(
    options.metric,
    ["value_contributed", "wins_contributed"],
    "metric",
    "value_contributed",
  );
  const requestedSortBy = options.sort_by === "final_value_contributed"
    ? "value_contributed"
    : options.sort_by ?? "wins_contributed";
  const responseSortBy = optionChoice(
    requestedSortBy,
    RANKING_SORTS,
    "sort_by",
    "wins_contributed",
  );
  const sortKey = responseSortBy === "selected_metric" ? metric : responseSortBy;
  if (sortKey === "hustle_value") {
    throw projectionError(
      "unsupported_projection_sort",
      "Original responsibility has Offense, Defense, and Other; not Hustle.",
    );
  }
  const sortDirection = optionChoice(options.sort_direction, ["asc", "desc"], "sort_direction", "desc");
  const seasonRows = prepared.filter((row) => row.time_mode === timeMode
    && (season === ALL_SEASONS || row.season === season));
  const scoped = seasonRows.filter((row) => phaseMatches(row, phase));
  const comparisons = comparisonByPlayer(seasonRows);
  const totals = [];
  for (const [playerId, rows] of groupBy(scoped, (row) => row.player_id)) {
    const winsRows = rows.filter((row) => row.win_loss);
    const gamesPlayed = rows.filter((row) => row.appeared).length;
    const wins = rows.filter((row) => row.appeared && row.win_loss).length;
    const valueContributed = sum(rows, (row) => row.final_value_contributed);
    const winsContributed = sum(winsRows, (row) => row.final_value_contributed);
    const offensiveValue = sum(rows, (row) => row.responsibility.offense);
    const defensiveValue = sum(rows, (row) => row.responsibility.defense);
    const otherValue = sum(rows, (row) => row.responsibility.other);
    const offensiveWins = sum(winsRows, (row) => row.responsibility.offense);
    const defensiveWins = sum(winsRows, (row) => row.responsibility.defense);
    const otherWins = sum(winsRows, (row) => row.responsibility.other);
    const rawVc = sum(rows, (row) => row.raw_vc);
    const winsRawVc = sum(winsRows, (row) => row.raw_vc);
    const contextValues = Object.fromEntries(CONTEXT_FACTORS.map((factor) => [
      factor,
      sum(rows, (row) => row.context_components[factor]),
    ]));
    const winsContextValues = Object.fromEntries(CONTEXT_FACTORS.map((factor) => [
      factor,
      sum(winsRows, (row) => row.context_components[factor]),
    ]));
    const offenseContext = sum(rows, (row) => row.offense_context);
    const defenseContext = sum(rows, (row) => row.defense_context);
    const winsOffenseContext = sum(winsRows, (row) => row.offense_context);
    const winsDefenseContext = sum(winsRows, (row) => row.defense_context);
    const losses = gamesPlayed - wins;
    const lossesContributed = valueContributed - winsContributed;
    const selectedTotal = breakdownMode === "wc" ? winsContributed : valueContributed;
    const selectedRaw = breakdownMode === "wc" ? winsRawVc : rawVc;
    const selectedOffenseContext = breakdownMode === "wc" ? winsOffenseContext : offenseContext;
    const selectedDefenseContext = breakdownMode === "wc" ? winsDefenseContext : defenseContext;
    const selectedContexts = breakdownMode === "wc" ? winsContextValues : contextValues;
    const teams = recentTeamRows(rows).map((row) => dashboardTeam(row.team_id, row.game_date, teamMetadata));
    const comparison = comparisons.get(playerId) ?? {};
    totals.push({
      rank: null,
      season,
      player_id: String(playerId),
      _player_id_number: playerId,
      player_name: rows.map((row) => row.player_name).sort().at(-1),
      teams,
      games_played: gamesPlayed,
      wins,
      losses,
      value_contributed: valueContributed,
      wins_contributed: winsContributed,
      losses_contributed: lossesContributed,
      value_per_win: ratio(winsContributed, wins),
      value_per_game: ratio(valueContributed, gamesPlayed),
      value_per_game_rank: null,
      value_per_loss: ratio(lossesContributed, losses),
      win_loss_difference: null,
      regular_games: comparison.regular_games ?? null,
      postseason_games: comparison.postseason_games ?? null,
      regular_value_contributed: comparison.regular_value_contributed ?? null,
      postseason_value_contributed: comparison.postseason_value_contributed ?? null,
      regular_value_per_game: comparison.regular_value_per_game ?? null,
      postseason_value_per_game: comparison.postseason_value_per_game ?? null,
      postseason_value_per_game_difference:
        comparison.postseason_value_per_game_difference ?? null,
      regular_wins_contributed: comparison.regular_wins_contributed ?? null,
      postseason_wins_contributed: comparison.postseason_wins_contributed ?? null,
      regular_season_rank: comparison.regular_season_rank ?? null,
      postseason_rank: comparison.postseason_rank ?? null,
      postseason_rank_change: comparison.postseason_rank_change ?? null,
      offense_value: breakdownMode === "wc" ? offensiveWins : offensiveValue,
      defense_value: breakdownMode === "wc" ? defensiveWins : defensiveValue,
      hustle_value: 0,
      other_value: breakdownMode === "wc" ? otherWins : otherValue,
      offensive_value_contributed: offensiveValue,
      defensive_value_contributed: defensiveValue,
      other_value_contributed: otherValue,
      offensive_value_contributed_pct: percent(offensiveValue, valueContributed),
      defensive_value_contributed_pct: percent(defensiveValue, valueContributed),
      other_value_contributed_pct: percent(otherValue, valueContributed),
      offensive_wins_contributed: offensiveWins,
      defensive_wins_contributed: defensiveWins,
      other_wins_contributed: otherWins,
      offensive_wins_contributed_pct: percent(offensiveWins, winsContributed),
      defensive_wins_contributed_pct: percent(defensiveWins, winsContributed),
      other_wins_contributed_pct: percent(otherWins, winsContributed),
      raw_no_context_value: rawVc,
      teammate_context_value: offenseContext,
      opponent_context_value: defenseContext,
      raw_no_context_pct: percent(rawVc, valueContributed),
      teammate_context_pct: percent(offenseContext, valueContributed),
      opponent_context_pct: percent(defenseContext, valueContributed),
      wins_raw_no_context_value: winsRawVc,
      wins_teammate_context_value: winsOffenseContext,
      wins_opponent_context_value: winsDefenseContext,
      wins_raw_no_context_pct: percent(winsRawVc, winsContributed),
      wins_teammate_context_pct: percent(winsOffenseContext, winsContributed),
      wins_opponent_context_pct: percent(winsDefenseContext, winsContributed),
      side_context_raw_value: selectedRaw,
      side_context_raw_pct: percent(selectedRaw, selectedTotal),
      offense_context_value: selectedOffenseContext,
      defense_context_value: selectedDefenseContext,
      offense_context_pct: percent(selectedOffenseContext, selectedTotal),
      defense_context_pct: percent(selectedDefenseContext, selectedTotal),
      general_offense_context_value: selectedContexts.general_offense,
      general_defense_context_value: selectedContexts.general_defense,
      general_offense_context_pct: percent(selectedContexts.general_offense, selectedTotal),
      general_defense_context_pct: percent(selectedContexts.general_defense, selectedTotal),
      teammate_offense_context_value: selectedContexts.teammate_offense,
      opponent_offense_context_value: selectedContexts.opponent_offense,
      teammate_defense_context_value: selectedContexts.teammate_defense,
      opponent_defense_context_value: selectedContexts.opponent_defense,
      teammate_offense_context_pct: percent(selectedContexts.teammate_offense, selectedTotal),
      opponent_offense_context_pct: percent(selectedContexts.opponent_offense, selectedTotal),
      teammate_defense_context_pct: percent(selectedContexts.teammate_defense, selectedTotal),
      opponent_defense_context_pct: percent(selectedContexts.opponent_defense, selectedTotal),
    });
  }
  rowNumber(
    totals,
    (left, right) => compareNullable(left.value_per_game, right.value_per_game)
      || comparePlayerId(left, right),
    "value_per_game_rank",
  );
  for (const row of totals) {
    row.win_loss_difference = row.value_per_win === null || row.value_per_loss === null
      ? null
      : row.value_per_win - row.value_per_loss;
  }
  const sorted = [...totals].sort((left, right) =>
    compareNullable(left[sortKey], right[sortKey], sortDirection)
      || comparePlayerId(left, right));
  sorted.forEach((row, index) => { row.rank = index + 1; });
  const search = String(options.search ?? "").trim().toLocaleLowerCase();
  const searched = search
    ? sorted.filter((row) => row.player_name.toLocaleLowerCase().includes(search))
    : sorted;
  const page = paginate(searched, options, { defaultLimit: 50 });
  page.rows.forEach((row) => { delete row._player_id_number; });
  return {
    rows: page.rows,
    total: searched.length,
    scope: {
      season,
      phase,
      timeMode,
      breakdownMode,
      metric,
      sortBy: responseSortBy,
      sortDirection,
    },
  };
}

function projectRankingsPrepared(prepared, options, configuration, teamMetadata) {
  const projected = rankingRows(prepared, options, teamMetadata);
  const metadata = projectionMetadata(configuration, prepared, options);
  return {
    total: projected.total,
    payload: {
      ...metadata,
      release_receipt: projectionReleaseReceipt(configuration, options),
      season: projected.scope.season,
      phase: projected.scope.phase,
      metric: projected.scope.metric,
      garbage_time_mode: projected.scope.timeMode,
      stat_version: metadata.stat_version,
      breakdown_mode: projected.scope.breakdownMode,
      sort_by: projected.scope.sortBy,
      sort_direction: projected.scope.sortDirection,
      postseason_comparison: {
        measure: "regular_season_rank_minus_postseason_rank",
        metric: "wins_contributed",
        value_per_game_measure: "postseason_value_per_game_minus_regular_value_per_game",
        rank_population: "players_with_postseason_appearance",
        postseason_includes: ["PlayIn", "Playoffs"],
        value_per_game_rank_population: "active_table_scope",
      },
      rows: projected.rows,
    },
  };
}

function projectTopGamesPrepared(prepared, options, configuration, teamMetadata) {
  const scope = selectedRows(prepared, options);
  if (!["All", "Regular Season", "Playoffs", "Postseason"].includes(scope.phase)) {
    throw projectionError(
      "invalid_projection_filter",
      "Top games do not support PlayIn-only filtering.",
    );
  }
  const outcome = optionChoice(options.outcome, OUTCOMES, "outcome", "Both");
  const filtered = scope.rows.filter((row) => row.appeared
    && (outcome === "Both" || row.win_loss === (outcome === "Wins")));
  const ranked = [...filtered].sort((left, right) =>
    compareNullable(left.final_value_contributed, right.final_value_contributed)
      || right.game_date.localeCompare(left.game_date)
      || left.game_id.localeCompare(right.game_id)
      || comparePlayerId(left, right));
  const responseRows = ranked.map((row, index) => ({
    rank: index + 1,
    game_id: row.game_id,
    game_date: row.game_date,
    season: row.season,
    season_type: row.season_type,
    player_id: String(row.player_id),
    player_name: row.player_name,
    team: dashboardTeam(row.team_id, row.game_date, teamMetadata),
    opponent: dashboardTeam(row.opponent_id, row.game_date, teamMetadata),
    location: row.location,
    win_loss: row.win_loss,
    outcome: row.win_loss ? "Win" : "Loss",
    value_contributed: row.final_value_contributed,
  }));
  const page = paginate(responseRows, options, { defaultLimit: 25 });
  const metadata = projectionMetadata(configuration, prepared, options);
  return {
    total: responseRows.length,
    payload: {
      ...metadata,
      season: scope.season,
      phase: scope.phase,
      outcome,
      garbage_time_mode: scope.timeMode,
      rows: page.rows,
    },
  };
}

function projectHighValueRecordsPrepared(prepared, options, configuration, teamMetadata) {
  const scope = selectedRows(prepared, options, { season: false });
  if (!["All", "Regular Season", "Playoffs", "Postseason"].includes(scope.phase)) {
    throw projectionError(
      "invalid_projection_filter",
      ".400-plus records do not support PlayIn-only filtering.",
    );
  }
  const sortBy = optionChoice(options.sort_by, HIGH_VALUE_SORTS, "sort_by", "games_played");
  const sortDirection = optionChoice(options.sort_direction, ["asc", "desc"], "sort_direction", "desc");
  const records = [];
  const qualifying = scope.rows.filter((row) => row.appeared
    && row.final_value_contributed >= HIGH_VALUE_GAME_THRESHOLD);
  for (const [playerId, rows] of groupBy(qualifying, (row) => row.player_id)) {
    const wins = rows.filter((row) => row.win_loss);
    const current = [...rows].sort((left, right) =>
      right.game_date.localeCompare(left.game_date)
        || right.game_id.localeCompare(left.game_id))[0];
    records.push({
      rank: null,
      player_id: String(playerId),
      _player_id_number: playerId,
      player_name: rows.map((row) => row.player_name).sort().at(-1),
      team: dashboardTeam(current.team_id, current.game_date, teamMetadata),
      games_played: rows.length,
      wins: wins.length,
      value_contributed: sum(rows, (row) => row.final_value_contributed),
      wins_contributed: sum(wins, (row) => row.final_value_contributed),
      winning_percentage: wins.length / rows.length,
    });
  }
  records.sort((left, right) => compareNullable(left[sortBy], right[sortBy], sortDirection)
    || left._player_id_number - right._player_id_number);
  records.forEach((row, index) => { row.rank = index + 1; });
  const page = paginate(records, options);
  page.rows.forEach((row) => { delete row._player_id_number; });
  const metadata = projectionMetadata(configuration, prepared, options);
  return {
    total: records.length,
    payload: {
      ...metadata,
      threshold: HIGH_VALUE_GAME_THRESHOLD,
      minimum_rule: "greater_than_or_equal",
      phase: scope.phase,
      garbage_time_mode: scope.timeMode,
      postseason_includes: ["PlayIn", "Playoffs"],
      sort_by: sortBy,
      sort_direction: sortDirection,
      total_players: records.length,
      rows: page.rows,
    },
  };
}

function projectSeasonLeadersPrepared(prepared, options, configuration, teamMetadata) {
  const scope = selectedRows(prepared, options, { graph: true, season: false });
  const groups = groupBy(
    scope.rows.filter((row) => row.appeared),
    (row) => `${row.player_id}\u001f${row.season_end_year}`,
  );
  const leaders = [];
  for (const rows of groups.values()) {
    const wins = rows.filter((row) => row.win_loss);
    if (wins.length === 0) continue;
    const teamIds = [...new Set(rows.map((row) => row.team_id))].sort((left, right) => left - right);
    leaders.push({
      rank: null,
      player_id: String(rows[0].player_id),
      _player_id_number: rows[0].player_id,
      player_name: rows.map((row) => row.player_name).sort().at(-1),
      season: rows[0].season,
      season_end_year: rows[0].season_end_year,
      teams: teamIds.map((teamId) => dashboardTeam(teamId, null, teamMetadata)),
      wins_contributed: sum(wins, (row) => row.final_value_contributed),
      offensive_wins_contributed: sum(wins, (row) => row.responsibility.offense),
      defensive_wins_contributed: sum(wins, (row) => row.responsibility.defense),
      other_wins_contributed: sum(wins, (row) => row.responsibility.other),
      games_played: rows.length,
    });
  }
  leaders.sort((left, right) => compareNullable(left.wins_contributed, right.wins_contributed)
    || right.season_end_year - left.season_end_year
    || comparePlayerId(left, right));
  leaders.forEach((row, index) => { row.rank = index + 1; });
  const page = paginate(leaders, options, { defaultLimit: 15 });
  page.rows.forEach((row) => { delete row._player_id_number; });
  const metadata = projectionMetadata(configuration, prepared, options);
  return {
    total: leaders.length,
    payload: {
      ...metadata,
      phase: scope.phase,
      garbage_time_mode: scope.timeMode,
      limit: page.limit,
      rows: page.rows,
    },
  };
}

function rollingQualificationRank(phase, years) {
  void phase;
  void years;
  return 10;
}

function projectRollingTrendsPrepared(prepared, options, configuration) {
  const scope = selectedRows(prepared, options, { graph: true, season: false });
  const years = optionChoice(Number(options.window_years ?? 3), WINDOW_YEARS, "window_years", 3);
  const qualificationStart = QUALIFICATION_FIRST_SEASON_START[years];
  const qualificationRank = rollingQualificationRank(scope.phase, years);
  const selected = scope.rows.filter((row) => row.season_start >= DISPLAY_FIRST_SEASON_START);
  const seasonal = [];
  for (const rows of groupBy(selected, (row) => `${row.player_id}\u001f${row.season_end_year}`).values()) {
    const gamesPlayed = rows.filter((row) => row.appeared).length;
    if (gamesPlayed === 0) continue;
    seasonal.push({
      season: rows[0].season,
      season_start: rows[0].season_start,
      player_id: rows[0].player_id,
      player_name: rows.map((row) => row.player_name).sort().at(-1),
      games_played: gamesPlayed,
      season_value: sum(
        rows.filter((row) => row.appeared && row.win_loss),
        (row) => row.final_value_contributed,
      ),
    });
  }
  const latest = seasonal.length ? Math.max(...seasonal.map((row) => row.season_start)) : null;
  const rolling = [];
  for (const [playerId, seasons] of groupBy(seasonal, (row) => row.player_id)) {
    seasons.sort((left, right) => left.season_start - right.season_start);
    const byStart = new Map(seasons.map((row) => [row.season_start, row]));
    const first = seasons[0].season_start;
    const last = Math.min(seasons.at(-1).season_start + years - 1, latest);
    const playerName = seasons.map((row) => row.player_name).sort().at(-1);
    const calendar = [];
    for (let start = first; start <= last; start += 1) {
      const observed = byStart.get(start);
      calendar.push({
        season: seasonLabel(start + 1),
        season_start: start,
        player_id: playerId,
        player_name: playerName,
        games_played: observed?.games_played ?? 0,
        season_value: observed?.season_value ?? 0,
        played_season: observed ? 1 : 0,
      });
    }
    calendar.forEach((row, index) => {
      const window = calendar.slice(Math.max(0, index - years + 1), index + 1);
      rolling.push({
        ...row,
        rolling_average: sum(window, (item) => item.season_value) / window.length,
        window_size: window.reduce((total, item) => total + item.played_season, 0),
        window_span: window.length,
        window_rank: null,
      });
    });
  }
  const fullBySeason = groupBy(
    rolling.filter((row) => row.window_span === years && row.season_start >= qualificationStart),
    (row) => row.season_start,
  );
  for (const rows of fullBySeason.values()) {
    rowNumber(
      rows,
      (left, right) => compareNullable(left.rolling_average, right.rolling_average)
        || comparePlayerId(left, right),
      "window_rank",
    );
  }
  const qualifiedIds = new Set(
    rolling.filter((row) => row.window_rank !== null && row.window_rank <= qualificationRank)
      .map((row) => row.player_id),
  );
  const players = [];
  const outputSeasons = new Set();
  for (const [playerId, seasons] of groupBy(
    rolling.filter((row) => qualifiedIds.has(row.player_id)),
    (row) => row.player_id,
  )) {
    seasons.sort((left, right) => left.season_start - right.season_start);
    const qualifying = seasons.filter((row) => row.window_rank !== null
      && row.window_rank <= qualificationRank);
    seasons.forEach((row) => outputSeasons.add(row.season));
    players.push({
      player_id: String(playerId),
      _player_id_number: playerId,
      player_name: seasons.at(-1).player_name,
      best_window_rank: qualifying.length
        ? Math.min(...qualifying.map((row) => row.window_rank))
        : null,
      qualifying_windows: qualifying.length,
      seasons: seasons.map((row) => ({
        season: row.season,
        season_start: row.season_start,
        games_played: row.games_played,
        season_value: row.season_value,
        rolling_average: row.rolling_average,
        window_size: row.window_size,
        window_span: row.window_span,
        window_years: years,
        zero_filled_season: row.games_played === 0,
        window_rank: row.window_rank,
        qualifying_window: row.window_rank !== null && row.window_rank <= qualificationRank,
      })),
    });
  }
  players.sort((left, right) =>
    (left.best_window_rank ?? qualificationRank + 1)
      - (right.best_window_rank ?? qualificationRank + 1)
      || left.player_name.localeCompare(right.player_name)
      || comparePlayerId(left, right));
  players.forEach((player) => { delete player._player_id_number; });
  const metadata = projectionMetadata(configuration, prepared, options);
  return {
    total: players.length,
    payload: {
      ...metadata,
      garbage_time_mode: scope.timeMode,
      phase: scope.phase,
      metric: "wins_contributed",
      window_years: years,
      qualification_rank: qualificationRank,
      first_season: seasonLabel(DISPLAY_FIRST_SEASON_START + 1),
      first_qualifying_season: seasonLabel(qualificationStart + 1),
      requires_complete_window: true,
      requires_all_seasons_played: false,
      missing_seasons_counted_as_zero: true,
      zero_filled_windows_ranked: true,
      trailing_zeros_limited_to_window: true,
      seasons: [...outputSeasons].sort((left, right) => Number(left.slice(0, 4)) - Number(right.slice(0, 4))),
      players,
    },
  };
}

function projectPostseasonLiftPrepared(prepared, options, configuration) {
  const timeMode = normalizeTimeMode(options);
  const years = optionChoice(Number(options.window_years ?? 3), WINDOW_YEARS, "window_years", 3);
  const qualificationStart = QUALIFICATION_FIRST_SEASON_START[years];
  const allRows = prepared.filter((row) => row.time_mode === timeMode);
  const career = [];
  for (const [playerId, rows] of groupBy(allRows, (row) => row.player_id)) {
    career.push({
      player_id: playerId,
      player_name: rows.map((row) => row.player_name).sort().at(-1),
      career_full_season_wins_contributed: sum(
        rows.filter((row) => row.appeared && row.win_loss),
        (row) => row.final_value_contributed,
      ),
      career_full_season_rank: null,
    });
  }
  career.sort((left, right) =>
    compareNullable(
      left.career_full_season_wins_contributed,
      right.career_full_season_wins_contributed,
    ) || comparePlayerId(left, right));
  career.forEach((row, index) => { row.career_full_season_rank = index + 1; });
  const eligible = career.slice(0, POSTSEASON_LIFT_CAREER_RANK_CUTOFF);
  const eligibleById = new Map(eligible.map((row) => [row.player_id, row]));
  const seasonal = [];
  const recent = allRows.filter((row) => row.season_start >= DISPLAY_FIRST_SEASON_START
    && eligibleById.has(row.player_id));
  for (const rows of groupBy(recent, (row) => `${row.player_id}\u001f${row.season_end_year}`).values()) {
    const regular = rows.filter((row) => row.season_type === "Regular Season");
    const postseason = rows.filter((row) => ["PlayIn", "Playoffs"].includes(row.season_type));
    const careerRow = eligibleById.get(rows[0].player_id);
    seasonal.push({
      season: rows[0].season,
      season_start: rows[0].season_start,
      player_id: rows[0].player_id,
      player_name: rows.map((row) => row.player_name).sort().at(-1),
      career_full_season_wins_contributed: careerRow.career_full_season_wins_contributed,
      career_full_season_rank: careerRow.career_full_season_rank,
      regular_games: regular.filter((row) => row.appeared).length,
      postseason_games: postseason.filter((row) => row.appeared).length,
      regular_wins_contributed: sum(
        regular.filter((row) => row.appeared && row.win_loss),
        (row) => row.final_value_contributed,
      ),
      postseason_wins_contributed: sum(
        postseason.filter((row) => row.appeared && row.win_loss),
        (row) => row.final_value_contributed,
      ),
    });
  }
  const comparableBySeason = groupBy(
    seasonal.filter((row) => row.regular_games > 0 && row.postseason_games > 0),
    (row) => row.season_start,
  );
  const comparisons = new Map();
  for (const rows of comparableBySeason.values()) {
    rowNumber(
      rows,
      (left, right) => compareNullable(left.regular_wins_contributed, right.regular_wins_contributed)
        || comparePlayerId(left, right),
      "regular_season_rank",
    );
    rowNumber(
      rows,
      (left, right) => compareNullable(left.postseason_wins_contributed, right.postseason_wins_contributed)
        || comparePlayerId(left, right),
      "postseason_rank",
    );
    for (const row of rows) {
      comparisons.set(`${row.player_id}\u001f${row.season_start}`, {
        ...row,
        season_rank_change: row.regular_season_rank - row.postseason_rank,
      });
    }
  }
  const latest = seasonal.length ? Math.max(...seasonal.map((row) => row.season_start)) : null;
  const rolling = [];
  for (const [playerId, seasons] of groupBy(seasonal, (row) => row.player_id)) {
    seasons.sort((left, right) => left.season_start - right.season_start);
    const first = seasons[0].season_start;
    const last = Math.min(seasons.at(-1).season_start + years - 1, latest);
    const careerRow = eligibleById.get(playerId);
    const playerName = seasons.map((row) => row.player_name).sort().at(-1);
    const calendar = [];
    for (let start = first; start <= last; start += 1) {
      const comparison = comparisons.get(`${playerId}\u001f${start}`) ?? null;
      calendar.push({
        season: seasonLabel(start + 1),
        season_start: start,
        player_id: playerId,
        player_name: playerName,
        career_full_season_wins_contributed: careerRow.career_full_season_wins_contributed,
        career_full_season_rank: careerRow.career_full_season_rank,
        regular_games: comparison?.regular_games ?? null,
        postseason_games: comparison?.postseason_games ?? null,
        regular_wins_contributed: comparison?.regular_wins_contributed ?? null,
        postseason_wins_contributed: comparison?.postseason_wins_contributed ?? null,
        regular_season_rank: comparison?.regular_season_rank ?? null,
        postseason_rank: comparison?.postseason_rank ?? null,
        season_rank_change: comparison?.season_rank_change ?? 0,
        comparison_season: comparison !== null,
      });
    }
    calendar.forEach((row, index) => {
      const window = calendar.slice(Math.max(0, index - years + 1), index + 1);
      rolling.push({
        ...row,
        rolling_average: sum(window, (item) => item.season_rank_change) / window.length,
        window_appearances: window.filter((item) => item.comparison_season).length,
        window_span: window.length,
        top_rank: null,
        bottom_rank: null,
      });
    });
  }
  const fullBySeason = groupBy(
    rolling.filter((row) => row.window_span === years
      && row.window_appearances > 0
      && row.season_start >= qualificationStart),
    (row) => row.season_start,
  );
  for (const rows of fullBySeason.values()) {
    rowNumber(
      rows,
      (left, right) => compareNullable(left.rolling_average, right.rolling_average)
        || comparePlayerId(left, right),
      "top_rank",
    );
    rowNumber(
      rows,
      (left, right) => compareNullable(left.rolling_average, right.rolling_average, "asc")
        || comparePlayerId(left, right),
      "bottom_rank",
    );
  }
  const qualification = new Map();
  for (const row of rolling) {
    if (row.top_rank === null) continue;
    const current = qualification.get(row.player_id) ?? {
      qualifies_top: false,
      qualifies_bottom: false,
      best_top_rank: null,
      best_bottom_rank: null,
    };
    if (row.top_rank <= POSTSEASON_LIFT_QUALIFICATION_RANK) {
      current.qualifies_top = true;
      current.best_top_rank = current.best_top_rank === null
        ? row.top_rank : Math.min(current.best_top_rank, row.top_rank);
    }
    if (row.bottom_rank <= POSTSEASON_LIFT_QUALIFICATION_RANK) {
      current.qualifies_bottom = true;
      current.best_bottom_rank = current.best_bottom_rank === null
        ? row.bottom_rank : Math.min(current.best_bottom_rank, row.bottom_rank);
    }
    qualification.set(row.player_id, current);
  }
  const players = [];
  const outputSeasons = new Set();
  for (const [playerId, seasons] of groupBy(
    rolling.filter((row) => {
      const value = qualification.get(row.player_id);
      return value?.qualifies_top || value?.qualifies_bottom;
    }),
    (row) => row.player_id,
  )) {
    seasons.sort((left, right) => left.season_start - right.season_start);
    seasons.forEach((row) => outputSeasons.add(row.season));
    const value = qualification.get(playerId);
    players.push({
      player_id: String(playerId),
      _player_id_number: playerId,
      player_name: seasons.at(-1).player_name,
      career_full_season_wins_contributed: seasons[0].career_full_season_wins_contributed,
      career_full_season_rank: seasons[0].career_full_season_rank,
      qualifies_top: value.qualifies_top,
      qualifies_bottom: value.qualifies_bottom,
      qualification_group: value.qualifies_top && value.qualifies_bottom
        ? "both" : value.qualifies_top ? "top" : "bottom",
      best_top_rank: value.best_top_rank,
      best_bottom_rank: value.best_bottom_rank,
      seasons: seasons.map((row) => ({
        season: row.season,
        season_start: row.season_start,
        career_full_season_wins_contributed: row.career_full_season_wins_contributed,
        career_full_season_rank: row.career_full_season_rank,
        regular_games: row.regular_games,
        postseason_games: row.postseason_games,
        regular_wins_contributed: row.regular_wins_contributed,
        postseason_wins_contributed: row.postseason_wins_contributed,
        regular_season_rank: row.regular_season_rank,
        postseason_rank: row.postseason_rank,
        season_rank_change: row.season_rank_change,
        comparison_season: row.comparison_season,
        zero_filled_season: !row.comparison_season,
        rolling_average: row.rolling_average,
        window_appearances: row.window_appearances,
        window_span: row.window_span,
        window_years: years,
        top_rank: row.top_rank,
        bottom_rank: row.bottom_rank,
        qualifying_top_window: row.top_rank !== null
          && row.top_rank <= POSTSEASON_LIFT_QUALIFICATION_RANK,
        qualifying_bottom_window: row.bottom_rank !== null
          && row.bottom_rank <= POSTSEASON_LIFT_QUALIFICATION_RANK,
      })),
    });
  }
  players.sort((left, right) =>
    (left.qualifies_top ? 0 : 1) - (right.qualifies_top ? 0 : 1)
      || (left.best_top_rank ?? POSTSEASON_LIFT_QUALIFICATION_RANK + 1)
        - (right.best_top_rank ?? POSTSEASON_LIFT_QUALIFICATION_RANK + 1)
      || (left.best_bottom_rank ?? POSTSEASON_LIFT_QUALIFICATION_RANK + 1)
        - (right.best_bottom_rank ?? POSTSEASON_LIFT_QUALIFICATION_RANK + 1)
      || left.player_name.localeCompare(right.player_name)
      || comparePlayerId(left, right));
  players.forEach((player) => { delete player._player_id_number; });
  const boundary = eligible.at(-1) ?? null;
  const metadata = projectionMetadata(configuration, prepared, options);
  return {
    total: players.length,
    payload: {
      ...metadata,
      garbage_time_mode: timeMode,
      metric: "wins_contributed",
      measure: "regular_season_rank_minus_postseason_rank",
      population: "all_seasons_full_season_wins_contributed_top_100",
      population_size: POSTSEASON_LIFT_CAREER_RANK_CUTOFF,
      population_rank_cutoff: POSTSEASON_LIFT_CAREER_RANK_CUTOFF,
      population_boundary_player: boundary?.player_name ?? null,
      rank_population: "career_top_100_members_with_postseason_appearance",
      postseason_includes: ["PlayIn", "Playoffs"],
      window_years: years,
      qualification_rank: POSTSEASON_LIFT_QUALIFICATION_RANK,
      first_season: seasonLabel(DISPLAY_FIRST_SEASON_START + 1),
      first_qualifying_season: seasonLabel(qualificationStart + 1),
      requires_complete_window: true,
      missing_comparisons_counted_as_zero: true,
      trailing_zeros_limited_to_window: true,
      top_player_count: players.filter((player) => player.qualifies_top).length,
      bottom_player_count: players.filter((player) => player.qualifies_bottom).length,
      both_player_count: players.filter((player) => player.qualifies_top && player.qualifies_bottom).length,
      seasons: [...outputSeasons].sort((left, right) => Number(left.slice(0, 4)) - Number(right.slice(0, 4))),
      players,
    },
  };
}

function relevantDetailRow(row) {
  return row.appeared || row.final_value_contributed !== 0 || row.raw_vc !== 0 || row.total_context !== 0;
}

function detailGame(row, teamMetadata) {
  return {
    game_id: row.game_id,
    game_date: row.game_date,
    season: row.season,
    season_type: row.season_type,
    player_id: String(row.player_id),
    player_name: row.player_name,
    win_loss: row.win_loss,
    final_value_contributed: row.final_value_contributed,
    signed_raw_offense: row.raw_offense,
    signed_raw_defense: row.raw_defense,
    signed_raw_other: row.raw_other,
    signed_adjusted_offense: row.adjusted_offense,
    signed_adjusted_defense: row.adjusted_defense,
    signed_adjusted_other: row.adjusted_other,
    offensive_value_contributed: row.responsibility.offense,
    defensive_value_contributed: row.responsibility.defense,
    other_value_contributed: row.responsibility.other,
    raw_no_context_contribution: row.raw_vc,
    teammate_context_contribution: row.offense_context,
    opponent_context_contribution: row.defense_context,
    general_offense_context: row.context_components.general_offense,
    general_defense_context: row.context_components.general_defense,
    teammate_offense_context: row.context_components.teammate_offense,
    teammate_defense_context: row.context_components.teammate_defense,
    opponent_offense_context: row.context_components.opponent_offense,
    opponent_defense_context: row.context_components.opponent_defense,
    offense_context: row.offense_context,
    defense_context: row.defense_context,
    raw_percent_of_final: percent(row.raw_vc, row.final_value_contributed),
    teammate_percent_of_final: percent(row.offense_context, row.final_value_contributed),
    opponent_percent_of_final: percent(row.defense_context, row.final_value_contributed),
    offense_component_positive: Math.max(row.adjusted_offense, 0),
    offense_component_negative_magnitude: Math.max(-row.adjusted_offense, 0),
    defense_component_positive: Math.max(row.adjusted_defense, 0),
    defense_component_negative_magnitude: Math.max(-row.adjusted_defense, 0),
    other_component_positive: Math.max(row.adjusted_other, 0),
    other_component_negative_magnitude: Math.max(-row.adjusted_other, 0),
    offense_responsibility_basis: row.responsibility_basis.offense,
    defense_responsibility_basis: row.responsibility_basis.defense,
    other_responsibility_basis: row.responsibility_basis.other,
    teammate_offense_multiplier_percentage:
      100 * (row.factor_multipliers.teammate_offense - 1),
    teammate_defense_multiplier_percentage:
      100 * (row.factor_multipliers.teammate_defense - 1),
    opponent_offense_multiplier_percentage:
      100 * (row.factor_multipliers.opponent_offense - 1),
    opponent_defense_multiplier_percentage:
      100 * (row.factor_multipliers.opponent_defense - 1),
    combined_offense_multiplier_percentage:
      100 * (row.combined_offense_multiplier - 1),
    combined_defense_multiplier_percentage:
      100 * (row.combined_defense_multiplier - 1),
    factor_logs: copy(row.factor_logs),
    factor_multipliers: copy(row.factor_multipliers),
    responsibility_formula_reconciliation: copy(row.responsibility_formula),
    responsibility_display_close: copy(row.responsibility_display_close),
    responsibility_component_evidence: copy(row.responsibility_component_evidence),
    responsibility_basis: copy(row.responsibility_basis),
    context_display_close: copy(row.context_display_close),
    calculation_row_hash: row.calculation_row_hash,
    responsibility_row_hash: row.responsibility_row_hash ?? row.calculation_row_hash,
    team: dashboardTeam(row.team_id, row.game_date, teamMetadata),
    opponent: dashboardTeam(row.opponent_id, row.game_date, teamMetadata),
  };
}

function projectPlayerDetailsPrepared(prepared, options, configuration, teamMetadata) {
  const playerId = optionInteger(options.player_id, "player_id", null, { minimum: 1 });
  const scope = selectedRows(prepared, options);
  const breakdownMode = optionChoice(options.breakdown_mode, BREAKDOWN_MODES, "breakdown_mode", "vc");
  const selected = scope.rows.filter((row) => row.player_id === playerId
    && relevantDetailRow(row)
    && (breakdownMode === "vc" || row.win_loss));
  const finalValue = sum(selected, (row) => row.final_value_contributed);
  const rawValue = sum(selected, (row) => row.raw_vc);
  const offenseContext = sum(selected, (row) => row.offense_context);
  const defenseContext = sum(selected, (row) => row.defense_context);
  const contextSums = Object.fromEntries(CONTEXT_FACTORS.map((factor) => [
    factor,
    sum(selected, (row) => row.context_components[factor]),
  ]));
  const summary = {
    game_count: selected.length,
    final_value: finalValue,
    raw_no_context_value: rawValue,
    teammate_context_value: offenseContext,
    opponent_context_value: defenseContext,
    offense_context_value: offenseContext,
    defense_context_value: defenseContext,
    general_offense_context_value: contextSums.general_offense,
    general_defense_context_value: contextSums.general_defense,
    teammate_offense_context_value: contextSums.teammate_offense,
    teammate_defense_context_value: contextSums.teammate_defense,
    opponent_offense_context_value: contextSums.opponent_offense,
    opponent_defense_context_value: contextSums.opponent_defense,
    raw_no_context_pct: percent(rawValue, finalValue),
    teammate_context_pct: percent(offenseContext, finalValue),
    opponent_context_pct: percent(defenseContext, finalValue),
  };
  const sorted = [...selected].sort((left, right) =>
    right.game_date.localeCompare(left.game_date)
      || right.game_id.localeCompare(left.game_id)
      || left.team_id - right.team_id);
  let page;
  let perPage;
  let offset;
  if (options.page !== undefined || options.per_page !== undefined) {
    page = optionInteger(options.page, "page", 1, { minimum: 1 });
    perPage = optionInteger(options.per_page, "per_page", 20, { minimum: 1, maximum: 100 });
    offset = (page - 1) * perPage;
  } else {
    offset = optionInteger(options.offset, "offset", 0);
    perPage = optionInteger(options.limit, "limit", 20, { minimum: 1, maximum: 100 });
    page = Math.floor(offset / perPage) + 1;
  }
  const games = sorted.slice(offset, offset + perPage).map((row) => detailGame(row, teamMetadata));
  const metadata = projectionMetadata(configuration, prepared, options);
  const { certification_status: _certificationStatus, ...detailMetadata } = metadata;
  return {
    total: selected.length,
    payload: {
      ...detailMetadata,
      player_id: String(playerId),
      season: scope.season,
      phase: scope.phase,
      garbage_time_mode: scope.timeMode,
      breakdown_mode: breakdownMode,
      summary,
      pagination: {
        page,
        per_page: perPage,
        total_games: selected.length,
        total_pages: selected.length ? Math.ceil(selected.length / perPage) : 0,
      },
      games,
    },
  };
}

function projectResponsibilityPrepared(prepared, options, configuration, teamMetadata) {
  const ranking = projectRankingsPrepared(prepared, options, configuration, teamMetadata);
  const rows = ranking.payload.rows.map((row) => ({
    rank: row.rank,
    season: row.season,
    player_id: row.player_id,
    player_name: row.player_name,
    teams: row.teams,
    games_played: row.games_played,
    wins: row.wins,
    value_contributed: row.value_contributed,
    wins_contributed: row.wins_contributed,
    offensive_value_contributed: row.offensive_value_contributed,
    defensive_value_contributed: row.defensive_value_contributed,
    other_value_contributed: row.other_value_contributed,
    offensive_value_contributed_pct: row.offensive_value_contributed_pct,
    defensive_value_contributed_pct: row.defensive_value_contributed_pct,
    other_value_contributed_pct: row.other_value_contributed_pct,
    offensive_wins_contributed: row.offensive_wins_contributed,
    defensive_wins_contributed: row.defensive_wins_contributed,
    other_wins_contributed: row.other_wins_contributed,
    offensive_wins_contributed_pct: row.offensive_wins_contributed_pct,
    defensive_wins_contributed_pct: row.defensive_wins_contributed_pct,
    other_wins_contributed_pct: row.other_wins_contributed_pct,
    offense_value: row.offense_value,
    defense_value: row.defense_value,
    other_value: row.other_value,
  }));
  return {
    total: ranking.total,
    payload: {
      ...Object.fromEntries(Object.entries(ranking.payload).filter(([key]) => key !== "rows")),
      panel: "responsibility",
      responsibility_sides: [...RESPONSIBILITY_SIDES],
      rows,
    },
  };
}

function projectContextPrepared(prepared, options, configuration, teamMetadata) {
  const ranking = projectRankingsPrepared(prepared, options, configuration, teamMetadata);
  const rows = ranking.payload.rows.map((row) => ({
    rank: row.rank,
    season: row.season,
    player_id: row.player_id,
    player_name: row.player_name,
    teams: row.teams,
    games_played: row.games_played,
    wins: row.wins,
    value_contributed: row.value_contributed,
    wins_contributed: row.wins_contributed,
    side_context_raw_value: row.side_context_raw_value,
    side_context_raw_pct: row.side_context_raw_pct,
    offense_context_value: row.offense_context_value,
    offense_context_pct: row.offense_context_pct,
    defense_context_value: row.defense_context_value,
    defense_context_pct: row.defense_context_pct,
    general_offense_context_value: row.general_offense_context_value,
    general_offense_context_pct: row.general_offense_context_pct,
    teammate_offense_context_value: row.teammate_offense_context_value,
    teammate_offense_context_pct: row.teammate_offense_context_pct,
    opponent_defense_context_value: row.opponent_defense_context_value,
    opponent_defense_context_pct: row.opponent_defense_context_pct,
    general_defense_context_value: row.general_defense_context_value,
    general_defense_context_pct: row.general_defense_context_pct,
    teammate_defense_context_value: row.teammate_defense_context_value,
    teammate_defense_context_pct: row.teammate_defense_context_pct,
    opponent_offense_context_value: row.opponent_offense_context_value,
    opponent_offense_context_pct: row.opponent_offense_context_pct,
  }));
  return {
    total: ranking.total,
    payload: {
      ...Object.fromEntries(Object.entries(ranking.payload).filter(([key]) => key !== "rows")),
      panel: "context",
      collapsed_context: ["side_context_raw_value", "offense_context_value", "defense_context_value"],
      expanded_context: [
        "general_offense",
        "teammate_offense",
        "opponent_defense",
        "general_defense",
        "teammate_defense",
        "opponent_offense",
      ],
      rows,
    },
  };
}

function canonicalPanel(panel) {
  const normalized = PANEL_ALIASES[String(panel ?? "")];
  if (!normalized || !LOCAL_DASHBOARD_PANELS.includes(normalized)) {
    throw projectionError("unsupported_projection_panel", `Unsupported local dashboard panel ${panel}.`);
  }
  return normalized;
}

function assertFilters(panel, filters) {
  if (!isRecord(filters)) {
    throw projectionError("invalid_projection_filter", "filters must be an object.");
  }
  const allowed = PANEL_FILTERS[panel];
  const unknown = Object.keys(filters).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw projectionError(
      "unsupported_projection_filter",
      `Panel ${panel} does not support filter ${unknown.sort().join(", ")}.`,
    );
  }
}

function assertSort(panel, sort) {
  if (sort === null) return;
  if (!isRecord(sort)
      || typeof sort.key !== "string"
      || !["asc", "desc"].includes(sort.direction ?? "desc")
      || Object.keys(sort).some((key) => !["key", "direction"].includes(key))) {
    throw projectionError("invalid_projection_sort", "sort must contain only a key and asc/desc direction.");
  }
  if (!PANEL_SORTS[panel]?.has(sort.key)) {
    throw projectionError(
      "unsupported_projection_sort",
      `Panel ${panel} does not support sort key ${sort.key}.`,
    );
  }
}

function panelProjection(prepared, panel, options, configuration, teamMetadata) {
  switch (panel) {
    case "rankings":
      return projectRankingsPrepared(prepared, options, configuration, teamMetadata);
    case "top_games":
      return projectTopGamesPrepared(prepared, options, configuration, teamMetadata);
    case "high_value_records":
      return projectHighValueRecordsPrepared(prepared, options, configuration, teamMetadata);
    case "season_leaders":
      return projectSeasonLeadersPrepared(prepared, options, configuration, teamMetadata);
    case "rolling_graphs":
      return projectRollingTrendsPrepared(prepared, options, configuration);
    case "postseason_lift":
      return projectPostseasonLiftPrepared(prepared, options, configuration);
    case "player_details":
      return projectPlayerDetailsPrepared(prepared, options, configuration, teamMetadata);
    case "responsibility":
      return projectResponsibilityPrepared(prepared, options, configuration, teamMetadata);
    case "context":
      return projectContextPrepared(prepared, options, configuration, teamMetadata);
    default:
      throw projectionError("unsupported_projection_panel", `Unsupported local dashboard panel ${panel}.`);
  }
}

function genericRows(panel, payload) {
  if (["rolling_graphs", "postseason_lift"].includes(panel)) return payload.players;
  if (panel === "player_details") return payload.games;
  return payload.rows;
}

function genericMetadata(panel, payload, configuration) {
  const collection = panel === "player_details"
    ? "games"
    : ["rolling_graphs", "postseason_lift"].includes(panel) ? "players" : "rows";
  const metadata = Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== collection),
  );
  return {
    ...metadata,
    projection_version: LOCAL_PROJECTION_VERSION,
    release_receipt: payload.release_receipt
      ?? projectionReleaseReceipt(configuration),
    panel,
    receipt: payload.calculation_receipt,
    stale: configuration?.stale === true || configuration?.requiresRerun === true,
    configuration: configuration ? copy(configuration) : null,
    panel_payload: payload,
  };
}

export function createLocalDashboardProjector(
  rows,
  { configuration = null, teamMetadata = TEAM_METADATA } = {},
) {
  const prepared = normalizeRows(rows);
  assertConfigurationMatchesRows(configuration, prepared);
  const selectedTeamMetadata = isRecord(teamMetadata) ? copy(teamMetadata) : TEAM_METADATA;
  const project = (panelName, options = {}) => {
    const panel = canonicalPanel(panelName);
    const result = panelProjection(
      prepared,
      panel,
      options,
      options.configuration ?? configuration,
      selectedTeamMetadata,
    );
    return result.payload;
  };
  return Object.freeze({
    project,
    rankings: (options = {}) => project("rankings", options),
    topGames: (options = {}) => project("top_games", options),
    highValueRecords: (options = {}) => project("high_value_records", options),
    seasonWinsLeaders: (options = {}) => project("season_leaders", options),
    rollingTrends: (options = {}) => project("rolling_graphs", options),
    postseasonLiftTrends: (options = {}) => project("postseason_lift", options),
    playerContext: (options = {}) => project("player_details", options),
    responsibility: (options = {}) => project("responsibility", options),
    context: (options = {}) => project("context", options),
  });
}

export function projectRankings(rows, options = {}) {
  return createLocalDashboardProjector(rows, options).rankings(options);
}

export function projectTopGames(rows, options = {}) {
  return createLocalDashboardProjector(rows, options).topGames(options);
}

export function projectHighValueRecords(rows, options = {}) {
  return createLocalDashboardProjector(rows, options).highValueRecords(options);
}

export function projectSeasonWinsLeaders(rows, options = {}) {
  return createLocalDashboardProjector(rows, options).seasonWinsLeaders(options);
}

export const projectSeasonLeaders = projectSeasonWinsLeaders;

export function projectRollingTrends(rows, options = {}) {
  return createLocalDashboardProjector(rows, options).rollingTrends(options);
}

export const projectRollingGraphs = projectRollingTrends;

export function projectPostseasonLiftTrends(rows, options = {}) {
  return createLocalDashboardProjector(rows, options).postseasonLiftTrends(options);
}

export const projectPostseasonLift = projectPostseasonLiftTrends;

export function projectPlayerContext(rows, options = {}) {
  return createLocalDashboardProjector(rows, options).playerContext(options);
}

export const projectPlayerDetails = projectPlayerContext;

export function projectResponsibility(rows, options = {}) {
  return createLocalDashboardProjector(rows, options).responsibility(options);
}

export function projectContext(rows, options = {}) {
  return createLocalDashboardProjector(rows, options).context(options);
}

export function projectLocalDashboardPanel(
  panelName,
  rows,
  {
    filters = {},
    sort = null,
    limit = 100,
    offset = 0,
    configuration = null,
  } = {},
) {
  const panel = canonicalPanel(panelName);
  assertFilters(panel, filters);
  assertSort(panel, sort);
  const merged = {
    ...filters,
    sort_by: sort?.key ?? filters.sort_by,
    sort_direction: sort?.direction ?? filters.sort_direction,
    limit: filters.limit ?? limit,
    offset: filters.offset ?? offset,
    configuration,
  };
  const prepared = normalizeRows(rows);
  assertConfigurationMatchesRows(configuration, prepared);
  const result = panelProjection(prepared, panel, merged, configuration, TEAM_METADATA);
  return {
    rows: genericRows(panel, result.payload),
    total: result.total,
    metadata: genericMetadata(panel, result.payload, configuration),
  };
}
