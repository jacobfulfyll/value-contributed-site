// Answer every /api request of the V11 dashboard from static files.
//
// The published site has no server.  `scripts/build_v11_site.py` writes one
// JSON snapshot per natural scope and this module does the filtering, sorting,
// searching and paging the FastAPI routes did, with the same defaults, the
// same orderings and the same tie-breaks, so a page cannot tell the two apart.
//
// It is written in the same UMD shape as team-directory.js, so all three
// callers work:
//
//   * a classic <script src> in a page, which installs the fetch patch;
//   * `import "../v11-static-api.js"` inside the Experiments module worker,
//     which installs the same patch on the worker's own fetch;
//   * `require(...)` under node, which gets the routing core and installs
//     nothing — that is what the build's `verify` command drives.
//
// The build publishes one statistic.  V13 is the public one (owner's note,
// 2026-09-28): `/api/v13/...` is answered from `data/v13/`, by the same V11
// handlers — V13 serves V11's routes in V11's shapes — plus the few blocks only
// V13 has, which the build writes exactly as the API answered them.  V11 can
// still be built on its own and is answered from `data/v11/` the same way; the
// methodology page reads V11's one document whichever statistic is published.
// V9 and V10 endpoints answer 404 with a JSON body, and anything that is not a
// GET or HEAD answers 405, because a static site cannot write.
(function v11StaticApiModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ValueContributedV11StaticApi = api;
  if (api.shouldAutoInstall()) api.install();
})(typeof globalThis === "undefined" ? this : globalThis, function buildV11StaticApi() {
  "use strict";

  // --- where the site lives ---------------------------------------------------

  const DATA_PREFIX = "data/v11/";
  const PACKAGE_PREFIX = "api/v11/experiment-packages/";
  // The one list of published statistics, whichever they are. An older tree
  // kept it under V11's prefix.
  const SOURCES_FILE = "data/sources.json";
  // The statistics a tree can hold beside V11, each under `data/<id>/`.
  const SITE_SOURCES = Object.freeze(["v11", "v13"]);

  // The page-relative pages of the built tree, so a link to "/players" can be
  // turned into one that works at a domain root, under a project sub-path and
  // from `python -m http.server` alike.
  const PAGES = Object.freeze({
    "/": "",
    "/players": "players/",
    "/teams": "teams/",
    "/seasons": "seasons/",
    "/experiments": "experiments/",
    "/how-it-works": "how-it-works/",
    "/compare/players": "compare/players/",
    "/compare/teams": "compare/teams/",
  });

  function scriptBase() {
    // A classic <script> knows its own URL, and the shim always sits one level
    // below the site root (dashboard-assets/v11-static-api.js).  Reading the
    // script's own URL rather than location.pathname is what makes a deep page
    // such as /compare/players/ resolve the same base as the home page.
    if (typeof document === "undefined") return null;
    const current = document.currentScript;
    if (current && current.src) return new URL("../", current.src).href;
    const tag = document.querySelector('script[src*="v11-static-api.js"]');
    return tag && tag.src ? new URL("../", tag.src).href : null;
  }

  function resolveBase() {
    const declared = typeof globalThis !== "undefined"
      ? globalThis.__V11_STATIC_SITE_BASE__
      : null;
    if (typeof declared === "string" && declared) return new URL(declared, "http://site.invalid/").href;
    const fromScript = scriptBase();
    if (fromScript) return fromScript;
    if (typeof self !== "undefined" && self.location && self.location.href) {
      // A worker without a declared base: the worker script sits two levels
      // below the root (dashboard-assets/experiments/).
      return new URL("../../", self.location.href).href;
    }
    return "/";
  }

  // --- small shared helpers ---------------------------------------------------

  function seasonLabel(seasonEndYear) {
    if (seasonEndYear === null || seasonEndYear === undefined) return "All Seasons";
    const year = Number(seasonEndYear);
    return `${year - 1}-${String(year).slice(-2)}`;
  }

  function seasonKey(seasonEndYear) {
    return seasonEndYear === null || seasonEndYear === undefined
      ? "career"
      : String(Number(seasonEndYear));
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function ratio(numerator, denominator) {
    return denominator ? numerator / denominator : null;
  }

  // The site's one folding rule, shared with the server and with the pages.
  // A page loads `name-fold.js` through its own module graph; under node the
  // shim's own tests and the fidelity proof `require()` it from beside this
  // file. It is resolved when a search is first answered rather than when this
  // file loads, so the order the two scripts arrive in cannot matter.
  let foldModule = null;

  function nameFold() {
    if (foldModule) return foldModule;
    const found = (typeof globalThis !== "undefined" && globalThis.ValueContributedNameFold)
      || (typeof require === "function" ? require("./name-fold.js") : null);
    if (!found) throw new HttpError(500, "name-fold.js is not loaded");
    foldModule = found;
    return foldModule;
  }

  /** The folded contains-search the database runs, with % and _ as wildcards. */
  function ilikeContains(value, needle) {
    if (!needle) return true;
    return nameFold().matchesName(value, needle);
  }

  function intOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : null;
  }

  function clampInt(value, fallback, low, high) {
    const number = intOrNull(value);
    if (number === null) return fallback;
    return Math.min(high, Math.max(low, number));
  }

  function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  const SCHEDULES = ["all", "regular_season", "play_in", "playoffs", "postseason"];
  const SCHEDULE_LABEL = Object.freeze({
    all: "All",
    regular_season: "Regular Season",
    play_in: "PlayIn",
    playoffs: "Playoffs",
    postseason: "Postseason",
  });
  const PHASE_TO_SCHEDULE = Object.freeze({
    All: "all",
    "Regular Season": "regular_season",
    PlayIn: "play_in",
    Playoffs: "playoffs",
    Postseason: "postseason",
  });
  const TIME_MODES = ["competitive", "all_minutes"];
  // The high-value records panel's threshold, kept character for character in
  // step with `v11_serving.HIGH_VALUE_THRESHOLD`, which is what the snapshots
  // were written at.  `tests/test_v11_rankings_history.py` fails if they drift.
  const HIGH_VALUE_THRESHOLD = 0.5;
  const METRICS = ["value_contributed", "wins_contributed"];
  const SEASON_TYPES = ["Regular Season", "PlayIn", "Playoffs"];
  const COMPONENTS = Object.freeze([
    "scoring", "assists", "offensive_rebounds", "screening",
    "secondary_creation", "turnovers",
    "blocks", "steals", "charges", "defensive_rebounds", "defensive_boxouts",
    "fouls", "defended_field_goals",
  ]);
  // The six on-court context factors, in the project's standing order, and the
  // three that make up each side's multiplier.  `v11_context_breakdown.FACTORS`
  // is the same list; `tests/test_build_v11_site.py` pins them together.
  const CONTEXT_FACTORS = Object.freeze([
    "general_offense", "general_defense", "teammate_offense",
    "teammate_defense", "opponent_offense", "opponent_defense",
  ]);
  const CONTEXT_OFFENSE_FACTORS = Object.freeze([
    "general_offense", "teammate_offense", "opponent_defense",
  ]);
  const CONTEXT_DEFENSE_FACTORS = Object.freeze([
    "general_defense", "teammate_defense", "opponent_offense",
  ]);
  const CONTEXT_MEASURES = Object.freeze(["raw_value", ...CONTEXT_FACTORS]);

  // The snapshots were taken with `breakdown_mode=vc`, so every ranking row
  // carries both the Value Contributed amounts and their won-game twins.  The
  // wins view selects the second set, exactly as the API does, rather than
  // needing a second copy of every ranking snapshot.
  function contextInWinsView(row) {
    const target = Number(row.wins_contributed);
    const pct = (amount) => (
      amount === null || amount === undefined || target === 0
        ? null : (100.0 * Number(amount)) / target
    );
    const won = (factor) => row[`wins_${factor}_context_value`];
    const group = (factors) => {
      if (factors.some((factor) => won(factor) === null || won(factor) === undefined)) {
        return 0.0;
      }
      return factors.reduce((total, factor) => total + Number(won(factor)), 0);
    };
    const offense = group(CONTEXT_OFFENSE_FACTORS);
    const defense = group(CONTEXT_DEFENSE_FACTORS);
    const selected = {
      side_context_raw_value: Number(row.wins_raw_no_context_value),
      offense_context_value: offense,
      defense_context_value: defense,
    };
    for (const factor of CONTEXT_FACTORS) {
      const amount = won(factor);
      selected[`${factor}_context_value`] = amount === null || amount === undefined
        ? null : Number(amount);
      selected[`${factor}_context_pct`] = pct(amount);
    }
    selected.side_context_raw_pct = pct(selected.side_context_raw_value);
    selected.offense_context_pct = pct(offense);
    selected.defense_context_pct = pct(defense);
    return { ...row, ...selected };
  }

  function scheduleKeeps(schedule, seasonType) {
    if (schedule === "all") return true;
    if (schedule === "regular_season") return seasonType === "Regular Season";
    if (schedule === "play_in") return seasonType === "PlayIn";
    if (schedule === "playoffs") return seasonType === "Playoffs";
    if (schedule === "postseason") return seasonType === "PlayIn" || seasonType === "Playoffs";
    return false;
  }

  class HttpError extends Error {
    constructor(status, detail) {
      super(typeof detail === "string" ? detail : "error");
      this.status = status;
      this.detail = detail;
    }
  }

  // --- the franchise directory, as src/team_directory.py has it ----------------

  function makeDirectory(payload) {
    const teams = payload.teams || {};
    const charlotte = String(payload.charlotte_team_id);
    const hornetsFrom = payload.charlotte_hornets_from;
    const bobcats = payload.bobcats_name;
    function entry(teamId) {
      const key = String(intOrNull(teamId) ?? "");
      return Object.prototype.hasOwnProperty.call(teams, key) ? teams[key] : null;
    }
    function abbreviation(teamId) {
      const identifier = intOrNull(teamId);
      if (identifier === null || identifier <= 0) return String(teamId);
      const found = entry(identifier);
      return found ? found[0] : String(identifier);
    }
    function dateLabel(gameDate) {
      if (gameDate === null || gameDate === undefined) return null;
      const label = String(gameDate).trim().slice(0, 10);
      return label || null;
    }
    function name(teamId, gameDate) {
      const identifier = intOrNull(teamId);
      if (identifier === null || identifier <= 0) return `NBA team ${teamId}`;
      const found = entry(identifier);
      if (!found) return `NBA team ${identifier}`;
      const label = dateLabel(gameDate);
      if (String(identifier) === charlotte && label !== null && label < hornetsFrom) {
        return bobcats;
      }
      return found[1];
    }
    function team(teamId, gameDate) {
      const identifier = intOrNull(teamId);
      const full = name(teamId, gameDate);
      return {
        team_id: identifier === null || identifier <= 0 ? null : identifier,
        id: identifier === null || identifier <= 0 ? null : identifier,
        abbreviation: abbreviation(teamId),
        name: full,
        team_name: full,
      };
    }
    return { abbreviation, name, team };
  }

  function addTeamAbbreviations(row, directory) {
    if (row.team_id !== null && row.team_id !== undefined) {
      row.team_abbreviation = directory.abbreviation(row.team_id);
    }
    if (row.opponent_id !== null && row.opponent_id !== undefined) {
      row.opponent_abbreviation = directory.abbreviation(row.opponent_id);
    }
    if (row.team_ids !== null && row.team_ids !== undefined) {
      row.team_abbreviations = (row.team_ids || []).map((value) => directory.abbreviation(value));
    }
    return row;
  }

  // --- compact row stores ------------------------------------------------------

  /** Rebuild one stored row into the named columns the queries selected. */
  function expandRow(store, values) {
    const row = {};
    for (let index = 0; index < store.columns.length; index += 1) {
      row[store.columns[index]] = values[index];
    }
    row.season_type = SEASON_TYPES[row.type];
    delete row.type;
    if (Object.prototype.hasOwnProperty.call(row, "name")) {
      row.player_name = store.names[row.name];
      delete row.name;
    }
    if (Object.prototype.hasOwnProperty.call(row, "opponent")) {
      row.opponent_id = store.teams[row.opponent];
      delete row.opponent;
    }
    if (Object.prototype.hasOwnProperty.call(row, "team")) {
      row.team_id = store.teams[row.team];
      delete row.team;
    } else if (store.team_id !== undefined) {
      row.team_id = store.team_id;
    }
    row.win_loss = Boolean(row.win_loss);
    row.season = seasonLabel(row.season_end_year);
    if (store.player_id !== undefined) row.player_id = store.player_id;
    return row;
  }

  // A ranking or landscape snapshot is one column list and an array per row —
  // the keys of eighty-odd fields were more than half of its bytes. The fixed
  // dictionaries inside a row (component totals, the context vector) are
  // arrays too, and an empty one is stored as null.
  function unpackSnapshot(snapshot) {
    if (!snapshot.__unpacked) {
      const columns = snapshot.columns ?? [];
      const nested = snapshot.nested ?? {};
      const rows = (snapshot.rows ?? []).map((values) => {
        const row = {};
        columns.forEach((name, index) => {
          const value = values[index];
          const keys = nested[name];
          if (keys) {
            row[name] = value === null || value === undefined
              ? {}
              : Object.fromEntries(keys.map((key, at) => [key, value[at]]));
          } else {
            row[name] = value;
          }
        });
        return row;
      });
      // A field only some rows carry (a V13 landscape row's `v13` block) is
      // left off the rows the build listed as not having it.
      for (const [name, indexes] of Object.entries(snapshot.absent ?? {})) {
        for (const at of indexes) delete rows[at][name];
      }
      Object.defineProperty(snapshot, "__unpacked", { value: rows });
    }
    return snapshot.__unpacked;
  }

  function expandStore(store) {
    if (!store.__expanded) {
      store.__expanded = store.rows.map((values) => expandRow(store, values));
    }
    return store.__expanded;
  }

  // --- reading -----------------------------------------------------------------

  // The build writes every snapshot gzipped under its own `.json` name, and a
  // static host serves those bytes as they are, so they are inflated here. A
  // host that inflated them on the way, or an older tree that was never
  // compressed, hands back text, which the gzip magic number tells apart.
  async function parseJsonBody(response) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function makeIo(base, nativeFetch) {
    const cache = new Map();
    return {
      base,
      async json(relativePath) {
        if (cache.has(relativePath)) return cache.get(relativePath);
        const promise = (async () => {
          const response = await nativeFetch(new URL(relativePath, base).href, {
            credentials: "omit",
          });
          if (!response.ok) return null;
          return parseJsonBody(response);
        })();
        cache.set(relativePath, promise);
        return promise;
      },
    };
  }

  /**
   * The same reader, answering for one statistic: every V11 snapshot path the
   * handlers name is read from that statistic's own folder instead, and the
   * words and identifiers a payload carries name it.
   */
  function scopedIo(io, id) {
    if (id === "v11" || io.source === id) return io;
    const folder = `data/${id}/`;
    return {
      ...io,
      source: id,
      label: id.toUpperCase(),
      json(relativePath) {
        return io.json(
          relativePath.startsWith(DATA_PREFIX)
            ? folder + relativePath.slice(DATA_PREFIX.length)
            : relativePath,
        );
      },
    };
  }

  function sourceId(io) {
    return io.source ?? "v11";
  }

  function label(io) {
    return io.label ?? "V11";
  }

  async function need(io, relativePath, detail) {
    const payload = await io.json(relativePath);
    if (payload === null || payload === undefined) throw new HttpError(404, detail);
    return payload;
  }

  /** A store a tree may not carry, which is not an error. */
  async function optional(io, relativePath) {
    const payload = await io.json(relativePath);
    return payload === undefined || payload === null ? null : payload;
  }

  // His place among everybody over exactly the selected seasons: the metric is
  // additive, so each season's own snapshot is summed and ranked, which is the
  // aggregation the API does in one query.
  async function selectionRank(io, query, seasonYears, playerId) {
    const totals = new Map();
    for (const year of [...seasonYears].sort((left, right) => left - right)) {
      const snapshot = await rankingSnapshot(io, { ...query, seasonEndYear: year });
      for (const row of unpackSnapshot(snapshot)) {
        const identity = Number(row.player_id);
        totals.set(identity, (totals.get(identity) ?? 0) + finite(row[query.metric]));
      }
    }
    if (!totals.has(playerId)) return null;
    const ordered = [...totals.entries()]
      .sort((left, right) => right[1] - left[1] || left[0] - right[0]);
    return ordered.findIndex(([identity]) => identity === playerId) + 1;
  }

  // --- endpoint handlers -------------------------------------------------------

  function rankingRowsFor(snapshot, { metric, search, targetedNull }) {
    const ranked = unpackSnapshot(snapshot).slice().sort((left, right) => {
      const difference = Number(right[metric]) - Number(left[metric]);
      if (difference) return difference;
      return Number(left.player_id) - Number(right.player_id);
    });
    const withRank = ranked.map((row, index) => {
      const copy = { ...row, rank: index + 1 };
      if (targetedNull !== null && String(copy.player_id) !== targetedNull) {
        // A numeric search narrows the debut scan to that one player, so every
        // other row loses its first-season field exactly as the query does.
        copy.career_first_season_end_year = null;
      }
      return copy;
    });
    const trimmed = String(search ?? "").trim();
    const filtered = withRank.filter(
      (row) => ilikeContains(row.player_name, trimmed) || String(row.player_id) === trimmed,
    );
    // The query carries the size of the filtered table on every row, and the
    // pages read it from there, so it is part of a row and not only of the
    // envelope.
    for (const row of filtered) row.total_count = filtered.length;
    return filtered;
  }

  // The order a page is read in, which is not the order a ranking *is*: `rank`
  // is the metric order and never moves. Kept in step with
  // `v11_api.SORTABLE_COLUMNS`, and the three displayed sides sort by whichever
  // amount the reader is looking at.
  const SORTABLE_COLUMNS = Object.freeze([
    "wins_contributed", "value_contributed", "losses_contributed",
    "value_per_game", "value_per_game_rank",
    "games_played", "wins", "losses",
    "offense_value", "defense_value", "other_value", "hustle_value",
    "postseason_rank_change", "postseason_value_per_game_difference",
    "side_context_raw_value", "side_context_raw_pct",
    "offense_context_value", "defense_context_value",
    "offense_context_pct", "defense_context_pct",
    "general_offense_context_value", "general_defense_context_value",
    "teammate_offense_context_value", "teammate_defense_context_value",
    "opponent_offense_context_value", "opponent_defense_context_value",
  ]);
  const DISPLAYED_SIDES = Object.freeze({
    offense_value: "offensive",
    defense_value: "defensive",
    other_value: "other",
  });

  function sortValue(row, column, breakdownMode) {
    const side = DISPLAYED_SIDES[column];
    const key = side
      ? `${side}_${breakdownMode === "wc" ? "wins_contributed" : "value_contributed"}`
      : column;
    const value = row[key];
    if (value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  // Rows with nothing to sort by go last in both directions, as in
  // `v11_api.sort_ranking_rows`.
  function sortRankingRows(rows, column, direction, breakdownMode) {
    const sign = direction === "asc" ? 1 : -1;
    rows.sort((left, right) => {
      const a = sortValue(left, column, breakdownMode);
      const b = sortValue(right, column, breakdownMode);
      if (a === null && b !== null) return 1;
      if (b === null && a !== null) return -1;
      return ((a ?? 0) - (b ?? 0)) * sign || Number(left.player_id) - Number(right.player_id);
    });
  }

  function rankingQuery(params) {
    const search = String(params.get("search") ?? "");
    const trimmed = search.trim();
    const sortBy = params.get("sort_by");
    if (sortBy !== null && !SORTABLE_COLUMNS.includes(sortBy)) {
      throw new HttpError(422, "sort column is invalid");
    }
    const sortDirection = params.get("sort_direction");
    if (sortDirection !== null && sortDirection !== "asc" && sortDirection !== "desc") {
      throw new HttpError(422, "sort direction is invalid");
    }
    return {
      seasonEndYear: intOrNull(params.get("season_end_year")),
      schedule: oneOf(params.get("schedule") ?? "all", SCHEDULES, "all"),
      timeMode: oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive"),
      metric: oneOf(params.get("metric") ?? "value_contributed", METRICS, "value_contributed"),
      search,
      sortBy,
      sortDirection: sortDirection === "asc" ? "asc" : "desc",
      targetedNull: trimmed && /^\d+$/.test(trimmed) ? trimmed : null,
    };
  }

  async function rankingSnapshot(io, query) {
    return need(
      io,
      `${DATA_PREFIX}rankings/${query.timeMode}/${query.schedule}/${seasonKey(query.seasonEndYear)}.json`,
      `${label(io)} rankings are not in this site build`,
    );
  }

  const handlers = {
    async "api/sources"(io) {
      return (await optional(io, SOURCES_FILE))
        ?? need(io, `${DATA_PREFIX}sources.json`, "sources");
    },

    async "api/v11/options"(io) {
      return need(io, `${DATA_PREFIX}options.json`, "options");
    },

    async "api/v11/methodology"(io) {
      return need(io, `${DATA_PREFIX}methodology.json`, "methodology");
    },

    async "api/v11/experiment-catalogue"(io) {
      return need(io, `${DATA_PREFIX}catalogue.json`, "catalogue");
    },

    async "api/v11/experiment-packages/seasons"(io) {
      return need(io, `${DATA_PREFIX}package-seasons.json`, "package seasons");
    },

    async "api/v11/experiment-packages/manifest"(io, params) {
      const season = intOrNull(params.get("season"));
      if (season === null) throw new HttpError(422, "season is required");
      return need(
        io,
        `${PACKAGE_PREFIX}${season}/manifest.json`,
        `no experiment package for ${season}`,
      );
    },

    async "api/v11/rankings"(io, params) {
      const query = rankingQuery(params);
      const snapshot = await rankingSnapshot(io, query);
      const limit = clampInt(params.get("limit"), 100, 1, 1000);
      const offset = Math.max(0, intOrNull(params.get("offset")) ?? 0);
      const breakdownMode = oneOf(params.get("breakdown_mode") ?? "vc", ["vc", "wc"], "vc");
      let rows = rankingRowsFor(snapshot, query);
      if (breakdownMode === "wc") rows = rows.map(contextInWinsView);
      if (query.sortBy) {
        sortRankingRows(rows, query.sortBy, query.sortDirection, breakdownMode);
      }
      return {
        source: await source(io),
        season: seasonLabel(query.seasonEndYear),
        season_end_year: query.seasonEndYear,
        phase: SCHEDULE_LABEL[query.schedule],
        time_mode: query.timeMode,
        metric: query.metric,
        breakdown_mode: breakdownMode,
        total_count: rows.length,
        limit,
        offset,
        rows: rows.slice(offset, offset + limit),
      };
    },

    async "api/v11/players"(io, params) {
      const query = rankingQuery(params);
      const snapshot = await rankingSnapshot(io, query);
      const limit = clampInt(params.get("limit"), 100, 1, 1000);
      const offset = Math.max(0, intOrNull(params.get("offset")) ?? 0);
      const rows = rankingRowsFor(snapshot, query);
      // The directory reads the `vc` view, which is what `/api/v11/players`
      // answers with, so a displayed side sorts by its whole-scope amount.
      if (query.sortBy) sortRankingRows(rows, query.sortBy, query.sortDirection, "vc");
      return {
        source: await source(io),
        filters: {
          season_end_year: query.seasonEndYear,
          schedule: query.schedule,
          time_mode: query.timeMode,
          metric: query.metric,
        },
        total: rows.length,
        limit,
        offset,
        coverage: {
          team_ids: "complete_from_player_games",
          win_loss_record: "complete_from_player_games",
          win_side_responsibility: "complete_from_player_games",
        },
        availability: await availability(io),
        rows: rows.slice(offset, offset + limit),
      };
    },

    async "api/v11/top-games"(io, params) {
      const seasonEndYear = intOrNull(params.get("season_end_year"));
      const schedule = oneOf(params.get("schedule") ?? "all", SCHEDULES, "all");
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const outcome = oneOf(params.get("outcome") ?? "both", ["both", "wins", "losses"], "both");
      const limit = clampInt(params.get("limit"), 10, 1, 100);
      const snapshot = await need(
        io,
        `${DATA_PREFIX}top-games/${timeMode}/${schedule}/${outcome}/${seasonKey(seasonEndYear)}.json`,
        `${label(io)} top games are not in this site build`,
      );
      return {
        source: await source(io),
        season: seasonLabel(seasonEndYear),
        phase: SCHEDULE_LABEL[schedule],
        outcome: outcome.charAt(0).toUpperCase() + outcome.slice(1),
        rows: snapshot.rows.slice(0, limit),
      };
    },

    async "api/v11/season-wins-leaders"(io, params) {
      const schedule = oneOf(
        params.get("schedule") ?? "all", ["all", "regular_season", "postseason"], "all",
      );
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const limit = clampInt(params.get("limit"), 25, 1, 60);
      const snapshot = await need(
        io,
        `${DATA_PREFIX}season-wins-leaders/${timeMode}/${schedule}.json`,
        `${label(io)} season leaders are not in this site build`,
      );
      return {
        source: await source(io),
        phase: schedule,
        time_mode: timeMode,
        limit,
        rows: snapshot.rows.slice(0, limit),
      };
    },

    async "api/v11/high-value-records"(io, params) {
      const schedule = oneOf(
        params.get("schedule") ?? "all",
        ["all", "regular_season", "playoffs", "postseason"],
        "all",
      );
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const sortBy = oneOf(
        params.get("sort_by") ?? "games_played",
        ["games_played", "wins", "value_contributed", "wins_contributed", "winning_percentage"],
        "games_played",
      );
      const direction = oneOf(params.get("sort_direction") ?? "desc", ["asc", "desc"], "desc");
      const snapshot = await need(
        io,
        `${DATA_PREFIX}high-value-records/${timeMode}/${schedule}.json`,
        `${label(io)} high-value records are not in this site build`,
      );
      const sign = direction === "asc" ? 1 : -1;
      const rows = snapshot.rows.slice().sort((left, right) => {
        const difference = (Number(left[sortBy]) - Number(right[sortBy])) * sign;
        if (difference) return difference;
        return Number(left.player_id) - Number(right.player_id);
      }).map((row, index) => ({ rank: index + 1, ...row }));
      return {
        source: await source(io),
        threshold: HIGH_VALUE_THRESHOLD,
        phase: schedule,
        time_mode: timeMode,
        sort_by: sortBy,
        sort_direction: direction,
        total_players: rows.length,
        rows,
      };
    },

    async "api/v11/rolling-trends"(io, params) {
      const schedule = oneOf(
        params.get("schedule") ?? "all", ["all", "regular_season", "postseason"], "all",
      );
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const window = intOrNull(params.get("window_years")) ?? 3;
      if (![1, 3, 5].includes(window)) throw new HttpError(422, "rolling trend window is invalid");
      const payload = await need(
        io,
        `${DATA_PREFIX}rolling-trends/${timeMode}/${schedule}/${window}.json`,
        `${label(io)} rolling trends are not in this site build`,
      );
      return { source: await source(io), ...payload };
    },

    async "api/v11/postseason-lift-trends"(io, params) {
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const window = intOrNull(params.get("window_years")) ?? 3;
      if (![1, 3, 5].includes(window)) throw new HttpError(422, "postseason lift window is invalid");
      const payload = await need(
        io,
        `${DATA_PREFIX}postseason-lift-trends/${timeMode}/${window}.json`,
        `${label(io)} postseason lift trends are not in this site build`,
      );
      return { source: await source(io), ...payload };
    },

    async "api/v11/rankings/player-landscape"(io, params) {
      const schedule = oneOf(params.get("schedule") ?? "all", SCHEDULES, "all");
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const requested = params.getAll("season");
      const years = [];
      for (const value of requested) {
        const label = String(value).trim();
        if (label.length === 7 && label[4] === "-" && /^\d{4}$/.test(label.slice(0, 4))) {
          years.push(Number(label.slice(0, 4)) + 1);
        } else if (/^\d{4}$/.test(label)) {
          years.push(Number(label));
        }
      }
      const options = await need(io, `${DATA_PREFIX}options.json`, "options");
      const every = options.seasons.map((entry) => Number(entry.season_end_year));
      const wanted = years.length
        ? [...new Set(years)].sort((left, right) => left - right).filter((year) => every.includes(year))
        : every;
      const rows = [];
      let playerTypes = null;
      // V11 writes a row's style once, in the shared style index, and it is
      // put back here; a statistic without that index publishes whole rows.
      let stylesAttached = true;
      for (const year of wanted) {
        const snapshot = await io.json(
          `${DATA_PREFIX}landscape/${timeMode}/${schedule}/${year}.json`,
        );
        if (snapshot) {
          rows.push(...unpackSnapshot(snapshot).map((row) => ({ ...row })));
          if (snapshot.player_types) playerTypes = snapshot.player_types;
          stylesAttached = stylesAttached && Boolean(snapshot.styles_attached);
        }
      }
      rows.sort((left, right) => (
        Number(left.player_id) - Number(right.player_id)
        || Number(left.season_end_year) - Number(right.season_end_year)
      ));
      if (!stylesAttached) await attachStyles(io, rows, timeMode, schedule);
      return {
        source: await source(io),
        selected_seasons: requested.map((value) => String(value)),
        schedule,
        time_mode: timeMode,
        availability: await availability(io),
        player_types: playerTypes,
        rows,
      };
    },

    async "api/v11/rankings/team-landscape"(io, params) {
      const schedule = oneOf(params.get("schedule") ?? "regular_season", SCHEDULES, "regular_season");
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const requested = params.getAll("season");
      const years = new Set();
      for (const value of requested) {
        const label = String(value).trim();
        if (label.length === 7 && label[4] === "-" && /^\d{4}$/.test(label.slice(0, 4))) {
          years.add(Number(label.slice(0, 4)) + 1);
        } else if (/^\d{4}$/.test(label)) {
          years.add(Number(label));
        }
      }
      const snapshot = await io.json(`${DATA_PREFIX}team-landscape/${timeMode}/${schedule}.json`);
      if (!snapshot) {
        return {
          source: await source(io),
          selected_seasons: requested.map((value) => String(value)),
          schedule,
          time_mode: timeMode,
          availability: await teamAvailability(io),
          team_types: null,
          rows: [],
        };
      }
      const rows = years.size
        ? snapshot.rows.filter((row) => years.has(Number(row.season_end_year)))
        : snapshot.rows;
      return {
        source: await source(io),
        selected_seasons: requested.map((value) => String(value)),
        schedule,
        time_mode: timeMode,
        availability: await teamAvailability(io),
        team_types: snapshot.team_types,
        rows,
      };
    },

    async "api/v11/rankings/player-context"(io, params) {
      const playerId = intOrNull(params.get("player_id"));
      if (playerId === null || playerId < 1) throw new HttpError(422, "player_id is invalid");
      const phase = params.get("phase") ?? "All";
      if (!Object.prototype.hasOwnProperty.call(PHASE_TO_SCHEDULE, phase)) {
        throw new HttpError(422, "phase is invalid");
      }
      const schedule = PHASE_TO_SCHEDULE[phase];
      const label = String(params.get("season") ?? "All Seasons").trim();
      let seasonEndYear = null;
      if (label && label !== "All Seasons") {
        if (label.length !== 7 || label[4] !== "-" || !/^\d{4}$/.test(label.slice(0, 4))) {
          throw new HttpError(422, "season label is invalid");
        }
        seasonEndYear = Number(label.slice(0, 4)) + 1;
      }
      const timeMode = oneOf(
        params.get("garbage_time_mode") ?? "competitive", TIME_MODES, "competitive",
      );
      const breakdownMode = oneOf(params.get("breakdown_mode") ?? "vc", ["vc", "wc"], "vc");
      const page = Math.max(1, intOrNull(params.get("page")) ?? 1);
      const perPage = clampInt(params.get("per_page"), 20, 1, 100);
      const directory = await teamDirectory(io);
      const envelope = await source(io);
      const store = await playerStore(io, timeMode, playerId);
      const scoped = expandStore(store).filter((row) => (
        finite(row.actual_seconds) > 0
        && scheduleKeeps(schedule, row.season_type)
        && (seasonEndYear === null || row.season_end_year === seasonEndYear)
      ));
      const selected = scoped.filter((row) => breakdownMode !== "wc" || row.win_loss);
      const gameCount = selected.length;
      let finalValue = 0;
      let offenseValue = 0;
      let defenseValue = 0;
      for (const row of selected) {
        finalValue += finite(row.value_contributed);
        offenseValue += finite(row.final_offense_value);
        defenseValue += finite(row.final_defense_signed);
      }
      // The scope's totals come from the stored scope sums rather than from
      // adding the per-game amounts, because that is where the API reads them:
      // the summary table widened every float4 before it added it.
      const breakdown = contextIsPublished(envelope)
        ? await contextStore(io, timeMode, playerId)
        : null;
      const totals = breakdown === null
        ? null
        : contextScopeTotals(breakdown, { seasonEndYear, schedule });
      const ordered = selected.slice().sort((left, right) => (
        (left.game_date < right.game_date ? 1 : left.game_date > right.game_date ? -1 : 0)
        || (left.game_id < right.game_id ? 1 : left.game_id > right.game_id ? -1 : 0)
      ));
      const games = ordered.slice((page - 1) * perPage, (page - 1) * perPage + perPage).map((row) => {
        const value = finite(row.value_contributed);
        const game = {
          game_id: row.game_id,
          game_date: row.game_date,
          season_end_year: row.season_end_year,
          season: row.season,
          season_type: row.season_type,
          team_id: row.team_id,
          opponent_id: row.opponent_id,
          player_id: String(playerId),
          player_name: row.player_name,
          win_loss: Boolean(row.win_loss),
          actual_seconds: row.actual_seconds,
          final_value_contributed: row.value_contributed,
          offensive_value_contributed: row.final_offense_value,
          defensive_value_contributed: row.final_defense_signed,
          other_value_contributed: 0.0,
          signed_raw_offense: row.raw_offense,
          signed_raw_defense: row.raw_defense,
          signed_raw_other: row.raw_other,
          offense_component_positive: row.raw_offense_positive,
          offense_component_negative_magnitude: row.raw_offense_negative,
          defense_component_positive: row.raw_defense_positive,
          defense_component_negative_magnitude: row.raw_defense_negative,
          other_component_positive: 0.0,
          other_component_negative_magnitude: 0.0,
          signed_adjusted_offense: row.adjusted_offense,
          signed_adjusted_defense: row.signed_defense,
          signed_adjusted_other: 0.0,
        };
        game.team = directory.team(row.team_id, row.game_date);
        game.opponent = directory.team(row.opponent_id, row.game_date);
        Object.assign(game, contextGameFields(
          breakdown === null ? {} : breakdown.__byGame.get(String(row.game_id)) ?? {},
          value,
        ));
        for (const key of [
          "offense_responsibility_basis",
          "defense_responsibility_basis",
          "other_responsibility_basis",
          "actual_offense_points_on", "expected_offense_points_on",
          "offensive_possessions_on", "actual_opponent_points_on",
          "expected_opponent_points_on", "defensive_possessions_on",
          "opponent_defense_strength_mean", "opponent_offense_strength_mean",
        ]) game[key] = null;
        return addTeamAbbreviations(game, directory);
      });
      const run = (envelope.seasons || []).find(
        (item) => Number(item.season_end_year) === seasonEndYear,
      ) || null;
      const context = contextScopeSummary(
        totals, breakdownMode, finalValue,
        await unavailable(io, "context_decomposition"),
      );
      return {
        source: envelope,
        stat_version: sourceId(io),
        release_id: null,
        run_id: run === null ? null : run.run_id,
        configuration_receipt: null,
        calculation_receipt: run === null ? null : run.content_sha256,
        player_id: String(playerId),
        season: label || "All Seasons",
        phase,
        garbage_time_mode: timeMode,
        breakdown_mode: breakdownMode,
        sides: { offense: offenseValue, defense: defenseValue, other: 0.0 },
        context_decomposition: context.decomposition,
        availability: await availability(io),
        summary: {
          game_count: gameCount,
          final_value: finalValue,
          ...context.summary,
          offense_value: offenseValue,
          defense_value: defenseValue,
          other_value: 0.0,
        },
        pagination: {
          page,
          per_page: perPage,
          total_games: gameCount,
          total_pages: gameCount ? Math.floor((gameCount + perPage - 1) / perPage) : 0,
        },
        games,
      };
    },

    async "api/v11/teams"(io, params) {
      const seasonEndYear = intOrNull(params.get("season_end_year"));
      const schedule = oneOf(params.get("schedule") ?? "all", SCHEDULES, "all");
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const metric = oneOf(params.get("metric") ?? "value_contributed", METRICS, "value_contributed");
      const limit = clampInt(params.get("limit"), 100, 1, 250);
      const offset = Math.max(0, intOrNull(params.get("offset")) ?? 0);
      const snapshot = await need(
        io,
        `${DATA_PREFIX}teams/${timeMode}/${schedule}/${seasonKey(seasonEndYear)}.json`,
        `${label(io)} team totals are not in this site build`,
      );
      const directory = await teamDirectory(io);
      const played = seasonEndYear === null ? null : `${seasonEndYear}-01-01`;
      const ordered = snapshot.rows.slice().sort((left, right) => (
        (Number(right[metric]) - Number(left[metric]))
        || (Number(left.team_id) - Number(right.team_id))
      ));
      let rows = ordered.map((record, index) => {
        const row = addTeamAbbreviations({ ...record }, directory);
        row.rank = index + 1;
        row.team_name = directory.name(row.team_id, played);
        row.name = row.team_name;
        row.id = Number(row.team_id);
        row.abbreviation = row.team_abbreviation;
        return row;
      });
      // A franchise answers to its abbreviation, its city or its nickname,
      // under the site-wide folding rule, so "lal", "Lakers" and
      // "los angeles" are one search.
      const needle = String(params.get("search") ?? "").trim();
      if (needle) {
        rows = rows.filter((row) => nameFold().matchesTeam({
          teamId: row.team_id, name: row.team_name, abbreviation: row.abbreviation,
        }, needle));
      }
      return {
        source: await source(io),
        filters: {
          season_end_year: seasonEndYear,
          schedule,
          time_mode: timeMode,
          metric,
        },
        total: rows.length,
        limit,
        offset,
        availability: await availability(io),
        rows: rows.slice(offset, offset + limit),
      };
    },

    async "api/v11/seasons/story"(io, params, captured) {
      const seasonEndYear = intOrNull(captured.season_end_year);
      if (seasonEndYear === null || seasonEndYear < 2014 || seasonEndYear > 2026) {
        throw new HttpError(422, "season is outside V11");
      }
      const schedule = oneOf(params.get("schedule") ?? "regular_season", SCHEDULES, "regular_season");
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const raw = String(params.get("player_ids") ?? "");
      const parsed = [];
      for (const piece of raw.split(",")) {
        if (!piece.trim()) continue;
        const value = intOrNull(piece);
        if (value === null) throw new HttpError(422, "player_ids must be comma-separated integers");
        if (!parsed.includes(value)) parsed.push(value);
      }
      if (!parsed.length || parsed.length > 20 || parsed.some((value) => value < 1)) {
        throw new HttpError(422, "season-story player IDs are invalid");
      }
      const directory = await teamDirectory(io);
      const rows = [];
      for (const playerId of parsed) {
        const store = await io.json(`${DATA_PREFIX}player/${timeMode}/${playerId}.json`);
        if (!store) continue;
        for (const row of expandStore(store)) {
          if (row.season_end_year !== seasonEndYear) continue;
          if (!scheduleKeeps(schedule, row.season_type)) continue;
          rows.push(addTeamAbbreviations({
            game_id: row.game_id,
            game_date: row.game_date,
            season_end_year: row.season_end_year,
            season_type: row.season_type,
            team_id: row.team_id,
            opponent_id: row.opponent_id,
            player_id: playerId,
            player_name: row.player_name,
            win_loss: Boolean(row.win_loss),
            value_contributed: row.value_contributed,
            wins_contributed: row.wins_contributed,
            offensive_value_contributed: row.final_offense_value,
            defensive_value_contributed: row.final_defense_signed,
            defensive_wins_contributed: row.win_loss ? row.final_defense_signed : 0,
            offensive_wins_contributed: row.win_loss ? row.final_offense_value : 0,
          }, directory));
        }
      }
      rows.sort((left, right) => (
        (left.game_date < right.game_date ? -1 : left.game_date > right.game_date ? 1 : 0)
        || (left.game_id < right.game_id ? -1 : left.game_id > right.game_id ? 1 : 0)
        || (Number(left.player_id) - Number(right.player_id))
      ));
      return { source: await source(io), rows };
    },

    async "api/v11/games/anatomy"(io) {
      // Every player-game of every season would be 33,590 files and most of a
      // gigabyte; the V11 pages declare `player_game_anatomy: false` and never
      // ask for it, so the published site says so rather than shipping it.
      await source(io);
      throw new HttpError(404, "Per-game anatomy is not available on the public site.");
    },

    async "api/v11/players/profile"(io, params, captured) {
      const playerId = intOrNull(captured.player_id);
      if (playerId === null || playerId < 1) throw new HttpError(422, "player_id must be positive");
      const query = rankingQuery(params);
      query.search = String(playerId);
      query.targetedNull = String(playerId);
      // `rank` is a rank *by* the metric the page is showing, over exactly the
      // seasons it has ticked. It was pinned to Value Contributed and to the
      // career, so a profile could print `#1` under a "WC rank" heading for a
      // player who did not lead Wins Contributed.
      const seasonYears = params.getAll("season")
        .map((label) => Number(String(label).slice(0, 4)) + 1)
        .filter((year) => Number.isFinite(year));
      const snapshot = await rankingSnapshot(io, query);
      const entity = rankingRowsFor(snapshot, query)
        .find((row) => Number(row.player_id) === playerId) || null;
      if (entity === null) throw new HttpError(404, `${label(io)} player profile not found`);
      entity.rank_metric = query.metric;
      // A selection of several seasons is ranked over exactly those seasons.
      if (seasonYears.length > 1) {
        entity.rank = await selectionRank(io, query, seasonYears, playerId);
      }
      const directory = await teamDirectory(io);
      const store = await playerStore(io, query.timeMode, playerId);
      const played = expandStore(store).filter((row) => finite(row.actual_seconds) > 0);
      const seasons = playerSeasons(played, query.schedule, directory);
      const components = playerComponents(store, query.seasonEndYear, query.schedule);
      const chart = contributionChart(played, query.seasonEndYear);
      // The seasons the chart draws are the page's selection, or the one
      // season a `season_end_year` request names, exactly as the API reads it.
      chart.by_season = seasonGameSeries(
        played, query.schedule,
        seasonYears.length || query.seasonEndYear === null
          ? seasonYears : [query.seasonEndYear],
        directory,
      );
      const payload = {
        source: await source(io),
        filters: {
          season_end_year: query.seasonEndYear,
          schedule: query.schedule,
          time_mode: query.timeMode,
          metric: "value_contributed",
        },
        state: "ready",
        entity,
        summary: entity,
        seasons: await withSeasonRanks(io, seasons, playerId),
        fingerprint: {
          responsibility: {
            offense: entity.offense_value,
            defense: entity.defense_value,
            other: 0.0,
          },
          context: fingerprintContext(entity),
          sources: components.sources,
          wins_sources: components.wins_sources,
          ...(components.defensive_rebound_split
            ? { defensive_rebound_split: components.defensive_rebound_split } : {}),
        },
        contribution_chart: chart,
        profile_id: `${sourceId(io)}:player:${playerId}:${
          query.seasonEndYear === null ? "career" : query.seasonEndYear
        }:${query.timeMode}:${query.schedule}`,
        archetype: null,
        type_history: [],
        scoring_sources: [],
        playmaking_sources: [],
        similarity: {
          ...await unavailable(io, "similarity"),
          lens: String(params.get("lens") ?? "concept_balanced"),
          matches: [],
        },
        dimensions: [],
        concepts: {},
        defended_shots: [],
        availability: await availability(io),
      };
      if (sourceId(io) !== "v11") {
        const kept = {};
        for (const key of PROFILE_STORE_KEYS) kept[key] = payload[key];
        return { ...kept, ...await publishedProfileBlocks(io, playerId, params) };
      }
      // The page's own season selection travels as repeated `season=` labels;
      // the described panels are built over exactly those seasons.
      query.seasonEndYears = seasonYears;
      // A reader who clicks one season of a wider selection narrows the
      // described blocks to it; the totals and the chart keep the selection.
      // An absent parameter is absent: `Number("") + 1` is 1, which is finite
      // and would have described season 1.
      const chosen = String(params.get("profile_season") ?? "");
      const profileYear = /^\d{4}-\d{2}$/.test(chosen)
        ? Number(chosen.slice(0, 4)) + 1 : null;
      query.pageSeasonEndYears = seasonYears.length
        ? seasonYears
        : (query.seasonEndYear === null ? [] : [query.seasonEndYear]);
      if (profileYear !== null
        && (!seasonYears.length || seasonYears.includes(profileYear))) {
        query.seasonEndYears = [profileYear];
        query.seasonEndYear = profileYear;
      }
      const style = await playerStyle(io, playerId, query, String(params.get("lens") ?? "concept_balanced"));
      if (style !== null) Object.assign(payload, style);
      return payload;
    },

    async "api/v11/players/games"(io, params, captured) {
      const playerId = intOrNull(captured.player_id);
      if (playerId === null || playerId < 1) throw new HttpError(422, "player_id must be positive");
      const seasonEndYear = intOrNull(params.get("season_end_year"));
      const schedule = oneOf(params.get("schedule") ?? "all", SCHEDULES, "all");
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const outcome = oneOf(params.get("outcome") ?? "both", ["both", "wins", "losses"], "both");
      const limit = clampInt(params.get("limit"), 100, 1, 250);
      const offset = Math.max(0, intOrNull(params.get("offset")) ?? 0);
      const directory = await teamDirectory(io);
      const store = await playerStore(io, timeMode, playerId);
      const selected = expandStore(store).filter((row) => (
        finite(row.actual_seconds) > 0
        && scheduleKeeps(schedule, row.season_type)
        && (seasonEndYear === null || row.season_end_year === seasonEndYear)
        && (outcome === "both" || (outcome === "wins" ? row.win_loss : !row.win_loss))
      ));
      const ordered = selected.slice().sort((left, right) => (
        (Number(right.value_contributed) - Number(left.value_contributed))
        || (left.game_id < right.game_id ? -1 : left.game_id > right.game_id ? 1 : 0)
      ));
      const rows = ordered.slice(offset, offset + limit).map((row, index) => addTeamAbbreviations({
        game_id: row.game_id,
        game_date: row.game_date,
        season_end_year: row.season_end_year,
        season: row.season,
        season_type: row.season_type,
        team_id: row.team_id,
        opponent_id: row.opponent_id,
        player_id: playerId,
        player_name: row.player_name,
        win_loss: Boolean(row.win_loss),
        actual_seconds: row.actual_seconds,
        included_seconds: row.included_seconds,
        value_contributed: row.value_contributed,
        wins_contributed: row.wins_contributed,
        offense_value: row.final_offense_value,
        defense_value: row.final_defense_signed,
        other_value: 0.0,
        signed_offense: row.adjusted_offense,
        signed_defense: row.signed_defense,
        total_count: ordered.length,
        rank: offset + index + 1,
        outcome: row.win_loss ? "win" : "loss",
      }, directory));
      return {
        source: await source(io),
        rows,
        total: rows.length ? ordered.length : 0,
        limit,
        offset,
      };
    },

    // A team page has two scopes. The selection — the seasons the page has
    // ticked, its schedule and its game-time view — is rebuilt here from the
    // team's own game store with the server's arithmetic. The profile is one
    // season, and is read from that season's snapshot.
    async "api/v11/teams/profile"(io, params, captured) {
      const teamId = intOrNull(captured.team_id);
      if (teamId === null || teamId < 1) throw new HttpError(422, "team_id must be positive");
      const seasonEndYear = intOrNull(params.get("season_end_year"));
      if (seasonEndYear === null) throw new HttpError(422, "season_end_year is required");
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const schedule = oneOf(params.get("schedule") ?? "regular_season", SCHEDULES, "regular_season");
      const metric = oneOf(params.get("metric") ?? "value_contributed", METRICS, "value_contributed");
      const lens = String(params.get("lens") ?? "concept_balanced");
      const requested = params.getAll("season")
        .map((label) => Number(String(label).slice(0, 4)) + 1)
        .filter((year) => Number.isFinite(year));
      const years = requested.length
        ? [...new Set(requested)].sort((left, right) => left - right)
        : [seasonEndYear];
      const chosenYear = profileYear(params.get("profile_season"), years, seasonEndYear);
      const chartIds = requestedIds(params.get("chart_player_ids"));

      const totals = await teamSeasonTotals(io, teamId, { timeMode, schedule, years });
      const games = totals.reduce((sum, row) => sum + Number(row.games_played || 0), 0);
      if (!games) throw new HttpError(404, `${label(io)} has no team season for this request`);
      const store = await need(
        io,
        `${DATA_PREFIX}team-games/${timeMode}/${teamId}.json`,
        `${label(io)} team games are not in this site build`,
      );
      const wanted = new Set(years);
      const played = expandStore(store).filter((row) => (
        scheduleKeeps(schedule, row.season_type)
        && wanted.has(row.season_end_year)
        && Number(row.actual_seconds) > 0
      ));
      const perSeason = teamPerSeasonRoster(played);
      const roster = foldRoster(perSeason, metric);
      const minutes = roster.reduce((sum, row) => sum + Number(row.minutes_played || 0), 0);
      const value = totals.reduce((sum, row) => sum + Number(row[metric] || 0), 0);
      const wins = totals.reduce((sum, row) => sum + Number(row.wins || 0), 0);

      const published = contextIsPublished(await source(io));
      const contextRows = published
        ? await teamContextRows(io, timeMode, { teamId, years, schedule })
        : null;
      for (const member of roster) {
        member.minute_share = minutes === 0
          ? null : Number(member.minutes_played || 0) / minutes;
        member.selected_for_similarity = false;
        member.context = contextRows?.byPlayer.get(member.player_id) ?? {};
      }
      attachRosterTypes(
        roster, await playerTypeIndex(io, timeMode, styleScope(schedule)), years,
      );
      // A statistic whose style build names a defensive role gives every
      // member one; the build records whether that key is carried and the
      // roles it held (V13 carries the key and names none).
      const rosterRoles = await optional(io, `${DATA_PREFIX}team-roster.json`);
      if (rosterRoles?.defense_role) {
        for (const member of roster) {
          member.defense_role = rosterRoles.roles?.[String(member.player_id)] ?? null;
        }
      }
      const concentration = [1, 3, 5].map((count) => ({
        players: count,
        contribution_share: value === 0 ? null
          : roster.slice(0, count).reduce((sum, row) => sum + Number(row[metric] || 0), 0) / value,
        minutes_share: minutes === 0 ? null
          : roster.slice(0, count).reduce((sum, row) => sum + Number(row.minutes_played || 0), 0) / minutes,
      }));

      const snapshot = await need(
        io,
        `${DATA_PREFIX}team-profile/${timeMode}/${chosenYear}.json`,
        `${label(io)} has no team season for this request`,
      );
      const payload = snapshot.teams[String(teamId)];
      if (!payload) throw new HttpError(404, `${label(io)} has no team season for this request`);
      // A statistic without a team style build (V13) has neither file, so
      // they are not asked for.
      const teamStyles = (await teamAvailability(io)).archetypes?.available !== false;
      const teamTypes = teamStyles
        ? await io.json(`${DATA_PREFIX}team-types/${timeMode}.json`) : null;
      const history = teamStyles
        ? await teamTypeHistory(io, teamId, { timeMode, years, chosenYear }) : null;
      const seasonLabelOf = (year) => `${year - 1}-${String(year).slice(-2)}`;
      return {
        source: await source(io),
        ...payload,
        filters: {
          season_end_year: seasonEndYear,
          schedule,
          time_mode: timeMode,
          metric,
          season_end_years: [...years],
          seasons: years.map(seasonLabelOf),
          profile_season: seasonLabelOf(chosenYear),
          profile_season_end_year: chosenYear,
        },
        state: "ready",
        summary: {
          games_played: games,
          games,
          wins,
          losses: games - wins,
          win_percentage: wins / games,
          minutes,
          unique_players: roster.length,
          value_contributed: totals.reduce((sum, row) => sum + Number(row.value_contributed || 0), 0),
          wins_contributed: totals.reduce((sum, row) => sum + Number(row.wins_contributed || 0), 0),
          offense_value: totals.reduce((sum, row) => sum + Number(row.offense_value || 0), 0),
          defense_value: totals.reduce((sum, row) => sum + Number(row.defense_value || 0), 0),
          other_value: 0.0,
        },
        profile_id: `${sourceId(io)}:team:${teamId}:seasons:${years.join("-")}:${timeMode}:${schedule}`
          + `:profile:${chosenYear}`,
        roster,
        players: roster,
        seasons: teamSeasonRows(totals, perSeason, seasonLabelOf),
        season_rosters: seasonRosters(perSeason, seasonLabelOf),
        concentration,
        scopes: {
          selection: {
            seasons: years.map(seasonLabelOf),
            schedule,
            rule: SELECTION_SCOPE_RULE,
          },
          profile: {
            season: seasonLabelOf(chosenYear),
            season_end_year: chosenYear,
            schedule: "regular_season",
            rule: PROFILE_SCOPE_RULE,
          },
        },
        fingerprint: {
          ...(payload.fingerprint ?? {}),
          ...(published ? { context: contextRows?.team ?? {} } : {}),
        },
        ...teamContribution(played, roster, { metric, years, chartIds, seasonLabelOf }),
        ...(history ?? {}),
        ...(teamTypes ? { team_types: teamTypes } : {}),
        lens,
        availability: await teamAvailability(io),
      };
    },

    async "api/v11/teams/similarity"(io, params, captured) {
      const teamId = intOrNull(captured.team_id);
      if (teamId === null || teamId < 1) throw new HttpError(422, "team_id must be positive");
      const seasonEndYear = intOrNull(params.get("season_end_year"));
      if (seasonEndYear === null) throw new HttpError(422, "season_end_year is required");
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const directory = await teamDirectory(io);
      const entity = directory.team(teamId, `${seasonEndYear}-01-01`);
      const reasons = await need(io, `${DATA_PREFIX}availability.json`, "availability");
      const snapshot = await io.json(
        `${DATA_PREFIX}team-similarity/${timeMode}/${seasonEndYear}.json`,
      );
      const stored = snapshot ? snapshot.teams[String(teamId)] : null;
      return {
        source: await source(io),
        target: {
          team_id: teamId,
          team_name: entity.name,
          team_abbreviation: entity.abbreviation,
          season_end_year: seasonEndYear,
          season: `${seasonEndYear - 1}-${String(seasonEndYear).slice(-2)}`,
          time_mode: timeMode,
        },
        status: "unavailable",
        reason: reasons.similarity.reason,
        matches: [],
        archetype: null,
        archetype_policy: null,
        ...(stored ?? {}),
        ...(stored && stored.status === "available"
          ? { team_types: await io.json(`${DATA_PREFIX}team-types/${timeMode}.json`) }
          : {}),
        lens: String(params.get("lens") ?? "concept_balanced"),
        availability: await teamAvailability(io),
      };
    },

    async "api/v11/teams/games"(io, params, captured) {
      const teamId = intOrNull(captured.team_id);
      if (teamId === null || teamId < 1) throw new HttpError(422, "team_id must be positive");
      const seasonEndYear = intOrNull(params.get("season_end_year"));
      const schedule = oneOf(params.get("schedule") ?? "all", SCHEDULES, "all");
      const timeMode = oneOf(params.get("time_mode") ?? "competitive", TIME_MODES, "competitive");
      const limit = clampInt(params.get("limit"), 250, 1, 250);
      const offset = Math.max(0, intOrNull(params.get("offset")) ?? 0);
      const directory = await teamDirectory(io);
      const store = await need(
        io,
        `${DATA_PREFIX}team-games/${timeMode}/${teamId}.json`,
        `${label(io)} team games are not in this site build`,
      );
      const selected = expandStore(store).filter((row) => (
        scheduleKeeps(schedule, row.season_type)
        && (seasonEndYear === null || row.season_end_year === seasonEndYear)
      ));
      const ordered = selected.slice().sort((left, right) => (
        (Number(right.value_contributed) - Number(left.value_contributed))
        || (left.game_id < right.game_id ? -1 : left.game_id > right.game_id ? 1 : 0)
        || (Number(left.player_id) - Number(right.player_id))
      ));
      const rows = ordered.slice(offset, offset + limit).map((row, index) => addTeamAbbreviations({
        game_id: row.game_id,
        game_date: row.game_date,
        season_end_year: row.season_end_year,
        season: row.season,
        season_type: row.season_type,
        time_mode: timeMode,
        team_id: teamId,
        opponent_id: row.opponent_id,
        player_id: row.player_id,
        player_name: row.player_name,
        win_loss: Boolean(row.win_loss),
        actual_seconds: row.actual_seconds,
        value_contributed: row.value_contributed,
        wins_contributed: row.wins_contributed,
        offense_value: row.final_offense_value,
        defense_value: row.final_defense_signed,
        other_value: 0.0,
        total_count: ordered.length,
        rank: offset + index + 1,
      }, directory));
      return {
        source: await source(io),
        rows,
        total: rows.length ? ordered.length : 0,
        limit,
        offset,
      };
    },
  };

  // --- derived player blocks ---------------------------------------------------

  function fingerprintContext(row) {
    // The six amounts of the profile's own scope, as `v11_entity_api` gives
    // them: taken from the entity ranking row, and empty when the breakdown is
    // not part of this build.
    if (row[`${CONTEXT_FACTORS[0]}_context_value`] === null
      || row[`${CONTEXT_FACTORS[0]}_context_value`] === undefined) return {};
    return Object.fromEntries(
      CONTEXT_FACTORS.map((factor) => [factor, finite(row[`${factor}_context_value`])]),
    );
  }

  // V11's breakdown is served from "breakdown", V13's from "serving"; "none"
  // is the one answer that means the deployment could not publish it.
  function contextIsPublished(envelope) {
    return String(envelope?.context_served_from ?? "none") !== "none";
  }

  async function contextStore(io, timeMode, playerId) {
    // The dialog's own store: per-game amounts keyed by game id, and the
    // scope sums the API reads from its summary table.  Nothing else on the
    // site loads it.
    const payload = await io.json(
      `${DATA_PREFIX}player-context/${timeMode}/${playerId}.json`,
    );
    if (!payload) return null;
    if (!payload.__byGame) {
      const byGame = new Map();
      for (const values of payload.rows ?? []) {
        const row = {};
        payload.columns.forEach((name, index) => { row[name] = values[index + 1]; });
        byGame.set(String(values[0]), row);
      }
      Object.defineProperty(payload, "__byGame", { value: byGame });
    }
    return payload;
  }

  function contextScopeTotals(store, { seasonEndYear, schedule }) {
    // The same grouping the API's summary read does: every stored scope row
    // the filters keep, added up, with the won-game half beside it.
    const columns = store.scope_columns ?? CONTEXT_MEASURES;
    const width = columns.length;
    const totals = {
      value: Object.fromEntries(columns.map((name) => [name, 0])),
      wins: Object.fromEntries(columns.map((name) => [name, 0])),
    };
    for (const values of store.scopes ?? []) {
      if (seasonEndYear !== null && Number(values[0]) !== seasonEndYear) continue;
      if (!scheduleKeeps(schedule, SEASON_TYPES[values[1]])) continue;
      columns.forEach((name, index) => {
        totals.value[name] += finite(values[2 + index]);
        totals.wins[name] += finite(values[2 + width + index]);
      });
    }
    return totals;
  }

  function contextGameFields(row, value) {
    // One game's raw amount, six contributions, group sums and the per-side
    // multiplier percentages the six stored factor logs are exponentials of.
    const share = (amount) => (value === 0 ? null : (100.0 * amount) / value);
    const percentage = (logs) => 100.0 * (Math.exp(logs.reduce((a, b) => a + b, 0)) - 1.0);
    if (row.context_raw_value === undefined || row.context_raw_value === null) {
      const fields = {
        raw_no_context_contribution: value,
        teammate_context_contribution: 0.0,
        opponent_context_contribution: 0.0,
        offense_context: 0.0,
        defense_context: 0.0,
        raw_percent_of_final: value === 0 ? null : 100.0,
        teammate_percent_of_final: value === 0 ? null : 0.0,
        opponent_percent_of_final: value === 0 ? null : 0.0,
        combined_offense_multiplier_percentage: null,
        combined_defense_multiplier_percentage: null,
      };
      for (const factor of CONTEXT_FACTORS) {
        fields[`${factor}_context`] = null;
        fields[`${factor}_multiplier_percentage`] = null;
      }
      return fields;
    }
    const amount = (factor) => finite(row[`context_${factor}`]);
    const log = (factor) => finite(row[`context_log_${factor}`]);
    const offense = CONTEXT_OFFENSE_FACTORS.reduce((total, f) => total + amount(f), 0);
    const defense = CONTEXT_DEFENSE_FACTORS.reduce((total, f) => total + amount(f), 0);
    const fields = {
      raw_no_context_contribution: finite(row.context_raw_value),
      teammate_context_contribution: offense,
      opponent_context_contribution: defense,
      offense_context: offense,
      defense_context: defense,
      raw_percent_of_final: share(finite(row.context_raw_value)),
      teammate_percent_of_final: share(offense),
      opponent_percent_of_final: share(defense),
      combined_offense_multiplier_percentage: percentage(
        CONTEXT_OFFENSE_FACTORS.map(log),
      ),
      combined_defense_multiplier_percentage: percentage(
        CONTEXT_DEFENSE_FACTORS.map(log),
      ),
    };
    for (const factor of CONTEXT_FACTORS) {
      fields[`${factor}_context`] = amount(factor);
      fields[`${factor}_multiplier_percentage`] = percentage([log(factor)]);
    }
    return fields;
  }

  function contextScopeSummary(totals, breakdownMode, finalValue, reason) {
    // The dialog's `context_decomposition` block and its sixteen-key summary,
    // in the shape `v11_entity_api._context_scope_summary` builds.
    const share = (amount) => (finalValue === 0 ? null : (100.0 * amount) / finalValue);
    if (totals === null) {
      const summary = {
        raw_no_context_value: finalValue,
        teammate_context_value: 0.0,
        opponent_context_value: 0.0,
        offense_context_value: 0.0,
        defense_context_value: 0.0,
        raw_no_context_pct: finalValue === 0 ? null : 100.0,
        teammate_context_pct: finalValue === 0 ? null : 0.0,
        opponent_context_pct: finalValue === 0 ? null : 0.0,
      };
      for (const factor of CONTEXT_FACTORS) summary[`${factor}_context_value`] = 0.0;
      return { decomposition: reason, summary };
    }
    const chosen = breakdownMode === "wc" ? "wins" : "value";
    const selected = totals[chosen];
    const groups = {};
    const winsGroups = {};
    for (const [side, factors] of [
      ["offense", CONTEXT_OFFENSE_FACTORS], ["defense", CONTEXT_DEFENSE_FACTORS],
    ]) {
      groups[side] = factors.reduce((total, f) => total + totals.value[f], 0);
      winsGroups[side] = factors.reduce((total, f) => total + totals.wins[f], 0);
    }
    const offense = chosen === "wins" ? winsGroups.offense : groups.offense;
    const defense = chosen === "wins" ? winsGroups.defense : groups.defense;
    const summary = {
      raw_no_context_value: selected.raw_value,
      teammate_context_value: offense,
      opponent_context_value: defense,
      offense_context_value: offense,
      defense_context_value: defense,
      raw_no_context_pct: share(selected.raw_value),
      teammate_context_pct: share(offense),
      opponent_context_pct: share(defense),
    };
    for (const factor of CONTEXT_FACTORS) {
      summary[`${factor}_context_value`] = selected[factor];
    }
    return {
      decomposition: {
        available: true,
        reason: null,
        factors: [...CONTEXT_FACTORS],
        offense_factors: [...CONTEXT_OFFENSE_FACTORS],
        defense_factors: [...CONTEXT_DEFENSE_FACTORS],
        selected: chosen,
        value: { ...totals.value },
        wins: { ...totals.wins },
        groups,
        wins_groups: winsGroups,
      },
      summary,
    };
  }

  function playerStore(io, timeMode, playerId) {
    return need(
      io,
      `${DATA_PREFIX}player/${timeMode}/${playerId}.json`,
      `${label(io)} player profile not found`,
    );
  }

  function playerSeasons(playedRows, schedule, directory) {
    const groups = new Map();
    for (const row of playedRows) {
      if (!scheduleKeeps(schedule, row.season_type)) continue;
      const year = row.season_end_year;
      let group = groups.get(year);
      if (!group) {
        group = {
          season_end_year: year,
          season: seasonLabel(year),
          games_played: 0,
          minutes_played: 0,
          seconds_played: 0,
          value_contributed: 0,
          wins_contributed: 0,
          offense_value: 0,
          defense_value: 0,
          other_value: 0.0,
          team_ids: new Set(),
        };
        groups.set(year, group);
      }
      group.games_played += 1;
      group.seconds_played += finite(row.actual_seconds);
      group.value_contributed += finite(row.value_contributed);
      group.wins_contributed += finite(row.wins_contributed);
      group.offense_value += finite(row.final_offense_value);
      group.defense_value += finite(row.final_defense_signed);
      group.team_ids.add(Number(row.team_id));
    }
    return [...groups.values()]
      .sort((left, right) => left.season_end_year - right.season_end_year)
      .map((group) => addTeamAbbreviations({
        ...group,
        minutes_played: group.seconds_played / 60.0,
        team_ids: [...group.team_ids].sort((left, right) => left - right),
      }, directory));
  }

  // A store names its own components when they are not V11's thirteen (V13
  // has seventeen), followed by the columns that split another category —
  // V13's contested and uncontested defensive rebounds, published beside the
  // components exactly as `v11_api.split_block` publishes them.
  function playerComponents(store, seasonEndYear, schedule) {
    const components = store.component_columns ?? COMPONENTS;
    const split = store.split_columns ?? [];
    const every = [...components, ...split];
    const totals = {};
    const wins = {};
    for (const key of every) {
      totals[key] = 0;
      wins[key] = 0;
    }
    for (const group of store.components || []) {
      const [year, typeIndex, won, values] = group;
      if (seasonEndYear !== null && year !== seasonEndYear) continue;
      if (!scheduleKeeps(schedule, SEASON_TYPES[typeIndex])) continue;
      for (let index = 0; index < every.length; index += 1) {
        totals[every[index]] += values[index];
        if (won) wins[every[index]] += values[index];
      }
    }
    const answer = {
      sources: components.map((key) => ({ key, value: totals[key] })),
      wins_sources: components.map((key) => ({ key, value: wins[key] })),
    };
    if (split.length) {
      answer.defensive_rebound_split = {
        of: ["defensive_rebounds", "defensive_boxouts"],
        contested: totals.defensive_rebounds_contested ?? 0.0,
        uncontested: totals.defensive_rebounds_uncontested ?? 0.0,
      };
    }
    return answer;
  }

  const CHART_SCHEDULES = [
    ["full", "Full season", "all"],
    ["regular_season", "Regular season", "regular_season"],
    ["postseason", "Postseason", "postseason"],
  ];

  function contributionChart(playedRows, seasonEndYear) {
    if (seasonEndYear === null) {
      const years = [...new Set(playedRows.map((row) => row.season_end_year))]
        .sort((left, right) => left - right);
      const schedules = CHART_SCHEDULES.map(([identifier, label, schedule]) => {
        let valueTotal = 0;
        let winsTotal = 0;
        const points = [];
        for (const year of years) {
          let value = 0;
          let wins = 0;
          for (const row of playedRows) {
            if (row.season_end_year !== year) continue;
            if (!scheduleKeeps(schedule, row.season_type)) continue;
            value += finite(row.value_contributed);
            wins += finite(row.wins_contributed);
          }
          valueTotal += value;
          winsTotal += wins;
          points.push({
            season_end_year: year,
            season: seasonLabel(year),
            value_contributed: value,
            wins_contributed: wins,
            cumulative_value_contributed: valueTotal,
            cumulative_wins_contributed: winsTotal,
          });
        }
        return { id: identifier, label, points };
      });
      return { grain: "season", selected_season_end_year: null, schedules };
    }
    const rows = playedRows
      .filter((row) => row.season_end_year === seasonEndYear)
      .sort((left, right) => (
        (left.game_date < right.game_date ? -1 : left.game_date > right.game_date ? 1 : 0)
        || (left.game_id < right.game_id ? -1 : left.game_id > right.game_id ? 1 : 0)
      ));
    const schedules = CHART_SCHEDULES.map(([identifier, label, schedule]) => {
      let valueTotal = 0;
      let winsTotal = 0;
      const points = [];
      for (const row of rows) {
        if (!scheduleKeeps(schedule, row.season_type)) continue;
        valueTotal += finite(row.value_contributed);
        winsTotal += finite(row.wins_contributed);
        points.push({
          game_id: row.game_id,
          game_date: row.game_date,
          season_end_year: row.season_end_year,
          season: row.season,
          season_type: row.season_type,
          value_contributed: row.value_contributed,
          wins_contributed: row.wins_contributed,
          cumulative_value_contributed: valueTotal,
          cumulative_wins_contributed: winsTotal,
        });
      }
      return { id: identifier, label, points };
    });
    return { grain: "game", selected_season_end_year: seasonEndYear, schedules };
  }

  // --- shared payload pieces ---------------------------------------------------

  function source(io) {
    return need(io, `${DATA_PREFIX}source.json`, "source");
  }

  async function teamDirectory(io) {
    const payload = await need(io, `${DATA_PREFIX}team-directory.json`, "team directory");
    if (!payload.__directory) {
      Object.defineProperty(payload, "__directory", { value: makeDirectory(payload) });
    }
    return payload.__directory;
  }

  async function availability(io) {
    const reasons = await need(io, `${DATA_PREFIX}availability.json`, "availability");
    const payload = {};
    for (const key of Object.keys(reasons)) payload[key] = { ...reasons[key] };
    return payload;
  }

  // The team routes report the team style build, which a statistic may not
  // have (V13 types players only); an older tree has one list for both.
  async function teamAvailability(io) {
    const reasons = await optional(io, `${DATA_PREFIX}availability-team.json`);
    if (!reasons) return availability(io);
    const payload = {};
    for (const key of Object.keys(reasons)) payload[key] = { ...reasons[key] };
    return payload;
  }

  async function unavailable(io, key) {
    const reasons = await need(io, `${DATA_PREFIX}availability.json`, "availability");
    return { ...reasons[key] };
  }

  // --- player and team styles ----------------------------------------------------
  // The style index holds every description of one kind for one game-time view
  // and one schedule scope. The profile page's style blocks are derived from it
  // here, exactly as the server derives them from the same rows.

  function styleScope(schedule) {
    if (schedule === "regular_season") return "regular_season";
    if (schedule === "playoffs" || schedule === "play_in" || schedule === "postseason") {
      return "postseason";
    }
    return "all";
  }

  function catalogueOf(index) {
    // `v11_entity_api._catalogue` publishes the half-distance a similarity
    // score is scaled by inside the catalogue; the stored index keeps it
    // beside the model, so it is put back in the same place here.
    return {
      ...index.model,
      similarity: {
        ...(index.model.similarity ?? {}),
        half_distance: index.similarity_half_distance,
      },
    };
  }

  // The style index is published as a small model beside one file per season,
  // because a type map only ever draws the seasons in view and the whole index
  // is the heaviest thing this site holds. `years` names the seasons a caller
  // needs; leaving it out reads every season, which is what a profile's
  // most-similar list across the whole history genuinely needs.
  //
  // Every file goes through `io.json`, which keeps what it has already read, so
  // two panels of the same page never fetch the same season twice.
  function unpackStyleRows(payload) {
    if (!payload) return [];
    if (!payload.__rows) {
      const columns = payload.columns;
      const rows = payload.rows.map((values) => {
        const row = {};
        columns.forEach((name, index) => { row[name] = values[index]; });
        return row;
      });
      Object.defineProperty(payload, "__rows", { value: rows });
    }
    return payload.__rows;
  }

  async function styleIndex(io, kind, timeMode, scope, years = null) {
    const prefix = `${DATA_PREFIX}styles/${kind}/${timeMode}/${scope}`;
    const model = await io.json(`${prefix}/model.json`);
    if (!model) return null;
    const published = (model.seasons ?? []).map(Number);
    const wanted = years === null
      ? published
      : published.filter((year) => years.has(Number(year)));
    const shards = await Promise.all(
      wanted.map((year) => io.json(`${prefix}/${year}.json`)),
    );
    const rows = [];
    for (const shard of shards) rows.push(...unpackStyleRows(shard));
    // The server reads the index in one order — entity, then season — and every
    // list derived from it inherits that order, so the shards are put back into
    // it rather than into the order they arrived in.
    rows.sort((left, right) => (
      Number(left.entity_id) - Number(right.entity_id)
      || Number(left.season_end_year) - Number(right.season_end_year)
    ));
    return { ...model, __rows: rows };
  }

  /** The distance the server measures: root mean square over shared measurements. */
  function maskedDistance(left, right) {
    let total = 0;
    let shared = 0;
    for (let index = 0; index < left.length; index += 1) {
      const a = left[index];
      const b = right[index];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      total += (a - b) * (a - b);
      shared += 1;
    }
    return shared === 0 ? null : Math.sqrt(total / shared);
  }

  function similarityScore(distance, half) {
    return 100 * Math.exp(-Math.LN2 * (distance / half) * (distance / half));
  }

  function nearestType(model, vector) {
    let best = null;
    let runnerUp = null;
    let index = -1;
    model.centroids.forEach((centre, position) => {
      const distance = maskedDistance(vector, centre);
      if (distance === null) return;
      if (best === null || distance < best) {
        runnerUp = best;
        best = distance;
        index = position;
      } else if (runnerUp === null || distance < runnerUp) {
        runnerUp = distance;
      }
    });
    if (index < 0) return null;
    const confidence = runnerUp === null ? 1 : (runnerUp <= 0 ? 0 : Math.max(0, 1 - best / runnerUp));
    return { index, confidence };
  }

  function percentileOf(ladder, value) {
    if (!ladder.length) return null;
    let below = 0;
    let equal = 0;
    for (const item of ladder) {
      if (item < value) below += 1;
      else if (item === value) equal += 1;
    }
    return (below + 0.5 * equal) / ladder.length;
  }

  function featureConcept(feature) {
    if (feature.key.startsWith("shot_share_") || feature.key.startsWith("type_minute_share_")) {
      return "shot_and_lineup_mix";
    }
    return { offense: "offence", defense: "defence", role: "role_and_shape" }[feature.side];
  }

  // A percentile is a position inside a season's own league, and a span has no
  // single league, so a span's percentile is the minutes-weighted mean of the
  // player's within-season percentiles — the server's own published rule.
  function spanPercentile(selected, laddersBySeason, index) {
    let weight = 0;
    let total = 0;
    for (const row of selected) {
      const ladders = laddersBySeason.get(row.season_end_year);
      if (!ladders || index >= ladders.length) continue;
      const value = row.feature_values[index];
      if (value === null || value === undefined) continue;
      const place = percentileOf(ladders[index], value);
      if (place === null || place === undefined) continue;
      total += place * Number(row.minutes);
      weight += Number(row.minutes);
    }
    return weight <= 0 ? null : total / weight;
  }

  function laddersFor(rows, features) {
    return features.map((_feature, index) => rows
      .map((item) => item.feature_values[index])
      .filter((value) => value !== null && value !== undefined)
      .sort((left, right) => left - right));
  }

  function styleDimensions(row, features, population, selected = null, bySeason = null) {
    const ladders = laddersFor(population, features);
    const laddersBySeason = new Map();
    if (selected && selected.length > 1 && bySeason) {
      for (const [year, rows] of bySeason) {
        laddersBySeason.set(year, laddersFor(rows, features));
      }
    }
    const spans = laddersBySeason.size > 0;
    return features.map((feature, index) => {
      const value = row.feature_values[index];
      const available = value !== null && value !== undefined;
      const z = row.feature_z[index];
      return {
        key: feature.key,
        label: feature.label,
        side: feature.side,
        meaning: feature.meaning,
        unit: feature.unit,
        concept_group: featureConcept(feature),
        value: available ? value : null,
        per36: available ? value : null,
        z: available && z !== null ? z : null,
        percentile: !available ? null
          : spans ? spanPercentile(selected, laddersBySeason, index)
            : percentileOf(ladders[index], value),
        available,
        availability_coverage: available ? 1.0 : 0.0,
        availability_rule: available
          ? "measured from this season's own recorded evidence"
          : "this season does not record it, so it is missing rather than zero",
        similarity_eligible: available,
        similarity_value: available && z !== null ? z : null,
      };
    });
  }

  function styleSummary(row, types, seasonLabelFor) {
    const entry = types[row.type_id] ?? {};
    return {
      id: row.type_id,
      label: entry.label ?? row.type_id,
      description: entry.description ?? null,
      confidence: row.type_confidence,
      provisional: Boolean(row.provisional),
      season: seasonLabelFor(row.season_end_year),
      season_end_year: row.season_end_year,
    };
  }

  function styleArchetype(row, types, seasonLabelFor) {
    const entry = types[row.type_id] ?? {};
    return {
      ...styleSummary(row, types, seasonLabelFor),
      stable_cluster_id: row.type_id,
      representative_name: entry.label ?? row.type_id,
      traits: (entry.defining_features ?? []).map((item) => ({
        direction: item.direction, dimension_key: item.label,
      })),
      x: row.type_x,
      y: row.type_y,
      offense_shape: row.offense_shape,
      defense_shape: row.defense_shape,
    };
  }

  function nearestRows(target, candidates, half, exclude, limit) {
    const scored = [];
    for (const row of candidates) {
      if (row.entity_id === exclude[0] && row.season_end_year === exclude[1]) continue;
      const distance = maskedDistance(target, row.feature_z);
      if (distance === null) continue;
      scored.push({ distance, row });
    }
    scored.sort((left, right) => (
      left.distance - right.distance
      || left.row.entity_id - right.row.entity_id
      || left.row.season_end_year - right.row.season_end_year
    ));
    return scored.slice(0, limit).map((item) => ({
      ...item, similarity: similarityScore(item.distance, half),
    }));
  }

  const SCORING_SOURCE_META = [
    ["putback", "Putbacks and tip-ins", "field_goals"],
    ["alley_oop_cut", "Alley-oops and cuts", "field_goals"],
    ["dunk", "Dunks", "field_goals"],
    ["layup", "Layups and finger rolls", "field_goals"],
    ["floater", "Floaters and runners", "field_goals"],
    ["hook", "Hook shots", "field_goals"],
    ["pullup_stepback", "Pull-ups and step-backs", "field_goals"],
    ["turnaround_fade", "Turnarounds and fadeaways", "field_goals"],
    ["spotup_jumper", "Spot-up and catch-and-shoot jumpers", "field_goals"],
    ["unclassified_shot", "Shot type not recorded", "field_goals"],
    ["free_throws", "Free throws", "not_a_field_goal"],
    ["shooting_fouls_drawn", "Shooting fouls drawn", "not_a_field_goal"],
    ["awarded_points", "Awarded points", "not_a_field_goal"],
  ];
  const PLAYMAKING_SOURCE_META = [
    ["assist_field_goal", "Assists on field goals"],
    ["assist_free_throw", "Passes that drew shooting fouls"],
    ["screen_assist", "Screen assists"],
  ];
  const SOURCE_MEANINGS = {
    putback: "Shots taken straight back up after an offensive rebound.",
    alley_oop_cut: "Finishes created by moving without the ball.",
    dunk: "Dunks that are neither lobs nor putbacks.",
    layup: "Layups, reverses and finger rolls, driving or standing.",
    floater: "Soft shots thrown up over a defender on the move.",
    hook: "Hooks and jump hooks from the post.",
    pullup_stepback: "Jump shots a player creates for himself off the dribble.",
    turnaround_fade: "Jump shots taken while turning or falling away from the basket.",
    spotup_jumper: "Jump shots taken without creating the space first.",
    unclassified_shot: "Attempts whose action type the source feed did not record.",
    free_throws: "What his free throws added or cost, both halves together.",
    shooting_fouls_drawn: "Points kept alive by drawing a foul on a shot.",
    awarded_points: "Points the officials awarded rather than shot for.",
    assist_field_goal: "Passes that led straight to a made field goal.",
    assist_free_throw: "Passes that ended in a shooting foul.",
    screen_assist: "Screens that freed the scorer.",
  };

  // The plain sentence the free-throw row carries, word for word the one the
  // server publishes.
  const FREE_THROW_NOTE = "A trip to the line is judged against what that trip "
    + "was expected to produce. Trips that beat it add value; trips that fall "
    + "short subtract it. A very good shooter who goes to the line often still "
    + "has some short trips, so both halves are shown.";

  // A share is the family's part of the whole a player produced, negatives
  // included, so the shares add to exactly one.
  function shareOf(value, total) {
    return total === 0 ? null : value / total;
  }

  function sourceRows(values, attempts, minutes, freeThrowDetail) {
    let total = 0;
    for (const value of values) total += Number(value ?? 0);
    const per36 = minutes <= 0 ? 0 : 36 / minutes;
    const halves = Array.isArray(freeThrowDetail) ? freeThrowDetail : [];
    return SCORING_SOURCE_META.map(([family, label, kind], index) => {
      const value = Number(values[index] ?? 0);
      const row = {
        family,
        label,
        meaning: SOURCE_MEANINGS[family],
        kind,
        value,
        share: shareOf(value, total),
        per36: value * per36,
        attempts: attempts[index] === null || attempts[index] === undefined
          ? null : Number(attempts[index]),
        basis: kind === "field_goals"
          ? "attempt_weighted_attribution" : "scaled_to_published_total",
      };
      if (family === "free_throws") {
        row.surplus_value = Number(halves[0] ?? 0);
        row.shortfall_value = Number(halves[1] ?? 0);
        row.surplus_trips = Number(halves[2] ?? 0);
        row.shortfall_trips = Number(halves[3] ?? 0);
        row.note = FREE_THROW_NOTE;
      }
      return row;
    });
  }

  function playmakingRows(values, minutes) {
    let total = 0;
    for (const value of values) total += Number(value ?? 0);
    const per36 = minutes <= 0 ? 0 : 36 / minutes;
    return PLAYMAKING_SOURCE_META.map(([family, label], index) => {
      const value = Number(values[index] ?? 0);
      return {
        family,
        label,
        meaning: SOURCE_MEANINGS[family],
        kind: "playmaking",
        value,
        share: shareOf(value, total),
        per36: value * per36,
        basis: family === "screen_assist" ? "exact" : "scaled_to_published_total",
      };
    });
  }

  /** One row's measurements, leaving out what its season does not record. */
  function descriptionBlock(row, features) {
    const output = {};
    features.forEach((feature, index) => {
      const value = row.feature_values[index];
      const z = row.feature_z[index];
      if (value === null || value === undefined || z === null || z === undefined) return;
      output[feature.key] = { per36: value, z };
    });
    return output;
  }

  /** Put each landscape row's style back on it from the shared style index. */
  async function attachStyles(io, rows, timeMode, schedule) {
    for (const row of rows) {
      row.player_type = null;
      row.type_x = null;
      row.type_y = null;
      row.offense_shape = null;
      row.defense_shape = null;
      row.description = {};
    }
    if (!rows.length) return;
    // A landscape is one or more named seasons, so only those seasons of the
    // style index are read — a season map costs a season, not thirteen.
    const years = new Set(rows.map((row) => Number(row.season_end_year)));
    const index = await styleIndex(io, "player", timeMode, styleScope(schedule), years);
    if (index === null) return;
    const types = {};
    for (const entry of index.model.types) types[entry.id] = entry;
    const seasonLabelFor = (year) => `${year - 1}-${String(year).slice(-2)}`;
    const stored = new Map();
    for (const item of index.__rows) {
      stored.set(`${item.entity_id}:${item.season_end_year}`, item);
    }
    for (const row of rows) {
      const item = stored.get(`${Number(row.player_id)}:${Number(row.season_end_year)}`);
      if (!item) continue;
      row.player_type = styleSummary(item, types, seasonLabelFor);
      row.type_x = item.type_x;
      row.type_y = item.type_y;
      row.offense_shape = item.offense_shape;
      row.defense_shape = item.defense_shape;
      row.description = descriptionBlock(item, index.model.features);
    }
  }

  // Where a defended shot was taken from, in the order the evidence stores it.
  const DEFENDED_SHOT_LOCATIONS = [
    ["at_rim", "At the rim"],
    ["under_six", "Inside six feet"],
    ["six_to_ten", "Six to ten feet"],
    ["ten_to_fifteen", "Ten to fifteen feet"],
    ["long_two", "Long two-pointers"],
    ["two_point_unclassified", "Two-pointers, area not recorded"],
    ["three_pointer", "Three-pointers"],
  ];
  const ASSIST_ZONES = [
    ["at_rim", "At the rim"],
    ["other_two", "Other two-pointers"],
    ["three", "Three-pointers"],
    ["unclassified", "Shot type not recorded"],
  ];
  const ASSIST_COLUMNS = SCORING_SOURCE_META
    .filter(([, , kind]) => kind === "field_goals")
    .map(([family]) => `family@${family}`)
    .concat(ASSIST_ZONES.map(([zone]) => `zone@${zone}`));
  const CREATED_SHOT_NOTE = "A pass that led to a field goal is sorted by the "
    + "shot it created: the count of each kind is exact, and the value each kind "
    + "produced carries the ledger's own proportions scaled onto the published "
    + "assist value. Screens and passes that drew a shooting foul have no single "
    + "shot at the other end, so they are not split.";

  /** The stored created-shot split, in the shape the server publishes. */
  function createdShotRows(values, counts, minutes) {
    const per36 = minutes <= 0 ? 0 : 36 / minutes;
    const block = (prefix, entries) => {
      const rows = entries.map(([family, label, meaning]) => {
        const position = ASSIST_COLUMNS.indexOf(`${prefix}@${family}`);
        const value = Number((values ?? [])[position] ?? 0);
        return {
          family,
          label,
          meaning,
          kind: prefix === "family" ? "created_shot" : "created_shot_zone",
          value,
          per36: value * per36,
          assists: Number((counts ?? [])[position] ?? 0),
          basis: "ledger_proportion_scaled_to_published_total",
        };
      });
      let total = 0;
      for (const row of rows) total += row.value;
      for (const row of rows) row.share = shareOf(row.value, total);
      return rows;
    };
    return {
      by_created_shot: block("family", SCORING_SOURCE_META
        .filter(([, , kind]) => kind === "field_goals")
        .map(([family, label]) => [family, label, SOURCE_MEANINGS[family]])),
      by_created_shot_zone: block("zone", ASSIST_ZONES
        .map(([zone, label]) => [zone, label,
          `Passes that created a shot from ${label.toLowerCase()}.`])),
    };
  }

  /** The stored defended-shot table, one row per location that has evidence. */
  // Every player's rank by Wins Contributed inside each season, at one fixed
  // scope — the full season on competitive minutes — read from one small store
  // rather than from thirteen ranking snapshots.
  async function withSeasonRanks(io, seasons, playerId) {
    if (!seasons.length) return seasons;
    const store = await optional(io, `${DATA_PREFIX}player-season-ranks.json`);
    if (store === null) return seasons;
    const ranks = new Map((store.rows ?? []).map(
      ([year, playerIdentity, rank]) => [`${year}:${playerIdentity}`, rank],
    ));
    return seasons.map((row) => ({
      ...row,
      wins_contributed_rank: ranks.get(`${row.season_end_year}:${playerId}`) ?? null,
    }));
  }

  // Every selected season's games, numbered 1..N inside its own season, which
  // is what the contribution chart draws one line per season against.
  function seasonGameSeries(playedRows, schedule, seasonYears, directory) {
    const wanted = new Set(seasonYears ?? []);
    const kept = playedRows
      .filter((row) => scheduleKeeps(schedule, row.season_type))
      .filter((row) => !wanted.size || wanted.has(Number(row.season_end_year)))
      .sort((left, right) => left.season_end_year - right.season_end_year
        || String(left.game_date).localeCompare(String(right.game_date))
        || String(left.game_id).localeCompare(String(right.game_id)));
    const seasons = [];
    const index = new Map();
    for (const row of kept) {
      const year = Number(row.season_end_year);
      let bucket = index.get(year);
      if (!bucket) {
        bucket = { season: seasonLabel(year), season_end_year: year, games: [] };
        index.set(year, bucket);
        seasons.push(bucket);
      }
      const value = finite(row.value_contributed);
      const wins = finite(row.wins_contributed);
      const previous = bucket.games[bucket.games.length - 1] ?? null;
      const named = addTeamAbbreviations({
        team_id: row.team_id, opponent_id: row.opponent_id,
      }, directory);
      bucket.games.push({
        game_number: bucket.games.length + 1,
        game_id: row.game_id,
        game_date: row.game_date,
        season: bucket.season,
        season_end_year: year,
        season_type: row.season_type,
        postseason: row.season_type === "PlayIn" || row.season_type === "Playoffs",
        team_abbreviation: named.team_abbreviation ?? null,
        opponent_abbreviation: named.opponent_abbreviation ?? null,
        result: row.win_loss ? "win" : "loss",
        value_contributed: value,
        wins_contributed: wins,
        cumulative_value_contributed: value + (previous ? previous.cumulative_value_contributed : 0),
        cumulative_wins_contributed: wins + (previous ? previous.cumulative_wins_contributed : 0),
      });
    }
    return seasons;
  }

  function defendedShotRows(values, minutes) {
    const per36 = minutes <= 0 ? 0 : 36 / minutes;
    // How his defended shots were spread across the floor: a share of his own
    // attempts, which is a different fact from a place in the league.
    let totalAttempts = 0;
    DEFENDED_SHOT_LOCATIONS.forEach((_entry, position) => {
      const base = position * 3;
      if (values && base < values.length) totalAttempts += Number(values[base] ?? 0);
    });
    const rows = [];
    DEFENDED_SHOT_LOCATIONS.forEach(([location, label], position) => {
      const base = position * 3;
      if (!values || base + 2 >= values.length) return;
      const attempts = Number(values[base] ?? 0);
      const missCredit = Number(values[base + 1] ?? 0);
      const makePenalty = Number(values[base + 2] ?? 0);
      if (attempts <= 0 && missCredit === 0 && makePenalty === 0) return;
      const net = missCredit + makePenalty;
      rows.push({
        location,
        label,
        attempts,
        miss_credit: missCredit,
        make_penalty: makePenalty,
        net,
        net_per36: net * per36,
        value_per_attempt: attempts <= 0 ? null : net / attempts,
        attempt_share: totalAttempts <= 0 ? null : attempts / totalAttempts,
        gross_miss_credit: missCredit,
        gross_make_penalty: makePenalty,
        net_value: net,
        reported_fga: attempts,
        scorable_fga: attempts,
      });
    });
    return rows;
  }

  /** Several described seasons read as one span, the server's own arithmetic. */
  function spanRow(rows, features) {
    if (rows.length === 1) return rows[0];
    const ordered = [...rows].sort((a, b) => a.season_end_year - b.season_end_year);
    let minutes = 0;
    for (const row of ordered) minutes += Number(row.minutes);
    const weighted = (read) => {
      let weight = 0;
      let total = 0;
      for (const row of ordered) {
        const value = read(row);
        if (value === null || value === undefined || !Number.isFinite(Number(value))) continue;
        total += Number(value) * Number(row.minutes);
        weight += Number(row.minutes);
      }
      return weight <= 0 ? null : total / weight;
    };
    const summed = (column) => {
      const width = Math.max(...ordered.map((row) => (row[column] ?? []).length), 0);
      const output = [];
      for (let index = 0; index < width; index += 1) {
        let total = 0;
        let seen = false;
        for (const row of ordered) {
          const value = (row[column] ?? [])[index];
          if (value === null || value === undefined) continue;
          total += Number(value);
          seen = true;
        }
        output.push(seen ? total : null);
      }
      return output;
    };
    const last = ordered[ordered.length - 1];
    const span = {
      entity_id: last.entity_id,
      name: last.name,
      team_ids: [...new Set(ordered.flatMap((row) => row.team_ids ?? []))].sort((a, b) => a - b),
      season_end_year: last.season_end_year,
      games_played: ordered.reduce((total, row) => total + Number(row.games_played), 0),
      minutes,
      provisional: ordered.some((row) => Boolean(row.provisional)),
    };
    for (const column of ["scoring_values", "scoring_attempts", "playmaking_values",
      "free_throw_detail", "assist_shot_values", "assist_shot_counts",
      "defended_shot_values", "extra_values"]) {
      span[column] = summed(column);
    }
    for (const column of ["feature_values", "feature_z"]) {
      span[column] = features.map((feature, index) => weighted(
        (row) => (row[column] ?? [])[index],
      ));
    }
    for (const column of ["type_x", "type_y", "offense_shape", "defense_shape",
      "type_confidence"]) {
      span[column] = weighted((row) => row[column]) ?? 0;
    }
    const attempts = span.scoring_attempts;
    let styleTotal = 0;
    SCORING_SOURCE_META.forEach(([family, , kind], index) => {
      if (kind === "field_goals" && family !== "unclassified_shot") {
        styleTotal += Number(attempts[index] ?? 0);
      }
    });
    features.forEach((feature, index) => {
      const key = String(feature.key ?? "");
      if (!key.startsWith("shot_share_")) return;
      const family = key.slice("shot_share_".length);
      const position = SCORING_SOURCE_META.findIndex(([name]) => name === family);
      if (position < 0) return;
      span.feature_values[index] = styleTotal <= 0
        ? null : Number(attempts[position] ?? 0) / styleTotal;
    });
    const byType = new Map();
    for (const row of ordered) {
      byType.set(row.type_id, (byType.get(row.type_id) ?? 0) + Number(row.minutes));
    }
    span.type_id = [...byType.keys()].sort()
      .reduce((best, key) => (byType.get(key) > byType.get(best) ? key : best));
    return span;
  }

  const PERCENTILE_RULE = "Where the player stood among that season's described "
    + "players, averaged over the selected seasons and weighted by the minutes he "
    + "played in each.";
  // A team profile describes one season, so its pool is that season's described
  // team seasons and there is nothing to average over. Published as its own
  // sentence, exactly as `v11_entity_api.TEAM_PERCENTILE_RULE` is.
  const TEAM_PERCENTILE_RULE = "Where this team season stood among that season's "
    + "described team seasons.";

  // --- the profile sections ------------------------------------------------------
  //
  // The seven radar-ready pictures of one span, built here rather than copied:
  // every spoke needs the pooled comparison of every described player of the
  // same seasons, and the published style index carries exactly that pool. The
  // arithmetic below is the server's own, element for element — the same
  // minutes-weighted means, the same percentile ladder, the same median — so a
  // published section is the number the API gives and not a lookalike.

  const HIGHER = "higher_is_better";
  const LOWER = "lower_is_better";
  const COST_FEATURES = new Set([
    "turnover_cost", "missed_two_cost", "missed_three_cost", "foul_cost",
  ]);
  // Four words at the most, because these are printed on a chart; the longer
  // wording each one replaces travels beside it as the axis description.
  const CONTEXT_LABELS = {
    raw_value: "Value before context",
    general_offense: "Own lineups · offense",
    general_defense: "Own lineups · defense",
    teammate_offense: "Teammates · offense",
    teammate_defense: "Teammates · defense",
    opponent_offense: "Opponent offenses faced",
    opponent_defense: "Opponent defenses faced",
  };
  const CONTEXT_DESCRIPTIONS = {
    raw_value: "What his Value Contributed would be with every context factor "
      + "neutral. This is not a factor; it is what the six below moved.",
    general_offense: "How the lineups he played in scored, against the league's "
      + "own offense that season.",
    general_defense: "How the lineups he played in defended, against the "
      + "league's own defense that season.",
    teammate_offense: "The teammates he played with, on offense.",
    teammate_defense: "The teammates he played with, on defense.",
    opponent_offense: "The opponents he faced, on offense.",
    opponent_defense: "The opponents he faced, on defense.",
  };
  // The six factors in one standing order: the three that move the offense
  // side, then the three that move defense. `raw_value` is not one of them —
  // it is what they moved — so it is the section's baseline.
  const CONTEXT_ORDER = [
    "general_offense", "teammate_offense", "opponent_defense",
    "general_defense", "teammate_defense", "opponent_offense",
  ];
  const SHORT_LABELS = {
    scoring_spotup_jumper: "Spot-up jumpers",
    scoring_free_throws: "Free throws (net)",
    three_point_rate: "Three-point share",
    assists_at_rim: "Assists at the rim",
    assists_other_two: "Assists, other twos",
    assists_three: "Assists, three-pointers",
    free_throw_assists: "Passes drawing fouls",
    // The three defensive volumes say what they are measured against, because
    // the defended-shot table beside them prints a share of the same attempts.
    rim_defense_volume: "Rim defense vs league",
    midrange_defense_volume: "Mid-range vs league",
    three_defense_volume: "Three-point vs league",
    missed_free_throw_credit: "Free throws forced short",
    free_throw_shortfall: "Free-throw shortfall",
    makes_allowed: "Makes allowed",
  };
  // The kind of shot a pass created: the ten families the scoring chart uses,
  // so passing and scoring read the same way.
  const ASSIST_FAMILY_LABELS = {
    putback: "Putbacks created",
    alley_oop_cut: "Alley-oops and cuts",
    dunk: "Dunks created",
    layup: "Layups created",
    floater: "Floaters created",
    hook: "Hook shots created",
    pullup_stepback: "Pull-ups created",
    turnaround_fade: "Fadeaways created",
    spotup_jumper: "Spot-up jumpers created",
    unclassified_shot: "Shot type not recorded",
  };
  const ASSIST_FAMILY_PHRASES = {
    putback: "a made putback or tip-in",
    alley_oop_cut: "a made alley-oop or a cut to the basket",
    dunk: "a made dunk",
    layup: "a made layup or finger roll",
    floater: "a made floater or runner",
    hook: "a made hook shot",
    pullup_stepback: "a made pull-up or step-back",
    turnaround_fade: "a made turnaround or fadeaway",
    spotup_jumper: "a made spot-up or catch-and-shoot jumper",
    unclassified_shot: "a made shot the feed did not give a type for",
  };
  // Measurements V11 records but the frozen description does not carry, in
  // `v11_player_types.EXTRA_COLUMNS` order.
  const EXTRA_COLUMNS = ["charge_value", "secondary_assists"];
  const AXIS_DESCRIPTIONS = {
    scoring_free_throws: "The net of the free-throw trips that beat what they "
      + "were expected to produce and the trips that fell short.",
    scoring_shooting_fouls_drawn: "Value from the shooting fouls he drew, "
      + "beside the trips themselves.",
    assists_at_rim: "Passes that created a made shot at the rim.",
    assists_other_two: "Passes that created another made two-pointer.",
    assists_three: "Passes that created a made three-pointer.",
    screen_assists: "Screens that freed the shooter on a made field goal.",
    free_throw_assists: "Passes that drew a shooting foul rather than a shot.",
    free_throw_shortfall: "What the free-throw trips that fell short took back.",
    makes_allowed: "Every shot he was the nearest defender on that went in.",
  };
  const DEFENDED_SHORT = {
    at_rim: "At the rim",
    under_six: "Inside six feet",
    six_to_ten: "Six to ten feet",
    ten_to_fifteen: "Ten to fifteen feet",
    long_two: "Long two-pointers",
    two_point_unclassified: "Area not recorded",
    three_pointer: "Three-pointers",
  };
  const DEFENDED_PHRASE = {
    at_rim: "at the rim",
    under_six: "inside six feet",
    six_to_ten: "from six to ten feet",
    ten_to_fifteen: "from ten to fifteen feet",
    long_two: "on long two-pointers",
    two_point_unclassified: "on two-pointers the feed did not place",
    three_pointer: "on three-pointers",
  };

  function weightedMean(pairs) {
    let weight = 0;
    let total = 0;
    for (const [value, share] of pairs) {
      weight += share;
      total += value * share;
    }
    return weight <= 0 ? null : total / weight;
  }

  function medianOfPool(values) {
    if (!values.length) return null;
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2
      ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function featureReader(index) {
    return (row) => {
      const values = row.feature_values ?? [];
      const value = index < values.length ? values[index] : null;
      return value === null || value === undefined ? null : Number(value);
    };
  }

  function arrayReader(column, index) {
    return (row) => {
      const values = row[column];
      if (!values || index >= values.length) return null;
      const value = values[index];
      if (value === null || value === undefined) return null;
      const minutes = Number(row.minutes);
      return minutes <= 0 ? null : Number(value) * 36 / minutes;
    };
  }

  function asCost(read) {
    return (row) => {
      const value = read(row);
      return value === null ? null : -value;
    };
  }

  function defendedReader(position) {
    const base = position * 3;
    return (row) => {
      const values = row.defended_shot_values;
      if (!values || base + 2 >= values.length) return null;
      const net = Number(values[base + 1] ?? 0) + Number(values[base + 2] ?? 0);
      const minutes = Number(row.minutes);
      return minutes <= 0 ? null : net * 36 / minutes;
    };
  }

  // Whether a pooled reading is the same number as this entity's own — the
  // server's own test, so `tie_share` is the same on both sides.
  function level(reading, value) {
    return Math.abs(reading - value) <= 1e-9 * Math.max(1, Math.abs(value));
  }

  function sectionAxis({
    key, label, direction, rows, population, read, total = null,
    description = "", chart = true, unit = "value",
  }) {
    let minutes = 0;
    for (const row of rows) minutes += Number(row.minutes);
    const present = rows
      .map((row) => [read(row), Number(row.minutes)])
      .filter(([value]) => value !== null && value !== undefined);
    if (!present.length || minutes <= 0) return null;
    const per36 = weightedMean(present);
    if (per36 === null || !Number.isFinite(per36)) return null;
    const places = [];
    const medians = [];
    const ties = [];
    for (const row of rows) {
      const value = read(row);
      if (value === null || value === undefined) continue;
      const pool = (population.get(Number(row.season_end_year)) ?? [])
        .map((other) => read(other))
        .filter((reading) => reading !== null && reading !== undefined
          && Number.isFinite(reading));
      if (!pool.length) continue;
      const place = percentileOf([...pool].sort((left, right) => left - right), value);
      if (place !== null && place !== undefined) places.push([place, Number(row.minutes)]);
      const middle = medianOfPool(pool);
      if (middle !== null) medians.push([middle, Number(row.minutes)]);
      const same = pool.filter((reading) => level(reading, value)).length;
      ties.push([same / pool.length, Number(row.minutes)]);
    }
    const percentile = weightedMean(places);
    const league = weightedMean(medians);
    const tieShare = weightedMean(ties);
    return {
      key,
      label,
      description,
      value: total !== null ? total : per36 * minutes / 36,
      per36,
      percentile: percentile === null ? null : percentile,
      league_median_per36: league === null ? null : league,
      direction,
      chart: Boolean(chart),
      tie_share: tieShare === null ? null : tieShare,
      // What the numbers on this axis are: `value` everywhere but the
      // secondary-assist axis, which is a plain count because V11 prices
      // secondary creation at zero.
      unit: String(unit),
    };
  }

  function buildSection(
    key, label, description, axes, comparison = "per_36",
    percentileRule = PERCENTILE_RULE, orientation = "better", chart = "radar",
  ) {
    const present = axes.filter((axis) => axis !== null && axis !== undefined);
    if (!present.length) return null;
    return {
      key, label, description, axes: present, comparison,
      percentile_rule: percentileRule,
      orientation,
      chart,
    };
  }

  const SHOT_FAMILY_META = SCORING_SOURCE_META.filter(([, , kind]) => kind === "field_goals");

  function contextAxis(name, rows, mine, pool, minutes) {
    let total = 0;
    for (const row of rows) total += Number(mine.get(`${row.season_end_year}:${name}`) ?? 0);
    if (minutes <= 0) return null;
    const places = [];
    const medians = [];
    for (const row of rows) {
      const season = Number(row.season_end_year);
      const entries = pool.get(season) ?? [];
      if (!entries.length) continue;
      const values = entries.map((entry) => Number(entry[name] ?? 0));
      const value = Number(mine.get(`${season}:${name}`) ?? 0);
      const place = percentileOf([...values].sort((left, right) => left - right), value);
      if (place !== null && place !== undefined) places.push([place, Number(row.minutes)]);
      const middle = medianOfPool(values);
      if (middle !== null) medians.push([middle, Number(row.minutes)]);
    }
    const percentile = weightedMean(places);
    const league = weightedMean(medians);
    return {
      key: `context_${name}`,
      label: CONTEXT_LABELS[name] ?? name,
      description: CONTEXT_DESCRIPTIONS[name] ?? "",
      value: total,
      per36: total * 36 / minutes,
      percentile: percentile === null ? null : percentile,
      league_median_per36: league === null ? null : league,
      direction: HIGHER,
      // The section is drawn as bars rather than as a radar, so no context
      // amount carries a spoke; `role` says which bar it is.
      chart: false,
      role: name === "raw_value" ? "baseline" : "factor",
      tie_share: null,
      unit: "value",
    };
  }

  function profileSections(
    rows, span, features, population, context, percentileRule = PERCENTILE_RULE,
  ) {
    const byKey = new Map(features.map((feature, index) => [String(feature.key), index]));
    const minutes = Number(span.minutes);
    const featureAxis = (key, chart = true) => {
      const index = byKey.get(key);
      if (index === undefined) return null;
      return sectionAxis({
        key,
        label: SHORT_LABELS[key] ?? String(features[index].label),
        description: AXIS_DESCRIPTIONS[key] ?? String(features[index].meaning ?? ""),
        direction: COST_FEATURES.has(key) ? LOWER : HIGHER,
        rows, population, read: featureReader(index), chart,
      });
    };
    const storedAxis = (
      column, index, key, label, direction = HIGHER, negate = false,
      chart = true, description = "",
    ) => {
      const values = span[column] ?? [];
      const stored = index < values.length ? Number(values[index] ?? 0) : 0;
      const read = arrayReader(column, index);
      return sectionAxis({
        key, label: SHORT_LABELS[key] ?? label,
        description: AXIS_DESCRIPTIONS[key] ?? description,
        direction, rows, population,
        read: negate ? asCost(read) : read,
        total: negate ? -stored : stored,
        chart,
      });
    };
    const scoringIndex = new Map(SCORING_SOURCE_META.map(([key], index) => [key, index]));
    const scoringAxes = [
      ...SHOT_FAMILY_META.map(([key, label]) => storedAxis(
        "scoring_values", scoringIndex.get(key), `scoring_${key}`, label,
        // "Shot type not recorded" is the residue bucket: almost every player
        // has nothing in it, so it is a table row rather than a spoke.
        HIGHER, false, key !== "unclassified_shot", SOURCE_MEANINGS[key] ?? "",
      )),
      storedAxis("scoring_values", scoringIndex.get("free_throws"),
        "scoring_free_throws", "Free throws, net"),
      storedAxis("scoring_values", scoringIndex.get("shooting_fouls_drawn"),
        "scoring_shooting_fouls_drawn", "Shooting fouls drawn", HIGHER, false, false),
      featureAxis("three_point_rate", false),
    ];
    const assistIndex = new Map(ASSIST_COLUMNS.map((column, index) => [column, index]));
    const extraIndex = new Map(EXTRA_COLUMNS.map((name, index) => [name, index]));
    const extraAxis = (key, label, description, unit = "value") => {
      const index = extraIndex.get(key);
      if (index === undefined) return null;
      const values = span.extra_values ?? [];
      if (index >= values.length) return null;
      return sectionAxis({
        key, label, description, direction: HIGHER, rows, population,
        read: arrayReader("extra_values", index),
        total: Number(values[index] ?? 0), unit,
      });
    };
    const playmakingAxes = [
      ...Object.keys(ASSIST_FAMILY_LABELS).map((family) => storedAxis(
        "assist_shot_values", assistIndex.get(`family@${family}`),
        `assists_family_${family}`, ASSIST_FAMILY_LABELS[family], HIGHER, false,
        family !== "unclassified_shot",
        `Passes that created ${ASSIST_FAMILY_PHRASES[family]}.`,
      )),
      ...ASSIST_ZONES.filter(([zone]) => zone !== "unclassified").map(([zone, label]) => storedAxis(
        "assist_shot_values", assistIndex.get(`zone@${zone}`),
        `assists_${zone}`, `Assists creating ${label.toLowerCase()}`,
        HIGHER, false, false,
      )),
      storedAxis("playmaking_values", 2, "screen_assists", "Screen assists"),
      storedAxis("playmaking_values", 1, "free_throw_assists",
        "Passes that drew shooting fouls"),
      extraAxis(
        "secondary_assists", "Secondary assists",
        "How many secondary assists he made, per 36 minutes. This is a count "
        + "and not value: V11 prices secondary creation at zero, so none of "
        + "his published total comes from it.",
        "count",
      ),
      // The turnovers that used to sit here are a cost, and a chart of what a
      // player adds carries only what he adds. They are in `negative_value`.
    ];
    const contextAxes = context
      ? ["raw_value", ...CONTEXT_ORDER].map((name) => contextAxis(
        name, rows, context.mine, context.pool, minutes,
      ))
      : [];
    const shortfall = span.free_throw_detail ?? [];
    // Every make he allowed, wherever it came from, as one cost: seven spokes
    // of one family would be a chart about defended shots rather than about
    // what his habits cost, so they add to one axis and stay in the table.
    const allowedReaders = DEFENDED_SHOT_LOCATIONS.map(
      (_entry, position) => arrayReader("defended_shot_values", position * 3 + 2),
    );
    const allowedValues = span.defended_shot_values ?? [];
    let allowedTotal = 0;
    DEFENDED_SHOT_LOCATIONS.forEach((_entry, position) => {
      const base = position * 3 + 2;
      allowedTotal += base >= allowedValues.length ? 0 : Number(allowedValues[base] ?? 0);
    });
    const detailAxes = DEFENDED_SHOT_LOCATIONS.map(([location], position) => {
      const base = position * 3 + 2;
      const total = base >= allowedValues.length ? 0 : Number(allowedValues[base] ?? 0);
      return sectionAxis({
        key: `makes_allowed_${location}`, label: DEFENDED_SHORT[location],
        description: `Makes he allowed ${DEFENDED_PHRASE[location]}.`,
        direction: LOWER, rows, population,
        read: asCost(arrayReader("defended_shot_values", base)),
        total: -total,
        chart: false,
      });
    }).filter((axis) => axis !== null && axis !== undefined);
    detailAxes.sort((left, right) => right.value - left.value);
    const negativeAxes = [
      featureAxis("turnover_cost"),
      featureAxis("missed_two_cost"),
      featureAxis("missed_three_cost"),
      featureAxis("foul_cost"),
      sectionAxis({
        key: "free_throw_shortfall", label: SHORT_LABELS.free_throw_shortfall,
        description: AXIS_DESCRIPTIONS.free_throw_shortfall,
        direction: LOWER, rows, population,
        read: asCost(arrayReader("free_throw_detail", 1)),
        total: -(shortfall.length > 1 ? Number(shortfall[1] ?? 0) : 0),
      }),
      sectionAxis({
        key: "makes_allowed", label: SHORT_LABELS.makes_allowed,
        description: AXIS_DESCRIPTIONS.makes_allowed,
        direction: LOWER, rows, population,
        read: (row) => {
          const parts = allowedReaders.map((reader) => reader(row))
            .filter((value) => value !== null && value !== undefined);
          if (!parts.length) return null;
          let sum = 0;
          for (const value of parts) sum += value;
          return -sum;
        },
        total: -allowedTotal,
      }),
    ].filter((axis) => axis !== null && axis !== undefined).concat(detailAxes);
    return [
      buildSection("scoring", "Where the scoring came from",
        "Every kind of shot he took plus his free throws, as V11 prices them. "
        + "These axes add up to his published scoring value.", scoringAxes,
        "per_36", percentileRule),
      buildSection("playmaking", "What his passing created",
        "Passes sorted by the shot at the other end, screens and passes that "
        + "drew a shooting foul. What his turnovers cost is in “Where he "
        + "lost value”.", playmakingAxes,
        "per_36", percentileRule),
      buildSection("rebounding_and_hustle", "Rebounding and little things",
        "Possessions kept alive, possessions ended, and the work that does not "
        + "show up as a shot.", [
          featureAxis("offensive_rebound_volume"),
          featureAxis("defensive_rebound_volume"),
          featureAxis("offensive_boxout_volume"),
          featureAxis("defensive_boxout_volume"),
          extraAxis(
            "charge_value", "Charges drawn",
            "What the charges he drew were worth, per 36 minutes. V11 pays a "
            + "charge inside his steal value, so this is the charge half of "
            + "that number on its own.",
          ),
          storedAxis("playmaking_values", 2, "screen_assists", "Screen assists"),
          // Deflections left this chart: V11 prices `pressure_defense` at
          // nothing. Steals left it too — the defense chart draws them.
        ], "per_36", percentileRule),
      buildSection("defense", "Defense",
        "Every shot he was the nearest defender on, what he took away, and the "
        + "free throws he forced to be missed. What his fouls cost is in "
        + "“Where he lost value”.", [
          featureAxis("rim_defense_volume"),
          featureAxis("midrange_defense_volume"),
          featureAxis("three_defense_volume"),
          featureAxis("block_volume"),
          featureAxis("steal_volume"),
          featureAxis("defensive_rebound_volume"),
          featureAxis("missed_free_throw_credit"),
          // The seven places on the floor were a second radar of their own,
          // whose percentile could not be told apart from the defended-shot
          // table's share. The shares are the table's job; this is one chart.
        ], "per_36", percentileRule),
      buildSection("context", "What the game around him did to the number",
        "Value Contributed with every context factor neutral, and what each "
        + "factor added or took away. The value before context plus the six "
        + "factors is his Value Contributed exactly.", contextAxes,
        "season_total", percentileRule, "better", "diverging_bars"),
      buildSection("negative_value", "Where he lost value",
        "Everything that cost him. Every amount here is what it cost, so "
        + "further out on this chart means it cost him more — the one "
        + "chart in the profile where outward is not better.", negativeAxes,
        "per_36", percentileRule, "cost"),
    ].filter((section) => section !== null);
  }

  // --- a team page's two scopes ---------------------------------------------------
  //
  // The selection — the seasons the page has ticked, its schedule and its
  // game-time view — is rebuilt here from the franchise's own game store, the
  // per-season team totals and two small indexes, with the server's own
  // arithmetic. The profile is one season and is read from that season's
  // snapshot. Both sentences below are the server's, word for word.

  const SELECTION_SCOPE_RULE = "Team totals, the roster, the concentration "
    + "cards and the contribution chart are summed over every selected season.";
  const PROFILE_SCOPE_RULE = "A franchise changes too much between seasons for "
    + "a blend of several to describe one, so this is a single season at a time.";
  const CHART_LEADERS = 10;
  const ROLLING_WINDOW = 10;
  const OTHERS_LABEL = "All Other Players";
  const ROSTER_SUMS = [
    "games_played", "wins", "losses", "seconds_played", "minutes_played",
    "value_contributed", "wins_contributed", "offense_value", "defense_value",
    "other_value",
  ];

  /** The season the profile describes: the asked-for one, or the newest. */
  function profileYear(profileSeason, years, fallback) {
    const asked = /^\d{4}-\d{2}$/.test(String(profileSeason ?? ""))
      ? Number(String(profileSeason).slice(0, 4)) + 1 : null;
    const available = years.length ? years : [fallback];
    if (asked !== null && available.includes(asked)) return asked;
    return Math.max(...available);
  }

  /** The chart's own player selection, as the page sends it. */
  function requestedIds(value) {
    const found = [];
    for (const part of String(value ?? "").split(",")) {
      const text = part.trim();
      if (/^\d+$/.test(text) && Number(text) > 0 && !found.includes(Number(text))) {
        found.push(Number(text));
      }
    }
    return found.slice(0, CHART_LEADERS);
  }

  /** One franchise's record and value in each selected season. */
  async function teamSeasonTotals(io, teamId, { timeMode, schedule, years }) {
    const rows = [];
    for (const year of years) {
      const snapshot = await io.json(
        `${DATA_PREFIX}teams/${timeMode}/${schedule}/${year}.json`,
      );
      const found = (snapshot?.rows ?? []).find((row) => Number(row.team_id) === teamId);
      if (found) rows.push({ ...found, season_end_year: year });
    }
    return rows;
  }

  /** Every player-season the franchise used, from its own game store. */
  function teamPerSeasonRoster(played) {
    const groups = new Map();
    for (const row of played) {
      const key = `${row.player_id}:${row.season_end_year}`;
      let target = groups.get(key);
      if (!target) {
        target = {
          player_id: Number(row.player_id),
          season_end_year: Number(row.season_end_year),
          player_name: row.player_name,
          games_played: 0,
          wins: 0,
          losses: 0,
          seconds_played: 0,
          value_contributed: 0,
          wins_contributed: 0,
          offense_value: 0,
          defense_value: 0,
          other_value: 0,
          __latest: null,
        };
        groups.set(key, target);
      }
      target.games_played += 1;
      if (row.win_loss) target.wins += 1; else target.losses += 1;
      target.seconds_played += Number(row.actual_seconds || 0);
      target.value_contributed += Number(row.value_contributed || 0);
      target.wins_contributed += Number(row.wins_contributed || 0);
      target.offense_value += Number(row.final_offense_value || 0);
      target.defense_value += Number(row.final_defense_signed || 0);
      // The name is the one on his most recent game of that season, which is
      // what `array_agg(... ORDER BY game_date DESC, game_id DESC)[1]` takes.
      const stamp = `${row.game_date}|${row.game_id}`;
      if (target.__latest === null || stamp > target.__latest) {
        target.__latest = stamp;
        target.player_name = row.player_name;
      }
    }
    const rows = [...groups.values()];
    for (const row of rows) {
      row.minutes_played = row.seconds_played / 60.0;
      delete row.__latest;
    }
    return rows.sort((left, right) => (
      (left.player_id - right.player_id) || (left.season_end_year - right.season_end_year)
    ));
  }

  /** Per-player totals over the selection, oldest season added first. */
  function foldRoster(perSeason, metric) {
    const folded = new Map();
    const ordered = [...perSeason].sort((left, right) => (
      (left.player_id - right.player_id) || (left.season_end_year - right.season_end_year)
    ));
    for (const row of ordered) {
      let target = folded.get(row.player_id);
      if (!target) {
        target = {
          player_id: row.player_id,
          player_name: row.player_name,
          seasons: [],
          season_end_years: [],
        };
        for (const key of ROSTER_SUMS) target[key] = 0.0;
        folded.set(row.player_id, target);
      }
      target.player_name = row.player_name || target.player_name;
      target.seasons.push(seasonLabel(row.season_end_year));
      target.season_end_years.push(row.season_end_year);
      for (const key of ROSTER_SUMS) target[key] += Number(row[key] || 0);
    }
    const roster = [...folded.values()];
    for (const row of roster) {
      row.games_played = Math.round(row.games_played);
      row.wins = Math.round(row.wins);
      row.losses = Math.round(row.losses);
      row.seasons_played = row.seasons.length;
    }
    return roster.sort((left, right) => (
      (Number(right[metric] || 0) - Number(left[metric] || 0))
      || (left.player_id - right.player_id)
    ));
  }

  /** The roster's six context amounts, per player and for the team. */
  async function teamContextRows(io, timeMode, { teamId, years, schedule }) {
    const store = await io.json(`${DATA_PREFIX}team-context/${timeMode}.json`);
    const byPlayer = new Map();
    const team = Object.fromEntries(CONTEXT_FACTORS.map((factor) => [factor, 0.0]));
    if (!store) return { byPlayer, team };
    const columns = store.columns;
    const at = Object.fromEntries(columns.map((name, index) => [name, index]));
    const types = store.season_types ?? SEASON_TYPES;
    const wanted = new Set(years);
    for (const values of store.rows) {
      if (Number(values[at.team_id]) !== teamId) continue;
      if (!wanted.has(Number(values[at.season_end_year]))) continue;
      if (!scheduleKeeps(schedule, types[values[at.season_type]])) continue;
      const playerId = Number(values[at.player_id]);
      let target = byPlayer.get(playerId);
      if (!target) {
        target = Object.fromEntries(CONTEXT_FACTORS.map((factor) => [factor, 0.0]));
        byPlayer.set(playerId, target);
      }
      for (const factor of CONTEXT_FACTORS) {
        const amount = Number(values[at[factor]] || 0);
        target[factor] += amount;
        team[factor] += amount;
      }
    }
    return { byPlayer, team };
  }

  /** The five-column index of which type each described player-season was. */
  async function playerTypeIndex(io, timeMode, scope) {
    const store = await io.json(`${DATA_PREFIX}player-types/${timeMode}/${scope}.json`);
    if (!store) return null;
    if (!store.__byPlayer) {
      const at = Object.fromEntries(store.columns.map((name, index) => [name, index]));
      const byPlayer = new Map();
      for (const values of store.rows) {
        const playerId = Number(values[at.player_id]);
        const list = byPlayer.get(playerId) ?? [];
        list.push({
          season_end_year: Number(values[at.season_end_year]),
          type_id: store.types[values[at.type]].id,
          provisional: Boolean(values[at.provisional]),
          minutes: Number(values[at.minutes] || 0),
        });
        byPlayer.set(playerId, list);
      }
      Object.defineProperty(store, "__byPlayer", { value: byPlayer });
      Object.defineProperty(store, "__labels", {
        value: new Map((store.types ?? []).map((entry) => [entry.id, entry.label])),
      });
    }
    return store;
  }

  /**
   * The kind of player each roster member was, over the selection.
   *
   * The type he spent most of his selected minutes in, counting only seasons
   * he actually played for this franchise: a season he spent elsewhere
   * describes another team's roster.
   */
  function attachRosterTypes(roster, index, years) {
    if (index === null) {
      for (const row of roster) row.player_type = null;
      return;
    }
    const wanted = new Set(years);
    for (const row of roster) {
      const own = new Set(row.season_end_years);
      const described = (index.__byPlayer.get(row.player_id) ?? [])
        .filter((entry) => wanted.has(entry.season_end_year) && own.has(entry.season_end_year));
      if (!described.length) { row.player_type = null; continue; }
      const minutes = new Map();
      let provisional = false;
      for (const entry of described) {
        minutes.set(entry.type_id, (minutes.get(entry.type_id) ?? 0) + entry.minutes);
        if (entry.provisional) provisional = true;
      }
      const best = [...minutes.keys()].sort()
        .reduce((chosen, key) => (
          chosen === null || minutes.get(key) > minutes.get(chosen)
          || (minutes.get(key) === minutes.get(chosen) && key > chosen) ? key : chosen
        ), null);
      row.player_type = {
        id: best,
        label: index.__labels.get(best) ?? best,
        described_seasons: described.length,
        season_end_years: described.map((entry) => entry.season_end_year)
          .sort((left, right) => left - right),
        provisional,
        mixed: minutes.size > 1,
      };
    }
  }

  /** One row per selected season, in the shape the career table reads. */
  function teamSeasonRows(totals, perSeason, labelOf) {
    return totals.map((row) => {
      const games = Math.round(Number(row.games_played || 0));
      const wins = Math.round(Number(row.wins || 0));
      const value = Number(row.value_contributed || 0);
      const winsValue = Number(row.wins_contributed || 0);
      return {
        season_end_year: row.season_end_year,
        season: labelOf(row.season_end_year),
        games_played: games,
        wins,
        losses: games - wins,
        players: perSeason.filter((item) => item.season_end_year === row.season_end_year).length,
        value_contributed: value,
        wins_contributed: winsValue,
        losses_contributed: value - winsValue,
      };
    }).sort((left, right) => left.season_end_year - right.season_end_year);
  }

  /** Each selected season's roster, which the turnover cards read. */
  function seasonRosters(perSeason, labelOf) {
    const byYear = new Map();
    for (const row of perSeason) {
      const list = byYear.get(row.season_end_year) ?? [];
      list.push({
        player_id: row.player_id,
        player_name: row.player_name,
        minutes: row.minutes_played,
        value_contributed: row.value_contributed,
        wins_contributed: row.wins_contributed,
      });
      byYear.set(row.season_end_year, list);
    }
    return [...byYear.keys()].sort((left, right) => left - right).map((year) => ({
      season_end_year: year,
      season: labelOf(year),
      players: byYear.get(year).sort((left, right) => (
        (right.value_contributed - left.value_contributed)
        || (left.player_id - right.player_id)
      )),
    }));
  }

  /**
   * Who built the franchise's value, by game or by season.
   *
   * One selected season is drawn game by game; several are drawn season by
   * season. The leaders are the ten largest inside the selection unless the
   * page's own picker names others, and everyone else is one line.
   */
  function teamContribution(played, roster, { metric, years, chartIds, seasonLabelOf }) {
    const asked = new Set(chartIds);
    let leaders = chartIds.length
      ? roster.filter((row) => asked.has(row.player_id)).slice(0, CHART_LEADERS)
      : [];
    if (!leaders.length) leaders = roster.slice(0, CHART_LEADERS);
    const chartPlayers = leaders.map((row) => ({
      player_id: row.player_id, player_name: row.player_name,
    }));
    const chosen = new Set(chartPlayers.map((row) => row.player_id));
    const column = metric === "wins_contributed" ? "wins_contributed" : "value_contributed";
    const games = [];
    const indexOf = new Map();
    for (const row of played) {
      let position = indexOf.get(row.game_id);
      if (position === undefined) {
        position = games.length;
        indexOf.set(row.game_id, position);
        games.push({
          game_id: row.game_id,
          game_date: row.game_date,
          season_end_year: row.season_end_year,
          season: row.season,
          values: new Map(),
        });
      }
      const key = chosen.has(Number(row.player_id)) ? Number(row.player_id) : null;
      games[position].values.set(
        key, (games[position].values.get(key) ?? 0) + Number(row[column] || 0),
      );
    }
    const running = new Map(chartPlayers.map((row) => [row.player_id, 0.0]));
    running.set(null, 0.0);
    const cumulativeSeries = [];
    let previousYear = null;
    games.forEach((game, position) => {
      for (const [key, amount] of game.values) running.set(key, running.get(key) + amount);
      const values = chartPlayers.map((player) => ({
        ...player, cumulative: running.get(player.player_id),
      }));
      values.push({ player_id: null, player_name: OTHERS_LABEL, cumulative: running.get(null) });
      cumulativeSeries.push({
        game_number: position + 1,
        game_id: game.game_id,
        game_date: game.game_date,
        season_end_year: game.season_end_year,
        season_separator: previousYear !== game.season_end_year,
        values,
        team_total: values.reduce((sum, row) => sum + row.cumulative, 0),
      });
      previousYear = game.season_end_year;
    });
    const identities = [...chartPlayers, { player_id: null, player_name: OTHERS_LABEL }];
    let seasonSeries;
    if (years.length > 1) {
      const byYear = new Map();
      for (const game of games) {
        const pool = byYear.get(game.season_end_year) ?? new Map();
        for (const [key, amount] of game.values) pool.set(key, (pool.get(key) ?? 0) + amount);
        byYear.set(game.season_end_year, pool);
      }
      const sorted = [...byYear.keys()].sort((left, right) => left - right);
      seasonSeries = {
        mode: "season_totals",
        series: identities.map((player) => ({
          ...player,
          points: sorted.map((year) => ({
            season_end_year: year,
            season: seasonLabelOf(year),
            value: byYear.get(year).get(player.player_id) ?? 0.0,
          })).filter((point) => player.player_id === null || point.value !== 0.0),
        })),
      };
    } else {
      seasonSeries = {
        mode: "team_games",
        display: "raw",
        window_games: ROLLING_WINDOW,
        series: identities.map((player) => {
          const raw = games.map((game, position) => ({
            game_number: position + 1,
            game_id: game.game_id,
            game_date: game.game_date,
            raw: game.values.get(player.player_id) ?? 0.0,
          }));
          return {
            ...player,
            points: raw.map((point, position) => {
              const window = raw.slice(Math.max(0, position - (ROLLING_WINDOW - 1)), position + 1);
              return {
                ...point,
                rolling: window.reduce((sum, item) => sum + item.raw, 0) / window.length,
                window_size: window.length,
              };
            }),
          };
        }),
      };
    }
    return {
      cumulative_series: cumulativeSeries,
      season_series: seasonSeries,
      contribution_chart: seasonSeries,
      who_built_total: { metric, players: chartPlayers, points: cumulativeSeries },
    };
  }

  /**
   * The path a franchise took between styles, over the page's own selection.
   *
   * It is the one block on a team profile that is deliberately not about a
   * single season: a chart of moving from one season to the next needs them
   * all. Everything else the profile draws is the chosen season's, and comes
   * from that season's own snapshot.
   */
  async function teamTypeHistory(io, teamId, { timeMode, years, chosenYear }) {
    const index = await styleIndex(io, "team", timeMode, "regular_season");
    if (index === null) return null;
    const rows = index.__rows;
    const wanted = new Set([...years, chosenYear]);
    const history = rows
      .filter((row) => row.entity_id === teamId && wanted.has(row.season_end_year))
      .sort((left, right) => left.season_end_year - right.season_end_year);
    if (!history.length) return null;
    const types = {};
    for (const entry of index.model.types) types[entry.id] = entry;
    const labelOf = (year) => `${year - 1}-${String(year).slice(-2)}`;
    return {
      type_history: history.map((row) => ({
        season: labelOf(row.season_end_year),
        season_end_year: row.season_end_year,
        id: row.type_id,
        label: (types[row.type_id] ?? {}).label ?? row.type_id,
        provisional: Boolean(row.provisional),
        x: row.type_x,
        y: row.type_y,
        minutes: Number(row.minutes),
        selected: row.season_end_year === chosenYear,
      })),
      selection: {
        season_end_years: history.map((row) => row.season_end_year),
        seasons: history.map((row) => labelOf(row.season_end_year)),
        spans_more_than_one_season: false,
        profile_season: labelOf(chosenYear),
        profile_season_end_year: chosenYear,
        rule: PROFILE_SCOPE_RULE,
        percentile_rule: TEAM_PERCENTILE_RULE,
      },
    };
  }

  /** This player's six context amounts per selected season, and the league's. */
  async function selectionContext(io, playerId, timeMode, schedule, years) {
    if (!years.length) return null;
    const mine = new Map();
    const pool = new Map();
    let any = false;
    for (const year of years) {
      const snapshot = await io.json(
        `${DATA_PREFIX}context-pool/${timeMode}/${schedule}/${year}.json`,
      );
      if (!snapshot) continue;
      any = true;
      const columns = snapshot.columns ?? [];
      const entries = (snapshot.rows ?? []).map((row) => {
        const entry = {};
        columns.forEach((name, index) => {
          if (name !== "player_id") entry[name] = Number(row[index] ?? 0);
        });
        entry.player_id = Number(row[0]);
        return entry;
      });
      pool.set(Number(year), entries);
      const own = entries.find((entry) => entry.player_id === Number(playerId));
      if (own) {
        for (const name of CONTEXT_MEASURES) mine.set(`${year}:${name}`, own[name] ?? 0);
      }
    }
    return any ? { mine, pool } : null;
  }

  /** What the payload says about the seasons it was built over. */
  function selectionBlock(selected, chosen, seasonLabelFor, pageYears = []) {
    const years = selected.map((row) => row.season_end_year);
    const many = years.length > 1;
    const page = [...new Set(pageYears.map(Number))].sort((left, right) => left - right);
    const pageSelection = page.length ? page : years;
    return {
      season_end_years: years,
      seasons: years.map(seasonLabelFor),
      spans_more_than_one_season: many,
      // Which one season the blocks describe, when a reader has clicked a
      // season in the career table, and the whole selection he can go back to.
      profile_season: many ? null : seasonLabelFor(years[0]),
      profile_season_end_year: many ? null : years[0],
      page_season_end_years: pageSelection,
      page_seasons: pageSelection.map(seasonLabelFor),
      rule: many
        ? "Every value, attempt and minute is summed over the selected seasons; "
          + "the rates and shares come from those sums."
        : "One season, exactly as it is stored.",
      percentile_rule: PERCENTILE_RULE,
      type_rule: many
        ? "A span is typed as the type it spent most of its minutes in; the "
          + "season-by-season types are in type_history."
        : "This season's own type.",
      similarity_rule: many
        ? `The most similar players are for ${seasonLabelFor(chosen.season_end_year)}, `
          + "the most recent selected season; V11 compares one season at a time."
        : "The most similar players are for this season.",
    };
  }

  /** The style blocks of a player profile, derived from the style index. */
  async function playerStyle(io, playerId, query, lens) {
    const scope = styleScope(query.schedule);
    const index = await styleIndex(io, "player", query.timeMode, scope);
    if (index === null) return null;
    const rows = index.__rows;
    const history = rows.filter((row) => row.entity_id === playerId);
    if (!history.length) return null;
    const features = index.model.features;
    const wanted = new Set((query.seasonEndYears ?? []).map(Number));
    let selected = history.filter((row) => wanted.has(row.season_end_year));
    if (!selected.length) {
      selected = [history.find((row) => row.season_end_year === query.seasonEndYear)
        ?? history[history.length - 1]];
    }
    selected.sort((a, b) => a.season_end_year - b.season_end_year);
    const chosen = spanRow(selected, features);
    const population = rows.filter((row) => row.season_end_year === chosen.season_end_year);
    const bySeason = new Map();
    for (const row of selected) {
      if (bySeason.has(row.season_end_year)) continue;
      bySeason.set(row.season_end_year,
        rows.filter((item) => item.season_end_year === row.season_end_year));
    }
    const context = await selectionContext(
      io, playerId, query.timeMode, query.schedule,
      selected.map((row) => Number(row.season_end_year)),
    );
    const sections = profileSections(selected, chosen, features, bySeason, context);
    const types = {};
    for (const entry of index.model.types) types[entry.id] = entry;
    const half = index.similarity_half_distance;
    const seasonLabelFor = (year) => `${year - 1}-${String(year).slice(-2)}`;
    const directory = await teamDirectory(io);
    const asMatch = (item) => {
      const row = item.row;
      const season = seasonLabelFor(row.season_end_year);
      const entry = types[row.type_id] ?? {};
      return {
        player_id: row.entity_id,
        player_name: row.name,
        season,
        season_end_year: row.season_end_year,
        team_ids: row.team_ids,
        team_abbreviations: row.team_ids.map((id) => directory.abbreviation(id)),
        similarity: item.similarity,
        score: item.similarity,
        distance: item.distance,
        player_type: { id: row.type_id, label: entry.label ?? row.type_id },
        candidate_player_name: row.name,
        candidate_x: row.type_x,
        candidate_y: row.type_y,
        explanation: `${entry.label ?? row.type_id} in ${season}, with a very `
          + "similar mix of scoring, playmaking and defense per minute.",
      };
    };
    const exclude = [playerId, chosen.season_end_year];
    // V11's distance is between two season descriptions, so a span's
    // neighbours are the most recent selected season's neighbours rather than
    // a comparison between a span and a set of seasons.
    const target = selected[selected.length - 1].feature_z;
    const sameSeason = nearestRows(target, population, half, exclude, 10).map(asMatch);
    const allSeasons = nearestRows(
      target, rows.filter((row) => row.entity_id !== playerId), half, exclude, 10,
    ).map(asMatch);
    return {
      archetype: styleArchetype(chosen, types, seasonLabelFor),
      type_history: history.map((row) => ({
        season: seasonLabelFor(row.season_end_year),
        season_end_year: row.season_end_year,
        id: row.type_id,
        label: (types[row.type_id] ?? {}).label ?? row.type_id,
        provisional: Boolean(row.provisional),
        x: row.type_x,
        y: row.type_y,
        minutes: Number(row.minutes),
      })),
      profile_sections: sections,
      scoring_sources: sourceRows(
        chosen.scoring_values, chosen.scoring_attempts, chosen.minutes,
        chosen.free_throw_detail,
      ),
      playmaking_sources: playmakingRows(chosen.playmaking_values, chosen.minutes),
      playmaking_breakdown: {
        by_kind: playmakingRows(chosen.playmaking_values, chosen.minutes),
        ...createdShotRows(
          chosen.assist_shot_values, chosen.assist_shot_counts, chosen.minutes,
        ),
        note: CREATED_SHOT_NOTE,
      },
      defended_shots: defendedShotRows(chosen.defended_shot_values, chosen.minutes),
      selection: selectionBlock(
        selected, chosen, seasonLabelFor, query.pageSeasonEndYears ?? [],
      ),
      dimensions: styleDimensions(chosen, features, population, selected, bySeason),
      concepts: {},
      player_types: catalogueOf(index),
      similarity: {
        available: true,
        status: "available",
        lens,
        scope,
        time_mode: query.timeMode,
        season: seasonLabelFor(chosen.season_end_year),
        matches: sameSeason.length ? sameSeason : allSeasons,
        same_season: sameSeason,
        all_seasons: allSeasons,
      },
    };
  }

  // --- V13's own blocks, as the API answered them -----------------------------
  //
  // V13 describes a player with its own types, groupings, regrouped sections,
  // similarity lists, matchups and a whole-span comparison. The build writes
  // them per player for exactly the requests the Players page can make (every
  // season, the full season, competitive minutes), and they are handed back
  // here unchanged; everything else a profile carries is rebuilt from the
  // player's own stores, as it is for V11.

  // The keys of a profile rebuilt from the stores; `PROFILE_STORE_KEYS` in
  // `src/v11_site_export.py` is the same list. A profile's `availability` is
  // published with its blocks: a player below the type model's minutes floor
  // has none, and says so.
  const PROFILE_STORE_KEYS = Object.freeze([
    "source", "filters", "state", "entity", "summary", "seasons", "fingerprint",
    "contribution_chart", "profile_id",
  ]);
  const PLAYER_EXTRAS = "player-extras/";

  function copyOf(value) {
    return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  async function playerExtras(io, playerId) {
    return need(
      io,
      `${DATA_PREFIX}${PLAYER_EXTRAS}${playerId}.json`,
      `${label(io)} player profile not found`,
    );
  }

  function notPublished(io, what) {
    return new HttpError(404, `${label(io)} publishes ${what} only for the Players page's own scope.`);
  }

  /** The seasons an API route answers for: the requested ones it serves, or all. */
  async function servedYears(io, params) {
    const options = await need(io, `${DATA_PREFIX}options.json`, "options");
    const served = options.seasons.map((entry) => Number(entry.season_end_year))
      .sort((left, right) => left - right);
    const wanted = new Set(params.getAll("season")
      .map(String)
      .filter((value) => value.length === 7 && /^\d{4}$/.test(value.slice(0, 4)))
      .map((value) => Number(value.slice(0, 4)) + 1));
    const years = served.filter((year) => wanted.has(year));
    return years.length ? years : served;
  }

  function yearKey(years) {
    return [...new Set(years.map(Number))].sort((left, right) => left - right).join(",");
  }

  async function publishedProfileBlocks(io, playerId, params) {
    const extras = await playerExtras(io, playerId);
    const scope = extras.scope ?? {};
    const asked = {
      schedule: params.get("schedule") ?? "all",
      time_mode: params.get("time_mode") ?? "competitive",
      lens: params.get("lens") ?? "concept_balanced",
    };
    for (const key of Object.keys(asked)) {
      if (scope[key] !== undefined && asked[key] !== scope[key]) {
        throw notPublished(io, "a player's description");
      }
    }
    const seasons = params.getAll("season");
    const chosen = String(params.get("profile_season") ?? "");
    const year = intOrNull(params.get("season_end_year"));
    let name = "all";
    if (/^\d{4}-\d{2}$/.test(chosen) && seasons.includes(chosen)) {
      name = `profile:${Number(chosen.slice(0, 4)) + 1}`;
    } else if (!seasons.length && year !== null) {
      name = `season:${year}`;
    }
    const variant = extras.variants?.[name];
    if (!variant) throw new HttpError(404, `${label(io)} player profile not found`);
    const blocks = {};
    for (const [key, at] of Object.entries(variant)) {
      if (typeof at === "string" && at.startsWith("$")) {
        blocks[key] = copyOf(await need(
          io,
          `${DATA_PREFIX}${PLAYER_EXTRAS}shared/${at.slice(1)}.json`,
          `${label(io)} shared profile block ${at.slice(1)}`,
        ));
      } else {
        blocks[key] = copyOf(extras.blocks[at]);
      }
    }
    return blocks;
  }

  // Routes only V13 has.
  const OWN_HANDLERS = {
    async "api/v13/type-trends"(io, params) {
      const schedule = params.get("schedule") ?? "all";
      if (!["all", "regular_season", "postseason"].includes(schedule)) {
        throw new HttpError(422, "schedule is invalid");
      }
      const timeMode = params.get("time_mode") ?? "competitive";
      if (!TIME_MODES.includes(timeMode)) throw new HttpError(422, "time_mode is invalid");
      const window = intOrNull(params.get("window_years") ?? "3");
      if (![1, 3, 5].includes(window)) throw new HttpError(422, "type trend window is invalid");
      return copyOf(await need(
        io,
        `${DATA_PREFIX}type-trends/${timeMode}/${schedule}/${window}.json`,
        `${label(io)} type trends are not in this site build`,
      ));
    },

    async "api/v13/players/span-similarity"(io, params, captured) {
      const playerId = intOrNull(captured.player_id);
      if (playerId === null || playerId < 1) throw new HttpError(422, "player_id must be positive");
      if ((params.get("schedule") ?? "all") !== "all"
        || (params.get("time_mode") ?? "competitive") !== "competitive"
        || (intOrNull(params.get("limit")) ?? 10) !== 10) {
        throw notPublished(io, "the whole-span comparison");
      }
      const extras = await playerExtras(io, playerId);
      const answer = extras.span_similarity?.[yearKey(await servedYears(io, params))];
      if (!answer) throw notPublished(io, "the whole-span comparison");
      return copyOf(answer);
    },

    async "api/v13/players/matchups"(io, params, captured) {
      const playerId = intOrNull(captured.player_id);
      if (playerId === null || playerId < 1) throw new HttpError(422, "player_id must be positive");
      if ((params.get("schedule") ?? "all") !== "all") throw notPublished(io, "matchups");
      const extras = await playerExtras(io, playerId);
      const answer = extras.matchups?.[yearKey(await servedYears(io, params))];
      if (!answer) throw notPublished(io, "matchups");
      return copyOf(answer);
    },
  };

  const OWN_PATTERNS = [
    [/^api\/v13\/players\/(\d+)\/span-similarity$/, "api/v13/players/span-similarity", ["player_id"]],
    [/^api\/v13\/players\/(\d+)\/matchups$/, "api/v13/players/matchups", ["player_id"]],
  ];

  // --- routing -----------------------------------------------------------------

  const PATTERNS = [
    [/^api\/v11\/players\/(\d+)\/games$/, "api/v11/players/games", ["player_id"]],
    [/^api\/v11\/players\/(\d+)$/, "api/v11/players/profile", ["player_id"]],
    [/^api\/v11\/teams\/(\d+)\/games$/, "api/v11/teams/games", ["team_id"]],
    [/^api\/v11\/teams\/(\d+)\/similarity$/, "api/v11/teams/similarity", ["team_id"]],
    [/^api\/v11\/teams\/(\d+)$/, "api/v11/teams/profile", ["team_id"]],
    [/^api\/v11\/seasons\/(\d+)\/story$/, "api/v11/seasons/story", ["season_end_year"]],
    [/^api\/v11\/games\/([^/]+)\/anatomy$/, "api/v11/games/anatomy", ["game_id"]],
  ];

  /** The part of an /api path this router recognises, with no leading slash. */
  function apiKey(pathname) {
    const index = pathname.indexOf("/api/");
    if (index >= 0) return pathname.slice(index + 1).replace(/\/$/, "");
    return pathname.replace(/^\/+/, "").replace(/\/$/, "");
  }

  function matchIn(table, patterns, key) {
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      return { handler: table[key], captured: {} };
    }
    for (const [pattern, name, names] of patterns) {
      const found = pattern.exec(key);
      if (!found) continue;
      const captured = {};
      names.forEach((field, index) => { captured[field] = found[index + 1]; });
      return { handler: table[name], captured };
    }
    return null;
  }

  /**
   * The handler for one key, and the statistic it answers for. A route of
   * another statistic is V11's route of the same path, answered from that
   * statistic's own folder, unless it is one of the few that statistic alone has.
   */
  function match(key, io) {
    const own = matchIn(OWN_HANDLERS, OWN_PATTERNS, key);
    const versioned = /^api\/(v\d+)\/(.*)$/.exec(key);
    const id = versioned && SITE_SOURCES.includes(versioned[1]) ? versioned[1] : "v11";
    if (own) return { ...own, io: scopedIo(io, id) };
    const v11Key = versioned && id !== "v11" ? `api/v11/${versioned[2]}` : key;
    const found = matchIn(handlers, PATTERNS, v11Key);
    return found ? { ...found, io: scopedIo(io, id) } : null;
  }

  /**
   * Answer one request from the built files.
   *
   * `io.json(path)` resolves a site-relative path to parsed JSON, or to null
   * when the file is not there.  The return is `{status, body}`, or
   * `{status: 0, passthrough}` when the caller should fetch a real file.
   */
  async function answer(urlLike, io) {
    const url = new URL(String(urlLike), "http://site.invalid/");
    const key = apiKey(url.pathname);
    // A package block is bytes, not JSON: hand it back as a real file so the
    // worker inflates the gzip the manifest fingerprinted.
    const packageFile = /^api\/v11\/experiment-packages\/(\d+)\/(.+)$/.exec(key);
    if (packageFile) {
      return { status: 0, passthrough: `${PACKAGE_PREFIX}${packageFile[1]}/${packageFile[2]}` };
    }
    const route = match(key, io);
    if (route === null) {
      return {
        status: 404,
        body: { detail: `${url.pathname} is not part of the published site.` },
      };
    }
    try {
      const body = await route.handler(route.io, url.searchParams, route.captured);
      return { status: 200, body };
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, body: { detail: error.detail } };
      throw error;
    }
  }

  // --- installing into a page or a worker --------------------------------------

  function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (typeof URL !== "undefined" && input instanceof URL) return input.href;
    if (input && typeof input.url === "string") return input.url;
    return String(input);
  }

  function requestMethod(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (input && typeof input.method === "string") return input.method.toUpperCase();
    return "GET";
  }

  function sitePath(pathname) {
    const clean = pathname.replace(/\/$/, "") || "/";
    return Object.prototype.hasOwnProperty.call(PAGES, clean) ? PAGES[clean] : null;
  }

  /** Map a site-absolute URL such as "/players?x=1" onto the built tree. */
  function rewriteSiteUrl(value, base) {
    const text = String(value ?? "");
    if (!text.startsWith("/") || text.startsWith("//")) return text;
    const url = new URL(text, "http://site.invalid/");
    const page = sitePath(url.pathname);
    if (page !== null) return new URL(page + url.search + url.hash, base).href;
    if (url.pathname.startsWith("/dashboard-assets/")) {
      const rest = url.pathname.slice("/dashboard-assets/".length).replace(/^v\d[^/]*\//, "");
      return new URL(`dashboard-assets/${rest}${url.search}${url.hash}`, base).href;
    }
    if (url.pathname.startsWith("/api/")) {
      return new URL(url.pathname.slice(1) + url.search + url.hash, base).href;
    }
    return text;
  }

  function shouldAutoInstall() {
    if (typeof fetch !== "function") return false;
    if (typeof document !== "undefined") return true;
    return typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined"
      && self instanceof WorkerGlobalScope;
  }

  function install() {
    const scope = typeof self === "undefined" ? globalThis : self;
    if (scope.__V11_STATIC_API_INSTALLED__) return scope.__V11_STATIC_API_INSTALLED__;
    const base = resolveBase();
    const nativeFetch = scope.fetch.bind(scope);
    const io = makeIo(base, nativeFetch);
    scope.__V11_STATIC_SITE_BASE__ = base;
    scope.__V11_SITE_BASE__ = base;
    scope.__V11_SITE_URL__ = (value) => rewriteSiteUrl(value, base);

    scope.fetch = async (input, init = {}) => {
      const href = requestUrl(input);
      const url = new URL(href, typeof location === "undefined" ? base : location.href);
      const key = apiKey(url.pathname);
      if (!key.startsWith("api/")) return nativeFetch(input, init);
      const method = requestMethod(input, init);
      if (method !== "GET" && method !== "HEAD") {
        return jsonResponse(405, { detail: "The published site is read-only." });
      }
      const result = await answer(url.href, io);
      if (result.status === 0) {
        return nativeFetch(new URL(result.passthrough, base).href, {
          credentials: "omit",
        });
      }
      return jsonResponse(result.status, result.body);
    };

    if (typeof document !== "undefined") installPageHelpers(scope, base);
    scope.__V11_STATIC_API_INSTALLED__ = { base, answer: (url) => answer(url, io) };
    return scope.__V11_STATIC_API_INSTALLED__;
  }

  /**
   * Keep every navigation inside the built tree.
   *
   * The pages build links such as "/players?player_id=..." at runtime, which
   * point at the domain root and so miss a project sub-path.  Rewriting the
   * anchor `href` setter, `setAttribute`, the History API and any href already
   * in the document covers every way one of those is produced, including the
   * ones injected through innerHTML.
   */
  function installPageHelpers(scope, base) {
    const map = (value) => rewriteSiteUrl(value, base);

    const descriptor = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, "href");
    if (descriptor && descriptor.set) {
      Object.defineProperty(HTMLAnchorElement.prototype, "href", {
        ...descriptor,
        set(value) { descriptor.set.call(this, map(value)); },
      });
    }
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function patchedSetAttribute(name, value) {
      // Chart marks are SVG anchors, which carry the same site-absolute hrefs.
      const anchor = this instanceof HTMLAnchorElement
        || (typeof SVGAElement !== "undefined" && this instanceof SVGAElement);
      if (String(name).toLowerCase() === "href" && anchor) {
        return setAttribute.call(this, name, map(value));
      }
      return setAttribute.call(this, name, value);
    };
    for (const name of ["pushState", "replaceState"]) {
      const original = history[name].bind(history);
      history[name] = (state, title, url) => original(
        state, title, url === undefined || url === null ? url : map(url),
      );
    }
    // An anchor written through innerHTML never passes the href setter, so the
    // document is swept once and then watched.  Re-setting the attribute goes
    // through the patched setAttribute above, which does the mapping.
    const fixOne = (node) => {
      const raw = node.getAttribute("href");
      if (raw && raw.startsWith("/") && !raw.startsWith("//")) {
        node.setAttribute("href", raw);
      }
    };
    const fixWithin = (root) => {
      if (root.nodeType !== 1) return;
      if (root.matches && root.matches("a[href]")) fixOne(root);
      if (root.querySelectorAll) root.querySelectorAll("a[href]").forEach(fixOne);
    };
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) fixWithin(node);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded", () => fixWithin(document.documentElement), { once: true },
      );
    } else {
      fixWithin(document.documentElement);
    }
    // The Experiments page reads this meta to build its API URLs, and hands
    // one to its worker, where a root-relative path would resolve from the
    // module directory instead of the site.
    const meta = document.querySelector('meta[name="v11-api-base"]');
    if (meta) meta.content = base.replace(/\/$/, "");
  }

  return Object.freeze({
    answer,
    install,
    shouldAutoInstall,
    rewriteSiteUrl,
    makeIo,
    makeDirectory,
    ilikeContains,
    seasonLabel,
    // Exported so the two implementations of a profile section can be run
    // against one another on identical inputs, the way the rest of this file's
    // internals already are (`makeDirectory`, `ilikeContains`).
    profileSections,
    spanRow,
    // The team page's selection arithmetic, for the same reason: it has to
    // reach the same answer as `v11_entity_api`'s, so both are run on the same
    // rows in `tests/test_v11_team_page_notes.py`.
    __testing: Object.freeze({
      expandStore,
      teamPerSeasonRoster,
      foldRoster,
      teamContribution,
      attachRosterTypes,
      teamSeasonRows,
      seasonRosters,
      profileYear,
      requestedIds,
      // The order a ranking page is read in, so the shim's rule and
      // `v11_api.sort_ranking_rows` can be run on the same rows.
      sortRankingRows,
      sortValue,
      styleIndex,
    }),
    PAGES,
    DATA_PREFIX,
    SOURCES_FILE,
    SITE_SOURCES,
    PROFILE_STORE_KEYS,
    PACKAGE_PREFIX,
    COMPONENTS,
    SEASON_TYPES,
  });
});
