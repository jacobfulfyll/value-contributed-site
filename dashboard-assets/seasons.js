import { mobilePhoto, setupMobilePage, prepareMobileTable, renderMobileLines, seasonStepper } from "./mobile-page-ui.js?v=mobile-pages-20260923-6";
import {
  createOriginalExperimentClient,
  createV9EntitySourceAdapter,
  experimentsSwitchedOn,
} from "./experiments/index.js";
import {
  CHART_PANEL_KEYS, createRankingsVisualWorkspace, SEASON_FACE_BUDGET,
} from "./rankings-visuals.js?v=v13-charts-20260927-19";
// Side-effect import: team-directory.js is a classic script shared with the
// rankings page and publishes itself on globalThis.
import "./team-directory.js";
import "./page-notice.js";
// Side-effect import: page-notice.js turns a browser's own "Failed to
// fetch" into a sentence a reader can act on, and leaves a message this
// site wrote alone.

const TEAM_DIRECTORY = globalThis.ValueContributedTeamDirectory ?? null;
const { readableError } = globalThis.ValueContributedPageNotice;
// Official statistics served by their own /api/<version> endpoints.
const SERVER_SOURCES = ["v11", "v12", "v13", "v10"];

const V9_RELEASE_ID = "60a96635-f13d-42a3-a18e-bf02df29f9b5";
const DEFAULT_SEASONS = Array.from({ length: 13 }, (_, index) => 2014 + index);
const COLORS = ["#1f6b50", "#8a4a24", "#315e79", "#65537c", "#826618", "#8a2d2d", "#337a87", "#765b39", "#4d6a45", "#805b77"];
const DASHES = ["", "8 4", "2 3", "12 4 2 4", "4 3 1 3", "14 4", "1 4", "10 3 3 3", "6 2 1 2", "3 5"];
const RACES = Object.freeze({
  main_character: { title: "How the Main Character race unfolded", note: "Cumulative Wins Contributed over each candidate’s regular-season and postseason games.", field: "wins_contributed", unit: "cumulative WC" },
  mvp: { title: "How the MVP race unfolded", note: "Cumulative Wins Contributed over each candidate’s regular-season games.", field: "wins_contributed", unit: "cumulative WC", regular: true },
  dpoy: { title: "How the defensive-player race unfolded", note: "Cumulative defense-only Wins Contributed over each candidate’s regular-season games.", field: "defensive_wins_contributed", unit: "cumulative D-WC", regular: true },
  postseason_mvp: { title: "How the postseason MVP race unfolded", note: "Cumulative Wins Contributed across Play-In and playoff games only.", field: "wins_contributed", unit: "postseason WC", postseason: true },
  postseason_defender: { title: "How the postseason defender race unfolded", note: "Cumulative defense-only Wins Contributed across Play-In and playoff games only.", field: "defensive_wins_contributed", unit: "postseason D-WC", postseason: true },
  roy: { title: "How the rookie race unfolded", note: "Cumulative Value Contributed over each first-observed candidate’s regular-season games.", field: "value_contributed", unit: "cumulative VC", regular: true },
});
const byId = (id) => document.getElementById(id);
const state = {
  client: null, adapter: null, sources: [], controller: null, storyController: null,
  workspace: null, landscape: null, landscapeSignal: null, enriched: null,
  chartRequest: null, chartsDrawn: false, awards: {}, storyCache: new Map(), gamesKey: null,
  // The three league-wide reads of the selected season, by schedule, so a
  // chart's own schedule switch never reads one twice.
  schedules: new Map(),
};
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[character]);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const number = (value, digits = 3) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value)) : "—";
const seasonLabel = (year) => `${Number(year) - 1}-${String(year).slice(-2).padStart(2, "0")}`;
const seasonEndYear = (season) => Number(String(season).slice(0, 4)) + 1;
const sourceId = () => byId("season-source").value;
const experimentId = () => sourceId().startsWith("experiment:") ? sourceId().slice(11) : null;
const selectedSeason = () => byId("season-year").value;

function profileHref(row, { gameId = null } = {}) {
  const params = new URLSearchParams({
    source: sourceId(), player_id: String(row.player_id), season: selectedSeason(),
    schedule: "all", time_mode: byId("season-time").value, metric: "wins_contributed",
  });
  if (gameId) params.set("game_id", String(gameId));
  return `/players?${params}`;
}

function serverTeam(teamId, abbreviation) {
  if (TEAM_DIRECTORY) return TEAM_DIRECTORY.teamRecord(teamId, { abbreviation });
  return { team_id: teamId, id: teamId, abbreviation: "—", name: "—", team_name: "—" };
}

async function officialPanel(panel, filters, signal) {
  const serverSource = SERVER_SOURCES.includes(sourceId()) ? sourceId() : null;
  if (serverSource) {
    const path = panel === "rankings"
      ? `/api/${serverSource}/rankings`
      : `/api/${serverSource}/top-games`;
    const season = filters.season === "All Seasons" ? null : seasonEndYear(filters.season);
    const params = new URLSearchParams({
      schedule: ({ All: "all", "Regular Season": "regular_season", PlayIn: "play_in", Playoffs: "playoffs", Postseason: "postseason" })[filters.phase] ?? "all",
      time_mode: filters.garbage_time_mode,
      limit: filters.limit ?? (panel === "rankings" ? "250" : "10"),
    });
    if (season) params.set("season_end_year", String(season));
    if (panel === "rankings") params.set("metric", filters.sort_by ?? "wins_contributed");
    else params.set("outcome", String(filters.outcome ?? "Both").toLowerCase());
    const response = await fetch(`${path}?${params}`, { signal });
    if (!response.ok) {
      throw new Error(`The ${serverSource.toUpperCase()} ${panel} panel could not be loaded.`);
    }
    const payload = await response.json();
    return {
      ...payload,
      // The charts name the statistic and build their player links from it, so
      // a server panel carries the version it was read from.
      stat_version: serverSource,
      selected_seasons: season ? [filters.season] : [],
      rows: (payload.rows ?? []).map((row) => ({
        ...row,
        minutes_played: finite(row.seconds_played) / 60,
        team: serverTeam(row.team_id, row.team_abbreviation),
        opponent: serverTeam(row.opponent_id, row.opponent_abbreviation),
      })),
    };
  }
  const path = panel === "rankings" ? "/api/rankings" : "/api/rankings/top-games";
  const params = new URLSearchParams({ stat_version: "original", ...filters });
  const response = await fetch(`${path}?${params}`, { signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail?.message ?? payload.detail ?? `The ${panel} panel could not be loaded.`);
  }
  return response.json();
}

async function localPanel(panel, filters, signal) {
  if (!state.client) throw new Error("Browser-local experiments are unavailable in this browser.");
  const result = await state.client.queryRankings(experimentId(), {
    panel, filters,
    sort: panel === "rankings" ? { key: "wins_contributed", direction: "desc" } : null,
    limit: panel === "rankings" ? 1000 : 10,
    offset: 0, signal,
  });
  const payload = result?.metadata?.panel_payload;
  if (!payload) throw new Error(`The local ${panel} projection returned no panel payload.`);
  return payload;
}

function rankingFilters(season = selectedSeason(), phase = "All") {
  return {
    season, phase, garbage_time_mode: byId("season-time").value,
    sort_by: "wins_contributed", sort_direction: "desc", limit: "1000", search: "", breakdown_mode: "wc",
  };
}

async function loadRanking(signal, season = selectedSeason(), phase = "All") {
  const filters = rankingFilters(season, phase);
  return experimentId() ? localPanel("rankings", filters, signal) : officialPanel("rankings", filters, signal);
}

// The landscape is what the two style charts read, and it is the heaviest thing
// this page can ask for — a whole season of published descriptions. It is
// therefore fetched when one of those panels is opened and never on load: the
// award races, the story and the best games are all answered by the ranking
// payloads the page already has.
async function enrichLandscape(payload, signal) {
  // V11 publishes a described player season — its type, map position and 36
  // measurements — on its own landscape route, which the two style charts read.
  if (sourceId() === "v11") {
    const params = new URLSearchParams({
      season: selectedSeason(), schedule: "all", time_mode: byId("season-time").value,
    });
    const response = await fetch(`/api/v11/rankings/player-landscape?${params}`, { signal });
    if (!response.ok) throw new Error("The season player type landscape could not be loaded.");
    const landscape = await response.json();
    state.landscape = landscape;
    return { ...payload, selected_seasons: [selectedSeason()], player_landscape: landscape };
  }
  // V12 publishes its own described player seasons on the same route under
  // /api/v12, typed by its own style build.
  if (sourceId() === "v12") {
    const params = new URLSearchParams({
      season: selectedSeason(), schedule: "all", time_mode: byId("season-time").value,
    });
    const response = await fetch(`/api/v12/rankings/player-landscape?${params}`, { signal });
    if (!response.ok) throw new Error("The season player type landscape could not be loaded.");
    const landscape = await response.json();
    state.landscape = landscape;
    return { ...payload, selected_seasons: [selectedSeason()], player_landscape: landscape };
  }
  // V13 does the same under /api/v13, typed by its own style build once it has one.
  if (sourceId() === "v13") {
    const params = new URLSearchParams({
      season: selectedSeason(), schedule: "all", time_mode: byId("season-time").value,
    });
    const response = await fetch(`/api/v13/rankings/player-landscape?${params}`, { signal });
    if (!response.ok) throw new Error("The season player type landscape could not be loaded.");
    const landscape = await response.json();
    state.landscape = landscape;
    return { ...payload, selected_seasons: [selectedSeason()], player_landscape: landscape };
  }
  if (SERVER_SOURCES.includes(sourceId())) {
    state.landscape = payload;
    return payload;
  }
  if (experimentId()) return payload;
  const params = new URLSearchParams({ source: "v9", season: selectedSeason(), schedule: "all", time_mode: byId("season-time").value });
  const response = await fetch(`/api/rankings/player-landscape?${params}`, { signal });
  if (!response.ok) throw new Error("The season player landscapes could not be loaded.");
  const landscape = await response.json();
  state.landscape = landscape;
  const byPlayer = new Map((landscape.rows ?? []).map((row) => [String(row.player_id), row]));
  return { ...payload, selected_seasons: [selectedSeason()], rows: (payload.rows ?? []).map((row) => ({ ...row, ...(byPlayer.get(String(row.player_id)) ?? {}) })) };
}

function awardRows(targetId, rows, value, label) {
  byId(targetId).innerHTML = rows.length ? rows.map((row, index) => `<div class="award-row"><span>${index + 1}</span><img src="https://cdn.nba.com/headshots/nba/latest/260x190/${Number(row.player_id)}.png" alt="" loading="lazy"/><a href="${profileHref(row)}">${escapeHtml(row.player_name)}</a><strong>${value(row) >= 0 && targetId === "mip-race" ? "+" : ""}${number(value(row))} ${label}</strong></div>`).join("") : '<p class="chart-note">No eligible players.</p>';
}

function previousSeasonForSource() {
  const previousYear = seasonEndYear(selectedSeason()) - 1;
  const source = state.sources.find((row) => row.id === sourceId());
  const available = (source?.scope?.season_end_years ?? source?.selected_seasons ?? DEFAULT_SEASONS).map(Number);
  return available.includes(previousYear) ? seasonLabel(previousYear) : null;
}

function renderAwards(regularPayload, postseasonPayload, previousRegularPayload = null, fullPayload = null) {
  const rows = regularPayload.rows ?? [];
  // Main Character: the most Wins Contributed over the whole season, regular
  // season and postseason together.
  const mainCharacter = [...(fullPayload?.rows ?? [])]
    .sort((a, b) => finite(b.wins_contributed) - finite(a.wins_contributed) || finite(a.player_id) - finite(b.player_id)).slice(0, 10);
  awardRows("main-character-race", mainCharacter, (row) => row.wins_contributed, "WC");
  const postseasonRows = postseasonPayload.rows ?? [];
  const mvp = [...rows].sort((a, b) => finite(b.wins_contributed) - finite(a.wins_contributed) || finite(a.player_id) - finite(b.player_id)).slice(0, 10);
  const dpoy = [...rows].sort((a, b) => finite(b.defensive_wins_contributed) - finite(a.defensive_wins_contributed) || finite(a.player_id) - finite(b.player_id)).slice(0, 10);
  const postseasonMvp = [...postseasonRows]
    .sort((a, b) => finite(b.wins_contributed) - finite(a.wins_contributed) || finite(a.player_id) - finite(b.player_id)).slice(0, 10);
  const postseasonDefender = [...postseasonRows]
    .sort((a, b) => finite(b.defensive_wins_contributed) - finite(a.defensive_wins_contributed) || finite(a.player_id) - finite(b.player_id)).slice(0, 10);
  awardRows("mvp-race", mvp, (row) => row.wins_contributed, "WC");
  awardRows("dpoy-race", dpoy, (row) => row.defensive_wins_contributed, "D-WC");
  awardRows("postseason-mvp-race", postseasonMvp, (row) => row.wins_contributed, "WC");
  awardRows("postseason-defender-race", postseasonDefender, (row) => row.defensive_wins_contributed, "D-WC");

  const year = seasonEndYear(selectedSeason());
  let rookies = [];
  // A statistic's first season is its dataset boundary: every player in it
  // debuts there as far as its own history knows (V13's begins in 2017-18,
  // V11's in 2013-14), so no rookie can be told from a veteran.
  const served = (state.sources.find((row) => row.id === sourceId())?.scope?.season_end_years ?? [])
    .map(Number).filter(Number.isFinite);
  const firstYear = served.length ? Math.min(...served) : 2014;
  if (year === firstYear) {
    byId("roy-race").innerHTML = `<p class="chart-note">Unavailable at the dataset boundary: ${seasonLabel(firstYear)} cannot distinguish established players from true rookies.</p>`;
  } else if (experimentId()) {
    byId("roy-race").innerHTML = '<p class="chart-note">Unavailable for browser experiments until a complete-history debut catalog is projected. V9 rows are never substituted into an experiment.</p>';
  } else {
    // A player's first calculated season is on the ranking row itself, so the
    // rookie race is answered by the payload this page already has rather than
    // by the landscape, which is now only fetched when a style chart is opened.
    const firstByPlayer = new Map(rows.map((row) => [String(row.player_id), Number(row.career_first_season_end_year)]));
    for (const row of state.landscape?.rows ?? []) {
      if (!firstByPlayer.has(String(row.player_id))) {
        firstByPlayer.set(String(row.player_id), Number(row.career_first_season_end_year));
      }
    }
    rookies = rows.filter((row) => firstByPlayer.get(String(row.player_id)) === year)
      .sort((a, b) => finite(b.value_contributed) - finite(a.value_contributed) || finite(a.player_id) - finite(b.player_id)).slice(0, 10);
    awardRows("roy-race", rookies, (row) => row.value_contributed, "VC");
  }

  let improved = [];
  if (previousRegularPayload) {
    const previous = new Map((previousRegularPayload.rows ?? []).map((row) => [String(row.player_id), row]));
    improved = rows.map((row) => {
      const prior = previous.get(String(row.player_id));
      if (!prior || finite(row.games_played) < 20 || finite(prior.games_played) < 20) return null;
      const currentRate = finite(row.wins_contributed) / finite(row.games_played);
      const previousRate = finite(prior.wins_contributed) / finite(prior.games_played);
      return { ...row, _mip_delta: currentRate - previousRate, _previous_wc_per_game: previousRate };
    }).filter((row) => row && row._mip_delta > 0)
      .sort((a, b) => b._mip_delta - a._mip_delta || finite(a.player_id) - finite(b.player_id)).slice(0, 10);
    awardRows("mip-race", improved, (row) => row._mip_delta, "WC/game");
  } else {
    byId("mip-race").innerHTML = '<p class="chart-note">Unavailable because the immediately preceding season is not complete in this source.</p>';
  }
  state.awards = { main_character: { rows: mainCharacter }, mvp: { rows: mvp }, dpoy: { rows: dpoy }, postseason_mvp: { rows: postseasonMvp }, postseason_defender: { rows: postseasonDefender }, roy: { rows: rookies } };
}

// The best games are a closed disclosure too: read the first time they are
// opened, and again only when what they were read for has changed.
const gamesKey = () => [sourceId(), selectedSeason(), byId("season-time").value, byId("season-games-phase").value, byId("season-games-outcome").value].join("|");

async function loadGamesIfOpen(signal) {
  if (!byId("season-games-panel").open || state.gamesKey === gamesKey()) return;
  await loadGames(signal);
}

async function loadGames(signal) {
  state.gamesKey = gamesKey();
  const filters = { season: selectedSeason(), phase: byId("season-games-phase").value, outcome: byId("season-games-outcome").value, garbage_time_mode: byId("season-time").value, limit: "25" };
  byId("season-games-body").innerHTML = '<tr><td colspan="9">Loading the top 25 games…</td></tr>';
  const payload = experimentId() ? await localPanel("top-games", filters, signal) : await officialPanel("top-games", filters, signal);
  const rows = payload.rows ?? [];
  byId("season-games-body").innerHTML = rows.length ? rows.map((row) => {
    const venue = row.location === "away" ? "@" : "vs.";
    return `<tr><td>${finite(row.rank)}</td><td>${mobilePhoto(row.player_id)}<a href="${profileHref(row, {gameId:row.game_id})}">${escapeHtml(row.player_name)}</a></td><td>${escapeHtml(row.game_date)}</td><td>${escapeHtml(row.team?.abbreviation ?? "—")}</td><td>${venue} ${escapeHtml(row.opponent?.abbreviation ?? "—")}</td><td>${escapeHtml(row.season_type)}</td><td>${row.win_loss ? "W" : "L"}</td><td class="numeric">${number(row.value_contributed)}</td><td><a class="game-anatomy-button" href="${profileHref(row, { gameId: row.game_id })}">See build</a></td></tr>`;
  }).join("") : '<tr><td colspan="9">No games match these filters.</td></tr>';
  prepareMobileTable(byId("season-games-body"), {kind:"season-games",main:1,hidden:[8]});
  byId("season-games-meta").textContent = `Top ${rows.length} · ${byId("season-games-phase").selectedOptions[0].textContent} · ${byId("season-games-outcome").selectedOptions[0].textContent}`;
}

function storySeries(payload, raceKey) {
  const config = RACES[raceKey];
  const candidates = state.awards[raceKey]?.rows ?? [];
  const rowsByPlayer = new Map();
  for (const row of payload.rows ?? []) {
    if (config.postseason && !["PlayIn", "Playoffs"].includes(row.season_type)) continue;
    if (config.regular && row.season_type !== "Regular Season") continue;
    const key = String(row.player_id);
    if (!rowsByPlayer.has(key)) rowsByPlayer.set(key, []);
    rowsByPlayer.get(key).push(row);
  }
  return candidates.map((candidate, index) => {
    const rows = (rowsByPlayer.get(String(candidate.player_id)) ?? [])
      .sort((left, right) => String(left.game_date).localeCompare(String(right.game_date)) || String(left.game_id).localeCompare(String(right.game_id)));
    let cumulative = 0;
    const points = rows.map((row, gameIndex) => {
      cumulative += finite(row[config.field]);
      const value = cumulative;
      return { ...row, value, game_number: gameIndex + 1, timestamp: Date.parse(`${row.game_date}T00:00:00Z`) };
    });
    return { ...candidate, color: COLORS[index % COLORS.length], dash: DASHES[index % DASHES.length], points };
  }).filter((series) => series.points.length);
}

// Two ways to read the same race (owner's note, 2026-09-27): the line ends,
// as the chart was first drawn but with faces a third larger, and the gap to
// whoever led on each date.
const STORY_VIEWS = Object.freeze({ ends: "Line ends", gap: "Gap to the leader" });

// For the gap view every contender is read on every game date of the race:
// the total he had reached by that date (none before his first game).
function storyDisplaySeries(series, view) {
  if (view !== "gap") return series;
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.timestamp)))].sort((a, b) => a - b);
  const cursor = series.map(() => -1);
  const perDate = dates.map((date) => series.map((item, index) => {
    while (cursor[index] + 1 < item.points.length && item.points[cursor[index] + 1].timestamp <= date) cursor[index] += 1;
    return cursor[index] < 0 ? null : item.points[cursor[index]];
  }));
  return series.map((item, index) => ({
    ...item,
    points: dates.flatMap((date, dateIndex) => {
      const own = perDate[dateIndex][index];
      if (!own) return [];
      const values = perDate[dateIndex].map((point) => (point ? point.value : 0));
      return [{ ...own, timestamp: date, game_date: new Date(date).toISOString().slice(0, 10), raw: own.value, value: Math.max(...values) - own.value }];
    }),
  }));
}

function renderStory(payload, raceKey) {
  const config = RACES[raceKey];
  const view = Object.hasOwn(STORY_VIEWS, byId("season-story-view")?.value) ? byId("season-story-view").value : "ends";
  byId("season-story-title").textContent = config.title;
  byId("season-story-note").textContent = `${config.note}${view === "gap"
    ? " Each line is how far a contender was behind whoever led on that date; the leader rides the top line."
    : ""}`;
  const series = storySeries(payload, raceKey);
  const container = byId("season-story-chart");
  const status = byId("season-story-status");
  if (!series.length) {
    container.innerHTML = '<p class="chart-note">This race is unavailable for the selected source and season.</p>';
    byId("season-story-table").innerHTML = "";
    status.innerHTML = '<strong>Race unavailable</strong><span>No eligible player-game series can be drawn.</span>';
    return;
  }
  const shown = storyDisplaySeries(series, view);
  const unit = config.unit.split(" ").at(-1);
  const width = Math.max(360, Math.floor(container.getBoundingClientRect().width || 960));
  const height = Math.max(390, Math.min(570, Math.round(width * .52)));
  // The gap view finishes in a column of its own on a wide screen: a large
  // face, the name and the result, in finishing order and joined to the end
  // of each line, so no face sits on another.
  const finishColumn = width >= 620 && view === "gap";
  const margin = { top: 24, right: finishColumn ? 236 : width < 620 ? 20 : 38, bottom: 62, left: width < 620 ? 62 : 78 };
  const allPoints = shown.flatMap((item) => item.points);
  let xMin = Math.min(...allPoints.map((point) => point.timestamp));
  let xMax = Math.max(...allPoints.map((point) => point.timestamp));
  if (xMin === xMax) xMax += 86400000;
  // The gap reads downward: no gap, the leader, is the top line.
  const inverted = view === "gap";
  let yMin = Math.min(0, ...allPoints.map((point) => point.value));
  let yMax = Math.max(0, ...allPoints.map((point) => point.value));
  if (yMin === yMax) yMax += 1;
  const yPad = (yMax - yMin) * .08;
  // A gap is never below zero, so its axis starts at the top line exactly.
  yMin = view === "gap" ? 0 : yMin - yPad; yMax += yPad;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (value) => margin.left + (value - xMin) / (xMax - xMin) * (width - margin.left - margin.right);
  const y = (value) => (inverted
    ? margin.top + (value - yMin) / (yMax - yMin) * plotHeight
    : height - margin.bottom - (value - yMin) / (yMax - yMin) * plotHeight);
  const path = (points) => points.map((point, index) => `${index ? "L" : "M"}${x(point.timestamp).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
  const dateLabel = (timestamp) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(timestamp));
  const xTicks = Array.from({ length: 5 }, (_, index) => xMin + (xMax - xMin) * index / 4);
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yMax - yMin) * index / 4);
  const yTickLabel = (tick) => number(tick, 2);
  const yTitle = view === "gap" ? `${unit} behind the leader` : config.unit;
  const result = (end) => (view === "gap"
    ? (end.value <= 1e-9 ? `Leads · ${number(end.raw)} ${unit}` : `${number(end.value)} behind`)
    : `${number(end.value)} ${unit}`);
  // The line ends are the chart as first drawn, with faces a third larger.
  const faceRadius = finishColumn ? 19 : 11 * 1.33;
  const finishes = new Map();
  if (finishColumn) {
    const gap = faceRadius * 2 + 6;
    const top = margin.top + faceRadius; const bottom = height - margin.bottom - faceRadius;
    const order = shown.map((item) => ({ id: String(item.player_id), y: y(item.points.at(-1).value) }))
      .sort((left, right) => left.y - right.y);
    order.forEach((entry, index) => { entry.y = Math.max(entry.y, top, index ? order[index - 1].y + gap : top); });
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const limit = index === order.length - 1 ? bottom : order[index + 1].y - gap;
      order[index].y = Math.min(order[index].y, limit);
    }
    order.forEach((entry) => finishes.set(entry.id, entry.y));
  }
  const groups = shown.map((item, index) => {
    const line = path(item.points); const end = item.points.at(-1);
    const faceId = `season-story-face-${raceKey}-${item.player_id}-${index}`;
    const endX = x(end.timestamp); const endY = y(end.value);
    const faceX = finishColumn ? width - margin.right + 30 + faceRadius : endX;
    const faceY = finishColumn ? finishes.get(String(item.player_id)) : endY;
    const faceInitials = item.player_name.split(/\s+/u).slice(0, 2).map((part) => part[0]).join("");
    const finish = finishColumn
      ? `<path class="season-story-leader" d="M${endX.toFixed(1)},${endY.toFixed(1)} L${(faceX - faceRadius - 8).toFixed(1)},${faceY.toFixed(1)} L${(faceX - faceRadius).toFixed(1)},${faceY.toFixed(1)}" stroke="${item.color}"/><circle class="season-story-tip" cx="${endX}" cy="${endY}" r="3.5" fill="${item.color}"/>`
        + `<text class="season-story-finish-name" x="${faceX + faceRadius + 9}" y="${faceY - 2}">${escapeHtml(item.player_name)}</text><text class="season-story-finish-value" x="${faceX + faceRadius + 9}" y="${faceY + 13}">${escapeHtml(result(end))}</text>`
      : "";
    return `<g class="season-story-series" data-story-player="${item.player_id}"><defs><clipPath id="${faceId}"><circle cx="${faceX}" cy="${faceY}" r="${faceRadius - 1.5}"/></clipPath></defs><path class="season-story-line" d="${line}" stroke="${item.color}"${item.dash ? ` stroke-dasharray="${item.dash}"` : ""}/>${finish}<path class="season-story-hit" d="${line}" tabindex="0" aria-label="${escapeHtml(item.player_name)} ${escapeHtml(result(end))}"/><circle class="season-story-face-back" cx="${faceX}" cy="${faceY}" r="${faceRadius}" fill="${item.color}"/><text class="season-story-face-initials" x="${faceX}" y="${faceY + 3}" text-anchor="middle">${escapeHtml(faceInitials)}</text><image class="season-story-face-image" href="https://cdn.nba.com/headshots/nba/latest/1040x760/${Number(item.player_id)}.png" x="${faceX - faceRadius}" y="${faceY - faceRadius * .82}" width="${faceRadius * 2}" height="${faceRadius * 1.64}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${faceId})"/><circle class="season-story-end season-story-face-back" cx="${faceX}" cy="${faceY}" r="${faceRadius}" fill="none" stroke="${item.color}"/><title>${escapeHtml(item.player_name)} · ${escapeHtml(result(end))}</title></g>`;
  }).join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(config.title)}">${xTicks.map((tick) => `<line class="season-story-grid" x1="${x(tick)}" x2="${x(tick)}" y1="${margin.top}" y2="${height - margin.bottom}"/><text class="season-story-axis" x="${x(tick)}" y="${height - margin.bottom + 23}" text-anchor="middle">${dateLabel(tick)}</text>`).join("")}${yTicks.map((tick) => `<line class="season-story-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="season-story-axis" x="${margin.left - 10}" y="${y(tick) + 4}" text-anchor="end">${yTickLabel(tick)}</text>`).join("")}<text class="axis-title" x="${width / 2}" y="${height - 13}" text-anchor="middle">Season calendar</text><text class="axis-title" x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})">${escapeHtml(yTitle)}</text>${groups}</svg><ul class="season-story-legend">${series.map((item) => `<li><button type="button" data-story-legend="${item.player_id}" style="--series-color:${item.color}"><i></i>${escapeHtml(item.player_name)}</button></li>`).join("")}</ul>`;
  const defaultStatus = `<strong>${series.length} contenders</strong><span>Hover or focus a line to follow one player across the season.</span>`;
  const applyHighlight = (playerId = null, point = null) => {
    container.classList.toggle("has-highlight", Boolean(playerId));
    container.querySelectorAll(".season-story-series").forEach((group) => group.classList.toggle("is-highlighted", group.dataset.storyPlayer === String(playerId)));
    if (!playerId) { status.innerHTML = defaultStatus; return; }
    const item = shown.find((candidate) => String(candidate.player_id) === String(playerId));
    const selectedPoint = point ?? item?.points.at(-1);
    const reading = view === "gap"
      ? `${selectedPoint?.value <= 1e-9 ? "leading" : `${number(selectedPoint?.value)} behind the leader`} · ${number(selectedPoint?.raw)} ${unit}`
      : `game ${finite(selectedPoint?.game_number)} · ${number(selectedPoint?.value)} ${config.unit}`;
    status.innerHTML = `<strong>${escapeHtml(item?.player_name)}</strong><span>${escapeHtml(selectedPoint?.game_date)} · ${escapeHtml(reading)}</span>`;
  };
  const pointAtEvent = (event, item) => {
    const rect = container.querySelector("svg").getBoundingClientRect();
    const chartX = (event.clientX - rect.left) / rect.width * width;
    return item.points.reduce((best, point) => Math.abs(x(point.timestamp) - chartX) < Math.abs(x(best.timestamp) - chartX) ? point : best, item.points[0]);
  };
  container.querySelectorAll(".season-story-series").forEach((group) => {
    const item = shown.find((candidate) => String(candidate.player_id) === group.dataset.storyPlayer);
    const hit = group.querySelector(".season-story-hit");
    hit.addEventListener("pointerenter", (event) => applyHighlight(item.player_id, pointAtEvent(event, item)));
    hit.addEventListener("pointermove", (event) => applyHighlight(item.player_id, pointAtEvent(event, item)));
    hit.addEventListener("pointerleave", () => applyHighlight());
    hit.addEventListener("focus", () => applyHighlight(item.player_id));
    hit.addEventListener("blur", () => applyHighlight());
  });
  container.querySelectorAll("[data-story-legend]").forEach((button) => {
    button.addEventListener("pointerenter", () => applyHighlight(button.dataset.storyLegend));
    button.addEventListener("pointerleave", () => applyHighlight());
    button.addEventListener("focus", () => applyHighlight(button.dataset.storyLegend));
    button.addEventListener("blur", () => applyHighlight());
  });
  status.innerHTML = defaultStatus;
  byId("season-story-table").innerHTML = `<details><summary>View race endpoints as a table</summary><table><thead><tr><th>Player</th><th>${escapeHtml(config.unit)}</th><th>Games shown</th></tr></thead><tbody>${series.map((item) => `<tr><th><a href="${profileHref(item)}">${escapeHtml(item.player_name)}</a></th><td>${number(item.points.at(-1).value)}</td><td>${item.points.length}</td></tr>`).join("")}</tbody></table></details>`;
  const dates=[...new Set(series.flatMap(item=>item.points.map(point=>point.timestamp)))].sort((a,b)=>a-b);
  const firstDate=dates[0], day=86400000;
  const labels=Array.from({length:Math.round((dates.at(-1)-firstDate)/day)+1},(_,i)=>dateLabel(firstDate+i*day));
  // The phone draws the view that is picked: the gap view hands it each
  // contender's distance behind the leader, with the leader on the top line.
  renderMobileLines(container, shown.map(item=>({key:String(item.player_id),label:item.player_name,points:item.points.map(point=>({index:Math.round((point.timestamp-firstDate)/day),value:point.value,tooltip:view==="gap"?`${point.game_date} · ${number(point.raw)} ${unit}`:`${point.game_date} · game ${point.game_number}`}))})),{xLabels:labels,unit:view==="gap"?`${unit} behind the leader`:config.unit,title:config.title,scopeKey:`${sourceId()}:${selectedSeason()}:${raceKey}`,invert:view==="gap"});

}

async function loadStory(raceKey = byId("season-story-race").value, signal = null) {
  const candidates = state.awards[raceKey]?.rows ?? [];
  const ids = candidates.map((row) => Number(row.player_id));
  const config = RACES[raceKey];
  byId("season-story-title").textContent = config.title;
  byId("season-story-note").textContent = config.note;
  if (!ids.length) { renderStory({ rows: [] }, raceKey); return; }
  const cacheKey = [sourceId(), selectedSeason(), byId("season-time").value, raceKey, ids.join(",")].join(":");
  let payload = state.storyCache.get(cacheKey);
  if (!payload) {
    byId("season-story-status").innerHTML = '<strong>Loading race</strong><span>Reading the top candidates’ player-game rows.</span>';
    payload = await state.adapter.query(sourceId(), "season_story", {
      source: sourceId(), scope: "season", season: selectedSeason(), schedule: config.postseason ? "postseason" : config.regular ? "regular_season" : "all",
      time_mode: byId("season-time").value, metric: "wins_contributed", player_ids: ids,
    }, { signal });
    state.storyCache.set(cacheKey, payload);
  }
  renderStory(payload, raceKey);
}

// The charts and the story are disclosures, and each one pays for itself
// the first time it is opened. `drawChartsIfOpen` reads the whole season —
// every schedule, every player — which is the heaviest of this page's reads and
// the one nothing above the charts needs.
function anyChartPanelOpen() {
  return CHART_PANEL_KEYS.some((key) => chartPanel(key)?.open);
}

function chartPanel(key) {
  return document.querySelector(`[data-rankings-panel="${key}"]`);
}

async function drawChartsIfOpen(controller, key = null) {
  if (!anyChartPanelOpen()) return;
  // Once the season is drawn, opening a second panel is the workspace's own
  // job: re-rendering would throw away the descriptions it has already read.
  if (state.chartsDrawn) {
    if (key) await state.workspace.openPanel(key);
    return;
  }
  if (!state.chartRequest) state.chartRequest = loadRanking(controller.signal);
  const result = await state.chartRequest;
  const payload = {...result, breakdown_mode:"wc"};
  if (state.controller !== controller) return;
  state.enriched = payload;
  state.chartsDrawn = true;
  await state.workspace.render(payload);
  state.workspace.renderRegularPost({
    ...payload, breakdown_mode: byId("season-reg-post-metric").value,
  });
}

async function drawStoryIfOpen(raceKey, signal) {
  if (!byId("season-story-panel").open) return;
  await loadStory(raceKey, signal);
}

function syncUrl() {
  const params = new URLSearchParams({ source: sourceId(), season: selectedSeason(), time_mode: byId("season-time").value });
  history.replaceState({}, "", `/seasons?${params}`);
}

async function load() {
  state.controller?.abort();
  state.storyController?.abort();
  const controller = new AbortController();
  state.controller = controller;
  syncUrl();
  byId("season-loading").hidden = false;
  byId("season-error").hidden = true;
  byId("season-content").hidden = true;
  state.landscape = null;
  try {
    const previousSeason = previousSeasonForSource();
    // Three of the four league-wide reads answer the award races, which are
    // what this page is for. The fourth — the whole season, every schedule —
    // is only ever drawn by the charts, so it waits until one is opened.
    // The Main Character race reads the whole season, which is also what the
    // charts draw first, so it is read once here and handed to them.
    const [regularRanking, postseasonRanking, previousRegularRanking, fullRanking] = await Promise.all([
      loadRanking(controller.signal, selectedSeason(), "Regular Season"),
      loadRanking(controller.signal, selectedSeason(), "Postseason"),
      previousSeason ? loadRanking(controller.signal, previousSeason, "Regular Season").catch(() => null) : Promise.resolve(null),
      loadRanking(controller.signal, selectedSeason(), "All"),
    ]);
    if (state.controller !== controller) return;
    state.enriched = null;
    state.chartRequest = Promise.resolve(fullRanking);
    state.schedules = new Map([["Regular Season", regularRanking], ["Postseason", postseasonRanking], ["All", fullRanking]]);
    state.chartsDrawn = false;
    state.landscapeSignal = controller.signal;
    renderAwards(regularRanking, postseasonRanking, previousRegularRanking, fullRanking);
    byId("season-content").hidden = false;
    await state.workspace.render(null);
    // A new selection means the games, if open, are read again.
    state.gamesKey = null;
    await Promise.all([
      drawChartsIfOpen(controller),
      drawStoryIfOpen(byId("season-story-race").value, controller.signal),
      loadGamesIfOpen(controller.signal),
    ]);
    byId("season-title").textContent = `${selectedSeason()} season room`;
    const source = state.sources.find((row) => row.id === sourceId());
    const sourceLabel = source?.label ?? sourceId().toUpperCase();
    byId("season-status-title").textContent = sourceLabel;
    byId("season-eyebrow").textContent = `${sourceLabel} · SEASON ROOM`;
    document.title = `Seasons · ${sourceLabel} Value Contributed`;
    byId("season-status-detail").textContent = source?.kind === "experiment" ? "Completed browser-local experiment" : source?.id === "v9" ? "Approved full-lineup 1× calculation" : "Official calculation";
  } catch (error) {
    if (error.name === "AbortError") return;
    byId("season-error").textContent = readableError(error);
    byId("season-error").hidden = false;
  } finally {
    if (state.controller === controller) byId("season-loading").hidden = true;
  }
}

function setSeasonOptions(requested = null) {
  const source = state.sources.find((row) => row.id === sourceId());
  const years = (source?.scope?.season_end_years ?? source?.selected_seasons ?? DEFAULT_SEASONS).map(Number).sort((a, b) => b - a);
  byId("season-year").innerHTML = years.map((year) => `<option value="${seasonLabel(year)}">${seasonLabel(year)}</option>`).join("");
  if (requested && years.includes(seasonEndYear(requested))) byId("season-year").value = requested;
  seasonStepper(byId("season-year"));
}

async function bootstrap() {
  setupMobilePage();
  const manifestUrl = document.querySelector('meta[name="original-package-manifest"]')?.content;
  const manifestSha256 = document.querySelector('meta[name="original-package-manifest-sha256"]')?.content;
  // Nothing browser-local starts while the site-wide experiments switch is
  // off: no runtime module, no worker and no IndexedDB.
  if (experimentsSwitchedOn() && manifestUrl && /^[0-9a-f]{64}$/.test(manifestSha256 ?? "")) {
    try {
      state.client = await createOriginalExperimentClient({ manifestAuthority: { url: manifestUrl, sha256: manifestSha256, releaseId: V9_RELEASE_ID } });
      await state.client.markStaleReleases(V9_RELEASE_ID);
    } catch (error) { console.warn("Browser-local experiments are unavailable on Seasons.", error); }
  }
  state.adapter = createV9EntitySourceAdapter({ experimentClient: state.client });
  // With the switch off the adapter lists the default statistic alone, so
  // there is nothing to choose and the picker stays hidden.
  state.sources = await state.adapter.listSources();
  const sourceSelect = byId("season-source");
  byId("season-source-control").hidden = !experimentsSwitchedOn();
  sourceSelect.innerHTML = `<optgroup label="Official">${state.sources.filter((row) => row.kind === "official").map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`).join("")}</optgroup>`;
  const experiments = state.sources.filter((row) => row.kind === "experiment");
  if (experiments.length) sourceSelect.insertAdjacentHTML("beforeend", `<optgroup label="My Experiments">${experiments.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`).join("")}</optgroup>`);
  const params = new URLSearchParams(location.search);
  if (state.sources.some((row) => row.id === params.get("source"))) sourceSelect.value = params.get("source");
  else {
    // The page opens on the statistic /api/sources names as the default
    // (V13); the earlier ones are selectable only with the switch on.
    const preferred = state.sources.find((row) => row.kind === "official" && row.default)?.id
      ?? SERVER_SOURCES.find((id) => state.sources.some((row) => row.id === id));
    if (preferred) sourceSelect.value = preferred;
  }
  if (["competitive", "all_minutes"].includes(params.get("time_mode"))) byId("season-time").value = params.get("time_mode");
  setSeasonOptions(params.get("season"));
  // The season room has no ranking table above its charts, so the drawn-count
  // note names the season instead of a control that is not on this page.
  state.workspace = createRankingsVisualWorkspace({
    // The charts are disclosures on this page too, so nothing is drawn —
    // and the season's published descriptions are not fetched — until a reader
    // opens one.
    panelElements: new Map(CHART_PANEL_KEYS.map((key) => [
      key, document.querySelector(`[data-rankings-panel="${key}"]`),
    ])),
    scopeCopy: {
      subject: "in this season",
      order: "Wins Contributed order",
      control: "",
    },
    // A whole league is far past the size at which the rankings page turns
    // faces into dots, and the season room is where a reader is looking for
    // faces, so its two scatter charts draw the best hundred as faces.
    faceBudget: SEASON_FACE_BUDGET,
    // Opening a style chart is the moment this season's descriptions are read.
    loadVisualPayload: async (payload) => {
      const enriched = await enrichLandscape(payload, state.landscapeSignal);
      state.enriched = enriched;
      return enriched;
    },
    loadComparisonPayload: async (payload) => payload,
    // The offense/defense chart and the type lanes each carry a regular /
    // full / postseason switch; the season's three reads answer it.
    loadSchedulePayload: async (schedule) => state.schedules.get(schedule)
      ?? loadRanking(state.controller?.signal, selectedSeason(), schedule),
    regPostSearch: true,
    // Nothing is read until a chart is opened, so the V13 panels follow the
    // source picker until then.
    sourceBeforePayload: () => sourceId(),
  });
  sourceSelect.addEventListener("change", () => { setSeasonOptions(); load(); });
  byId("season-year").addEventListener("change", load);
  byId("mobile-map-limit").addEventListener("change", async event => {
    document.querySelector("[data-mobile-chart-limit]").dataset.mobileChartLimit=event.target.value;
    if(state.enriched) {
      await state.workspace.render(state.enriched);
      state.workspace.renderRegularPost({ ...state.enriched, breakdown_mode: byId("season-reg-post-metric").value });
    }
  });
  byId("season-time").addEventListener("change", load);
  byId("season-reg-post-metric").addEventListener("change", () => {
    if (state.enriched) state.workspace.renderRegularPost({ ...state.enriched, breakdown_mode: byId("season-reg-post-metric").value });
  });
  for (const key of CHART_PANEL_KEYS) {
    chartPanel(key)?.addEventListener("toggle", async () => {
      const controller = state.controller;
      if (!controller || !chartPanel(key)?.open) return;
      try { await drawChartsIfOpen(controller, key); }
      catch (error) {
        if (error.name !== "AbortError") {
          byId("season-error").textContent = readableError(error);
          byId("season-error").hidden = false;
        }
      }
    });
  }
  byId("season-story-panel").addEventListener("toggle", async () => {
    if (!byId("season-story-panel").open) return;
    state.storyController?.abort();
    state.storyController = new AbortController();
    try { await loadStory(byId("season-story-race").value, state.storyController.signal); }
    catch (error) {
      if (error.name !== "AbortError") byId("season-story-status").innerHTML = `<strong>Race unavailable</strong><span>${escapeHtml(readableError(error))}</span>`;
    }
  });
  byId("season-story-view").addEventListener("change", async () => {
    state.storyController?.abort();
    state.storyController = new AbortController();
    try { await drawStoryIfOpen(byId("season-story-race").value, state.storyController.signal); }
    catch (error) { if (error.name !== "AbortError") byId("season-story-status").innerHTML = `<strong>Race unavailable</strong><span>${escapeHtml(readableError(error))}</span>`; }
  });
  byId("season-story-race").addEventListener("change", async () => {
    state.storyController?.abort();
    state.storyController = new AbortController();
    try { await drawStoryIfOpen(byId("season-story-race").value, state.storyController.signal); }
    catch (error) { if (error.name !== "AbortError") byId("season-story-status").innerHTML = `<strong>Race unavailable</strong><span>${escapeHtml(readableError(error))}</span>`; }
  });
  byId("season-games-panel").addEventListener("toggle", async () => {
    try { await loadGamesIfOpen(state.controller?.signal); }
    catch (error) {
      state.gamesKey = null;
      if (error.name !== "AbortError") byId("season-games-meta").textContent = readableError(error);
    }
  });
  [byId("season-games-phase"), byId("season-games-outcome")].forEach((control) => control.addEventListener("change", async () => {
    const controller = new AbortController();
    try { await loadGames(controller.signal); } catch (error) { byId("season-games-meta").textContent = error.message; }
  }));
  await load();
}

bootstrap();
