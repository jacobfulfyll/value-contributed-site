export const PLAYER_CHART_SCHEDULES = Object.freeze([
  Object.freeze({ id: "full", label: "Full season" }),
  Object.freeze({ id: "regular_season", label: "Regular season" }),
  Object.freeze({ id: "postseason", label: "Postseason" }),
]);

const SCHEDULE_IDS = new Set(PLAYER_CHART_SCHEDULES.map((item) => item.id));

function selectedSchedules(values) {
  const selected = [...new Set(values ?? [])].filter((value) => SCHEDULE_IDS.has(value));
  return selected.length ? selected : ["full"];
}

function pointKey(point, grain) {
  return grain === "game" ? String(point.game_id) : Number(point.season_end_year);
}

function teamLabel(value) {
  return value?.abbreviation ?? value?.team_abbreviation ?? value?.name ?? value?.team_name ?? "";
}

function tooltip(point, scheduleLabel, grain, metric, cumulative) {
  const metricLabel = metric === "wins_contributed" ? "WC" : "VC";
  const raw = Number(point[metric] ?? 0);
  const cumulativeValue = Number(point[`cumulative_${metric}`] ?? raw);
  if (grain === "season") {
    return cumulative
      ? `${point.season} · ${scheduleLabel} · season ${metricLabel} ${raw.toFixed(3)} · career cumulative ${metricLabel} ${cumulativeValue.toFixed(3)}`
      : `${point.season} · ${scheduleLabel}`;
  }
  const opponent = teamLabel(point.opponent);
  const matchup = opponent ? `${point.location === "away" ? "@" : "vs."} ${opponent}` : "";
  const detail = [point.game_date, teamLabel(point.team), matchup, point.outcome].filter(Boolean).join(" · ");
  return cumulative
    ? `${detail} · game ${metricLabel} ${raw.toFixed(3)} · season cumulative ${metricLabel} ${cumulativeValue.toFixed(3)}`
    : detail;
}

export function buildPlayerContributionChart(chart, {
  metric = "value_contributed",
  cumulative = false,
  schedules = ["full"],
} = {}) {
  const grain = chart?.grain === "game" ? "game" : "season";
  const selected = selectedSchedules(schedules);
  const sources = (chart?.schedules ?? []).filter((schedule) => selected.includes(schedule.id));
  const labelsByKey = new Map();
  for (const schedule of sources) {
    for (const point of schedule.points ?? []) {
      const key = pointKey(point, grain);
      if (!labelsByKey.has(key)) {
        labelsByKey.set(key, grain === "game" ? {
          key,
          label: point.game_date,
          short: String(point.game_date ?? "").slice(5),
          order: `${point.game_date ?? ""}:${String(point.game_id)}`,
        } : {
          key,
          label: point.season,
          short: String(point.season_end_year),
          order: Number(point.season_end_year),
        });
      }
    }
  }
  const labels = [...labelsByKey.values()].sort((left, right) => grain === "game"
    ? String(left.order).localeCompare(String(right.order))
    : Number(left.order) - Number(right.order));
  const valueField = cumulative ? `cumulative_${metric}` : metric;
  const series = sources.map((schedule) => {
    const byKey = new Map((schedule.points ?? []).map((point) => [pointKey(point, grain), point]));
    return {
      key: `schedule:${schedule.id}`,
      label: schedule.label,
      points: labels.map((label, index) => {
        const point = byKey.get(label.key);
        if (!point) return null;
        return {
          index,
          value: Number(point[valueField] ?? 0),
          raw: Number(point[metric] ?? 0),
          tooltip: tooltip(point, schedule.label, grain, metric, cumulative),
        };
      }),
    };
  });
  return {
    grain,
    mode: cumulative
      ? (grain === "game" ? "season_cumulative" : "career_cumulative")
      : (grain === "game" ? "game_values" : "season_totals"),
    labels,
    series,
  };
}

// --- seasons compared by game ------------------------------------------------
//
// The season-by-season curve could say how good a season was; it could not say
// how one season went against another, because every season was one point.
// This model puts the game number inside the season on the x-axis, so several
// seasons of different lengths read on one 1..N run, and colours the
// postseason separately when exactly one season is drawn.

export const SEASON_LINE_PRESETS = Object.freeze([
  Object.freeze({ id: "all", label: "All selected seasons" }),
  Object.freeze({ id: "last-3", label: "Last 3 seasons" }),
  Object.freeze({ id: "last-5", label: "Last 5 seasons" }),
]);

const POSTSEASON_COLOR = "#8a2d2d";

export function seasonLineChoices(bySeason) {
  const seasons = (bySeason ?? []).map((row) => String(row.season));
  const presets = SEASON_LINE_PRESETS.filter((preset) => (
    preset.id === "all"
    || (preset.id === "last-3" && seasons.length > 3)
    || (preset.id === "last-5" && seasons.length > 5)
  ));
  return [...presets, ...seasons.map((season) => ({ id: season, label: season }))];
}

export function seasonsForChoice(bySeason, choice) {
  const seasons = (bySeason ?? []).map((row) => String(row.season));
  if (choice === "last-3") return seasons.slice(-3);
  if (choice === "last-5") return seasons.slice(-5);
  if (seasons.includes(String(choice))) return [String(choice)];
  return seasons;
}

function gameTooltip(game, metric, cumulative) {
  const short = metric === "wins_contributed" ? "WC" : "VC";
  const opponent = game.opponent_abbreviation ? `vs ${game.opponent_abbreviation}` : "";
  const result = game.result === "win" ? "won" : game.result === "loss" ? "lost" : "";
  const detail = [
    `Game ${game.game_number}`, game.game_date, opponent, result,
    game.postseason ? "postseason" : "",
  ].filter(Boolean).join(" · ");
  const raw = Number(game[metric] ?? 0);
  return cumulative
    ? `${detail} · game ${short} ${raw.toFixed(3)} · season total ${Number(game[`cumulative_${metric}`] ?? raw).toFixed(3)}`
    : `${detail} · ${short} ${raw.toFixed(3)}`;
}

export function buildSeasonGameChart(bySeason, {
  metric = "value_contributed",
  cumulative = false,
  seasons = null,
} = {}) {
  const rows = (bySeason ?? []).filter((row) => (row.games ?? []).length);
  const wanted = seasons === null ? null : new Set(seasons.map(String));
  const drawn = wanted === null ? rows : rows.filter((row) => wanted.has(String(row.season)));
  const longest = Math.max(0, ...drawn.map((row) => row.games.length));
  const labels = Array.from({ length: longest }, (_, index) => ({
    key: index + 1,
    label: `Game ${index + 1}`,
    short: String(index + 1),
  }));
  const field = cumulative ? `cumulative_${metric}` : metric;
  const point = (game, index) => ({
    index,
    value: Number(game[field] ?? 0),
    raw: Number(game[metric] ?? 0),
    tooltip: gameTooltip(game, metric, cumulative),
  });
  // One season draws its postseason in its own colour, as its own line, so a
  // reader can see where the season stopped being the regular season. The last
  // regular-season game is repeated at the head of the postseason line, which
  // is what joins the two without inventing a point.
  if (drawn.length === 1) {
    const games = drawn[0].games;
    const postseasonFrom = games.findIndex((game) => game.postseason);
    const regular = games.map((game, index) => (
      game.postseason ? null : point(game, index)
    ));
    const series = [{
      key: `season:${drawn[0].season}:regular`,
      label: postseasonFrom === -1 ? String(drawn[0].season) : "Regular season",
      color: null,
      points: regular,
    }];
    if (postseasonFrom > -1) {
      series.push({
        key: `season:${drawn[0].season}:postseason`,
        label: "Postseason",
        color: POSTSEASON_COLOR,
        points: games.map((game, index) => (
          game.postseason || index === postseasonFrom - 1 ? point(game, index) : null
        )),
      });
    }
    return { labels, series, seasons: [String(drawn[0].season)], singleSeason: true };
  }
  return {
    labels,
    series: drawn.map((row) => ({
      key: `season:${row.season}`,
      label: String(row.season),
      color: null,
      points: labels.map((_label, index) => (
        row.games[index] ? point(row.games[index], index) : null
      )),
    })),
    seasons: drawn.map((row) => String(row.season)),
    singleSeason: false,
  };
}
