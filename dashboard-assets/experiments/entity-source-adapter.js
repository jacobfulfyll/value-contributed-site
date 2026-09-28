import { createReadOnlyFetch } from "./network-policy.js";
import { BrowserExperimentError } from "./protocol.js";
import { EntitySimilarityWorkerClient } from "./entity-similarity-client.js";
import { V9_PUBLIC_SOURCE } from "./entity-projections.js";
// Loaded for its side effect: team-directory.js is a classic script so the
// rankings page can share it, and it publishes itself on globalThis.
import "../team-directory.js";

/**
 * Whether the page this adapter is running in serves the Experiments feature.
 *
 * The site-wide switch is a meta tag every dashboard page carries, so it is
 * known before the first request. A page that carries no such tag reads as
 * off, which is the published default; outside a document — under node, where
 * this module's own tests construct the adapter directly — there is no page to
 * ask, so a client the caller passed is honoured.
 */
export function experimentsSwitchedOn(doc = typeof document === "undefined" ? null : document) {
  if (!doc) return true;
  const content = doc.querySelector('meta[name="vc-experiments"]')?.content;
  return String(content ?? "").trim().toLowerCase() === "on";
}

const ENDPOINTS = Object.freeze({
  player_landscape: () => "/api/rankings/player-landscape",
  players: () => "/api/players",
  player_profile: (filters) => `/api/players/${Number(filters.player_id)}`,
  player_games: (filters) => `/api/players/${Number(filters.player_id)}/games`,
  player_game_anatomy: (filters) => `/api/players/${Number(filters.player_id)}/games/${encodeURIComponent(String(filters.game_id))}/anatomy`,
  player_similarity: (filters) => `/api/players/${Number(filters.player_id)}/similarity`,
  teams: () => "/api/teams",
  team_profile: (filters) => `/api/teams/${Number(filters.team_id)}`,
  team_games: (filters) => `/api/teams/${Number(filters.team_id)}/games`,
  team_similarity: (filters) => `/api/teams/${Number(filters.team_id)}/similarity`,
  season_story: (filters) => `/api/seasons/${encodeURIComponent(String(filters.season))}/story`,
});

const V10_ENDPOINTS = Object.freeze({
  player_landscape: () => "/api/v10/rankings",
  players: () => "/api/v10/rankings",
  player_profile: (filters) => `/api/v10/players/${Number(filters.player_id)}`,
  player_games: (filters) => `/api/v10/players/${Number(filters.player_id)}/games`,
  player_game_anatomy: (filters) => `/api/v10/games/${encodeURIComponent(String(filters.game_id))}/anatomy`,
  player_similarity: (filters) => `/api/v10/players/${Number(filters.player_id)}`,
  teams: () => "/api/v10/teams",
  team_profile: (filters) => `/api/v10/teams/${Number(filters.team_id)}`,
  team_games: (filters) => `/api/v10/teams/${Number(filters.team_id)}/games`,
  team_similarity: (filters) => `/api/v10/teams/${Number(filters.team_id)}/similarity`,
  season_story: (filters) => `/api/v10/seasons/${Number(String(filters.season).slice(0, 4)) + 1}/story`,
});

// V11 serves the same entity panels in the same shapes as V10, so its endpoint
// table is the V10 table with the prefix swapped and the reshaping is shared.
// Two panels V10 folds into its rankings route have a dedicated V11 route.
const V11_ENDPOINTS = Object.freeze({
  ...Object.fromEntries(Object.entries(V10_ENDPOINTS).map(([panel, endpoint]) => [
    panel,
    (filters) => endpoint(filters).replace("/api/v10/", "/api/v11/"),
  ])),
  players: () => "/api/v11/players",
  player_landscape: () => "/api/v11/rankings/player-landscape",
  team_landscape: () => "/api/v11/rankings/team-landscape",
});
// V12 is answered by V11's own routes under /api/v12, in V11's shapes, so its
// table is V11's with the prefix swapped and every V11 query rule applies.
const V12_ENDPOINTS = Object.freeze(Object.fromEntries(
  Object.entries(V11_ENDPOINTS).map(([panel, endpoint]) => [
    panel,
    (filters) => endpoint(filters).replace("/api/v11/", "/api/v12/"),
  ]),
));
// V13 is answered the same way under /api/v13: V11's routes and V11's shapes.
const V13_ENDPOINTS = Object.freeze(Object.fromEntries(
  Object.entries(V11_ENDPOINTS).map(([panel, endpoint]) => [
    panel,
    (filters) => endpoint(filters).replace("/api/v11/", "/api/v13/"),
  ]),
));
// The statistics whose routes take V11's query shape.
const V11_SHAPED_SOURCES = new Set(["v11", "v12", "v13"]);
// The two landscape routes take season labels; every other V11 panel takes the
// V10 query shape.
const SEASON_LABEL_PANELS = Object.freeze(["player_landscape", "team_landscape"]);

const SERVER_ENDPOINTS = Object.freeze({
  v10: V10_ENDPOINTS, v11: V11_ENDPOINTS, v12: V12_ENDPOINTS, v13: V13_ENDPOINTS,
});
// Panels V11 cannot fill: the server answers them with {available:false} or an
// empty list, and the pages say so in plain language instead of drawing a
// half-empty chart.
const V11_UNAVAILABLE_REASON = "not_available_for_v11";

// Capabilities each server statistic actually serves, before the deployment's
// own `/api/sources` row narrows them. V11 publishes rankings, player and team
// pages, game logs, per-game anatomy, season stories and — since the style
// models were fitted — player and team types, their similarity, and the split
// the split of scoring and playmaking by kind of play, including the kind of
// shot a pass created, and — since the defended-shot evidence was stored beside
// the descriptions — its own shot-by-location table.
const SERVER_SOURCE_CAPABILITIES = Object.freeze({
  v10: Object.freeze({
    player_profiles: true,
    player_games: true,
    player_game_anatomy: true,
    player_similarity: true,
    team_profiles: true,
    team_games: true,
    team_similarity: true,
    responsibility_breakdown: true,
    defended_shot_breakdown: true,
    archetypes: true,
  }),
  v11: Object.freeze({
    player_profiles: true,
    player_games: true,
    player_game_anatomy: true,
    player_similarity: true,
    team_profiles: true,
    team_games: true,
    team_similarity: true,
    responsibility_breakdown: true,
    defended_shot_breakdown: true,
    archetypes: true,
    player_styles: true,
    scoring_sources: true,
  }),
  // V12 serves profiles, game logs and per-game anatomy from its stored rows,
  // and types, the map, descriptions and similarity from its own style build.
  // It has no per-shot defended table and no V11-style scoring split (its
  // profile sections draw both); its /api/sources row says the same.
  v12: Object.freeze({
    player_profiles: true,
    player_games: true,
    player_game_anatomy: true,
    player_similarity: true,
    team_profiles: true,
    team_games: true,
    team_similarity: true,
    responsibility_breakdown: true,
    defended_shot_breakdown: false,
    archetypes: true,
    player_styles: true,
    scoring_sources: false,
  }),
  // V13 is V12 plus hustle, tracking and matchup evidence, served the same
  // way. Its types and similarity come from its own style build, which its
  // /api/sources row switches off until that build is installed.
  v13: Object.freeze({
    player_profiles: true,
    player_games: true,
    player_game_anatomy: true,
    player_similarity: true,
    team_profiles: true,
    team_games: true,
    team_similarity: true,
    responsibility_breakdown: true,
    defended_shot_breakdown: false,
    archetypes: true,
    player_styles: true,
    scoring_sources: false,
  }),
});

const ENTITY_ID_FILTER = Object.freeze({
  player_profile: "player_id",
  player_games: "player_id",
  player_game_anatomy: "player_id",
  player_similarity: "player_id",
  team_profile: "team_id",
  team_games: "team_id",
  team_similarity: "team_id",
});

const SCHEDULE_TO_LOCAL = Object.freeze({
  all: "All",
  regular_season: "Regular Season",
  play_in: "PlayIn",
  playoffs: "Playoffs",
  postseason: "Postseason",
});
const METRIC_TO_LOCAL = Object.freeze({
  value_contributed: "vc",
  wins_contributed: "wc",
  vc: "vc",
  wc: "wc",
});
const OUTCOME_TO_LOCAL = Object.freeze({ both: "Both", wins: "Wins", losses: "Losses" });
const SCHEDULE_FROM_LOCAL = Object.freeze({
  All: "all",
  "Regular Season": "regular_season",
  PlayIn: "play_in",
  Playoffs: "playoffs",
  Postseason: "postseason",
});
const METRIC_FROM_LOCAL = Object.freeze({ vc: "value_contributed", wc: "wins_contributed" });
const OUTCOME_FROM_LOCAL = Object.freeze({ Both: "both", Wins: "wins", Losses: "losses" });
const PLAYER_SIMILARITY_CONTRACT_VERSION = "v9-player-similarity-feature-v1";
const PLAYER_SIMILARITY_FEATURE_COUNT = 38;

function normalizeSourceId(value) {
  const source = String(value ?? "v9");
  if (source === "v9") return { kind: "official", id: "v9", experimentId: null };
  if (source in SERVER_ENDPOINTS) return { kind: "official", id: source, experimentId: null };
  if (source.startsWith("experiment:") && source.length > "experiment:".length) {
    return { kind: "experiment", id: source, experimentId: source.slice("experiment:".length) };
  }
  throw new BrowserExperimentError("invalid_entity_source", `Unsupported analytics source ${source}.`);
}

function v10OfficialQuery(filters, panel, sourceId = "v10") {
  const query = new URLSearchParams();
  const season = Array.isArray(filters.season)
    ? (filters.season.length === 1 ? canonicalSeason(filters.season[0]) : null)
    : canonicalSeason(filters.season);
  if (season) query.set("season_end_year", String(Number(season.slice(0, 4)) + 1));
  // V11 describes a profile over exactly the seasons the page has selected, so
  // a multi-season selection travels as repeated `season=` labels instead of
  // collapsing to "career" and answering with the most recent season. Only V11
  // reads them: V10's routes take one `season_end_year` and nothing else, so a
  // repeated label there would be a parameter it has no meaning for.
  if (V11_SHAPED_SOURCES.has(sourceId) && Array.isArray(filters.season) && filters.season.length > 1
    && ["player_profile", "team_profile", "player_similarity"].includes(panel)) {
    for (const label of filters.season) {
      const canonical = canonicalSeason(label);
      if (canonical) query.append("season", canonical);
    }
  }
  if (!season && ["team_profile", "team_similarity"].includes(panel)) {
    // Team archetypes are season profiles, so a request that names no single
    // season still needs one. The newest season the page has actually selected
    // is that season; only a request with no selection at all falls back to the
    // newest frozen season.
    const selected = (Array.isArray(filters.season) ? filters.season : [])
      .map(canonicalSeason)
      .filter(Boolean)
      .map((label) => Number(label.slice(0, 4)) + 1)
      .filter((year) => Number.isFinite(year));
    query.set("season_end_year", String(selected.length ? Math.max(...selected) : 2026));
  }
  // A team's most-similar list belongs to the season its profile describes, so
  // it answers for the chosen profile season rather than for the newest one.
  if (V11_SHAPED_SOURCES.has(sourceId) && panel === "team_similarity") {
    const profileSeason = canonicalSeason(filters.profile_season);
    if (profileSeason) {
      query.set("season_end_year", String(Number(profileSeason.slice(0, 4)) + 1));
    }
  }
  // V11's team page has two scopes: the selection its controls choose, and the
  // one season its profile describes. The second travels on its own, so a link
  // restores the season card the reader clicked.
  if (V11_SHAPED_SOURCES.has(sourceId) && panel === "team_profile") {
    const profileSeason = canonicalSeason(filters.profile_season);
    if (profileSeason) query.set("profile_season", profileSeason);
    if (filters.chart_player_ids) {
      query.set("chart_player_ids", String(filters.chart_player_ids));
    }
    query.set("metric", canonicalMetric(filters.metric));
  }
  // A player profile has the same two scopes as a team profile — the seasons
  // the controls chose, and the one season a reader clicked in the career
  // table — and its rank is a rank *by* the page's own metric, which is what
  // the page prints it under.
  if (V11_SHAPED_SOURCES.has(sourceId) && panel === "player_profile") {
    const profileSeason = canonicalSeason(filters.profile_season);
    if (profileSeason) query.set("profile_season", profileSeason);
    query.set("metric", canonicalMetric(filters.metric));
  }
  query.set("schedule", canonicalSchedule(filters.schedule));
  query.set("time_mode", String(filters.time_mode ?? filters.garbage_time_mode ?? "competitive"));
  if (["players", "teams", "player_landscape"].includes(panel)) {
    query.set("metric", canonicalMetric(filters.metric));
    query.set("search", String(filters.search ?? ""));
  }
  if (["player_profile", "player_similarity", "team_profile", "team_similarity"].includes(panel)) {
    query.set("lens", String(filters.lens ?? "concept_balanced"));
  }
  if (["players", "teams", "player_landscape", "player_games", "team_games"].includes(panel)) {
    query.set("limit", String(filters.limit ?? (panel === "teams" ? 30 : 100)));
    query.set("offset", String(filters.offset ?? 0));
  }
  if (["player_games", "team_games"].includes(panel)) {
    query.set("outcome", canonicalOutcome(filters.outcome));
  }
  if (panel === "season_story") {
    query.set("player_ids", (filters.player_ids ?? []).map(Number).join(","));
  }
  return query;
}

// V11's landscape routes take season labels, the way the V9 route does; every
// other V11 panel takes the V10 query shape.
function serverQuery(sourceId, filters, panel) {
  if (!V11_SHAPED_SOURCES.has(sourceId) || !SEASON_LABEL_PANELS.includes(panel)) {
    return v10OfficialQuery(filters, panel, sourceId);
  }
  const query = new URLSearchParams();
  const requested = Array.isArray(filters.season) ? filters.season : [filters.season];
  requested.map(canonicalSeason).filter(Boolean)
    .forEach((season) => query.append("season", season));
  query.set("schedule", canonicalSchedule(filters.schedule));
  query.set("time_mode", String(filters.time_mode ?? filters.garbage_time_mode ?? "competitive"));
  return query;
}

function teamDirectory() {
  return globalThis.ValueContributedTeamDirectory ?? null;
}

// A team is always shown as its three-letter abbreviation: prefer the one the
// response carries, fall back to the shared directory, never print the id.
function serverTeam(value, abbreviation = null, name = null) {
  const directory = teamDirectory();
  if (directory) return directory.teamRecord(value, { abbreviation, name });
  const id = Number.isFinite(Number(value)) ? Number(value) : null;
  return { id, team_id: id, name: "—", team_name: "—", abbreviation: "—" };
}

function serverTeams(teamIds = [], abbreviations = []) {
  return (teamIds ?? []).map((teamId, index) => serverTeam(teamId, (abbreviations ?? [])[index] ?? null));
}

function blockIsUnavailable(block) {
  if (block === null || block === undefined) return true;
  if (Array.isArray(block)) return block.length === 0;
  if (typeof block === "object" && block.available === false) return true;
  return false;
}

function unavailableSimilarity(source, filters, reason = V11_UNAVAILABLE_REASON) {
  return {
    source,
    status: "unavailable",
    reason,
    matches: [],
    mode: filters.mode ?? (filters.season ? "season" : "career"),
  };
}

function v10ConceptSimilarityRows(explanation = {}) {
  const values = explanation?.concept_mse ?? {};
  if (Array.isArray(values)) return values;
  return Object.entries(values)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((left, right) => Number(left[1]) - Number(right[1]) || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([key, value]) => ({
      key,
      label: key.replaceAll("_", " "),
      value: Number(value),
    }));
}

function normalizeV10Payload(panel, payload, filters, sourceId = "v10") {
  const source = {
    ...payload.source,
    id: sourceId,
    public_id: sourceId,
    label: payload.source?.label ?? sourceId.toUpperCase(),
    completion_status: "complete",
  };
  if (panel === "players" || panel === "player_landscape") {
    const rows = (payload.rows ?? []).map((row) => ({
      ...row,
      teams: serverTeams(row.team_ids, row.team_abbreviations),
      latest_team: row.team_ids?.length
        ? serverTeam(row.team_ids.at(-1), (row.team_abbreviations ?? []).at(-1))
        : null,
      minutes_played: finite(row.seconds_played) / 60,
    }));
    const normalized = { ...payload, source, rows, pagination: { limit: payload.limit, offset: payload.offset, total: payload.total } };
    return panel === "player_landscape" ? normalized : normalizeDirectory(normalized, filters, panel);
  }
  if (panel === "teams") {
    const rows = (payload.rows ?? []).map((row) => ({
      ...row,
      ...serverTeam(row.team_id, row.team_abbreviation ?? row.abbreviation, row.team_name),
    }));
    return normalizeDirectory({ ...payload, source, rows, pagination: { limit: payload.limit, offset: payload.offset, total: payload.total } }, filters, panel);
  }
  if (panel === "player_profile") {
    const row = payload.entity ?? {};
    const teams = serverTeams(row.team_ids, row.team_abbreviations);
    return normalizePlayerProfile({
      ...payload,
      source,
      state: "ready",
      entity: { ...row, teams, latest_team: teams.at(-1) ?? null },
      summary: { ...payload.summary, minutes_played: finite(row.seconds_played) / 60 },
      seasons: (payload.seasons ?? []).map((seasonRow) => ({
        ...seasonRow,
        teams: serverTeams(seasonRow.team_ids, seasonRow.team_abbreviations),
        value_per_game: finite(seasonRow.games_played) ? finite(seasonRow.value_contributed) / finite(seasonRow.games_played) : null,
      })),
      v10: {
        source_id: sourceId,
        availability: payload.availability ?? null,
        archetype: blockIsUnavailable(payload.archetype) ? null : payload.archetype,
        dimensions: blockIsUnavailable(payload.dimensions) ? [] : payload.dimensions,
        concepts: blockIsUnavailable(payload.concepts) ? [] : payload.concepts,
        defended_shots: blockIsUnavailable(payload.defended_shots) ? [] : payload.defended_shots,
        similarity: payload.similarity,
        // V11's style blocks. A statistic that publishes none leaves them null
        // or empty and the page says so instead of drawing an empty panel.
        style_types: payload.player_types ?? null,
        type_history: blockIsUnavailable(payload.type_history) ? [] : payload.type_history,
        // V12 publishes a defensive role beside the offensive one, with its own
        // season history; a statistic with one type leaves both empty.
        defense_role: payload.defense_role ?? null,
        defense_history: Array.isArray(payload.defense_history) ? payload.defense_history : [],
        scoring_sources: blockIsUnavailable(payload.scoring_sources) ? [] : payload.scoring_sources,
        playmaking_sources: blockIsUnavailable(payload.playmaking_sources) ? [] : payload.playmaking_sources,
        // Published by V11 from 2026-09-20; a statistic that publishes none
        // leaves them null and the page keeps its plain sentence.
        playmaking_breakdown: payload.playmaking_breakdown ?? null,
        profile_sections: payload.profile_sections ?? null,
        selection: payload.selection ?? null,
        // V12 names the groups of its "Everything at once" wheel and the unit
        // its sections are in; V11 publishes neither and keeps its own.
        wheel_groups: payload.wheel_groups ?? null,
        profile_unit: payload.profile_unit ?? null,
        // V13's four area types for the described season, who shares them,
        // and each season's four types; other statistics publish none.
        v13_types: payload.v13_types ?? null,
      },
    }, filters);
  }
  if (panel === "player_similarity") {
    const entity = payload.entity ?? {};
    const similarity = payload.similarity ?? {};
    const mode = String(filters.mode ?? (filters.season ? "season" : "career")).toLowerCase();
    // V11 answers with two lists — the same season, and every season — so the
    // page's own toggle chooses between them instead of asking twice.
    const matches = ((mode === "career" ? similarity.all_seasons : similarity.same_season)
      ?? similarity.matches ?? []);
    return normalizePlayerSimilarity({
      source,
      status: matches.length ? "available" : "unavailable",
      reason: matches.length ? null
        : (blockIsUnavailable(similarity)
          ? similarity.reason ?? V11_UNAVAILABLE_REASON
          : "insufficient_candidate_pool"),
      target: { ...entity, minutes_played: finite(entity.seconds_played) / 60 },
      mode,
      lens: similarity.lens,
      matches: matches.map((row) => ({
        ...row,
        player_id: row.player_id ?? row.candidate_player_id,
        player_name: row.player_name ?? row.candidate_player_name,
        season_end_year: row.season_end_year ?? row.candidate_season_end_year,
        teams: row.teams ?? serverTeams(row.team_ids, row.team_abbreviations),
        score: row.similarity,
        style: row.player_type ?? null,
        explanation_text: typeof row.explanation === "string" ? row.explanation : null,
        strongest_similarities: typeof row.explanation === "string"
          ? [] : v10ConceptSimilarityRows(row.explanation),
        largest_differences: (typeof row.explanation === "object"
          ? row.explanation?.largest_differences : null) ?? [],
      })),
      archetype: payload.archetype,
    }, filters);
  }
  if (panel === "player_games" || panel === "team_games") {
    const rows = (payload.rows ?? []).map((row) => ({
      ...row,
      team: serverTeam(row.team_id, row.team_abbreviation),
      opponent: serverTeam(row.opponent_id, row.opponent_abbreviation),
      minutes_played: finite(row.actual_seconds) / 60,
    }));
    return normalizeGames({ ...payload, source, rows, pagination: { limit: payload.limit, offset: payload.offset, total: payload.total } }, filters);
  }
  if (panel === "player_game_anatomy") {
    const row = (payload.players ?? []).find((candidate) => Number(candidate.player_id) === Number(filters.player_id));
    if (!row) {
      throw new BrowserExperimentError(
        "server_player_game_missing",
        `The ${sourceId.toUpperCase()} game does not contain this player.`,
      );
    }
    const sources = Object.entries(row.component_details ?? {}).filter(([, value]) => Number.isFinite(Number(value))).map(([key, value]) => ({ key, label: key.replaceAll("_", " "), value: Number(value) }));
    const rawTotal = finite(row.raw_offense) + finite(row.raw_defense) + finite(row.raw_other);
    const adjustedTotal = finite(row.adjusted_offense) + finite(row.adjusted_defense) + finite(row.adjusted_other);
    // V11's evidence is measured in unnormalised points and its published value
    // is a share of the team's game, so the two must not read as one chain of
    // the same quantity. Each stage names its own unit, and the dialog only
    // draws an arrow between stages that share one.
    const v11 = V11_SHAPED_SOURCES.has(sourceId);
    return {
      source,
      player_name: row.player_name,
      game_date: row.game_date,
      season_type: row.season_type,
      team: serverTeam(row.team_id, row.team_abbreviation),
      opponent: serverTeam(row.opponent_id, row.opponent_abbreviation),
      result: row.wins_contributed ? "W" : "L",
      location: null,
      stages: v11 ? [
        { label: "Raw evidence", value: rawTotal, unit: "evidence points" },
        { label: "After team factors", value: adjustedTotal, unit: "evidence points" },
        { label: "Value Contributed", value: finite(row.value_contributed), unit: "share of the team's game" },
      ] : [
        { label: "Raw", value: rawTotal },
        { label: "Adjusted", value: adjustedTotal },
        { label: sourceId.toUpperCase(), value: finite(row.value_contributed) },
      ],
      sources,
      sources_unit: v11 ? "evidence points" : null,
      contexts: Object.entries(row.context_components ?? {}).map(([key, value]) => ({
        key,
        label: key.replaceAll("_", " "),
        value: Number(value),
      })),
      // V11 does publish the six-factor split, but not on this per-game view:
      // `context_components` comes from the game anatomy endpoint, which still
      // answers `{}`. The player Context dialog carries the six per game.
      contexts_note: sourceId === "v12" || sourceId === "v13"
        ? `${sourceId.toUpperCase()} does not have the six-factor context breakdown yet, so no context effects are shown.`
        : v11
          ? "The six context factors are not part of this per-game view. Open a player's Context from the rankings table to see them game by game."
          : null,
      // V12's contested and uncontested halves of defensive rebounds plus
      // box-outs: a second view of two sources above, never a source itself.
      defensive_rebound_split: row.defensive_rebound_split ?? null,
      responsibility: { offense: row.offense_responsibility, defense: row.defense_responsibility, other: row.other_responsibility },
      closure: v11
        ? { kind: "responsibility", final_value: finite(row.value_contributed) }
        : { raw_plus_context: finite(row.value_contributed), final_value: finite(row.value_contributed) },
      v10: {
        defended_shots: row.defended_shots,
        coverage: row.coverage,
        dimensions: row.dimensions ?? [],
      },
    };
  }
  if (panel === "team_profile") {
    return normalizeTeamProfile({
      ...payload,
      source,
      team: payload.entity,
      roster: { rows: payload.players ?? [], footer: payload.summary },
      v10: {
        source_id: sourceId,
        availability: payload.availability ?? null,
        archetype: blockIsUnavailable(payload.archetype) ? null : payload.archetype,
        archetype_policy: payload.archetype_policy,
        dimensions: blockIsUnavailable(payload.dimensions) ? [] : payload.dimensions,
        concepts: blockIsUnavailable(payload.concepts) ? [] : payload.concepts,
        similarity: { lens: payload.lens, matches: payload.matches ?? [] },
        style_types: payload.team_types ?? null,
        // The selected seasons with their own styles and map positions, which
        // is what the style-path chart draws.
        type_history: blockIsUnavailable(payload.type_history) ? [] : payload.type_history,
        defended_shots: blockIsUnavailable(payload.defended_shots) ? [] : payload.defended_shots,
        scoring_sources: blockIsUnavailable(payload.scoring_sources) ? [] : payload.scoring_sources,
        playmaking_breakdown: payload.playmaking_breakdown ?? null,
        profile_sections: payload.profile_sections ?? null,
        selection: payload.selection ?? null,
        playmaking_sources: blockIsUnavailable(payload.playmaking_sources) ? [] : payload.playmaking_sources,
      },
    }, filters);
  }
  if (panel === "team_landscape") {
    return { ...payload, source };
  }
  if (panel === "team_similarity") {
    if (blockIsUnavailable(payload.matches)) {
      return normalizeTeamSimilarity(
        unavailableSimilarity(source, filters, payload.reason ?? V11_UNAVAILABLE_REASON),
        filters,
      );
    }
    return normalizeTeamSimilarity({
      ...payload,
      source,
      status: (payload.matches ?? []).length ? "available" : "unavailable",
      matches: (payload.matches ?? []).map((row) => {
        const id = row.team_id ?? row.candidate_team_id;
        return {
          ...row,
          team_id: id,
          team: serverTeam(id, row.team_abbreviation ?? row.candidate_team_abbreviation,
            row.team_name ?? row.candidate_team_name),
          season_end_year: row.season_end_year ?? row.candidate_season_end_year,
          score: row.similarity,
          style: row.team_type ?? null,
          explanation_text: typeof row.explanation === "string" ? row.explanation : null,
        };
      }),
    }, filters);
  }
  if (panel === "season_story") {
    return {
      ...payload,
      source,
      rows: (payload.rows ?? []).map((row) => ({
        ...row,
        team: serverTeam(row.team_id, row.team_abbreviation),
        opponent: serverTeam(row.opponent_id, row.opponent_abbreviation),
      })),
    };
  }
  throw new BrowserExperimentError(
    "unsupported_server_entity_panel",
    `Unsupported ${sourceId.toUpperCase()} entity panel ${panel}.`,
  );
}

function localFilters(filters) {
  const result = { ...filters };
  if (filters.scope === "all") result.season = "All Seasons";
  else if (Array.isArray(filters.season)) result.season = canonicalSeason(filters.season);
  if (filters.scope === "season" && !filters.season) {
    throw new BrowserExperimentError("season_required", "A season is required for season scope.");
  }
  if (filters.schedule in SCHEDULE_TO_LOCAL) result.schedule = SCHEDULE_TO_LOCAL[filters.schedule];
  if (filters.metric in METRIC_TO_LOCAL) result.metric = METRIC_TO_LOCAL[filters.metric];
  if (filters.outcome in OUTCOME_TO_LOCAL) result.outcome = OUTCOME_TO_LOCAL[filters.outcome];
  return result;
}

function officialQuery(filters, panel) {
  const query = new URLSearchParams();
  const entityKey = ENTITY_ID_FILTER[panel];
  for (const [key, raw] of Object.entries(filters)) {
    if (raw === undefined || raw === null || raw === "" || key === entityKey || key === "source"
        || (panel === "player_game_anatomy" && key === "game_id")) continue;
    if (Array.isArray(raw) && key === "player_ids") query.set(key, raw.join(","));
    else if (key === "season" && Array.isArray(raw)) {
      // V9 takes one season beside `scope=season`, and refuses a season
      // beside `scope=all`. A page that hands its whole selection down —
      // which V11's profiles read — therefore sends one label or none, never
      // a repeated one whose last value would contradict the scope.
      const single = raw.length === 1 ? canonicalSeason(raw[0]) : null;
      if (single) query.set("season", single);
    } else if (Array.isArray(raw)) raw.forEach((value) => query.append(key, String(value)));
    else query.set(key, String(raw));
  }
  query.set("source", "v9");
  return query;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// A page may hand a whole selection down as a list of labels. One label is one
// season; several are a span, which has no single season, so everything that
// needs *a* season reads null and keeps the behaviour it already had. Only the
// V11 profile query reads the list itself.
function canonicalSeason(value) {
  if (Array.isArray(value)) {
    return value.length === 1 ? canonicalSeason(value[0]) : null;
  }
  if (value === undefined || value === null || value === "" || value === "All Seasons") return null;
  return String(value);
}

function canonicalSchedule(value) {
  return SCHEDULE_FROM_LOCAL[value] ?? (value in SCHEDULE_TO_LOCAL ? value : "all");
}

function canonicalMetric(value) {
  return METRIC_FROM_LOCAL[value] ?? (value in METRIC_TO_LOCAL ? value : "value_contributed");
}

function canonicalOutcome(value) {
  return OUTCOME_FROM_LOCAL[value] ?? (value in OUTCOME_TO_LOCAL ? value : "both");
}

function canonicalFilters(source, filters, overrides = {}) {
  const seasonValue = Object.prototype.hasOwnProperty.call(overrides, "season")
    ? overrides.season : filters.season;
  const season = canonicalSeason(seasonValue);
  return {
    source: source.id,
    scope: overrides.scope ?? (season === null ? "all" : "season"),
    season,
    schedule: canonicalSchedule(overrides.schedule ?? filters.schedule),
    time_mode: String(overrides.time_mode ?? filters.time_mode ?? filters.garbage_time_mode ?? "competitive"),
    metric: canonicalMetric(overrides.metric ?? filters.metric),
    outcome: canonicalOutcome(overrides.outcome ?? filters.outcome),
  };
}

function responsibility(value = {}) {
  return {
    offense: finite(value.offense ?? value.offense_value ?? value.offense_value_contributed),
    defense: finite(value.defense ?? value.defense_value ?? value.defense_value_contributed),
    other: finite(value.other ?? value.other_value ?? value.other_value_contributed),
  };
}

function playerSummary(value = {}, metric = "value_contributed") {
  const games = finite(value.games_played ?? value.games ?? value.appearances);
  const minutes = finite(value.minutes_played ?? value.minutes);
  const vc = finite(value.value_contributed ?? value.vc);
  const wc = finite(value.wins_contributed ?? value.wc);
  const split = responsibility(value.responsibility ?? value);
  const wins = finite(value.wins);
  const losses = value.losses === null || value.losses === undefined
    ? Math.max(0, games - wins)
    : finite(value.losses);
  return {
    games_played: games,
    games,
    appearances: games,
    value_evidence_rows: finite(value.value_evidence_rows),
    seconds_played: finite(value.seconds_played, minutes * 60),
    minutes_played: minutes,
    minutes,
    wins,
    losses,
    value_contributed: vc,
    vc,
    wins_contributed: wc,
    wc,
    losses_contributed: finite(value.losses_contributed ?? value.loss_value_contributed, vc - wc),
    loss_value_contributed: finite(value.loss_value_contributed ?? value.losses_contributed, vc - wc),
    selected_metric: metric,
    selected_value: metric === "wins_contributed" ? wc : vc,
    value_per_game: value.value_per_game ?? value.vc_per_game ?? (games ? vc / games : null),
    offense_value: split.offense,
    defense_value: split.defense,
    other_value: split.other,
    responsibility: split,
    context: { ...(value.context ?? {}) },
    // What this scope would have been with all six context factors switched
    // off. V10 and V11 publish it on the scope row; V9 publishes it on the
    // fingerprint instead, so a missing one here is a null, never a zero.
    raw_no_context_value: value.raw_no_context_value ?? null,
    wins_raw_no_context_value: value.wins_raw_no_context_value ?? null,
    rank: value.rank ?? value.relevant_rank ?? null,
    relevant_rank: value.relevant_rank ?? value.rank ?? null,
    rank_metric: value.rank_metric ?? metric,
    wins_contributed_rank: value.wins_contributed_rank ?? null,
  };
}

function playerSeason(value, metric) {
  const normalized = playerSummary(value, metric);
  return {
    season_end_year: Number(value.season_end_year),
    season: value.season,
    teams: [...(value.teams ?? [])],
    ...normalized,
    season_rank: value.season_rank ?? value.rank ?? null,
    // Where he stood by Wins Contributed in that full season, which the
    // career-by-season table prints beside the row.
    wins_contributed_rank: value.wins_contributed_rank ?? null,
  };
}

function fingerprint(value = {}) {
  const split = responsibility(value.responsibility ?? value);
  const shares = value.responsibility_share ?? value.responsibility?.shares ?? {};
  const total = split.offense + split.defense + split.other;
  return {
    raw_vc: value.raw_vc ?? null,
    responsibility: split,
    responsibility_share: {
      offense: shares.offense ?? (total ? split.offense / total : null),
      defense: shares.defense ?? (total ? split.defense / total : null),
      other: shares.other ?? (total ? split.other / total : null),
    },
    context: { ...(value.context ?? value.context_components ?? {}) },
    sources: [...(value.sources ?? [])],
    wins_sources: Array.isArray(value.wins_sources) ? [...value.wins_sources] : null,
    leading_positive_sources: [...(value.leading_positive_sources ?? value.positive_sources ?? [])],
    leading_negative_sources: [...(value.leading_negative_sources ?? value.negative_sources ?? [])],
    // V12's contested/uncontested view of two of the sources above.
    ...(value.defensive_rebound_split
      ? { defensive_rebound_split: { ...value.defensive_rebound_split } }
      : {}),
  };
}

function gameRow(value = {}) {
  const split = responsibility(value.responsibility ?? value);
  const winLoss = value.win_loss ?? (value.outcome === undefined
    ? value.result === "W" : value.outcome === "win");
  const vc = finite(value.value_contributed ?? value.vc);
  const seconds = finite(value.seconds_played, finite(value.minutes_played) * 60);
  return {
    rank: Number(value.rank),
    game_id: String(value.game_id),
    game_date: value.game_date ?? value.date,
    season_end_year: Number(value.season_end_year),
    season: value.season,
    season_type: value.season_type,
    player_id: value.player_id === undefined ? undefined : Number(value.player_id),
    player_name: value.player_name,
    team: value.team,
    opponent: value.opponent,
    location: value.location,
    win_loss: Boolean(winLoss),
    outcome: winLoss ? "win" : "loss",
    result: winLoss ? "W" : "L",
    seconds_played: seconds,
    minutes_played: seconds / 60,
    value_contributed: vc,
    wins_contributed: winLoss ? vc : 0,
    losses_contributed: winLoss ? 0 : vc,
    offense_value: split.offense,
    defense_value: split.defense,
    other_value: split.other,
    responsibility: split,
    selected_metric: "value_contributed",
    selected_value: vc,
  };
}

function normalizePlayerContributionChart(value = {}, filters = {}) {
  const grain = value.grain === "game" ? "game" : "season";
  const selectedSeason = value.selected_season_end_year
    ?? (filters.season ? Number(String(filters.season).slice(0, 4)) + 1 : null);
  return {
    grain,
    selected_season_end_year: selectedSeason === null ? null : Number(selectedSeason),
    // Every selected season's games, numbered inside their own season: one
    // line per season on the contribution chart.
    by_season: (value.by_season ?? []).map((season) => ({
      season: season.season,
      season_end_year: Number(season.season_end_year),
      games: (season.games ?? []).map((game) => ({
        ...game,
        game_number: Number(game.game_number),
        value_contributed: finite(game.value_contributed),
        wins_contributed: finite(game.wins_contributed),
        cumulative_value_contributed: finite(game.cumulative_value_contributed),
        cumulative_wins_contributed: finite(game.cumulative_wins_contributed),
      })),
    })),
    schedules: (value.schedules ?? []).map((schedule) => ({
      id: schedule.id,
      label: schedule.label,
      points: (schedule.points ?? []).map((point) => ({
        ...point,
        season_end_year: Number(point.season_end_year),
        value_contributed: finite(point.value_contributed),
        wins_contributed: finite(point.wins_contributed),
        cumulative_value_contributed: finite(point.cumulative_value_contributed),
        cumulative_wins_contributed: finite(point.cumulative_wins_contributed),
      })),
    })),
  };
}

function normalizePlayerProfile(payload, filters) {
  const normalizedFilters = canonicalFilters(payload.source, filters);
  const seasons = (payload.seasons ?? payload.career?.rows ?? []).map((row) =>
    playerSeason(row, normalizedFilters.metric));
  let cumulativeValue = 0;
  let cumulativeWins = 0;
  const trend = seasons.map((row) => {
    cumulativeValue += row.value_contributed;
    cumulativeWins += row.wins_contributed;
    return {
      season_end_year: row.season_end_year,
      season: row.season,
      value_contributed: row.value_contributed,
      wins_contributed: row.wins_contributed,
      cumulative_value_contributed: cumulativeValue,
      cumulative_wins_contributed: cumulativeWins,
    };
  });
  return {
    source: payload.source,
    filters: normalizedFilters,
    state: payload.state,
    entity: { ...(payload.entity ?? payload.player) },
    summary: playerSummary(payload.summary, normalizedFilters.metric),
    seasons,
    trend,
    contribution_chart: normalizePlayerContributionChart(
      payload.contribution_chart,
      normalizedFilters,
    ),
    fingerprint: fingerprint(payload.fingerprint),
    v10: payload.v10 ?? null,
  };
}

function normalizeGames(payload, filters) {
  const normalizedFilters = canonicalFilters(payload.source, filters);
  return {
    source: payload.source,
    filters: normalizedFilters,
    state: payload.state,
    rows: (payload.rows ?? []).map(gameRow),
    pagination: {
      limit: finite(payload.pagination?.limit, finite(filters.limit, 10)),
      offset: finite(payload.pagination?.offset, finite(filters.offset)),
      total: finite(payload.pagination?.total),
    },
    ranking_metric: "value_contributed",
  };
}

function normalizePlayerSimilarity(payload, filters) {
  const mode = String(payload.mode ?? filters.mode ?? "career").toLowerCase() === "career"
    ? "career" : "season";
  const season = mode === "season" ? canonicalSeason(filters.season) : null;
  const seasonEndYear = season ? Number(season.slice(0, 4)) + 1 : null;
  const normalizedFilters = canonicalFilters(payload.source, filters, {
    scope: mode === "career" ? "all" : "season",
    season,
    schedule: "all",
  });
  const minimumGames = mode === "career" ? 50 : 20;
  const minimumMinutes = mode === "career" ? 2000 : 500;
  const targetEligibility = payload.eligibility ?? {};
  const target = payload.target ?? {
    player_id: Number(filters.player_id),
    player_name: payload.player_name ?? "Unknown player",
    teams: [],
    games_played: finite(targetEligibility.appearances),
    seconds_played: finite(targetEligibility.seconds_played,
      finite(targetEligibility.minutes) * 60),
    minutes_played: finite(targetEligibility.minutes),
  };
  return {
    source: payload.source,
    filters: normalizedFilters,
    mode,
    contract_version: payload.contract_version ?? PLAYER_SIMILARITY_CONTRACT_VERSION,
    basis: payload.basis ?? {
      schedule: "all",
      time_mode: normalizedFilters.time_mode,
      scope_key: mode === "career" ? "career:2014-2026" : `season:${seasonEndYear}`,
      season_end_years: mode === "career"
        ? [...(payload.source.scope?.season_end_years ?? [])]
        : (seasonEndYear ? [seasonEndYear] : []),
    },
    thresholds: payload.thresholds ?? {
      games_played: targetEligibility.minimum_games ?? minimumGames,
      minutes_played: targetEligibility.minimum_minutes ?? minimumMinutes,
    },
    target: {
      ...target,
      player_id: Number(target.player_id),
      games_played: finite(target.games_played ?? target.appearances),
      seconds_played: finite(target.seconds_played,
        finite(target.minutes_played ?? target.minutes) * 60),
      minutes_played: finite(target.minutes_played ?? target.minutes),
    },
    status: payload.status,
    reason: payload.reason ?? null,
    pool_size: payload.pool_size ?? targetEligibility.pool_size ?? null,
    artifact: payload.artifact ?? null,
    matches: (payload.matches ?? []).map((match, index) => ({
      rank: Number(match.rank ?? index + 1),
      player_id: Number(match.player_id),
      player_name: match.player_name,
      scope_kind: match.scope_kind ?? mode,
      scope_key: match.scope_key ?? (mode === "career" ? "career:2014-2026" : `season:${seasonEndYear}`),
      season_end_year: match.season_end_year ?? seasonEndYear,
      season: match.season ?? (
        (match.season_end_year ?? seasonEndYear)
          ? `${Number(match.season_end_year ?? seasonEndYear) - 1}-${String(Number(match.season_end_year ?? seasonEndYear)).slice(-2).padStart(2, "0")}`
          : null
      ),
      teams: [...(match.teams ?? [])],
      score: finite(match.score ?? match.similarity),
      similarity: finite(match.similarity ?? match.score),
      distance: finite(match.distance, Math.sqrt(Math.max(0, finite(match.distance_squared)))),
      dimension_coverage: finite(match.dimension_coverage,
        finite(payload.active_feature_count) / PLAYER_SIMILARITY_FEATURE_COUNT),
      games_played: finite(match.games_played ?? match.appearances),
      seconds_played: finite(match.seconds_played, finite(match.minutes_played ?? match.minutes) * 60),
      minutes_played: finite(match.minutes_played ?? match.minutes),
      // The style this match belongs to, and the source's own plain sentence
      // about the match when it publishes one.
      style: match.style ?? match.player_type ?? null,
      // A two-axis statistic (V12) also names each match's defensive role.
      defense_type: match.defense_type ?? null,
      explanation_text: match.explanation_text
        ?? (typeof match.explanation === "string" ? match.explanation : null),
      explanations: match.explanations ?? {
        similarities: [...(match.strongest_similarities ?? [])],
        differences: [...(match.largest_differences ?? [])],
      },
      strongest_similarities: [...(match.strongest_similarities
        ?? match.explanations?.similarities ?? [])],
      largest_differences: [...(match.largest_differences
        ?? match.explanations?.differences ?? [])],
    })),
  };
}

function normalizeTeamProfile(payload, filters) {
  const normalizedFilters = canonicalFilters(payload.source, filters);
  const sourceSummary = payload.summary ?? {};
  const split = responsibility(sourceSummary.responsibility ?? sourceSummary);
  const games = finite(sourceSummary.games_played ?? sourceSummary.games);
  const wins = finite(sourceSummary.wins);
  const vc = finite(sourceSummary.team_value_contributed ?? sourceSummary.value_contributed);
  const wc = finite(sourceSummary.team_wins_contributed ?? sourceSummary.wins_contributed);
  const rosterRows = payload.players ?? payload.roster?.rows ?? [];
  const players = rosterRows.map((row) => ({
    player_id: Number(row.player_id),
    player_name: row.player_name,
    ...playerSummary(row, normalizedFilters.metric),
    minute_share: row.minute_share ?? null,
    minute_share_pct: row.minute_share_pct ?? (row.minute_share === null || row.minute_share === undefined
      ? null : finite(row.minute_share) * 100),
    // Which seasons of the selection this player was on the roster for, and
    // the kind of player he was across them. Absent from a source that does
    // not publish them, never invented.
    seasons: [...(row.seasons ?? [])],
    season_end_years: [...(row.season_end_years ?? [])],
    seasons_played: row.seasons_played ?? (row.seasons ?? []).length ?? null,
    player_type: row.player_type ?? null,
    defense_role: row.defense_role ?? null,
  }));
  const footerSource = payload.roster?.footer ?? payload.roster_footer ?? sourceSummary;
  const footer = {
    games_played: games,
    games,
    minutes: finite(footerSource.minutes ?? footerSource.player_minutes),
    player_minutes: finite(footerSource.player_minutes ?? footerSource.minutes),
    value_contributed: vc,
    wins_contributed: wc,
    losses_contributed: vc - wc,
    loss_value_contributed: vc - wc,
    responsibility: split,
  };
  return {
    source: payload.source,
    filters: normalizedFilters,
    state: payload.state,
    entity: { ...(payload.entity ?? payload.team) },
    summary: {
      games_played: games,
      games,
      wins,
      losses: finite(sourceSummary.losses, games - wins),
      win_percentage: sourceSummary.win_percentage ?? (games ? wins / games : null),
      player_seconds: finite(sourceSummary.player_seconds, footer.minutes * 60),
      player_minutes: finite(sourceSummary.player_minutes, footer.minutes),
      minutes: finite(sourceSummary.minutes, footer.minutes),
      value_contributed: vc,
      team_value_contributed: vc,
      wins_contributed: wc,
      team_wins_contributed: wc,
      losses_contributed: vc - wc,
      loss_value_contributed: vc - wc,
      selected_metric: normalizedFilters.metric,
      selected_value: normalizedFilters.metric === "wins_contributed" ? wc : vc,
      unique_players: finite(sourceSummary.unique_players, players.length),
      offense_value: split.offense,
      defense_value: split.defense,
      other_value: split.other,
      responsibility: split,
    },
    seasons: [...(payload.seasons ?? [])],
    players,
    roster: { rows: players, footer },
    concentration: [...(payload.concentration ?? payload.roster_concentration ?? [])],
    cumulative_series: [...(payload.cumulative_series ?? payload.who_built_total?.points ?? [])],
    season_series: payload.season_series ?? payload.contribution_chart ?? { mode: "season_totals", series: [] },
    who_built_total: payload.who_built_total ?? {
      metric: normalizedFilters.metric,
      players: players.slice(0, 10),
      points: [...(payload.cumulative_series ?? [])],
    },
    contribution_chart: payload.contribution_chart ?? payload.season_series,
    // Each selected season's own roster, which the turnover cards read, and
    // the source's own sentence about which block covers which scope.
    season_rosters: [...(payload.season_rosters ?? [])],
    scopes: payload.scopes ?? null,
    fingerprint: fingerprint(payload.fingerprint ?? { responsibility: split }),
    v10: payload.v10 ?? null,
  };
}

function normalizeTeamSimilarity(payload, filters) {
  const season = canonicalSeason(filters.season);
  const seasonEndYear = season ? Number(season.slice(0, 4)) + 1 : null;
  const normalizedFilters = canonicalFilters(payload.source, filters, {
    scope: season ? "season" : "all",
    season,
    schedule: "regular_season",
  });
  return {
    source: payload.source,
    filters: normalizedFilters,
    mode: "season",
    basis: typeof payload.basis === "object" ? payload.basis : {
      schedule: "regular_season",
      season_end_year: seasonEndYear,
      time_mode: normalizedFilters.time_mode,
    },
    target: payload.target ?? {
      team_id: Number(filters.team_id),
      season_end_year: seasonEndYear,
      time_mode: normalizedFilters.time_mode,
    },
    status: payload.status,
    reason: payload.reason ?? null,
    artifact: payload.artifact ?? null,
    verification_self_similarity: payload.verification_self_similarity ?? 100,
    comparison_pool_size: payload.comparison_pool_size ?? null,
    matches: (payload.matches ?? []).map((match, index) => {
      const explanation = match.explanation ?? {
        transport_flows: [...(match.closest_player_roles ?? [])],
        family_differences: { ...(match.family_differences ?? {}) },
        shared_player_count: finite(match.shared_player_count),
        dimension_coverage: finite(match.dimension_coverage),
      };
      return {
        rank: Number(match.rank ?? index + 1),
        team_id: Number(match.team_id),
        team: match.team,
        season_end_year: Number(match.season_end_year),
        season: match.season,
        score: finite(match.score ?? match.similarity),
        similarity: finite(match.similarity ?? match.score),
        distance: finite(match.distance),
        dimension_coverage: finite(match.dimension_coverage),
        selected_minute_coverage: finite(match.selected_minute_coverage ?? match.minute_coverage),
        minute_coverage: finite(match.minute_coverage ?? match.selected_minute_coverage),
        shared_player_count: finite(match.shared_player_count ?? explanation.shared_player_count),
        style: match.style ?? match.team_type ?? null,
        explanation_text: match.explanation_text
          ?? (typeof match.explanation === "string" ? match.explanation : null),
        explanation,
      };
    }),
  };
}

function normalizeDirectory(payload, filters, panel) {
  const normalizedFilters = canonicalFilters(payload.source, filters);
  const rows = (payload.rows ?? []).map((row) => panel === "players" ? {
    player_id: Number(row.player_id),
    player_name: row.player_name,
    teams: [...(row.teams ?? (row.latest_team ? [row.latest_team] : []))],
    latest_team: row.latest_team ?? row.team ?? row.teams?.[0] ?? null,
    games_played: finite(row.games_played ?? row.games),
    seconds_played: finite(row.seconds_played, finite(row.minutes_played ?? row.minutes) * 60),
    minutes_played: finite(row.minutes_played ?? row.minutes),
    value_contributed: finite(row.value_contributed),
    wins_contributed: finite(row.wins_contributed),
  } : {
    ...row,
    team_id: Number(row.team_id),
    games_played: finite(row.games_played ?? row.games),
    wins: finite(row.wins),
    value_contributed: finite(row.value_contributed),
    wins_contributed: finite(row.wins_contributed),
  });
  return {
    source: payload.source,
    filters: normalizedFilters,
    state: payload.state,
    rows,
    pagination: {
      limit: finite(payload.pagination?.limit, panel === "teams" ? 30 : 50),
      offset: finite(payload.pagination?.offset),
      total: finite(payload.pagination?.total, rows.length),
    },
  };
}

export function normalizeEntityPayload(panel, payload, filters = {}) {
  switch (panel) {
    case "player_landscape": return {
      ...payload,
      rows: (payload.rows ?? []).map((row) => ({
        ...row,
        player_id: Number(row.player_id),
        seconds_played: finite(row.seconds_played),
        minutes_played: finite(row.minutes_played, finite(row.seconds_played) / 60),
      })),
    };
    case "team_landscape": return { ...payload };
    case "players":
    case "teams": return normalizeDirectory(payload, filters, panel);
    case "player_profile": return normalizePlayerProfile(payload, filters);
    case "player_games":
    case "team_games": return normalizeGames(payload, filters);
    case "player_game_anatomy": return { ...payload, filters: canonicalFilters({ id: payload.source?.public_id ?? payload.source?.id ?? "v9" }, filters) };
    case "player_similarity": return normalizePlayerSimilarity(payload, filters);
    case "team_profile": return normalizeTeamProfile(payload, filters);
    case "team_similarity": return normalizeTeamSimilarity(payload, filters);
    case "season_story": return { ...payload, filters: canonicalFilters(payload.source, filters) };
    default: throw new BrowserExperimentError("unsupported_entity_panel", `Unsupported entity panel ${panel}.`);
  }
}

export function normalizeExperimentEntityPayload(panel, payload, filters = {}) {
  if (!payload?.source || payload.source.kind !== "experiment") {
    throw new BrowserExperimentError(
      "invalid_experiment_entity_source",
      "Browser entity projections must retain their receipt-bound experiment source.",
    );
  }
  return normalizeEntityPayload(panel, payload, filters);
}

// V10 is bound to its sealed runtime receipt; V11 identifies itself by the
// stat version its own API stamps on every envelope.
function assertServerSource(sourceId, payload) {
  const source = payload?.source ?? null;
  if (sourceId === "v10") {
    if (source?.id !== "v10"
        || !/^[0-9a-f]{64}$/.test(String(source.calculation_receipt ?? ""))
        || !/^[0-9a-f]{64}$/.test(String(source.runtime?.deployment_receipt ?? ""))) {
      throw new BrowserExperimentError(
        "v10_official_source_mismatch",
        "The V10 server response is not bound to the sealed runtime receipt.",
      );
    }
    return payload;
  }
  if ((source?.stat_version ?? source?.id) !== sourceId) {
    throw new BrowserExperimentError(
      `${sourceId}_official_source_mismatch`,
      `The ${sourceId.toUpperCase()} server response does not identify itself as ${sourceId.toUpperCase()}.`,
    );
  }
  return payload;
}

function assertOfficialSource(payload) {
  const source = payload?.source;
  if (!source || source.id !== V9_PUBLIC_SOURCE.public_id
      || source.public_id !== V9_PUBLIC_SOURCE.public_id
      || source.label !== "V9"
      || source.storage_slug !== V9_PUBLIC_SOURCE.storage_slug
      || source.release_id !== V9_PUBLIC_SOURCE.release_id
      || source.release_receipt !== V9_PUBLIC_SOURCE.release_receipt
      || source.run_id !== V9_PUBLIC_SOURCE.run_id
      || source.configuration_receipt !== V9_PUBLIC_SOURCE.configuration_receipt
      || source.calculation_receipt !== V9_PUBLIC_SOURCE.calculation_receipt
      || !/^[0-9a-f]{64}$/.test(String(source.runtime_receipt ?? ""))
      || source.completion_status !== "complete") {
    throw new BrowserExperimentError(
      "official_source_mismatch",
      "The server response is not receipt-bound to the approved V9 source.",
    );
  }
  return payload;
}

export class V9EntitySourceAdapter {
  constructor({
    experimentClient = null,
    fetchImpl = globalThis.fetch,
    similarityClient = null,
    WorkerImpl = globalThis.Worker,
  } = {}) {
    // With experiments switched off this page lists official statistics only,
    // and no browser-experiment client, worker or store is ever consulted —
    // even if one was handed in.
    this.experimentClient = experimentsSwitchedOn() ? experimentClient : null;
    this.fetchImpl = createReadOnlyFetch(fetchImpl);
    this.similarityClient = similarityClient;
    if (!this.similarityClient && this.experimentClient && typeof WorkerImpl === "function") {
      this.similarityClient = new EntitySimilarityWorkerClient({ WorkerImpl });
      this.experimentClient.entitySimilarityClient = this.similarityClient;
    }
  }

  async listSources() {
    const sources = [];
    // V9 is listed only when /api/sources says the deployment serves it.
    let v9Offered = false;
    // The statistic /api/sources names as the default. Sources are listed
    // newest first, so the default is marked rather than put first.
    let defaultId = null;
    try {
      const response = await this.fetchImpl("/api/sources", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const options = await response.json();
        defaultId = options.default_source ?? null;
        // /api/sources lists the official statistics newest first (V13, V12, V11, V10),
        // and every one of them serves its own entity panels.
        for (const row of options.sources ?? []) {
          if (row.id === V9_PUBLIC_SOURCE.public_id) v9Offered = true;
          if (!(row.id in SERVER_ENDPOINTS)) continue;
          const years = (row.season_end_years ?? options.season_end_years ?? []).map(Number);
          sources.push({
            ...row,
            kind: "official",
            label: row.label ?? row.id.toUpperCase(),
            public_id: row.id,
            default: row.id === defaultId,
            completion_status: "complete",
            certification_status: "local_receipt_verified",
            scope: {
              season_end_years: years,
              first_season: years.length ? `${years[0] - 1}-${String(years[0]).slice(-2)}` : null,
              last_season: years.length ? `${years.at(-1) - 1}-${String(years.at(-1)).slice(-2)}` : null,
              complete_history: years.length === 13,
            },
            // A deployment can narrow what its copy of a statistic serves —
            // the published static site has no per-game anatomy, for one — so
            // the source row's own `capabilities` override these defaults.
            capabilities: {
              ...SERVER_SOURCE_CAPABILITIES[row.id],
              ...(row.capabilities ?? {}),
            },
          });
        }
      }
    } catch {
      // A server statistic stays invisible until its sealed pointer verifies.
    }
    if (v9Offered) {
      sources.push({
        ...V9_PUBLIC_SOURCE,
        id: "v9",
        public_id: "v9",
        completion_status: "complete",
        default: defaultId === "v9",
      });
    }
    // With the site-wide switch off the site publishes one statistic, the
    // default, so no page can offer a choice between statistics (note of
    // 2026-09-28). The earlier ones come back with the switch.
    if (!experimentsSwitchedOn()) {
      const published = sources.find((source) => source.default) ?? sources[0];
      return published ? [published] : [];
    }
    if (!this.experimentClient) return sources;
    const experiments = await this.experimentClient.listPublished();
    return sources.concat(experiments
      .map((experiment) => {
        const stale = experiment.stale === true || experiment.requiresRerun === true;
        const selectedSeasons = [...new Set(
          experiment.selectedSeasons ?? experiment.selected_seasons ?? [],
        )].map(Number).sort((left, right) => left - right);
        return ({
        kind: "experiment",
        id: `experiment:${experiment.experimentId}`,
        public_id: `experiment:${experiment.experimentId}`,
        label: experiment.name,
        storage_slug: null,
        release_id: experiment.releaseId,
        release_receipt: experiment.manifestSha256 ?? null,
        run_id: experiment.experimentId,
        configuration_receipt: experiment.configurationReceipt,
        calculation_receipt: experiment.experimentReceipt ?? experiment.aggregateReceipt ?? null,
        runtime_receipt: experiment.aggregateReceipt ?? experiment.experimentReceipt ?? null,
        completion_status: stale ? "stale" : "complete",
        certification_status: stale ? "browser_local_stale" : "browser_local_complete",
        stale,
        selected_seasons: selectedSeasons,
        scope: {
          season_end_years: selectedSeasons,
          first_season: selectedSeasons.length
            ? `${selectedSeasons[0] - 1}-${String(selectedSeasons[0]).slice(-2).padStart(2, "0")}` : null,
          last_season: selectedSeasons.length
            ? `${selectedSeasons.at(-1) - 1}-${String(selectedSeasons.at(-1)).slice(-2).padStart(2, "0")}` : null,
          complete_history: selectedSeasons.length === 13
            && selectedSeasons.every((year, index) => year === 2014 + index),
        },
        capabilities: {
          player_profiles: true,
          player_games: true,
          player_game_anatomy: true,
          player_similarity: true,
          player_similarity_season: true,
          player_similarity_career: selectedSeasons.length === 13
            && selectedSeasons.every((year, index) => year === 2014 + index),
          team_profiles: true,
          team_games: true,
          team_similarity: true,
          player_similarity_contract: true,
          biographical_profile: false,
          traditional_box_score: false,
          responsibility_breakdown: true,
          context_breakdown: true,
          authoritative_minutes: true,
        },
      });
      }));
  }

  async query(sourceId, panel, filters = {}, { signal = null } = {}) {
    const source = normalizeSourceId(sourceId);
    const endpoint = ENDPOINTS[panel];
    // A panel only one server statistic publishes — V11's team landscape — has
    // no V9 route, so the V9 table alone no longer decides what exists.
    if (!endpoint && !SERVER_ENDPOINTS[source.id]?.[panel]) {
      throw new BrowserExperimentError("unsupported_entity_panel", `Unsupported entity panel ${panel}.`);
    }
    if (source.kind === "experiment") {
      if (!this.experimentClient) {
        throw new BrowserExperimentError("experiment_runtime_unavailable", "Browser experiments are unavailable.");
      }
      const payload = await this.experimentClient.queryEntity(source.experimentId, {
        panel,
        filters: localFilters(filters),
        signal,
      });
      return normalizeExperimentEntityPayload(panel, payload, filters);
    }
    if (source.id in SERVER_ENDPOINTS) {
      const label = source.id.toUpperCase();
      const serverEndpoint = SERVER_ENDPOINTS[source.id][panel];
      if (!serverEndpoint) {
        throw new BrowserExperimentError(
          "unsupported_server_entity_panel",
          `${label} does not expose ${panel} through this page.`,
        );
      }
      const query = serverQuery(source.id, filters, panel);
      const response = await this.fetchImpl(`${serverEndpoint(filters)}?${query.toString()}`, {
        method: "GET",
        credentials: "same-origin",
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        // A panel this statistic simply does not publish reads as "not
        // available" on the page instead of as a technical failure.
        if (response.status === 404 && panel === "player_similarity") {
          return normalizePlayerSimilarity(
            unavailableSimilarity({ id: source.id, public_id: source.id }, filters), filters,
          );
        }
        if (response.status === 404 && panel === "team_similarity") {
          return normalizeTeamSimilarity(
            unavailableSimilarity({ id: source.id, public_id: source.id }, filters), filters,
          );
        }
        let detail = null;
        try { detail = await response.json(); } catch { detail = null; }
        throw new BrowserExperimentError(
          detail?.detail?.code ?? `${source.id}_entity_http_${response.status}`,
          detail?.detail?.message ?? `${label} entity request failed (${response.status}).`,
          detail,
        );
      }
      const payload = await response.json();
      assertServerSource(source.id, payload);
      return normalizeV10Payload(panel, payload, filters, source.id);
    }
    const query = officialQuery(filters, panel);
    const response = await this.fetchImpl(`${endpoint(filters)}?${query.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      let detail = null;
      try { detail = await response.json(); } catch { detail = null; }
      throw new BrowserExperimentError(
        detail?.detail?.code ?? detail?.code ?? `entity_http_${response.status}`,
        detail?.detail?.message ?? detail?.message ?? `Entity API request failed (${response.status}).`,
        detail,
      );
    }
    const payload = assertOfficialSource(await response.json());
    return normalizeEntityPayload(panel, payload, filters);
  }

  close() {
    this.similarityClient?.close?.();
  }
}

export function createV9EntitySourceAdapter(options = {}) {
  return new V9EntitySourceAdapter(options);
}
