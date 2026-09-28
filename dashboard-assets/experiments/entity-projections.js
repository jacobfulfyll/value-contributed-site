import { fsum } from "./binary64.js";
import { BrowserExperimentError } from "./protocol.js";

export const ENTITY_DASHBOARD_PANELS = Object.freeze([
  "player_landscape",
  "player_profile",
  "player_games",
  "player_game_anatomy",
  "player_similarity",
  "team_profile",
  "team_games",
  "team_similarity",
]);

export const V9_PUBLIC_SOURCE = Object.freeze({
  kind: "official",
  public_id: "v9",
  label: "V9",
  storage_slug: "original",
  release_id: "60a96635-f13d-42a3-a18e-bf02df29f9b5",
  release_receipt: "d2a4597f935045e645741ee077d6f71a18c212f6661461e4bf7e827a70c15ade",
  run_id: "b9e21d4c-d5bc-4732-9f5d-c2fc6ca6ba34",
  configuration_receipt: "d0159dee48efaf8b68eb4f5b6555249099213c13c7cb30be6783555a446245e9",
  calculation_receipt: "66c066e95a0edb24067f9c255f367567e2685315555d0731b748c7dcb760381c",
});

export const OFFENSE_SOURCE_COMPONENTS = Object.freeze([
  "administrative_bonus_point",
  "assister",
  "defensive_lane_replacement_point",
  "ft_assister",
  "offensive_boxout",
  "oreb_pool",
  "regular_ft_shortfall",
  "retained_foul_drawn",
  "retained_foul_oreb_shortfall",
  "retained_foul_points",
  "scorer",
  "screen_assister",
  "terminal_fg_miss_2pt",
  "terminal_fg_miss_3pt",
  "turnover",
]);

export const DEFENSE_SOURCE_COMPONENTS = Object.freeze([
  "DFG_make",
  "DFG_miss",
  "administrative_point_penalty",
  "block",
  "defensive_boxout",
  "defensive_lane_violation_penalty",
  "defensive_rebound",
  "ordinary_foul_penalty",
  "pressure_defense",
  "retained_foul_penalty",
  "steal",
]);

export const CONTEXT_COMPONENTS = Object.freeze([
  "general_offense",
  "general_defense",
  "teammate_offense",
  "teammate_defense",
  "opponent_offense",
  "opponent_defense",
]);

const RESPONSIBILITY_COMPONENTS = Object.freeze(["offense", "defense", "other"]);
const FULL_SEASONS = Object.freeze(Array.from({ length: 13 }, (_, index) => 2014 + index));
export const TEAM_SIMILARITY_ARTIFACT_SCHEMA_VERSION = "browser-team-similarity-pairs-v1";
const FAMILY_WEIGHTS = Object.freeze({
  source: 0.55,
  responsibility: 0.15,
  context: 0.15,
  impact: 0.15,
});
const TEAM_FAMILIES = Object.freeze(["offense", "defense", "context", "responsibility"]);
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

function error(code, message, details = undefined) {
  return new BrowserExperimentError(code, message, details);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalFinite(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const INSTRUMENTATION_FEATURES = Object.freeze({
  screen_assister: "hustle",
  pressure_defense: "hustle",
  offensive_boxout: "boxouts",
  defensive_boxout: "boxouts",
  DFG_make: "contested",
  DFG_miss: "contested",
});

function instrumentationAvailable(row, feature) {
  const family = INSTRUMENTATION_FEATURES[feature];
  if (!family) return true;
  const coverage = row.instrumentation_coverage ?? {};
  const direct = coverage[`${family}_available`]
    ?? coverage[`${family}_seconds_fraction`]
    ?? row[`${family}_available`];
  if (direct !== null && direct !== undefined) {
    return typeof direct === "boolean" ? direct : finite(direct) > 0;
  }
  // Result v2 does not retain the engine's per-row instrumentation flags.
  // Era or nonzero-value inference would turn absent evidence into observed
  // zeroes, so mask the affected dimension until receipt-bound coverage is
  // present on a future result row.
  return false;
}

function instrumentationScopeCoverage(rows) {
  const totalSeconds = sum(rows, (row) => finite(row.seconds_played));
  return Object.fromEntries(["hustle", "boxouts", "contested"].map((family) => {
    const feature = family === "hustle" ? "screen_assister"
      : family === "boxouts" ? "offensive_boxout" : "DFG_make";
    const observed = sum(rows, (row) => instrumentationAvailable(row, feature)
      ? finite(row.seconds_played) : 0);
    return [`${family}_seconds_fraction`, totalSeconds > 0 ? observed / totalSeconds : null];
  }));
}

function sum(rows, getter) {
  return fsum(rows.map(getter));
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function groupBy(rows, getter) {
  const groups = new Map();
  for (const row of rows) {
    const key = getter(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function seasonLabel(seasonEndYear) {
  return `${seasonEndYear - 1}-${String(seasonEndYear).slice(-2).padStart(2, "0")}`;
}

function seasonEndYear(value) {
  if (value === undefined || value === null || value === "All Seasons") return null;
  if (/^\d{4}$/.test(String(value))) {
    const result = Number(value);
    if (FULL_SEASONS.includes(result)) return result;
  }
  const match = /^(\d{4})-(\d{2})$/.exec(String(value));
  if (match) {
    const result = Number(match[1]) + 1;
    if (FULL_SEASONS.includes(result)
        && String(result).slice(-2).padStart(2, "0") === match[2]) return result;
  }
  throw error("invalid_entity_scope", "Scope must be All Seasons, a season end year, or YYYY-YY.");
}

function normalizeSchedule(value) {
  const schedule = value ?? "All";
  if (!["All", "Regular Season", "PlayIn", "Playoffs", "Postseason"].includes(schedule)) {
    throw error("invalid_entity_schedule", `Unsupported schedule ${schedule}.`);
  }
  return schedule;
}

function scheduleMatches(row, schedule) {
  if (schedule === "All") return true;
  if (schedule === "Postseason") return ["PlayIn", "Playoffs"].includes(row.season_type);
  return row.season_type === schedule;
}

function normalizeMetric(value) {
  const metric = String(value ?? "vc").toLowerCase();
  if (!["vc", "wc"].includes(metric)) throw error("invalid_entity_metric", "Metric must be VC or WC.");
  return metric;
}

function normalizeTimeMode(value) {
  const mode = value ?? "competitive";
  if (!["all_minutes", "competitive"].includes(mode)) {
    throw error("invalid_entity_time_mode", `Unsupported game-time mode ${mode}.`);
  }
  return mode;
}

function normalizeOutcome(value) {
  const outcome = value ?? "Both";
  if (!["Both", "Wins", "Losses"].includes(outcome)) {
    throw error("invalid_entity_outcome", `Unsupported outcome ${outcome}.`);
  }
  return outcome;
}

function outcomeMatches(row, outcome) {
  return outcome === "Both" || (outcome === "Wins" ? row.win_loss : !row.win_loss);
}

function metricValue(row, metric) {
  return metric === "wc" ? (row.win_loss ? row.final_value_contributed : 0) : row.final_value_contributed;
}

function canonicalPlayerId(row) {
  return Number(row.canonical_player_id ?? row.player_id);
}

function team(teamId, gameDate = null, metadata = TEAM_METADATA) {
  const id = String(teamId);
  const configured = metadata[id] ?? metadata[Number(id)] ?? TEAM_METADATA[id] ?? null;
  const values = Array.isArray(configured)
    ? configured
    : configured ? [configured.abbreviation, configured.name] : [id, `NBA team ${id}`];
  let name = String(values[1]);
  if (id === "1610612766" && gameDate && String(gameDate) < "2014-07-01") {
    name = "Charlotte Bobcats";
  }
  return { team_id: Number(id), abbreviation: String(values[0]), name };
}

function latestRow(rows) {
  return [...rows].sort((left, right) =>
    String(right.game_date).localeCompare(String(left.game_date))
      || String(right.game_id).localeCompare(String(left.game_id))
      || canonicalPlayerId(left) - canonicalPlayerId(right))[0] ?? null;
}

function earliestRow(rows) {
  return [...rows].sort((left, right) =>
    String(left.game_date).localeCompare(String(right.game_date))
      || String(left.game_id).localeCompare(String(right.game_id))
      || canonicalPlayerId(left) - canonicalPlayerId(right))[0] ?? null;
}

function latestPlayerName(rows) {
  const latest = latestRow(rows.filter((row) => String(row.player_name ?? "").trim()));
  // A row with no name at all is shown by name-less wording, never by its id.
  if (!latest) return "Unknown player";
  return canonicalPlayerId(latest) === 202710 ? "Jimmy Butler III" : String(latest.player_name).trim();
}

function distinctGameCount(rows, { appearedOnly = false } = {}) {
  return new Set(rows.filter((row) => !appearedOnly || finite(row.seconds_played) > 0)
    .map((row) => String(row.game_id))).size;
}

function sourceEnvelope(configuration, rows, capabilities = {}) {
  const experimentId = configuration?.experimentId ?? configuration?.experiment_id
    ?? rows.find((row) => row.experiment_id)?.experiment_id ?? null;
  const selected = configuration?.selectedSeasons
    ?? configuration?.selected_seasons
    ?? configuration?.configuration?.selected_seasons
    ?? [...new Set(rows.map((row) => row.season_end_year))].sort((a, b) => a - b);
  const configurationReceipt = configuration?.configurationReceipt
    ?? configuration?.configuration_receipt
    ?? rows.find((row) => row.configuration_receipt)?.configuration_receipt
    ?? null;
  const calculationReceipt = configuration?.experimentReceipt
    ?? configuration?.experiment_receipt
    ?? configuration?.aggregateReceipt
    ?? configuration?.aggregate_receipt
    ?? null;
  return {
    kind: "experiment",
    id: `experiment:${experimentId}`,
    public_id: `experiment:${experimentId}`,
    label: configuration?.name ?? "Browser experiment",
    storage_slug: null,
    release_id: configuration?.releaseId ?? configuration?.release_id ?? null,
    run_id: experimentId,
    configuration_receipt: configurationReceipt,
    calculation_receipt: calculationReceipt,
    release_receipt: configuration?.manifestSha256 ?? configuration?.manifest_sha256 ?? null,
    runtime_receipt: configuration?.aggregateReceipt
      ?? configuration?.aggregate_receipt
      ?? calculationReceipt,
    completion_status: configuration?.published === true
      && configuration?.stale !== true
      && configuration?.requiresRerun !== true ? "complete" : "incomplete",
    certification_status: "browser_local_complete",
    scope: {
      season_end_years: [...selected].map(Number).sort((a, b) => a - b),
      first_season: selected.length ? seasonLabel(Math.min(...selected.map(Number))) : null,
      last_season: selected.length ? seasonLabel(Math.max(...selected.map(Number))) : null,
      complete_history: FULL_SEASONS.every((year) => selected.map(Number).includes(year)),
    },
    capabilities: {
      player_profiles: true,
      player_games: true,
      player_game_anatomy: true,
      player_similarity: true,
      player_similarity_season: true,
      player_similarity_career: FULL_SEASONS.every((year) => selected.map(Number).includes(year)),
      player_similarity_contract: true,
      team_profiles: true,
      team_games: true,
      team_similarity: true,
      biographical_profile: false,
      traditional_box_score: false,
      responsibility_breakdown: true,
      context_breakdown: true,
      authoritative_minutes: true,
      ...capabilities,
    },
  };
}

function assertComplete(configuration) {
  if (configuration?.published !== true) {
    throw error("experiment_not_complete", "Entity analytics require a completed browser experiment.");
  }
  if (configuration?.stale === true || configuration?.requiresRerun === true) {
    throw error("stale_experiment", "Rerun this experiment under the current receipt-bound release.");
  }
}

function selectedValueRows(rows, options, { season = true, schedule = true } = {}) {
  const mode = normalizeTimeMode(options.time_mode ?? options.garbage_time_mode);
  const selectedSeason = season ? seasonEndYear(options.season ?? options.scope) : null;
  const selectedSchedule = schedule
    ? normalizeSchedule(options.schedule ?? options.phase)
    : "All";
  return {
    mode,
    selectedSeason,
    schedule: selectedSchedule,
    rows: rows.filter((row) => row.time_mode === mode
      && (selectedSeason === null || Number(row.season_end_year) === selectedSeason)
      && scheduleMatches(row, selectedSchedule)),
  };
}

function allMinutesRows(rows, { seasons = null, schedule = "All" } = {}) {
  const selected = seasons === null ? null : new Set(seasons);
  return rows.filter((row) => row.time_mode === "all_minutes"
    && (selected === null || selected.has(Number(row.season_end_year)))
    && scheduleMatches(row, schedule));
}

function aggregateResponsibility(rows, total = sum(rows, (row) => row.final_value_contributed)) {
  const values = Object.fromEntries(RESPONSIBILITY_COMPONENTS.map((side) => [
    side,
    sum(rows, (row) => finite(row.responsibility?.[side])),
  ]));
  return {
    ...values,
    shares: Object.fromEntries(RESPONSIBILITY_COMPONENTS.map((side) => [
      side, ratio(values[side], total),
    ])),
  };
}

function aggregateContext(rows) {
  return Object.fromEntries(CONTEXT_COMPONENTS.map((key) => [
    key,
    sum(rows, (row) => finite(row.context_components?.[key])),
  ]));
}

function componentTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    for (const side of ["offense", "defense"]) {
      for (const [key, raw] of Object.entries(row.raw_components?.[side] ?? {})) {
        const identity = `${side}:${key}`;
        totals.set(identity, finite(totals.get(identity)) + finite(raw));
      }
    }
  }
  return [...totals.entries()].map(([identity, value]) => {
    const [side, ...parts] = identity.split(":");
    return { side, key: parts.join(":"), value };
  });
}

function playerRankMap(rows, metric) {
  const totals = [...groupBy(rows, canonicalPlayerId).entries()].map(([playerId, values]) => ({
    player_id: playerId,
    value: sum(values, (row) => metricValue(row, metric)),
  }));
  totals.sort((left, right) => right.value - left.value || left.player_id - right.player_id);
  return Object.fromEntries(totals.map((row, index) => [String(row.player_id), index + 1]));
}

export function buildPlayerRankIndex(rows, options = {}) {
  const timeMode = normalizeTimeMode(options.time_mode ?? options.garbage_time_mode);
  const schedule = normalizeSchedule(options.schedule ?? options.phase);
  const metric = normalizeMetric(options.metric);
  const selected = rows.filter((row) => row.time_mode === timeMode && scheduleMatches(row, schedule));
  const bySeason = groupBy(selected, (row) => Number(row.season_end_year));
  return {
    schema_version: "browser-player-rank-index-v1",
    time_mode: timeMode,
    schedule,
    metric,
    all: playerRankMap(selected, metric),
    seasons: Object.fromEntries([...bySeason.entries()]
      .sort(([left], [right]) => left - right)
      .map(([season, seasonRows]) => [String(season), playerRankMap(seasonRows, metric)])),
  };
}

function assertPlayerRankIndex(value, options) {
  if (value === null || value === undefined) return null;
  const timeMode = normalizeTimeMode(options.time_mode ?? options.garbage_time_mode);
  const schedule = normalizeSchedule(options.schedule ?? options.phase);
  const metric = normalizeMetric(options.metric);
  if (value.schema_version !== "browser-player-rank-index-v1"
      || value.time_mode !== timeMode
      || value.schedule !== schedule
      || value.metric !== metric
      || !value.all || typeof value.all !== "object" || Array.isArray(value.all)
      || !value.seasons || typeof value.seasons !== "object" || Array.isArray(value.seasons)) {
    throw error(
      "player_rank_index_mismatch",
      "The cached player-rank index does not match the requested entity scope.",
    );
  }
  return value;
}

function playerSeasonRows(allRows, playerId, options, metadata) {
  const mode = normalizeTimeMode(options.time_mode ?? options.garbage_time_mode);
  const schedule = normalizeSchedule(options.schedule ?? options.phase);
  const rankIndex = assertPlayerRankIndex(options.player_ranks, options);
  const values = allRows.filter((row) => row.time_mode === mode
    && canonicalPlayerId(row) === playerId && scheduleMatches(row, schedule));
  const activity = allMinutesRows(allRows, { schedule })
    .filter((row) => canonicalPlayerId(row) === playerId);
  const activityBySeason = groupBy(activity, (row) => Number(row.season_end_year));
  const poolBySeason = groupBy(
    allRows.filter((row) => row.time_mode === mode && scheduleMatches(row, schedule)),
    (row) => Number(row.season_end_year),
  );
  return [...groupBy(values, (row) => Number(row.season_end_year)).entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, seasonValues]) => {
      const activityRows = activityBySeason.get(year) ?? [];
      const metric = normalizeMetric(options.metric);
      const seasonRank = rankIndex
        ? rankIndex.seasons[String(year)]?.[String(playerId)] ?? null
        : playerRankMap(poolBySeason.get(year) ?? [], metric)[String(playerId)] ?? null;
      const responsibilities = aggregateResponsibility(seasonValues);
      const appearances = distinctGameCount(activityRows, { appearedOnly: true });
      const appearedRows = activityRows.filter((row) => finite(row.seconds_played) > 0);
      const wins = new Set(appearedRows.filter((row) => row.win_loss)
        .map((row) => String(row.game_id))).size;
      const losses = new Set(appearedRows.filter((row) => !row.win_loss)
        .map((row) => String(row.game_id))).size;
      const seconds = sum(activityRows, (row) => finite(row.seconds_played));
      const vc = sum(seasonValues, (row) => row.final_value_contributed);
      const wc = sum(seasonValues, (row) => row.win_loss ? row.final_value_contributed : 0);
      const teams = [...new Set(seasonValues.map((row) => row.team_id))]
        .map((teamId) => team(teamId, latestRow(seasonValues.filter((row) => row.team_id === teamId))?.game_date, metadata));
      return {
        season_end_year: year,
        season: seasonLabel(year),
        teams,
        appearances,
        games: appearances,
        games_played: appearances,
        wins,
        losses,
        value_evidence_rows: seasonValues.length,
        seconds_played: seconds,
        minutes: seconds / 60,
        minutes_played: seconds / 60,
        value_contributed: vc,
        wins_contributed: wc,
        value_per_game: ratio(vc, appearances),
        responsibility: responsibilities,
        season_rank: seasonRank,
      };
    });
}

function summaryRank(rows, playerId, metric) {
  const totals = [...groupBy(rows, canonicalPlayerId).entries()].map(([id, values]) => ({
    player_id: id,
    value: sum(values, (row) => metricValue(row, metric)),
  }));
  totals.sort((left, right) => right.value - left.value || left.player_id - right.player_id);
  const index = totals.findIndex((row) => row.player_id === playerId);
  return index < 0 ? null : index + 1;
}

const PLAYER_CHART_SCHEDULES = Object.freeze([
  Object.freeze({ id: "full", label: "Full season", matches: () => true }),
  Object.freeze({
    id: "regular_season",
    label: "Regular season",
    matches: (row) => row.season_type === "Regular Season",
  }),
  Object.freeze({
    id: "postseason",
    label: "Postseason",
    matches: (row) => ["PlayIn", "Playoffs"].includes(row.season_type),
  }),
]);

export function projectPlayerContributionChart(rows, {
  playerId,
  selectedSeason = null,
  timeMode = "competitive",
  metadata = TEAM_METADATA,
} = {}) {
  const selected = rows.filter((row) => row.time_mode === timeMode
    && canonicalPlayerId(row) === Number(playerId)
    && (selectedSeason === null || Number(row.season_end_year) === Number(selectedSeason)));
  const grain = selectedSeason === null ? "season" : "game";
  const schedules = PLAYER_CHART_SCHEDULES.map((schedule) => {
    const scheduleRows = selected.filter(schedule.matches);
    const grouped = groupBy(scheduleRows, (row) => grain === "season"
      ? Number(row.season_end_year) : String(row.game_id));
    const ordered = [...grouped.entries()].map(([key, values]) => ({
      key,
      rows: values,
      first: [...values].sort((left, right) => String(left.game_date).localeCompare(String(right.game_date))
        || String(left.game_id).localeCompare(String(right.game_id)))[0],
    })).sort((left, right) => grain === "season"
      ? Number(left.key) - Number(right.key)
      : String(left.first.game_date).localeCompare(String(right.first.game_date))
        || String(left.key).localeCompare(String(right.key)));
    let cumulativeValue = 0;
    let cumulativeWins = 0;
    const points = ordered.map((entry, index) => {
      const valueContributed = sum(entry.rows, (row) => finite(row.final_value_contributed));
      const winsContributed = sum(entry.rows, (row) => row.win_loss
        ? finite(row.final_value_contributed) : 0);
      cumulativeValue += valueContributed;
      cumulativeWins += winsContributed;
      const year = Number(entry.first.season_end_year);
      const common = {
        value_contributed: valueContributed,
        wins_contributed: winsContributed,
        cumulative_value_contributed: cumulativeValue,
        cumulative_wins_contributed: cumulativeWins,
      };
      if (grain === "season") {
        return {
          season_end_year: year,
          season: seasonLabel(year),
          ...common,
        };
      }
      return {
        game_number: index + 1,
        game_id: String(entry.key),
        game_date: entry.first.game_date,
        season_end_year: year,
        season: seasonLabel(year),
        season_type: entry.first.season_type,
        team: team(entry.first.team_id, entry.first.game_date, metadata),
        opponent: team(entry.first.opponent_id, entry.first.game_date, metadata),
        location: entry.first.location,
        win_loss: Boolean(entry.first.win_loss),
        outcome: entry.first.win_loss ? "W" : "L",
        seconds_played: sum(entry.rows, (row) => finite(row.seconds_played)),
        ...common,
      };
    });
    return { id: schedule.id, label: schedule.label, points };
  });
  return {
    grain,
    selected_season_end_year: selectedSeason === null ? null : Number(selectedSeason),
    schedules,
  };
}

export function projectPlayerProfile(rows, options = {}, configuration = null, metadata = TEAM_METADATA) {
  assertComplete(configuration);
  const playerId = Number(options.player_id);
  if (!Number.isSafeInteger(playerId) || playerId <= 0) {
    throw error("invalid_player_id", "player_id must be a positive canonical numeric ID.");
  }
  const metric = normalizeMetric(options.metric);
  const rankIndex = assertPlayerRankIndex(options.player_ranks, options);
  const scope = selectedValueRows(rows, options);
  const playerScope = scope.rows.filter((row) => canonicalPlayerId(row) === playerId);
  const allPlayerRows = rows.filter((row) => canonicalPlayerId(row) === playerId);
  if (allPlayerRows.length === 0) {
    throw error("player_not_found", "That player was not found.", { player_id: playerId });
  }
  const activityScope = allMinutesRows(rows, {
    seasons: scope.selectedSeason === null ? null : [scope.selectedSeason],
    schedule: scope.schedule,
  }).filter((row) => canonicalPlayerId(row) === playerId);
  const latest = latestRow(playerScope.length ? playerScope : allPlayerRows);
  const teams = [...new Set(playerScope.map((row) => row.team_id))]
    .map((teamId) => team(teamId, latestRow(playerScope.filter((row) => row.team_id === teamId))?.game_date, metadata));
  const vc = sum(playerScope, (row) => row.final_value_contributed);
  const wc = sum(playerScope, (row) => row.win_loss ? row.final_value_contributed : 0);
  const games = distinctGameCount(activityScope, { appearedOnly: true });
  const appearedScope = activityScope.filter((row) => finite(row.seconds_played) > 0);
  const wins = new Set(appearedScope.filter((row) => row.win_loss)
    .map((row) => String(row.game_id))).size;
  const losses = new Set(appearedScope.filter((row) => !row.win_loss)
    .map((row) => String(row.game_id))).size;
  const seconds = sum(activityScope, (row) => finite(row.seconds_played));
  const responsibility = aggregateResponsibility(playerScope);
  const components = componentTotals(playerScope);
  const career = playerSeasonRows(rows, playerId, options, metadata);
  const contributionChart = projectPlayerContributionChart(rows, {
    playerId,
    selectedSeason: scope.selectedSeason,
    timeMode: scope.mode,
    metadata,
  });
  const years = [...new Set(allPlayerRows.map((row) => Number(row.season_end_year)))].sort((a, b) => a - b);
  const entity = {
    player_id: playerId,
    player_name: latestPlayerName(allPlayerRows),
    headshot_url: `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`,
    latest_team: latest ? team(latest.team_id, latest.game_date, metadata) : null,
    teams,
    first_game_date: earliestRow(allPlayerRows)?.game_date ?? null,
    last_game_date: latestRow(allPlayerRows)?.game_date ?? null,
    data_span: years.length ? { from: seasonLabel(years[0]), to: seasonLabel(years.at(-1)) } : null,
  };
  const controls = {
    scope: scope.selectedSeason === null ? "All Seasons" : seasonLabel(scope.selectedSeason),
    schedule: scope.schedule,
    time_mode: scope.mode,
    metric,
  };
  const trend = career.map((row) => ({
    season_end_year: row.season_end_year,
    season: row.season,
    value_contributed: row.value_contributed,
    wins_contributed: row.wins_contributed,
    selected: row.season_end_year === scope.selectedSeason,
  }));
  return {
    source: sourceEnvelope(configuration, rows),
    state: playerScope.length ? "ready" : "empty",
    filters: controls,
    entity,
    player: entity,
    controls,
    summary: {
      games,
      games_played: games,
      appearances: games,
      wins,
      losses,
      value_evidence_rows: playerScope.length,
      seconds_played: seconds,
      minutes: seconds / 60,
      minutes_played: seconds / 60,
      value_contributed: vc,
      wins_contributed: wc,
      value_per_game: ratio(vc, games),
      rank: rankIndex
        ? (scope.selectedSeason === null
            ? rankIndex.all[String(playerId)] ?? null
            : rankIndex.seasons[String(scope.selectedSeason)]?.[String(playerId)] ?? null)
        : summaryRank(scope.rows, playerId, metric),
      rank_metric: metric,
    },
    career: {
      selected_season_end_year: scope.selectedSeason,
      chart: trend,
      rows: career,
    },
    seasons: career,
    trend,
    contribution_chart: contributionChart,
    fingerprint: {
      raw_vc: sum(playerScope, (row) => finite(row.raw_vc)),
      responsibility,
      context: aggregateContext(playerScope),
      sources: components
        .sort((left, right) => left.key.localeCompare(right.key)),
      wins_sources: componentTotals(playerScope.filter((row) => row.win_loss))
        .sort((left, right) => left.key.localeCompare(right.key)),
      leading_positive_sources: components.filter((row) => row.value > 0)
        .sort((left, right) => right.value - left.value || left.key.localeCompare(right.key)).slice(0, 6),
      leading_negative_sources: components.filter((row) => row.value < 0)
        .sort((left, right) => left.value - right.value || left.key.localeCompare(right.key)).slice(0, 6),
    },
  };
}

function pagination(options, total) {
  const limit = Math.max(1, Math.min(100, Number(options.limit ?? options.per_page ?? 20)));
  const page = Math.max(1, Number(options.page ?? 1));
  const offset = options.offset === undefined ? (page - 1) * limit : Math.max(0, Number(options.offset));
  return { limit, offset, page: Math.floor(offset / limit) + 1, total, total_pages: Math.ceil(total / limit) };
}

function topGamesPagination(options, total) {
  const requested = Number(options.limit ?? options.per_page ?? 10);
  return pagination({ ...options, limit: Math.min(10, requested) }, total);
}

export function projectPlayerGames(rows, options = {}, configuration = null, metadata = TEAM_METADATA) {
  assertComplete(configuration);
  const playerId = Number(options.player_id);
  if (!Number.isSafeInteger(playerId) || playerId <= 0) throw error("invalid_player_id", "player_id is required.");
  if (!rows.some((row) => canonicalPlayerId(row) === playerId)) {
    throw error("player_not_found", "That player was not found.", { player_id: playerId });
  }
  const outcome = normalizeOutcome(options.outcome);
  const scope = selectedValueRows(rows, options);
  const selected = scope.rows.filter((row) => canonicalPlayerId(row) === playerId
    && finite(row.seconds_played) > 0 && outcomeMatches(row, outcome));
  selected.sort((left, right) => right.final_value_contributed - left.final_value_contributed
    || String(right.game_date).localeCompare(String(left.game_date))
    || String(left.game_id).localeCompare(String(right.game_id)));
  const pager = topGamesPagination(options, selected.length);
  const projected = selected.slice(pager.offset, pager.offset + pager.limit).map((row, index) => ({
    rank: pager.offset + index + 1,
    game_id: String(row.game_id),
    game_date: row.game_date,
    season_end_year: Number(row.season_end_year),
    season: seasonLabel(Number(row.season_end_year)),
    season_type: row.season_type,
    player_id: canonicalPlayerId(row),
    player_name: row.player_name,
    team: team(row.team_id, row.game_date, metadata),
    opponent: team(row.opponent_id, row.game_date, metadata),
    location: row.location,
    result: row.win_loss ? "W" : "L",
    win_loss: row.win_loss,
    seconds_played: finite(row.seconds_played),
    value_contributed: row.final_value_contributed,
    wins_contributed: row.win_loss ? row.final_value_contributed : 0,
    responsibility: { ...row.responsibility },
  }));
  return {
    source: sourceEnvelope(configuration, rows),
    state: projected.length ? "ready" : "empty",
    player_id: playerId,
    filters: {
      scope: scope.selectedSeason === null ? "All Seasons" : seasonLabel(scope.selectedSeason),
      schedule: scope.schedule,
      time_mode: scope.mode,
      outcome,
    },
    rows: projected,
    pagination: pager,
  };
}

export function projectPlayerGameAnatomy(rows, options = {}, configuration = null, metadata = TEAM_METADATA) {
  assertComplete(configuration);
  const playerId = Number(options.player_id);
  const gameId = String(options.game_id ?? "");
  if (!Number.isSafeInteger(playerId) || playerId <= 0 || !gameId) {
    throw error("invalid_game_anatomy_identity", "player_id and game_id are required.");
  }
  const scope = selectedValueRows(rows, options);
  const row = scope.rows.find((item) => canonicalPlayerId(item) === playerId
    && String(item.game_id) === gameId);
  if (!row) return { source: sourceEnvelope(configuration, rows), state: "empty", player_id: playerId, game_id: gameId };
  const sources = componentTotals([row]).filter((item) => item.value !== 0)
    .sort((left, right) => left.key.localeCompare(right.key));
  const contexts = CONTEXT_COMPONENTS.map((key) => ({
    key, label: key.replaceAll("_", " "), value: finite(row.context_components?.[key]),
  })).filter((item) => item.value !== 0);
  const contextTotal = sum(contexts, (item) => item.value);
  return {
    source: sourceEnvelope(configuration, rows),
    state: "ready",
    player_id: playerId,
    player_name: row.player_name,
    game_id: gameId,
    game_date: row.game_date,
    season: seasonLabel(Number(row.season_end_year)),
    season_type: row.season_type,
    team: team(row.team_id, row.game_date, metadata),
    opponent: team(row.opponent_id, row.game_date, metadata),
    location: row.location,
    result: row.win_loss ? "W" : "L",
    sources,
    contexts,
    stages: [
      { key: "raw", label: "Governed raw value", value: finite(row.raw_vc) },
      { key: "context", label: "Six context effects", value: contextTotal },
      { key: "final", label: "Final Value Contributed", value: finite(row.final_value_contributed) },
    ],
    responsibility: { ...row.responsibility },
    closure: {
      raw_plus_context: finite(row.raw_vc) + contextTotal,
      final_value: finite(row.final_value_contributed),
    },
  };
}

function percentile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function playerFeatureRows(rows, mode, years) {
  const selectedValues = rows.filter((row) => row.time_mode === mode
    && years.includes(Number(row.season_end_year)));
  const selectedActivity = allMinutesRows(rows, { seasons: years });
  const activityByPlayer = groupBy(selectedActivity, canonicalPlayerId);
  return [...groupBy(selectedValues, canonicalPlayerId).entries()].map(([playerId, values]) => {
    const activity = activityByPlayer.get(playerId) ?? [];
    const seconds = sum(activity, (row) => finite(row.seconds_played));
    const appearances = distinctGameCount(activity, { appearedOnly: true });
    const per36 = seconds > 0 ? 2160 / seconds : 0;
    const features = {};
    for (const key of OFFENSE_SOURCE_COMPONENTS) {
      features[`source.offense.${key}`] = values.some((row) => instrumentationAvailable(row, key))
        ? sum(values, (row) => finite(row.raw_components?.offense?.[key])) * per36
        : null;
    }
    for (const key of DEFENSE_SOURCE_COMPONENTS) {
      features[`source.defense.${key}`] = values.some((row) => instrumentationAvailable(row, key))
        ? sum(values, (row) => finite(row.raw_components?.defense?.[key])) * per36
        : null;
    }
    const finalValue = sum(values, (row) => row.final_value_contributed);
    const responsibility = aggregateResponsibility(values, finalValue);
    for (const side of RESPONSIBILITY_COMPONENTS) {
      features[`responsibility.${side}`] = responsibility.shares[side];
    }
    for (const key of CONTEXT_COMPONENTS) {
      features[`context.${key}`] = sum(values, (row) => finite(row.context_components?.[key])) * per36;
    }
    features["impact.vc_per_36"] = sum(values, (row) => row.final_value_contributed) * per36;
    features["impact.wc_per_36"] = sum(values, (row) => row.win_loss ? row.final_value_contributed : 0) * per36;
    features["impact.minutes_per_appearance"] = appearances ? seconds / 60 / appearances : 0;
    return {
      player_id: playerId,
      player_name: latestPlayerName(values),
      appearances,
      minutes: seconds / 60,
      final_value: finalValue,
      teams: [...new Set(values.map((row) => Number(row.team_id)))].map((teamId) => {
        const latest = latestRow(values.filter((row) => Number(row.team_id) === teamId));
        return team(teamId, latest?.game_date);
      }),
      instrumentation_coverage: instrumentationScopeCoverage(values),
      features,
    };
  });
}

function featureFamily(key) {
  return key.slice(0, key.indexOf("."));
}

function standardizedPlayerFeatures(pool) {
  const keys = Object.keys(pool[0]?.features ?? {}).sort();
  const active = [];
  for (const key of keys) {
    const raw = pool.map((row) => optionalFinite(row.features[key]));
    const sorted = raw.filter((value) => value !== null).sort((a, b) => a - b);
    if (sorted.length === 0) continue;
    const lower = percentile(sorted, 0.01);
    const upper = percentile(sorted, 0.99);
    const clipped = raw.map((value) => value === null ? null : Math.min(upper, Math.max(lower, value)));
    const population = clipped.filter((value) => value !== null);
    const mean = sum(population, (value) => value) / population.length;
    const variance = sum(population, (value) => (value - mean) ** 2) / population.length;
    const deviation = Math.sqrt(variance);
    if (!(deviation > 1e-12)) continue;
    active.push({ key, family: featureFamily(key), lower, upper, mean, deviation });
  }
  return {
    active,
    rows: pool.map((row) => ({
      ...row,
      standardized: Object.fromEntries(active.map((feature) => [
        feature.key,
        optionalFinite(row.features[feature.key]) === null ? null
          : (Math.min(feature.upper, Math.max(feature.lower, row.features[feature.key])) - feature.mean)
            / feature.deviation,
      ])),
    })),
  };
}

function playerDistance(left, right, active) {
  const familyFeatures = groupBy(active, (feature) => feature.family);
  const families = {};
  const contributions = [];
  for (const [family, features] of familyFeatures.entries()) {
    const parts = features.flatMap((feature) => {
      const leftValue = optionalFinite(left.standardized[feature.key]);
      const rightValue = optionalFinite(right.standardized[feature.key]);
      if (leftValue === null || rightValue === null) return [];
      const gap = leftValue - rightValue;
      return [{
        feature: feature.key,
        gap: Math.abs(gap),
        squared: gap * gap,
        meaningful: Math.abs(gap) > 1e-12,
      }];
    });
    if (parts.length === 0) continue;
    const distance = sum(parts, (part) => part.squared) / parts.length;
    families[family] = distance;
    contributions.push(...parts.map((part) => ({ ...part, family, family_count: parts.length })));
  }
  const availableWeight = sum(Object.keys(families), (family) => FAMILY_WEIGHTS[family]);
  if (!(availableWeight > 0)) return null;
  const weighted = contributions.map((part) => ({
    feature: part.feature,
    standardized_gap: part.gap,
    contribution: FAMILY_WEIGHTS[part.family] / availableWeight
      * part.squared / part.family_count,
    meaningful: part.meaningful,
  }));
  const distanceSquared = sum(Object.entries(families), ([family, distance]) =>
    FAMILY_WEIGHTS[family] / availableWeight * distance);
  const differences = weighted.filter((item) => item.contribution > 1e-15)
    .sort((a, b) => b.contribution - a.contribution
    || a.feature.localeCompare(b.feature)).slice(0, 2);
  const similarities = weighted.filter((item) => item.meaningful)
    .sort((a, b) => a.standardized_gap - b.standardized_gap
      || a.feature.localeCompare(b.feature)).slice(0, 2);
  const sharedFeatureCount = contributions.length;
  return {
    distanceSquared,
    families,
    similarities,
    differences,
    sharedFeatureCount,
    activeFeatureCount: active.length,
    dimensionCoverage: active.length ? sharedFeatureCount / active.length : 0,
  };
}

export function projectPlayerSimilarity(rows, options = {}, configuration = null) {
  assertComplete(configuration);
  const playerId = Number(options.player_id);
  if (!Number.isSafeInteger(playerId) || playerId <= 0) throw error("invalid_player_id", "player_id is required.");
  const mode = String(options.mode ?? "career").toLowerCase();
  if (!["career", "season", "selected season", "selected_season"].includes(mode)) {
    throw error("invalid_similarity_mode", "Player similarity mode must be Career or Selected Season.");
  }
  const career = mode === "career";
  const selectedSeason = seasonEndYear(options.season ?? options.scope);
  if (!career && selectedSeason === null) {
    return { source: sourceEnvelope(configuration, rows), mode: "season", status: "unavailable", reason: "season_required", matches: [] };
  }
  const selected = configuration?.selectedSeasons
    ?? configuration?.selected_seasons
    ?? configuration?.configuration?.selected_seasons
    ?? [];
  if (career && !FULL_SEASONS.every((year) => selected.map(Number).includes(year))) {
    return { source: sourceEnvelope(configuration, rows), mode: "career", status: "unavailable", reason: "complete_history_required", matches: [] };
  }
  if (!career && !selected.map(Number).includes(selectedSeason)) {
    return { source: sourceEnvelope(configuration, rows), mode: "season", status: "unavailable", reason: "season_incomplete", matches: [] };
  }
  const years = career ? [...FULL_SEASONS] : [selectedSeason];
  const candidates = playerFeatureRows(rows, normalizeTimeMode(options.time_mode), years);
  const minimumGames = career ? 50 : 20;
  const minimumMinutes = career ? 2000 : 500;
  const target = candidates.find((row) => row.player_id === playerId);
  if (!target) {
    return { source: sourceEnvelope(configuration, rows), mode: career ? "career" : "season", status: "unavailable", reason: "player_not_found", matches: [] };
  }
  if (target.appearances < minimumGames || target.minutes < minimumMinutes) {
    return {
      source: sourceEnvelope(configuration, rows),
      mode: career ? "career" : "season",
      status: "unavailable",
      reason: "insufficient_data",
      eligibility: { appearances: target.appearances, minutes: target.minutes, minimum_games: minimumGames, minimum_minutes: minimumMinutes },
      matches: [],
    };
  }
  if (target.final_value === 0) {
    return {
      source: sourceEnvelope(configuration, rows),
      mode: career ? "career" : "season",
      status: "unavailable",
      reason: "zero_final_value",
      eligibility: { appearances: target.appearances, minutes: target.minutes, minimum_games: minimumGames, minimum_minutes: minimumMinutes },
      matches: [],
    };
  }
  const eligible = candidates.filter((row) => row.appearances >= minimumGames
    && row.minutes >= minimumMinutes && row.final_value !== 0);
  const standardized = standardizedPlayerFeatures(eligible);
  if (standardized.active.length === 0) {
    return { source: sourceEnvelope(configuration, rows), mode: career ? "career" : "season", status: "unavailable", reason: "zero_signal", matches: [] };
  }
  const standardizedTarget = standardized.rows.find((row) => row.player_id === playerId);
  const matches = standardized.rows.filter((row) => row.player_id !== playerId).map((row) => {
    const distance = playerDistance(standardizedTarget, row, standardized.active);
    if (distance === null) return null;
    const similarity = 100 * (2 ** (-distance.distanceSquared / 2));
    return {
      player_id: row.player_id,
      player_name: row.player_name,
      season_end_year: career ? null : selectedSeason,
      season: career ? null : seasonLabel(selectedSeason),
      teams: row.teams,
      games_played: row.appearances,
      seconds_played: row.minutes * 60,
      minutes_played: row.minutes,
      similarity: Math.round(similarity * 10) / 10,
      distance_squared: distance.distanceSquared,
      distance: Math.sqrt(Math.max(0, distance.distanceSquared)),
      dimension_coverage: distance.dimensionCoverage,
      family_distances: distance.families,
      strongest_similarities: distance.similarities,
      largest_differences: distance.differences,
    };
  }).filter(Boolean).sort((left, right) => left.distance_squared - right.distance_squared
    || left.player_id - right.player_id).slice(0, 5);
  return {
    source: sourceEnvelope(configuration, rows),
    filters: { season: career ? null : selectedSeason, time_mode: normalizeTimeMode(options.time_mode) },
    mode: career ? "career" : "season",
    season_end_year: career ? null : selectedSeason,
    status: matches.length ? "available" : "unavailable",
    reason: matches.length ? null : "eligible_pool_too_small",
    eligibility: { appearances: target.appearances, minutes: target.minutes, minimum_games: minimumGames, minimum_minutes: minimumMinutes, pool_size: eligible.length },
    active_feature_count: standardized.active.length,
    target: {
      player_id: target.player_id,
      player_name: target.player_name,
      teams: target.teams,
      games_played: target.appearances,
      seconds_played: target.minutes * 60,
      minutes_played: target.minutes,
    },
    matches,
  };
}

function rosterRows(valueRows, activityRows, metric) {
  const activityByPlayer = groupBy(activityRows, canonicalPlayerId);
  const valuesByPlayer = groupBy(valueRows, canonicalPlayerId);
  const teamMinutes = sum(activityRows, (row) => finite(row.seconds_played)) / 60;
  const result = [...valuesByPlayer.entries()].map(([playerId, values]) => {
    const activity = activityByPlayer.get(playerId) ?? [];
    const minutes = sum(activity, (row) => finite(row.seconds_played)) / 60;
    const appearances = distinctGameCount(activity, { appearedOnly: true });
    const appeared = activity.filter((row) => finite(row.seconds_played) > 0);
    const wins = new Set(appeared.filter((row) => row.win_loss)
      .map((row) => String(row.game_id))).size;
    const losses = new Set(appeared.filter((row) => !row.win_loss)
      .map((row) => String(row.game_id))).size;
    const responsibility = aggregateResponsibility(values);
    const vc = sum(values, (row) => row.final_value_contributed);
    const wc = sum(values, (row) => row.win_loss ? row.final_value_contributed : 0);
    return {
      player_id: playerId,
      player_name: latestPlayerName(values),
      games: appearances,
      games_played: appearances,
      appearances,
      wins,
      losses,
      value_evidence_rows: values.length,
      seconds_played: minutes * 60,
      minutes,
      minutes_played: minutes,
      minute_share: ratio(minutes, teamMinutes),
      minute_share_pct: ratio(minutes, teamMinutes) === null ? null : ratio(minutes, teamMinutes) * 100,
      value_contributed: vc,
      wins_contributed: wc,
      loss_value_contributed: vc - wc,
      value_per_game: ratio(vc, appearances),
      responsibility,
      context: aggregateContext(values),
      selected_value: metric === "wc" ? wc : vc,
    };
  });
  result.sort((left, right) => right.selected_value - left.selected_value || left.player_id - right.player_id);
  return result;
}

function selectedChartPlayers(roster, options = {}) {
  const raw = options.chart_player_ids ?? options.chartPlayerIds ?? [];
  const tokens = Array.isArray(raw) ? raw : String(raw).split(",");
  const identities = [...new Set(tokens
    .map((value) => Number(String(value).trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  if (identities.length > 10) {
    throw error("too_many_chart_players", "Choose at most 10 players for the team charts.");
  }
  if (!identities.length) return roster.slice(0, 10);
  const selected = roster.filter((row) => identities.includes(row.player_id)).slice(0, 10);
  return selected.length ? selected : roster.slice(0, 10);
}

function gameTimeline(valueRows, metric, selectedPlayers) {
  const selectedIds = new Set(selectedPlayers.map((row) => row.player_id));
  const games = [...groupBy(valueRows, (row) => String(row.game_id)).entries()].map(([gameId, rows]) => ({
    game_id: gameId,
    game_date: rows[0].game_date,
    season_end_year: Number(rows[0].season_end_year),
    rows,
  })).sort((left, right) => left.game_date.localeCompare(right.game_date)
    || left.game_id.localeCompare(right.game_id));
  const cumulative = new Map(selectedPlayers.map((player) => [player.player_id, 0]));
  let others = 0;
  return games.map((game, index) => {
    const perPlayer = new Map();
    for (const row of game.rows) {
      const id = canonicalPlayerId(row);
      perPlayer.set(id, finite(perPlayer.get(id)) + metricValue(row, metric));
    }
    for (const id of selectedIds) cumulative.set(id, finite(cumulative.get(id)) + finite(perPlayer.get(id)));
    others += sum(game.rows.filter((row) => !selectedIds.has(canonicalPlayerId(row))), (row) => metricValue(row, metric));
    return {
      game_number: index + 1,
      game_id: game.game_id,
      game_date: game.game_date,
      season_end_year: game.season_end_year,
      season_separator: index === 0 || games[index - 1].season_end_year !== game.season_end_year,
      values: [
        ...selectedPlayers.map((player) => ({ player_id: player.player_id, player_name: player.player_name, cumulative: cumulative.get(player.player_id) })),
        { player_id: null, player_name: "All Other Players", cumulative: others },
      ],
      team_total: fsum([...cumulative.values(), others]),
    };
  });
}

function nonAdditiveChart(valueRows, selectedPlayers, metric, selectedSeason, options = {}) {
  const top = selectedPlayers;
  const selectedIds = new Set(top.map((row) => row.player_id));
  if (selectedSeason === null) {
    return {
      mode: "season_totals",
      series: [
        ...top.map((player) => ({
          player_id: player.player_id,
          player_name: player.player_name,
          points: [...groupBy(valueRows.filter((row) => canonicalPlayerId(row) === player.player_id), (row) => Number(row.season_end_year)).entries()]
            .map(([year, rows]) => ({ season_end_year: year, season: seasonLabel(year), value: sum(rows, (row) => metricValue(row, metric)) }))
            .sort((left, right) => left.season_end_year - right.season_end_year),
        })),
        {
          player_id: null,
          player_name: "All Other Players",
          points: [...groupBy(valueRows.filter((row) => !selectedIds.has(canonicalPlayerId(row))), (row) => Number(row.season_end_year)).entries()]
            .map(([year, rows]) => ({ season_end_year: year, season: seasonLabel(year), value: sum(rows, (row) => metricValue(row, metric)) }))
            .sort((left, right) => left.season_end_year - right.season_end_year),
        },
      ],
    };
  }
  const rolling = String(options.rolling ?? "raw");
  const games = [...groupBy(valueRows, (row) => String(row.game_id)).entries()].map(([gameId, rows]) => ({
    game_id: gameId, game_date: rows[0].game_date, rows,
  })).sort((left, right) => left.game_date.localeCompare(right.game_date) || left.game_id.localeCompare(right.game_id));
  const seriesRows = [...top, { player_id: null, player_name: "All Other Players" }].map((player) => {
    const raw = games.map((game, index) => {
      const matching = game.rows.filter((row) => player.player_id === null
        ? !selectedIds.has(canonicalPlayerId(row)) : canonicalPlayerId(row) === player.player_id);
      return { game_number: index + 1, game_id: game.game_id, game_date: game.game_date, raw: sum(matching, (row) => metricValue(row, metric)) };
    });
    return {
      player_id: player.player_id,
      player_name: player.player_name,
      points: raw.map((point, index) => {
        const window = raw.slice(Math.max(0, index - 9), index + 1);
        return { ...point, rolling: sum(window, (row) => row.raw) / window.length, window_size: window.length };
      }),
    };
  });
  return { mode: "team_games", display: rolling === "rolling" ? "rolling" : "raw", window_games: 10, series: seriesRows };
}

export function projectTeamProfile(rows, options = {}, configuration = null, metadata = TEAM_METADATA) {
  assertComplete(configuration);
  const teamId = Number(options.team_id);
  if (!Number.isSafeInteger(teamId) || teamId <= 0) throw error("invalid_team_id", "team_id must be a positive numeric ID.");
  const metric = normalizeMetric(options.metric);
  const scope = selectedValueRows(rows, options);
  const values = scope.rows.filter((row) => Number(row.team_id) === teamId);
  const allTeamRows = rows.filter((row) => Number(row.team_id) === teamId);
  if (allTeamRows.length === 0) {
    throw error("team_not_found", "That team was not found.", { team_id: teamId });
  }
  const activity = allMinutesRows(rows, {
    seasons: scope.selectedSeason === null ? null : [scope.selectedSeason],
    schedule: scope.schedule,
  }).filter((row) => Number(row.team_id) === teamId);
  const roster = rosterRows(values, activity, metric);
  const gamesById = groupBy(values, (row) => String(row.game_id));
  const games = gamesById.size;
  const wins = [...gamesById.values()].filter((gameRows) => gameRows[0]?.win_loss).length;
  const vc = sum(values, (row) => row.final_value_contributed);
  const wc = sum(values, (row) => row.win_loss ? row.final_value_contributed : 0);
  const responsibility = aggregateResponsibility(values);
  const metricTotal = metric === "wc" ? wc : vc;
  const minuteTotal = sum(roster, (row) => row.minutes);
  const concentration = [1, 3, 5].map((count) => ({
    players: count,
    contribution_share: ratio(sum(roster.slice(0, count), (row) => row.selected_value), metricTotal),
    contribution_share_pct: ratio(sum(roster.slice(0, count), (row) => row.selected_value), metricTotal) === null
      ? null : ratio(sum(roster.slice(0, count), (row) => row.selected_value), metricTotal) * 100,
    minutes_share: ratio(sum(roster.slice(0, count), (row) => row.minutes), minuteTotal),
    minutes_share_pct: ratio(sum(roster.slice(0, count), (row) => row.minutes), minuteTotal) === null
      ? null : ratio(sum(roster.slice(0, count), (row) => row.minutes), minuteTotal) * 100,
  }));
  const chartPlayers = selectedChartPlayers(roster, options);
  const latest = latestRow(values.length ? values : allTeamRows);
  const entity = team(teamId, latest?.game_date, metadata);
  const controls = {
    scope: scope.selectedSeason === null ? "All Seasons" : seasonLabel(scope.selectedSeason),
    schedule: scope.schedule,
    time_mode: scope.mode,
    metric,
  };
  const seasonRows = [...groupBy(values, (row) => Number(row.season_end_year)).entries()]
    .map(([year, seasonValues]) => ({
      season_end_year: year,
      season: seasonLabel(year),
      games: distinctGameCount(seasonValues),
      wins: [...groupBy(seasonValues, (row) => String(row.game_id)).values()]
        .filter((gameRows) => gameRows[0]?.win_loss).length,
      value_contributed: sum(seasonValues, (row) => row.final_value_contributed),
      wins_contributed: sum(seasonValues, (row) => row.win_loss ? row.final_value_contributed : 0),
    })).sort((left, right) => left.season_end_year - right.season_end_year);
  const cumulative = gameTimeline(values, metric, chartPlayers);
  const seasonal = nonAdditiveChart(values, chartPlayers, metric, scope.selectedSeason, options);
  return {
    source: sourceEnvelope(configuration, rows),
    state: values.length ? "ready" : "empty",
    filters: controls,
    entity,
    team: entity,
    controls,
    summary: {
      games,
      wins,
      losses: games - wins,
      win_percentage: ratio(wins, games),
      team_value_contributed: vc,
      team_wins_contributed: wc,
      loss_value_contributed: vc - wc,
      responsibility,
      unique_players: roster.length,
      conservation: { expected_vc: games, expected_wc: wins, expected_loss_vc: games - wins },
    },
    concentration,
    who_built_total: {
      metric,
      players: chartPlayers.map((row) => ({ player_id: row.player_id, player_name: row.player_name })),
      points: cumulative,
    },
    roster: {
      rows: roster,
      footer: {
        games,
        minutes: minuteTotal,
        value_contributed: vc,
        wins_contributed: wc,
        loss_value_contributed: vc - wc,
        responsibility,
      },
    },
    contribution_chart: seasonal,
    seasons: seasonRows,
    players: roster,
    cumulative_series: cumulative,
    season_series: seasonal,
    fingerprint: {
      raw_vc: sum(values, (row) => finite(row.raw_vc)),
      responsibility,
      context: aggregateContext(values),
    },
  };
}

export function projectTeamGames(rows, options = {}, configuration = null, metadata = TEAM_METADATA) {
  assertComplete(configuration);
  const teamId = Number(options.team_id);
  if (!Number.isSafeInteger(teamId) || teamId <= 0) throw error("invalid_team_id", "team_id is required.");
  if (!rows.some((row) => Number(row.team_id) === teamId)) {
    throw error("team_not_found", "That team was not found.", { team_id: teamId });
  }
  const outcome = normalizeOutcome(options.outcome);
  const scope = selectedValueRows(rows, options);
  const selected = scope.rows.filter((row) => Number(row.team_id) === teamId
    && finite(row.seconds_played) > 0 && outcomeMatches(row, outcome));
  selected.sort((left, right) => right.final_value_contributed - left.final_value_contributed
    || String(right.game_date).localeCompare(String(left.game_date))
    || canonicalPlayerId(left) - canonicalPlayerId(right));
  const pager = topGamesPagination(options, selected.length);
  return {
    source: sourceEnvelope(configuration, rows),
    state: selected.length ? "ready" : "empty",
    team_id: teamId,
    filters: { scope: scope.selectedSeason === null ? "All Seasons" : seasonLabel(scope.selectedSeason), schedule: scope.schedule, time_mode: scope.mode, outcome },
    rows: selected.slice(pager.offset, pager.offset + pager.limit).map((row, index) => ({
      rank: pager.offset + index + 1,
      game_id: String(row.game_id),
      game_date: row.game_date,
      season_end_year: Number(row.season_end_year),
      season: seasonLabel(Number(row.season_end_year)),
      season_type: row.season_type,
      player_id: canonicalPlayerId(row),
      player_name: row.player_name,
      team: team(row.team_id, row.game_date, metadata),
      opponent: team(row.opponent_id, row.game_date, metadata),
      location: row.location,
      result: row.win_loss ? "W" : "L",
      win_loss: row.win_loss,
      seconds_played: finite(row.seconds_played),
      value_contributed: row.final_value_contributed,
      wins_contributed: row.win_loss ? row.final_value_contributed : 0,
      responsibility: { ...row.responsibility },
    })),
    pagination: pager,
  };
}

function teamSeasonFingerprints(rows, mode) {
  const regular = rows.filter((row) => row.season_type === "Regular Season");
  const values = regular.filter((row) => row.time_mode === mode);
  const activity = regular.filter((row) => row.time_mode === "all_minutes");
  const activityGroups = groupBy(activity, (row) => `${row.season_end_year}:${row.team_id}`);
  const valueGroups = groupBy(values, (row) => `${row.season_end_year}:${row.team_id}`);
  const teamSeasons = [];
  for (const [key, valueRows] of valueGroups.entries()) {
    const activityRows = activityGroups.get(key) ?? [];
    const minutesByPlayer = [...groupBy(activityRows, canonicalPlayerId).entries()].map(([playerId, playerRows]) => ({
      player_id: playerId,
      seconds: sum(playerRows, (row) => finite(row.seconds_played)),
    })).filter((row) => row.seconds > 0)
      .sort((left, right) => right.seconds - left.seconds || left.player_id - right.player_id);
    const totalSeconds = sum(minutesByPlayer, (row) => row.seconds);
    if (!(totalSeconds > 0)) continue;
    const significant = [];
    let covered = 0;
    for (const player of minutesByPlayer) {
      significant.push(player);
      covered += player.seconds;
      if (covered / totalSeconds >= 0.95) break;
    }
    const valuesByPlayer = groupBy(valueRows, canonicalPlayerId);
    const players = significant.map((activityPlayer) => {
      const playerRows = valuesByPlayer.get(activityPlayer.player_id) ?? [];
      const scale = 60000 / activityPlayer.seconds;
      const features = { offense: {}, defense: {}, context: {}, responsibility: {} };
      for (const component of OFFENSE_SOURCE_COMPONENTS) {
        features.offense[component] = playerRows.some((row) => instrumentationAvailable(row, component))
          ? sum(playerRows, (row) => finite(row.raw_components?.offense?.[component])) * scale
          : null;
      }
      for (const component of DEFENSE_SOURCE_COMPONENTS) {
        features.defense[component] = playerRows.some((row) => instrumentationAvailable(row, component))
          ? sum(playerRows, (row) => finite(row.raw_components?.defense?.[component])) * scale
          : null;
      }
      for (const component of CONTEXT_COMPONENTS) {
        features.context[component] = sum(playerRows, (row) => finite(row.context_components?.[component])) * scale;
      }
      for (const component of RESPONSIBILITY_COMPONENTS) {
        features.responsibility[component] = sum(playerRows, (row) => finite(row.responsibility?.[component])) * scale;
      }
      return {
        player_id: activityPlayer.player_id,
        player_name: playerRows.length ? latestPlayerName(playerRows) : "Unknown player",
        minute_weight: activityPlayer.seconds / covered,
        instrumentation_coverage: instrumentationScopeCoverage(playerRows),
        features,
      };
    });
    const [yearText, teamText] = key.split(":");
    teamSeasons.push({
      key,
      season_end_year: Number(yearText),
      team_id: Number(teamText),
      minute_coverage: covered / totalSeconds,
      players,
    });
  }
  for (const yearRows of groupBy(teamSeasons, (row) => row.season_end_year).values()) {
    const population = yearRows.flatMap((row) => row.players);
    for (const family of TEAM_FAMILIES) {
      const keys = family === "offense" ? OFFENSE_SOURCE_COMPONENTS
        : family === "defense" ? DEFENSE_SOURCE_COMPONENTS
          : family === "context" ? CONTEXT_COMPONENTS : RESPONSIBILITY_COMPONENTS;
      for (const feature of keys) {
        const observed = population.filter((player) => Number.isFinite(player.features[family][feature]));
        const valuesForFeature = observed.map((player) => player.features[family][feature]);
        const distinct = new Set(valuesForFeature);
        if (observed.length < 2 || distinct.size <= 1) {
          for (const player of observed) player.features[family][feature] = null;
          continue;
        }
        const sorted = [...valuesForFeature].sort((a, b) => a - b);
        const rankByValue = new Map();
        for (const value of distinct) {
          const first = sorted.indexOf(value);
          const last = sorted.lastIndexOf(value);
          rankByValue.set(value, (((first + last) / 2) + 0.5) / sorted.length);
        }
        for (const player of observed) {
          player.features[family][feature] = rankByValue.get(player.features[family][feature]);
        }
      }
    }
  }
  return teamSeasons;
}

function playerCost(left, right) {
  const families = {};
  let compared = 0;
  let possible = 0;
  for (const family of TEAM_FAMILIES) {
    const keys = family === "offense" ? OFFENSE_SOURCE_COMPONENTS
      : family === "defense" ? DEFENSE_SOURCE_COMPONENTS
        : family === "context" ? CONTEXT_COMPONENTS : RESPONSIBILITY_COMPONENTS;
    const gaps = [];
    for (const key of keys) {
      possible += 1;
      const a = left.features[family][key];
      const b = right.features[family][key];
      if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      compared += 1;
      gaps.push(Math.abs(a - b));
    }
    families[family] = gaps.length ? sum(gaps, (value) => value) / gaps.length : null;
  }
  const availableFamilies = TEAM_FAMILIES.filter((family) => families[family] !== null);
  const coverage = possible ? compared / possible : 0;
  return {
    // The official runtime assigns an uninformative unit cost when two
    // players share no active dimensions. Such pairs remain in the complete
    // empirical distance distribution and are filtered only after scoring.
    cost: availableFamilies.length ? sum(availableFamilies, (family) => families[family]) / availableFamilies.length : 1,
    families,
    coverage,
    shared_dimension_count: compared,
    feature_dimension_count: possible,
  };
}

const TEAM_FAMILY_LAYOUT = Object.freeze([
  ["offense", OFFENSE_SOURCE_COMPONENTS],
  ["defense", DEFENSE_SOURCE_COMPONENTS],
  ["context", CONTEXT_COMPONENTS],
  ["responsibility", RESPONSIBILITY_COMPONENTS],
]);
const TEAM_FEATURE_DIMENSION_COUNT = TEAM_FAMILY_LAYOUT.reduce(
  (total, [, keys]) => total + keys.length,
  0,
);

function compactTeamPlayers(players) {
  return players.map((player) => {
    const values = new Float64Array(TEAM_FEATURE_DIMENSION_COUNT);
    let offset = 0;
    for (const [family, keys] of TEAM_FAMILY_LAYOUT) {
      for (const key of keys) {
        const value = player.features[family][key];
        values[offset] = value === null || !Number.isFinite(value) ? Number.NaN : value;
        offset += 1;
      }
    }
    return { minute_weight: player.minute_weight, values };
  });
}

const TEAM_FAMILY_BOUNDARIES = Object.freeze([0, 15, 26, 32, 35]);

function writeCompactPlayerCost(left, right, costs, coverages, edge) {
  let compared = 0;
  let familyCount = 0;
  let familyMeanTotal = 0;
  for (let family = 0; family < 4; family += 1) {
    let familyCompared = 0;
    let familyGapTotal = 0;
    const end = TEAM_FAMILY_BOUNDARIES[family + 1];
    for (let offset = TEAM_FAMILY_BOUNDARIES[family]; offset < end; offset += 1) {
      const leftValue = left.values[offset];
      const rightValue = right.values[offset];
      // Compacted features contain only finite percentiles or NaN sentinels.
      if (leftValue !== leftValue || rightValue !== rightValue) continue;
      familyGapTotal += leftValue >= rightValue
        ? leftValue - rightValue
        : rightValue - leftValue;
      familyCompared += 1;
    }
    if (familyCompared > 0) {
      familyMeanTotal += familyGapTotal / familyCompared;
      familyCount += 1;
      compared += familyCompared;
    }
  }
  costs[edge] = familyCount > 0 ? familyMeanTotal / familyCount : 1;
  coverages[edge] = compared / TEAM_FEATURE_DIMENSION_COUNT;
}

function createTransportWorkspace(maxPlayers) {
  const maximumEdges = maxPlayers * maxPlayers;
  const maximumNodes = maxPlayers * 2 + 2;
  return {
    costs: new Float64Array(maximumEdges),
    coverages: new Float64Array(maximumEdges),
    flows: new Float64Array(maximumEdges),
    supply: new Float64Array(maxPlayers),
    demand: new Float64Array(maxPlayers),
    potential: new Float64Array(maximumNodes),
    distance: new Float64Array(maximumNodes),
    parentNode: new Int16Array(maximumNodes),
    parentEdge: new Int16Array(maximumNodes),
    parentKind: new Int8Array(maximumNodes),
    visited: new Uint8Array(maximumNodes),
  };
}

function prepareCompactTransport(leftPlayers, rightPlayers, workspace) {
  const leftCount = leftPlayers.length;
  const rightCount = rightPlayers.length;
  const edgeCount = leftCount * rightCount;
  const { costs, coverages, flows, supply, demand } = workspace;
  flows.fill(0, 0, edgeCount);
  supply.fill(0, 0, leftCount);
  demand.fill(0, 0, rightCount);
  for (let left = 0; left < leftCount; left += 1) {
    supply[left] = leftPlayers[left].minute_weight;
    for (let right = 0; right < rightCount; right += 1) {
      const edge = left * rightCount + right;
      writeCompactPlayerCost(
        leftPlayers[left],
        rightPlayers[right],
        costs,
        coverages,
        edge,
      );
    }
  }
  for (let right = 0; right < rightCount; right += 1) {
    demand[right] = rightPlayers[right].minute_weight;
  }
  return Math.min(
    sum(leftPlayers, (player) => player.minute_weight),
    sum(rightPlayers, (player) => player.minute_weight),
  );
}

// Specialized successive-shortest-path transport. This is the same
// deterministic residual network used by optimalTransport, represented in
// reusable typed arrays rather than hundreds of edge objects per pair.
// Node and edge ordering deliberately mirrors the rich solver so equal-cost
// paths retain its canonical tie-breaking behavior.
function optimalTransportSummary(leftPlayers, rightPlayers, workspace) {
  const leftCount = leftPlayers.length;
  const rightCount = rightPlayers.length;
  const source = 0;
  const leftOffset = 1;
  const rightOffset = leftOffset + leftCount;
  const sink = rightOffset + rightCount;
  const nodeCount = sink + 1;
  const {
    costs, coverages, flows, supply, demand, potential, distance,
    parentNode, parentEdge, parentKind, visited,
  } = workspace;
  potential.fill(0, 0, nodeCount);
  let transported = 0;
  let totalCost = 0;
  const epsilon = 1e-12;
  const targetMass = prepareCompactTransport(leftPlayers, rightPlayers, workspace);
  let augmentations = 0;
  const maximumAugmentations = leftCount + rightCount + 1;
  while (transported < targetMass - epsilon) {
    if (augmentations >= maximumAugmentations) {
      return { available: false, reason: "transport_did_not_converge" };
    }
    augmentations += 1;
    distance.fill(Infinity, 0, nodeCount);
    parentNode.fill(-1, 0, nodeCount);
    parentEdge.fill(-1, 0, nodeCount);
    parentKind.fill(0, 0, nodeCount);
    visited.fill(0, 0, nodeCount);
    distance[source] = 0;
    for (let iteration = 0; iteration < nodeCount; iteration += 1) {
      let node = -1;
      for (let candidate = 0; candidate < nodeCount; candidate += 1) {
        if (visited[candidate] || !Number.isFinite(distance[candidate])) continue;
        if (node < 0 || distance[candidate] < distance[node] - epsilon
            || (Math.abs(distance[candidate] - distance[node]) <= epsilon && candidate < node)) {
          node = candidate;
        }
      }
      if (node < 0) break;
      visited[node] = true;
      if (node === sink) break;
      const relax = (to, edgeIndex, edgeCost, kind) => {
        if (visited[to]) return;
        const reducedCost = Math.max(0, edgeCost + potential[node] - potential[to]);
        const candidateDistance = distance[node] + reducedCost;
        if (candidateDistance < distance[to] - epsilon
            || (Math.abs(candidateDistance - distance[to]) <= epsilon
              && (parentNode[to] < 0 || node < parentNode[to]
                || (node === parentNode[to] && edgeIndex < parentEdge[to])))) {
          distance[to] = candidateDistance;
          parentNode[to] = node;
          parentEdge[to] = edgeIndex;
          parentKind[to] = kind;
        }
      };
      if (node === source) {
        for (let left = 0; left < leftCount; left += 1) {
          if (supply[left] > epsilon) relax(leftOffset + left, left, 0, 1);
        }
      } else if (node >= leftOffset && node < rightOffset) {
        const left = node - leftOffset;
        for (let right = 0; right < rightCount; right += 1) {
          const edge = left * rightCount + right;
          if (1 - flows[edge] > epsilon) {
            relax(rightOffset + right, 1 + right, costs[edge], 2);
          }
        }
      } else if (node >= rightOffset && node < sink) {
        const right = node - rightOffset;
        // The original adjacency list inserts right-to-sink before reverse
        // player edges, so it receives edge index zero in a tie.
        if (demand[right] > epsilon) relax(sink, 0, 0, 4);
        for (let left = 0; left < leftCount; left += 1) {
          const edge = left * rightCount + right;
          if (flows[edge] > epsilon) {
            relax(leftOffset + left, 1 + left, -costs[edge], 3);
          }
        }
      }
    }
    if (!Number.isFinite(distance[sink])) return { available: false, reason: "dimension_coverage_below_threshold" };
    for (let node = 0; node < nodeCount; node += 1) {
      if (Number.isFinite(distance[node])) potential[node] += distance[node];
    }
    let amount = targetMass - transported;
    let pathCost = 0;
    for (let node = sink; node !== source; node = parentNode[node]) {
      if (node < 0 || parentNode[node] < 0) return { available: false, reason: "transport_path_missing" };
      const kind = parentKind[node];
      if (kind === 1) {
        amount = Math.min(amount, supply[node - leftOffset]);
      } else if (kind === 2) {
        const left = parentNode[node] - leftOffset;
        const right = node - rightOffset;
        const edge = left * rightCount + right;
        amount = Math.min(amount, 1 - flows[edge]);
        pathCost += costs[edge];
      } else if (kind === 3) {
        const left = node - leftOffset;
        const right = parentNode[node] - rightOffset;
        const edge = left * rightCount + right;
        amount = Math.min(amount, flows[edge]);
        pathCost -= costs[edge];
      } else if (kind === 4) {
        amount = Math.min(amount, demand[parentNode[node] - rightOffset]);
      } else {
        return { available: false, reason: "transport_path_missing" };
      }
    }
    if (!(amount > epsilon)) return { available: false, reason: "transport_zero_augmentation" };
    for (let node = sink; node !== source; node = parentNode[node]) {
      const kind = parentKind[node];
      if (kind === 1) {
        supply[node - leftOffset] -= amount;
      } else if (kind === 2) {
        const left = parentNode[node] - leftOffset;
        const right = node - rightOffset;
        flows[left * rightCount + right] += amount;
      } else if (kind === 3) {
        const left = node - leftOffset;
        const right = parentNode[node] - rightOffset;
        flows[left * rightCount + right] -= amount;
      } else if (kind === 4) {
        demand[parentNode[node] - rightOffset] -= amount;
      }
    }
    transported += amount;
    totalCost += amount * pathCost;
  }
  let weightedCoverage = 0;
  for (let left = 0; left < leftCount; left += 1) {
    for (let right = 0; right < rightCount; right += 1) {
      const edge = left * rightCount + right;
      if (flows[edge] <= epsilon) continue;
      weightedCoverage += flows[edge] * coverages[edge];
    }
  }
  return {
    available: true,
    distance: totalCost,
    dimension_coverage: transported > epsilon ? weightedCoverage / transported : 0,
  };
}

function optimalTransport(leftPlayers, rightPlayers) {
  const source = 0;
  const leftOffset = 1;
  const rightOffset = leftOffset + leftPlayers.length;
  const sink = rightOffset + rightPlayers.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from, to, capacity, cost, detail = null) => {
    const forward = { to, reverse: graph[to].length, capacity, cost, flow: 0, detail };
    const reverse = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost, flow: 0, detail: null };
    graph[from].push(forward);
    graph[to].push(reverse);
  };
  leftPlayers.forEach((player, index) => addEdge(source, leftOffset + index, player.minute_weight, 0));
  rightPlayers.forEach((player, index) => addEdge(rightOffset + index, sink, player.minute_weight, 0));
  for (let left = 0; left < leftPlayers.length; left += 1) {
    for (let right = 0; right < rightPlayers.length; right += 1) {
      const detail = playerCost(leftPlayers[left], rightPlayers[right]);
      if (Number.isFinite(detail.cost)) {
        addEdge(leftOffset + left, rightOffset + right, 1, detail.cost, { left, right, ...detail });
      }
    }
  }
  let transported = 0;
  let totalCost = 0;
  const epsilon = 1e-12;
  const targetMass = Math.min(
    sum(leftPlayers, (player) => player.minute_weight),
    sum(rightPlayers, (player) => player.minute_weight),
  );
  const potential = Array(graph.length).fill(0);
  let augmentations = 0;
  const maximumAugmentations = leftPlayers.length + rightPlayers.length + 1;
  while (transported < targetMass - epsilon) {
    if (augmentations >= maximumAugmentations) {
      return { available: false, reason: "transport_did_not_converge" };
    }
    augmentations += 1;
    const distance = Array(graph.length).fill(Infinity);
    const parentNode = Array(graph.length).fill(-1);
    const parentEdge = Array(graph.length).fill(-1);
    const visited = Array(graph.length).fill(false);
    distance[source] = 0;
    for (let iteration = 0; iteration < graph.length; iteration += 1) {
      let node = -1;
      for (let candidate = 0; candidate < graph.length; candidate += 1) {
        if (visited[candidate] || !Number.isFinite(distance[candidate])) continue;
        if (node < 0 || distance[candidate] < distance[node] - epsilon
            || (Math.abs(distance[candidate] - distance[node]) <= epsilon && candidate < node)) {
          node = candidate;
        }
      }
      if (node < 0) break;
      visited[node] = true;
      if (node === sink) break;
      graph[node].forEach((edge, edgeIndex) => {
        if (edge.capacity <= epsilon || visited[edge.to]) return;
        const reducedCost = Math.max(0, edge.cost + potential[node] - potential[edge.to]);
        const candidateDistance = distance[node] + reducedCost;
        if (candidateDistance < distance[edge.to] - epsilon
            || (Math.abs(candidateDistance - distance[edge.to]) <= epsilon
              && (parentNode[edge.to] < 0 || node < parentNode[edge.to]
                || (node === parentNode[edge.to] && edgeIndex < parentEdge[edge.to])))) {
          distance[edge.to] = candidateDistance;
          parentNode[edge.to] = node;
          parentEdge[edge.to] = edgeIndex;
        }
      });
    }
    if (!Number.isFinite(distance[sink])) return { available: false, reason: "dimension_coverage_below_threshold" };
    for (let node = 0; node < graph.length; node += 1) {
      if (Number.isFinite(distance[node])) potential[node] += distance[node];
    }
    let amount = targetMass - transported;
    let pathCost = 0;
    for (let node = sink; node !== source; node = parentNode[node]) {
      if (node < 0 || parentNode[node] < 0) return { available: false, reason: "transport_path_missing" };
      const edge = graph[parentNode[node]][parentEdge[node]];
      amount = Math.min(amount, edge.capacity);
      pathCost += edge.cost;
    }
    if (!(amount > epsilon)) return { available: false, reason: "transport_zero_augmentation" };
    for (let node = sink; node !== source; node = parentNode[node]) {
      const edge = graph[parentNode[node]][parentEdge[node]];
      edge.capacity -= amount;
      edge.flow += amount;
      graph[node][edge.reverse].capacity += amount;
      graph[node][edge.reverse].flow -= amount;
    }
    transported += amount;
    totalCost += amount * pathCost;
  }
  const flows = [];
  for (let left = 0; left < leftPlayers.length; left += 1) {
    for (const edge of graph[leftOffset + left]) {
      if (!edge.detail || edge.flow <= epsilon) continue;
      flows.push({
        source_player_id: leftPlayers[edge.detail.left].player_id,
        source_player_name: leftPlayers[edge.detail.left].player_name,
        match_player_id: rightPlayers[edge.detail.right].player_id,
        match_player_name: rightPlayers[edge.detail.right].player_name,
        minute_weight: edge.flow,
        cost: edge.detail.cost,
        family_differences: edge.detail.families,
        dimension_coverage: edge.detail.coverage,
        shared_dimension_count: edge.detail.shared_dimension_count,
        feature_dimension_count: edge.detail.feature_dimension_count,
      });
    }
  }
  const dimensionCoverage = transported > epsilon
    ? sum(flows, (flow) => flow.minute_weight * flow.dimension_coverage) / transported
    : 0;
  return { available: true, distance: totalCost, dimension_coverage: dimensionCoverage, flows };
}

function empiricalScores(pairs) {
  const distances = pairs.filter((pair) => pair.available).map((pair) => pair.distance).sort((a, b) => a - b);
  if (distances.length === 0) return;
  const lowerBound = (needle) => {
    let low = 0;
    let high = distances.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (distances[middle] < needle) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const upperBound = (needle) => {
    let low = 0;
    let high = distances.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (distances[middle] <= needle) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  for (const pair of pairs) {
    if (!pair.available) { pair.similarity = null; continue; }
    const less = lowerBound(pair.distance);
    const equal = upperBound(pair.distance) - less;
    const zeroBasedMidrank = less + (equal - 1) / 2;
    pair.similarity = 100 * (1 - (zeroBasedMidrank + 0.5) / distances.length);
  }
}

function teamSimilarityArtifactIdentity(source, mode) {
  return {
    source_id: source.id,
    configuration_receipt: source.configuration_receipt,
    calculation_receipt: source.calculation_receipt,
    season_end_years: [...source.scope.season_end_years],
    time_mode: mode,
  };
}

function assertTeamSimilarityArtifact(artifact, source, mode) {
  const identity = teamSimilarityArtifactIdentity(source, mode);
  const actual = artifact?.source_identity;
  if (artifact?.schema_version !== TEAM_SIMILARITY_ARTIFACT_SCHEMA_VERSION
      || !actual
      || actual.source_id !== identity.source_id
      || actual.configuration_receipt !== identity.configuration_receipt
      || actual.calculation_receipt !== identity.calculation_receipt
      || actual.time_mode !== identity.time_mode
      || JSON.stringify(actual.season_end_years) !== JSON.stringify(identity.season_end_years)
      || !Array.isArray(artifact.fingerprints)
      || !Array.isArray(artifact.pairs)) {
    throw error(
      "team_similarity_artifact_mismatch",
      "The cached team-similarity artifact does not match this receipt-bound source and time mode.",
    );
  }
  return artifact;
}

export function buildTeamSimilarityArtifact(rows, options = {}, configuration = null) {
  assertComplete(configuration);
  const mode = normalizeTimeMode(options.time_mode ?? options.garbage_time_mode);
  const source = sourceEnvelope(configuration, rows);
  const fingerprints = teamSeasonFingerprints(rows, mode);
  const completeSeasons = source.scope.season_end_years.every((year) =>
    fingerprints.filter((row) => row.season_end_year === year).length === 30);
  if (!completeSeasons) {
    return {
      schema_version: TEAM_SIMILARITY_ARTIFACT_SCHEMA_VERSION,
      source_identity: teamSimilarityArtifactIdentity(source, mode),
      status: "unavailable",
      reason: "incomplete_team_season_pool",
      fingerprints,
      pairs: [],
      pair_count: 0,
    };
  }
  const compactFingerprints = fingerprints.map((fingerprint) => ({
    key: fingerprint.key,
    players: compactTeamPlayers(fingerprint.players),
  }));
  const maximumRosterSize = Math.max(1, ...compactFingerprints.map((row) => row.players.length));
  const transportWorkspace = createTransportWorkspace(maximumRosterSize);
  const pairs = [];
  for (let left = 0; left < compactFingerprints.length; left += 1) {
    for (let right = left + 1; right < compactFingerprints.length; right += 1) {
      const transport = optimalTransportSummary(
        compactFingerprints[left].players,
        compactFingerprints[right].players,
        transportWorkspace,
      );
      pairs.push({
        left: compactFingerprints[left].key,
        right: compactFingerprints[right].key,
        available: transport.available,
        reason: transport.reason ?? null,
        distance: transport.distance ?? null,
        dimension_coverage: transport.dimension_coverage ?? 0,
      });
    }
  }
  empiricalScores(pairs);
  return {
    schema_version: TEAM_SIMILARITY_ARTIFACT_SCHEMA_VERSION,
    source_identity: teamSimilarityArtifactIdentity(source, mode),
    status: "available",
    reason: null,
    fingerprints,
    pairs,
    pair_count: pairs.length,
  };
}

export function projectTeamSimilarity(rows, options = {}, configuration = null, metadata = TEAM_METADATA) {
  assertComplete(configuration);
  const teamId = Number(options.team_id);
  const selectedSeason = seasonEndYear(options.season ?? options.scope);
  const mode = normalizeTimeMode(options.time_mode ?? options.garbage_time_mode);
  const source = sourceEnvelope(configuration, rows);
  if (!Number.isSafeInteger(teamId) || teamId <= 0) throw error("invalid_team_id", "team_id is required.");
  if (selectedSeason === null) return { source, status: "unavailable", reason: "exact_season_required", matches: [] };
  if (!source.scope.season_end_years.includes(selectedSeason)) {
    return { source, status: "unavailable", reason: "season_incomplete", matches: [] };
  }
  const artifact = options.similarity_artifact
    ? assertTeamSimilarityArtifact(options.similarity_artifact, source, mode)
    : buildTeamSimilarityArtifact(rows, { time_mode: mode }, configuration);
  if (artifact.status !== "available") {
    return { source, status: "unavailable", reason: artifact.reason, matches: [] };
  }
  const fingerprints = artifact.fingerprints;
  const target = fingerprints.find((row) => row.team_id === teamId && row.season_end_year === selectedSeason);
  if (!target) return { source, status: "unavailable", reason: "team_season_not_found", matches: [] };
  const pairsByKey = new Map();
  for (const pair of artifact.pairs) {
    pairsByKey.set(`${pair.left}\u001f${pair.right}`, pair);
    pairsByKey.set(`${pair.right}\u001f${pair.left}`, pair);
  }
  const selected = fingerprints.filter((row) => row.key !== target.key).map((candidate) => {
    const pair = pairsByKey.get(`${target.key}\u001f${candidate.key}`);
    if (!pair?.available || pair.similarity === null || pair.dimension_coverage < 0.75) return null;
    return { candidate, pair };
  }).filter(Boolean).sort((left, right) => right.pair.similarity - left.pair.similarity
    || left.pair.distance - right.pair.distance || left.candidate.team_id - right.candidate.team_id
    || left.candidate.season_end_year - right.candidate.season_end_year).slice(0, 5);
  const matches = selected.map(({ candidate, pair }) => {
    // The complete distribution is reused from the receipt-keyed artifact.
    // Only the five visible target/candidate transports are replayed to build
    // role-level explanations.
    const detail = optimalTransport(target.players, candidate.players);
    if (!detail.available) return null;
    const flows = detail.flows;
    const weightedFamily = Object.fromEntries(TEAM_FAMILIES.map((family) => {
      const available = flows.filter((flow) => Number.isFinite(flow.family_differences[family]));
      const weight = sum(available, (flow) => flow.minute_weight);
      return [family, weight > 0
        ? sum(available, (flow) => flow.minute_weight * flow.family_differences[family]) / weight
        : null];
    }));
    const shared = new Set(target.players.map((player) => player.player_id));
    return {
      team_id: candidate.team_id,
      team: team(
        candidate.team_id,
        `${candidate.season_end_year - 1}-10-01`,
        metadata,
      ),
      season_end_year: candidate.season_end_year,
      season: seasonLabel(candidate.season_end_year),
      similarity: pair.similarity,
      distance: pair.distance,
      family_differences: weightedFamily,
      shared_player_count: candidate.players.filter((player) => shared.has(player.player_id)).length,
      minute_coverage: candidate.minute_coverage,
      selected_minute_coverage: Math.min(target.minute_coverage, candidate.minute_coverage),
      dimension_coverage: pair.dimension_coverage,
      closest_player_roles: [...flows].sort((left, right) => right.minute_weight - left.minute_weight
        || left.cost - right.cost || left.source_player_id - right.source_player_id).slice(0, 5),
    };
  }).filter(Boolean);
  return {
    source,
    status: matches.length ? "available" : "unavailable",
    reason: matches.length ? null : "dimension_coverage_below_threshold",
    basis: "Regular Season",
    team_id: teamId,
    season_end_year: selectedSeason,
    time_mode: mode,
    verification_self_similarity: 100,
    comparison_pool_size: fingerprints.length,
    target: {
      ...team(teamId, `${selectedSeason - 1}-10-01`, metadata),
      season_end_year: selectedSeason,
      time_mode: mode,
    },
    matches,
  };
}

export function projectPlayerDirectory(rows, options = {}, configuration = null) {
  assertComplete(configuration);
  const scope = selectedValueRows(rows, options);
  const search = String(options.search ?? "").trim().toLocaleLowerCase();
  const activity = allMinutesRows(rows, {
    seasons: scope.selectedSeason === null ? null : [scope.selectedSeason],
    schedule: scope.schedule,
  });
  const activityByPlayer = groupBy(activity, canonicalPlayerId);
  let projected = [...groupBy(scope.rows, canonicalPlayerId).entries()].map(([playerId, values]) => {
    const playerActivity = activityByPlayer.get(playerId) ?? [];
    return {
      player_id: playerId,
      player_name: latestPlayerName(values),
      latest_team: team(latestRow(values).team_id, latestRow(values).game_date),
      teams: [...new Set(values.map((row) => Number(row.team_id)))].map((teamId) => {
        const latest = latestRow(values.filter((row) => Number(row.team_id) === teamId));
        return team(teamId, latest?.game_date);
      }),
      games: distinctGameCount(playerActivity, { appearedOnly: true }),
      minutes: sum(playerActivity, (row) => finite(row.seconds_played)) / 60,
      value_contributed: sum(values, (row) => row.final_value_contributed),
      wins_contributed: sum(values, (row) => row.win_loss ? row.final_value_contributed : 0),
    };
  }).filter((row) => !search || row.player_name.toLocaleLowerCase().includes(search)
    || String(row.player_id).includes(search));
  projected.sort((left, right) => left.player_name.localeCompare(right.player_name)
    || left.player_id - right.player_id);
  const pager = pagination(options, projected.length);
  projected = projected.slice(pager.offset, pager.offset + pager.limit);
  return {
    source: sourceEnvelope(configuration, rows),
    state: projected.length ? "ready" : "empty",
    filters: { search, scope: scope.selectedSeason === null ? "All Seasons" : seasonLabel(scope.selectedSeason), schedule: scope.schedule, time_mode: scope.mode },
    rows: projected,
    pagination: pager,
  };
}

export function projectTeamDirectory(rows, options = {}, configuration = null, metadata = TEAM_METADATA) {
  assertComplete(configuration);
  const scope = selectedValueRows(rows, options);
  const search = String(options.search ?? "").trim().toLocaleLowerCase();
  const teamIds = Object.keys(TEAM_METADATA).map(Number).sort((a, b) => a - b);
  const projected = teamIds.map((teamId) => {
    const values = scope.rows.filter((row) => Number(row.team_id) === teamId);
    const latest = latestRow(values);
    const gamesById = groupBy(values, (row) => String(row.game_id));
    const identity = team(teamId, latest?.game_date, metadata);
    return {
      ...identity,
      first_game_date: earliestRow(values)?.game_date ?? null,
      last_game_date: latest?.game_date ?? null,
      games: distinctGameCount(values),
      games_played: distinctGameCount(values),
      wins: [...gamesById.values()].filter((gameRows) => gameRows[0]?.win_loss).length,
      value_contributed: sum(values, (row) => row.final_value_contributed),
      wins_contributed: sum(values, (row) => row.win_loss ? row.final_value_contributed : 0),
    };
  }).filter((row) => !search || row.name.toLocaleLowerCase().includes(search)
    || row.abbreviation.toLocaleLowerCase().includes(search) || String(row.team_id).includes(search));
  projected.sort((left, right) => left.name.localeCompare(right.name) || left.team_id - right.team_id);
  return {
    source: sourceEnvelope(configuration, rows),
    state: projected.length ? "ready" : "empty",
    filters: { search, scope: scope.selectedSeason === null ? "All Seasons" : seasonLabel(scope.selectedSeason), schedule: scope.schedule, time_mode: scope.mode },
    rows: projected,
    pagination: { limit: 30, offset: 0, page: 1, total: projected.length, total_pages: projected.length ? 1 : 0 },
  };
}

export function projectPlayerLandscape(rows, options = {}, configuration = null) {
  assertComplete(configuration);
  const mode = normalizeTimeMode(options.time_mode ?? options.garbage_time_mode);
  const schedule = normalizeSchedule(options.schedule ?? options.phase);
  const requested = Array.isArray(options.season)
    ? options.season
    : options.season === undefined || options.season === null || options.season === "All Seasons"
      ? []
      : [options.season];
  const seasonYears = [...new Set(requested.map(seasonEndYear).filter((value) => value !== null))]
    .sort((left, right) => left - right);
  const selected = new Set(seasonYears);
  const scoped = rows.filter((row) => row.time_mode === mode
    && (!selected.size || selected.has(Number(row.season_end_year)))
    && scheduleMatches(row, schedule));
  const firstSeason = new Map();
  for (const row of rows) {
    const id = canonicalPlayerId(row);
    firstSeason.set(id, Math.min(firstSeason.get(id) ?? Number.POSITIVE_INFINITY, Number(row.season_end_year)));
  }
  const projected = [...groupBy(scoped, canonicalPlayerId).entries()].map(([playerId, playerRows]) => {
    const latest = latestRow(playerRows);
    const components = Object.fromEntries(componentTotals(playerRows).map((item) => [item.key, item.value]));
    const seconds = sum(playerRows, (row) => finite(row.seconds_played));
    return {
      player_id: String(playerId),
      player_name: latestPlayerName(playerRows),
      career_first_season_end_year: firstSeason.get(playerId),
      seconds_played: seconds,
      minutes_played: seconds / 60,
      value_contributed: sum(playerRows, (row) => finite(row.final_value_contributed)),
      wins_contributed: sum(playerRows, (row) => row.win_loss ? finite(row.final_value_contributed) : 0),
      offensive_value_contributed: sum(playerRows, (row) => finite(row.responsibility?.offense)),
      defensive_value_contributed: sum(playerRows, (row) => finite(row.responsibility?.defense)),
      other_value_contributed: sum(playerRows, (row) => finite(row.responsibility?.other)),
      raw_component_totals: components,
      similarity_context: aggregateContext(playerRows),
      latest_season_end_year: Number(latest?.season_end_year),
    };
  });
  projected.sort((left, right) => right.wins_contributed - left.wins_contributed
    || Number(left.player_id) - Number(right.player_id));
  return {
    source: sourceEnvelope(configuration, rows),
    selected_seasons: seasonYears.map(seasonLabel),
    schedule: schedule.toLocaleLowerCase().replaceAll(" ", "_"),
    time_mode: mode,
    rows: projected,
  };
}

export function projectSeasonStory(rows, options = {}, configuration = null) {
  assertComplete(configuration);
  const rawIds = Array.isArray(options.player_ids)
    ? options.player_ids
    : String(options.player_ids ?? "").split(",");
  const playerIds = [...new Set(rawIds.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
  if (!playerIds.length || playerIds.length > 10) {
    throw error("invalid_season_story_players", "Season stories require between one and ten canonical player IDs.");
  }
  const scope = selectedValueRows(rows, options);
  if (scope.selectedSeason === null) {
    throw error("season_story_requires_season", "Season stories require one exact season.");
  }
  const selected = new Set(playerIds);
  const projected = scope.rows.filter((row) => selected.has(canonicalPlayerId(row))
    && finite(row.seconds_played) > 0)
    .sort((left, right) => String(left.game_date).localeCompare(String(right.game_date))
      || String(left.game_id).localeCompare(String(right.game_id))
      || canonicalPlayerId(left) - canonicalPlayerId(right))
    .map((row) => ({
      game_id: String(row.game_id),
      game_date: row.game_date,
      season_end_year: Number(row.season_end_year),
      season: seasonLabel(Number(row.season_end_year)),
      season_type: row.season_type,
      player_id: canonicalPlayerId(row),
      player_name: row.player_name,
      win_loss: Boolean(row.win_loss),
      seconds_played: finite(row.seconds_played),
      value_contributed: finite(row.final_value_contributed),
      wins_contributed: row.win_loss ? finite(row.final_value_contributed) : 0,
      defensive_value_contributed: finite(row.responsibility?.defense),
      defensive_wins_contributed: row.win_loss ? finite(row.responsibility?.defense) : 0,
    }));
  return {
    source: sourceEnvelope(configuration, rows),
    state: projected.length ? "ready" : "empty",
    filters: { scope: seasonLabel(scope.selectedSeason), schedule: scope.schedule, time_mode: scope.mode },
    player_ids: playerIds,
    rows: projected,
  };
}

export function projectLocalEntityPanel(panel, rows, options = {}, configuration = null, metadata = TEAM_METADATA) {
  switch (panel) {
    case "player_landscape": return projectPlayerLandscape(rows, options, configuration);
    case "players": return projectPlayerDirectory(rows, options, configuration);
    case "teams": return projectTeamDirectory(rows, options, configuration, metadata);
    case "player_profile": return projectPlayerProfile(rows, options, configuration, metadata);
    case "player_games": return projectPlayerGames(rows, options, configuration, metadata);
    case "player_game_anatomy": return projectPlayerGameAnatomy(rows, options, configuration, metadata);
    case "player_similarity": return projectPlayerSimilarity(rows, options, configuration);
    case "team_profile": return projectTeamProfile(rows, options, configuration, metadata);
    case "team_games": return projectTeamGames(rows, options, configuration, metadata);
    case "team_similarity": return projectTeamSimilarity(rows, options, configuration, metadata);
    case "season_story": return projectSeasonStory(rows, options, configuration);
    default: throw error("unsupported_entity_panel", `Unsupported entity panel ${panel}.`);
  }
}
