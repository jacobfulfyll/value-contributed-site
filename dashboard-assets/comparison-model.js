import {
  howToRead,
  isLevelWithTheLeague,
  sectionOrientation,
  spokeReach,
  spokeRuns,
} from "./profile-sections.js";

const ADDITIVE_SUMMARY_FIELDS = Object.freeze([
  "games_played", "games", "appearances", "wins", "losses",
  "seconds_played", "minutes_played", "minutes", "value_contributed",
  "wins_contributed", "losses_contributed", "loss_value_contributed",
  "offense_value", "defense_value", "other_value",
]);

export const SOURCE_FAMILIES = Object.freeze([
  Object.freeze({
    id: "scoring",
    label: "Scoring & earned points",
    side: "offense",
    sources: Object.freeze([
      "administrative_bonus_point", "defensive_lane_replacement_point",
      "retained_foul_points", "scorer",
    ]),
  }),
  Object.freeze({
    id: "playmaking",
    label: "Playmaking",
    side: "offense",
    sources: Object.freeze(["assister", "ft_assister", "screen_assister"]),
  }),
  Object.freeze({
    id: "possession_extension",
    label: "Offensive possession extension",
    side: "offense",
    sources: Object.freeze([
      "offensive_boxout", "oreb_pool", "retained_foul_drawn",
    ]),
  }),
  Object.freeze({
    id: "offensive_efficiency",
    label: "Offensive efficiency & ball security",
    side: "offense",
    sources: Object.freeze([
      "regular_ft_shortfall", "retained_foul_oreb_shortfall",
      "terminal_fg_miss_2pt", "terminal_fg_miss_3pt", "turnover",
    ]),
  }),
  Object.freeze({
    id: "shot_defense",
    label: "Shot defense",
    side: "defense",
    sources: Object.freeze(["DFG_make", "DFG_miss", "block", "pressure_defense"]),
  }),
  Object.freeze({
    id: "defensive_possessions",
    label: "Defensive disruption & possession ending",
    side: "defense",
    sources: Object.freeze(["defensive_boxout", "defensive_rebound", "steal"]),
  }),
  Object.freeze({
    id: "defensive_discipline",
    label: "Defensive discipline",
    side: "defense",
    sources: Object.freeze([
      "administrative_point_penalty", "defensive_lane_violation_penalty",
      "ordinary_foul_penalty", "retained_foul_penalty",
    ]),
  }),
]);

const ALL_GOVERNED_SOURCES = Object.freeze(SOURCE_FAMILIES.flatMap((family) => family.sources));

export function assertSourceFamilyPartition(offenseSources, defenseSources) {
  const expected = [...offenseSources, ...defenseSources].sort();
  const actual = [...ALL_GOVERNED_SOURCES].sort();
  if (actual.length !== new Set(actual).size
      || expected.length !== actual.length
      || expected.some((key, index) => key !== actual[index])) {
    throw new Error("The comparison source-family registry must include every governed source exactly once.");
  }
  return true;
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function fsum(values) {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const numeric = finite(value);
    const next = sum + numeric;
    correction += Math.abs(sum) >= Math.abs(numeric)
      ? (sum - next) + numeric
      : (numeric - next) + sum;
    sum = next;
  }
  return sum + correction;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function sourceMap(fingerprint = {}, metric = "value_contributed") {
  const rows = metric === "wins_contributed"
    ? fingerprint.wins_sources ?? []
    : fingerprint.sources ?? [];
  return new Map(rows.map((row) => [String(row.key), finite(row.value)]));
}

export function sourceFamilyRates(profile, metric = "value_contributed") {
  const seconds = finite(profile?.summary?.seconds_played,
    finite(profile?.summary?.minutes_played) * 60);
  const per36 = seconds > 0 ? 2160 / seconds : 0;
  const sources = sourceMap(profile?.fingerprint, metric);
  return SOURCE_FAMILIES.map((family) => ({
    id: family.id,
    label: family.label,
    side: family.side,
    value: fsum(family.sources.map((key) => sources.get(key) ?? 0)) * per36,
    sources: family.sources.map((key) => ({ key, value: (sources.get(key) ?? 0) * per36 })),
  }));
}

export function midrankPercentiles(rows, value = (row) => row.value) {
  const ordered = rows.map((row, index) => ({ row, index, value: finite(value(row)) }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const output = new Array(rows.length).fill(50);
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
    const midrank = (start + end - 1) / 2;
    const percentile = ordered.length <= 1 ? 50 : 100 * midrank / (ordered.length - 1);
    for (let index = start; index < end; index += 1) output[ordered[index].index] = percentile;
    start = end;
  }
  return output;
}

export function comparisonRadar(profiles, metric = "value_contributed", population = null) {
  const targetRates = profiles.map((profile) => sourceFamilyRates(profile, metric));
  const populationRates = Array.isArray(population) && population.length
    ? population.map((profile) => sourceFamilyRates(profile, metric))
    : targetRates;
  return profiles.map((profile, profileIndex) => ({
    player_id: Number(profile.entity?.player_id),
    player_name: profile.entity?.player_name,
    axes: SOURCE_FAMILIES.map((family, familyIndex) => {
      const pool = populationRates.map((rates) => rates[familyIndex]);
      const target = targetRates[profileIndex][familyIndex];
      const ordered = pool.map((row) => finite(row.value));
      const targetValue = finite(target.value);
      const lower = ordered.filter((value) => value < targetValue).length;
      const equal = ordered.filter((value) => value === targetValue).length;
      return {
        ...target,
        percentile: ordered.length <= 1
          ? 50 : 100 * (lower + Math.max(0, equal - 1) / 2) / (ordered.length - 1),
      };
    }),
  }));
}

function mergeTeams(payloads) {
  const teams = new Map();
  for (const payload of payloads) {
    for (const team of payload.entity?.teams ?? []) {
      const id = Number(team.team_id ?? team.id);
      if (!teams.has(id)) teams.set(id, team);
    }
  }
  return [...teams.values()];
}

function mergeSources(fingerprints, field) {
  const values = new Map();
  for (const fingerprint of fingerprints) {
    for (const row of fingerprint?.[field] ?? []) {
      values.set(String(row.key), finite(values.get(String(row.key))) + finite(row.value));
    }
  }
  return [...values.entries()].map(([key, value]) => ({
    key,
    label: key.replaceAll("_", " "),
    value,
  })).sort((left, right) => left.key.localeCompare(right.key));
}

function mergeFingerprint(payloads) {
  const fingerprints = payloads.map((payload) => payload.fingerprint ?? {});
  const responsibility = Object.fromEntries(["offense", "defense", "other"].map((side) => [
    side,
    fsum(fingerprints.map((row) => row.responsibility?.[side])),
  ]));
  const total = fsum(Object.values(responsibility));
  const contextKeys = [
    "general_offense", "general_defense", "teammate_offense",
    "teammate_defense", "opponent_offense", "opponent_defense",
  ];
  // A statistic that publishes no context (V12 so far) keeps none, rather
  // than six zeros that would read as six measured amounts.
  const publishesContext = fingerprints.some((row) => Object.keys(row.context ?? {}).length);
  const context = publishesContext ? Object.fromEntries(contextKeys.map((key) => [
    key,
    fsum(fingerprints.map((row) => row.context?.[key])),
  ])) : {};
  const sources = mergeSources(fingerprints, "sources");
  const winsSources = mergeSources(fingerprints, "wins_sources");
  // V12's contested/uncontested view of defensive rebounds and box-outs sums
  // across seasons like the sources it splits, when every season carries it.
  const splits = fingerprints.map((row) => row.defensive_rebound_split ?? null);
  const split = splits.length && splits.every(Boolean)
    ? {
      ...splits[0],
      contested: fsum(splits.map((row) => row.contested)),
      uncontested: fsum(splits.map((row) => row.uncontested)),
    }
    : null;
  return {
    ...(split ? { defensive_rebound_split: split } : {}),
    raw_vc: fsum(fingerprints.map((row) => row.raw_vc)),
    responsibility,
    responsibility_share: Object.fromEntries(Object.entries(responsibility)
      .map(([key, value]) => [key, total ? value / total : null])),
    context,
    sources,
    wins_sources: winsSources,
    leading_positive_sources: sources.filter((row) => row.value > 0)
      .sort((left, right) => right.value - left.value || left.key.localeCompare(right.key)).slice(0, 6),
    leading_negative_sources: sources.filter((row) => row.value < 0)
      .sort((left, right) => left.value - right.value || left.key.localeCompare(right.key)).slice(0, 6),
  };
}

function mergeSummary(payloads, metric) {
  const summary = {};
  for (const field of ADDITIVE_SUMMARY_FIELDS) {
    summary[field] = fsum(payloads.map((payload) => payload.summary?.[field]));
  }
  summary.games_played = summary.appearances || summary.games_played || summary.games;
  summary.games = summary.games_played;
  summary.appearances = summary.games_played;
  summary.minutes_played = summary.seconds_played
    ? summary.seconds_played / 60
    : summary.minutes_played || summary.minutes;
  summary.minutes = summary.minutes_played;
  summary.value_per_game = ratio(summary.value_contributed, summary.games_played);
  summary.wins_per_game = ratio(summary.wins_contributed, summary.games_played);
  summary.value_per_36 = ratio(summary.value_contributed * 36, summary.minutes_played);
  summary.wins_per_36 = ratio(summary.wins_contributed * 36, summary.minutes_played);
  summary.selected_metric = metric;
  summary.selected_value = summary[metric];
  summary.responsibility = {
    offense: summary.offense_value,
    defense: summary.defense_value,
    other: summary.other_value,
  };
  summary.rank = null;
  summary.relevant_rank = null;
  return summary;
}

export function mergePlayerSeasonProfiles(payloads, selectedSeasons, metric = "value_contributed") {
  if (!payloads.length) throw new Error("At least one player-season payload is required.");
  const identities = new Set(payloads.map((payload) => Number(payload.entity?.player_id)));
  if (identities.size !== 1) throw new Error("Player season payloads do not share one player identity.");
  const sourceIds = new Set(payloads.map((payload) => payload.source?.public_id ?? payload.source?.id));
  if (sourceIds.size !== 1) throw new Error("Player season payloads do not share one source.");
  const selected = [...new Set(selectedSeasons.map(String))];
  const first = payloads[0];
  const history = [...(first.seasons ?? [])];
  const selectedYears = new Set(selected.map((season) => Number(season.slice(0, 4)) + 1));
  const selectedRows = history.filter((row) => selectedYears.has(Number(row.season_end_year)));
  let cumulativeValue = 0;
  let cumulativeWins = 0;
  const trend = selectedRows.map((row) => {
    cumulativeValue += finite(row.value_contributed);
    cumulativeWins += finite(row.wins_contributed);
    return {
      season_end_year: Number(row.season_end_year),
      season: row.season,
      value_contributed: finite(row.value_contributed),
      wins_contributed: finite(row.wins_contributed),
      cumulative_value_contributed: cumulativeValue,
      cumulative_wins_contributed: cumulativeWins,
    };
  });
  const schedules = ["full", "regular_season", "postseason"].map((id) => {
    let cumulativeVc = 0;
    let cumulativeWc = 0;
    const points = payloads.map((payload) => {
      const source = payload.contribution_chart?.schedules?.find((row) => row.id === id);
      const vc = fsum((source?.points ?? []).map((row) => row.value_contributed));
      const wc = fsum((source?.points ?? []).map((row) => row.wins_contributed));
      cumulativeVc += vc;
      cumulativeWc += wc;
      const year = Number(payload.filters?.season?.slice(0, 4)) + 1;
      return {
        season_end_year: year,
        season: payload.filters?.season,
        value_contributed: vc,
        wins_contributed: wc,
        cumulative_value_contributed: cumulativeVc,
        cumulative_wins_contributed: cumulativeWc,
      };
    }).sort((left, right) => left.season_end_year - right.season_end_year);
    return { id, label: id === "full" ? "Full season" : id === "regular_season" ? "Regular season" : "Postseason", points };
  });
  return {
    ...first,
    state: payloads.some((payload) => payload.state === "ready") ? "ready" : "empty",
    filters: { ...first.filters, scope: "seasons", season: null, seasons: selected },
    entity: { ...first.entity, teams: mergeTeams(payloads) },
    summary: mergeSummary(payloads, metric),
    seasons: history,
    trend,
    contribution_chart: { grain: "season", selected_season_end_year: null, selected_season_end_years: [...selectedYears], schedules },
    fingerprint: mergeFingerprint(payloads),
  };
}

export function mergeTeamSeasonProfiles(payloads, selectedSeasons, metric = "value_contributed") {
  if (!payloads.length) throw new Error("At least one team-season payload is required.");
  const identities = new Set(payloads.map((payload) => Number(payload.entity?.team_id ?? payload.entity?.id)));
  if (identities.size !== 1) throw new Error("Team season payloads do not share one franchise identity.");
  const sourceIds = new Set(payloads.map((payload) => payload.source?.public_id ?? payload.source?.id));
  if (sourceIds.size !== 1) throw new Error("Team season payloads do not share one source.");
  const selected = [...new Set(selectedSeasons.map(String))];
  const first = payloads[0];
  const players = new Map();
  for (const payload of payloads) {
    for (const row of payload.players ?? payload.roster?.rows ?? []) {
      const id = Number(row.player_id);
      if (!players.has(id)) {
        players.set(id, {
          player_id: id,
          player_name: row.player_name,
          games_played: 0,
          wins: 0,
          losses: 0,
          seconds_played: 0,
          minutes_played: 0,
          value_contributed: 0,
          wins_contributed: 0,
          losses_contributed: 0,
          offense_value: 0,
          defense_value: 0,
          other_value: 0,
        });
      }
      const target = players.get(id);
      for (const field of [
        "games_played", "wins", "losses", "seconds_played", "minutes_played",
        "value_contributed", "wins_contributed", "losses_contributed",
        "offense_value", "defense_value", "other_value",
      ]) target[field] += finite(row[field] ?? row[field === "minutes_played" ? "minutes" : field]);
      target.player_name = row.player_name || target.player_name;
    }
  }
  const summary = mergeSummary(payloads, metric);
  const roster = [...players.values()].map((row) => ({
    ...row,
    games: row.games_played,
    minutes: row.seconds_played ? row.seconds_played / 60 : row.minutes_played,
    loss_value_contributed: row.value_contributed - row.wins_contributed,
    value_per_game: ratio(row.value_contributed, row.games_played),
    selected_value: row[metric],
    minute_share: null,
    responsibility: {
      offense: row.offense_value,
      defense: row.defense_value,
      other: row.other_value,
    },
  })).sort((left, right) => right.selected_value - left.selected_value || left.player_id - right.player_id);
  const selectedTotal = summary[metric];
  const totalMinutes = fsum(roster.map((row) => row.minutes));
  summary.player_minutes = totalMinutes;
  summary.minutes_played = totalMinutes;
  summary.seconds_played = Math.round(totalMinutes * 60);
  roster.forEach((row) => { row.minute_share = ratio(row.minutes, totalMinutes); });
  const concentration = [1, 3, 5].map((count) => ({
    players: count,
    contribution_share: ratio(fsum(roster.slice(0, count).map((row) => row.selected_value)), selectedTotal),
    minutes_share: ratio(fsum(roster.slice(0, count).map((row) => row.minutes)), totalMinutes),
  }));
  const chartIds = [...new Set(payloads.flatMap((payload) =>
    (payload.who_built_total?.players ?? [])
      .map((row) => row.player_id)
      .filter((value) => value !== null && value !== undefined)
      .map(Number)))].slice(0, 10);
  const chartPlayers = chartIds.map((id) => {
    const row = roster.find((player) => player.player_id === id);
    return { player_id: id, player_name: row?.player_name ?? "Unknown player" };
  });
  const running = new Map([...chartIds.map((id) => [String(id), 0]), ["others", 0]]);
  const cumulativeSeries = [];
  let gameNumber = 0;
  for (const payload of [...payloads].sort((left, right) =>
    Number(left.filters?.season?.slice(0, 4)) - Number(right.filters?.season?.slice(0, 4)))) {
    const previous = new Map([...chartIds.map((id) => [String(id), 0]), ["others", 0]]);
    for (const point of payload.cumulative_series ?? []) {
      gameNumber += 1;
      const values = [];
      for (const value of point.values ?? []) {
        const key = value.player_id === null ? "others" : String(value.player_id);
        if (!running.has(key)) continue;
        const local = finite(value.cumulative);
        const increment = local - finite(previous.get(key));
        previous.set(key, local);
        running.set(key, finite(running.get(key)) + increment);
      }
      for (const player of chartPlayers) values.push({
        ...player,
        cumulative: finite(running.get(String(player.player_id))),
      });
      values.push({ player_id: null, player_name: "All Other Players", cumulative: finite(running.get("others")) });
      cumulativeSeries.push({
        ...point,
        game_number: gameNumber,
        season_separator: (point.game_number ?? 0) === 1,
        values,
        team_total: fsum(values.map((row) => row.cumulative)),
      });
    }
  }
  const seasonSeries = {
    mode: "season_totals",
    series: chartPlayers.concat([{ player_id: null, player_name: "All Other Players" }]).map((player) => ({
      ...player,
      points: payloads.map((payload) => {
        const rows = payload.players ?? [];
        const selectedValue = player.player_id === null
          ? fsum(rows.filter((row) => !chartIds.includes(Number(row.player_id))).map((row) => row[metric]))
          : finite(rows.find((row) => Number(row.player_id) === player.player_id)?.[metric]);
        return {
          season_end_year: Number(payload.filters?.season?.slice(0, 4)) + 1,
          season: payload.filters?.season,
          value: selectedValue,
        };
      }).filter((point) => player.player_id === null || point.value !== 0),
    })),
  };
  const seasonRosters = payloads.map((payload) => ({
    season: payload.filters?.season,
    season_end_year: Number(payload.filters?.season?.slice(0, 4)) + 1,
    players: (payload.players ?? payload.roster?.rows ?? []).map((row) => ({
      player_id: Number(row.player_id),
      player_name: row.player_name,
      minutes: finite(row.minutes_played ?? row.minutes),
      value_contributed: finite(row.value_contributed),
      wins_contributed: finite(row.wins_contributed),
    })),
  })).sort((left, right) => left.season_end_year - right.season_end_year);
  return {
    ...first,
    state: payloads.some((payload) => payload.state === "ready") ? "ready" : "empty",
    filters: { ...first.filters, scope: "seasons", season: null, seasons: selected },
    summary: { ...summary, unique_players: roster.length },
    players: roster,
    roster: { rows: roster, footer: summary },
    concentration,
    seasons: payloads.flatMap((payload) => payload.seasons ?? [])
      .sort((left, right) => Number(left.season_end_year) - Number(right.season_end_year)),
    fingerprint: mergeFingerprint(payloads),
    cumulative_series: cumulativeSeries,
    who_built_total: { metric, players: chartPlayers, points: cumulativeSeries },
    season_series: seasonSeries,
    contribution_chart: seasonSeries,
    season_rosters: seasonRosters,
  };
}

export function concentrationCurve(profile, metric = "value_contributed") {
  const field = metric === "wins_contributed" ? "wins_contributed" : "value_contributed";
  const players = [...(profile.players ?? profile.roster?.rows ?? [])]
    .map((row) => ({
      player_id: Number(row.player_id),
      player_name: row.player_name,
      minutes: finite(row.minutes_played ?? row.minutes),
      value: finite(row[field]),
    }))
    .sort((left, right) => right.value - left.value || left.player_id - right.player_id);
  const totalMinutes = fsum(players.map((row) => row.minutes));
  const totalValue = fsum(players.map((row) => row.value));
  let minutes = 0;
  let value = 0;
  return [{ rank: 0, minute_share: 0, contribution_share: 0 }].concat(players.map((row, index) => {
    minutes += row.minutes;
    value += row.value;
    return {
      ...row,
      rank: index + 1,
      minute_share: totalMinutes ? minutes / totalMinutes : null,
      contribution_share: totalValue ? value / totalValue : null,
    };
  }));
}

// --- comparing the published profile sections ------------------------------------
//
// The player page draws one radar per published section of one player. The
// comparison page draws the same radars with every compared player's shape on
// top of each other, which needs three things the single-player model does not:
// the spokes have to be the union of what the compared players have rather than
// one player's own eight, a player who has no comparison for a spoke needs a
// gap rather than a zero, and each row needs to know whose number is best.
//
// Nothing here re-derives a percentile. `spokeReach` is the player page's own
// orientation rule — `direction` decides which way a spoke points on the six
// sections that read "more is better", and the cost section reads the other
// way round and says so — and it is imported, not copied.

// Four shapes and four dash patterns, so a reader never has to tell two
// polygons apart by colour alone. The page adds the colour.
export const OVERLAY_SERIES_STYLES = Object.freeze([
  Object.freeze({ marker: "circle", dash: "" }),
  Object.freeze({ marker: "square", dash: "7 4" }),
  Object.freeze({ marker: "triangle", dash: "2 3" }),
  Object.freeze({ marker: "diamond", dash: "11 3 2 3" }),
]);

// The most polygons one radar can carry and still be read.
export const OVERLAY_MAX_SERIES = OVERLAY_SERIES_STYLES.length;

export function overlaySeriesStyle(index) {
  return OVERLAY_SERIES_STYLES[Math.abs(Number(index) || 0) % OVERLAY_SERIES_STYLES.length];
}

function firstAppearanceOrder(lists) {
  const seen = [];
  const known = new Set();
  for (const list of lists) {
    for (const key of list) {
      if (known.has(key)) continue;
      known.add(key);
      seen.push(key);
    }
  }
  return seen;
}

function entryAxis(entry, sectionKey, axisKey) {
  const section = (entry.sections ?? []).find((row) => String(row.key) === sectionKey);
  return (section?.axes ?? []).find((row) => String(row.key) === axisKey) ?? null;
}

// One compared player's reading of one spoke. `present` is the whole contract:
// false means draw a gap, and `reason` says which kind of nothing it is.
function axisReading(entry, sectionKey, axisKey, orientation = "better") {
  const axis = entryAxis(entry, sectionKey, axisKey);
  if (!axis) return { present: false, reason: "absent", outward: null };
  if ((entry.masked ?? new Set()).has(axisKey)) {
    return { present: false, reason: "masked", outward: null, label: String(axis.label ?? axisKey) };
  }
  // Level with most of the league is a tie, not a place in it, so it is the
  // same kind of nothing as a season that records no comparison at all.
  if (isLevelWithTheLeague(axis)) {
    return { present: false, reason: "level", outward: null, label: String(axis.label ?? axisKey) };
  }
  const outward = spokeReach(axis, orientation);
  if (outward === null) return { present: false, reason: "not_compared", outward: null };
  return {
    present: true,
    reason: null,
    outward,
    per36: Number(axis.per36),
    value: Number(axis.value),
    leagueMedian: Number(axis.league_median_per36),
    direction: String(axis.direction ?? "higher_is_better"),
  };
}

function withBest(values) {
  // A reading nobody has is not a best: `Number(null)` is 0, which is finite,
  // so an absent row has to arrive as NaN or every column would be marked.
  const best = bestValueIndexes(
    values.map((row) => (row.present ? row.outward : Number.NaN)), { direction: "higher" },
  );
  return { values, best };
}

function sectionSlide(sectionKey, entries, limit) {
  const holder = entries.find((entry) => (entry.sections ?? [])
    .some((row) => String(row.key) === sectionKey));
  const section = (holder?.sections ?? []).find((row) => String(row.key) === sectionKey) ?? {};
  const orientation = sectionOrientation(section);
  const wanted = String(section.chart ?? "radar");
  const axisKeys = firstAppearanceOrder(entries.map((entry) => {
    const own = (entry.sections ?? []).find((row) => String(row.key) === sectionKey);
    return (own?.axes ?? []).map((axis) => String(axis.key));
  }));
  const axes = axisKeys.map((axisKey, index) => {
    const source = entries.map((entry) => entryAxis(entry, sectionKey, axisKey)).find(Boolean) ?? {};
    const { values, best } = withBest(entries.map(
      (entry) => axisReading(entry, sectionKey, axisKey, orientation),
    ));
    return {
      key: axisKey,
      label: String(source.label ?? axisKey),
      description: String(source.description ?? ""),
      direction: String(source.direction ?? "higher_is_better"),
      index,
      values,
      best,
      // Which axes carry a spoke is the payload's own choice, the same for
      // every selection; a spoke is then drawn as soon as one of them has a
      // reading for it.
      wanted: source.chart !== false,
      usable: source.chart !== false && values.some((row) => row.present),
    };
  });
  const usable = axes.filter((axis) => axis.usable);
  const omitted = axes.filter((axis) => axis.wanted && !axis.usable).map((axis) => axis.label);
  const chosen = usable.slice(0, Math.max(0, limit));
  return {
    key: sectionKey,
    label: String(section.label ?? sectionKey),
    description: String(section.description ?? ""),
    comparison: String(section.comparison ?? "per_36"),
    orientation,
    percentileRule: String(section.percentile_rule ?? ""),
    howToRead: howToRead(sectionKey),
    kind: wanted === "diverging_bars"
      ? "bars"
      : (chosen.length >= 3 ? "radar" : "levels"),
    spokes: chosen,
    axes,
    omitted,
    shown: chosen.length,
    available: usable.length,
    sections: entries.map((entry) => (entry.sections ?? [])
      .find((row) => String(row.key) === sectionKey) ?? null),
  };
}

// The last slide: every measurement of the description at once, in the order
// and the groups the payload itself publishes them in, so the comparison wheel
// is the player page's wheel with more than one shape on it.
function overallSlide(entries) {
  const keys = firstAppearanceOrder(entries.map((entry) => (entry.dimensions ?? [])
    .map((row) => String(row.key))));
  const dimensionOf = (entry, key) => (entry.dimensions ?? [])
    .find((row) => String(row.key) === key) ?? null;
  const spokes = keys.map((key, index) => {
    const source = entries.map((entry) => dimensionOf(entry, key)).find(Boolean) ?? {};
    const { values, best } = withBest(entries.map((entry) => {
      const row = dimensionOf(entry, key);
      if (!row) return { present: false, reason: "absent", outward: null };
      if ((entry.masked ?? new Set()).has(key)) {
        return { present: false, reason: "masked", outward: null };
      }
      const place = Number(row.percentile);
      if (row.available === false || !Number.isFinite(place)) {
        return { present: false, reason: "not_compared", outward: null };
      }
      return { present: true, reason: null, outward: place, per36: Number(row.per36 ?? row.value) };
    }));
    return {
      key,
      label: String(source.label ?? key),
      group: String(source.concept_group ?? "role_and_shape"),
      index,
      values,
      best,
      usable: values.some((row) => row.present),
    };
  }).filter((spoke) => spoke.usable);
  return {
    key: "overall",
    label: "Everything at once",
    description: "Every measurement of the description on one wheel.",
    comparison: "per_36",
    percentileRule: "",
    howToRead: howToRead("overall"),
    kind: spokes.length >= 6 ? "wheel" : "table",
    spokes,
    axes: [],
    omitted: [],
    shown: spokes.length,
    available: spokes.length,
  };
}

/**
 * How one compared player's shape is drawn when he has no comparison for some
 * of the spokes.
 *
 * Every spoke present is one closed polygon, which is the ordinary case. A gap
 * is a real gap: the shape becomes one open line per unbroken run of spokes he
 * does have, starting after a gap so a run never wraps through one, and the
 * missing spoke is simply not joined across.
 */
export function overlayRuns(values) {
  return spokeRuns(values);
}

/**
 * One slide per published section, then the whole-profile wheel, each carrying
 * every compared player's reading of every spoke.
 *
 * `entries` are already in the page's own order. More than `maxSeries` of them
 * cannot be told apart on one wheel, so the overlay keeps the first
 * `maxSeries` and says it did.
 */
export function overlayRadarModel(entries, {
  limit = 12, maxSeries = OVERLAY_MAX_SERIES, overall = true,
} = {}) {
  const all = (entries ?? []).map((entry) => ({
    ...entry,
    masked: entry.masked instanceof Set
      ? entry.masked : new Set((entry.masked ?? []).map(String)),
  }));
  const shown = all.slice(0, Math.max(1, maxSeries));
  const sectionKeys = firstAppearanceOrder(shown.map((entry) => (entry.sections ?? [])
    .map((section) => String(section.key))));
  const slides = sectionKeys
    .map((key) => sectionSlide(key, shown, limit))
    .filter((slide) => slide.axes.length > 0);
  if (overall) {
    const wheel = overallSlide(shown);
    if (wheel.spokes.length) slides.push(wheel);
  }
  return {
    slides,
    entries: shown,
    hidden: all.slice(shown.length),
    capped: all.length > shown.length,
    maxSeries: Math.max(1, maxSeries),
  };
}

export function bestValueIndexes(values, { direction = "higher" } = {}) {
  const finiteRows = values.map((value, index) => ({ index, value: Number(value) }))
    .filter((row) => Number.isFinite(row.value));
  if (!finiteRows.length) return new Set();
  const best = direction === "lower"
    ? Math.min(...finiteRows.map((row) => row.value))
    : Math.max(...finiteRows.map((row) => row.value));
  return new Set(finiteRows.filter((row) => Math.abs(row.value - best) <= 1e-12).map((row) => row.index));
}

export function regularPostseasonRows(regularRows, postseasonRows, metric, display = "rate") {
  const postById = new Map(postseasonRows.map((row) => [String(row.player_id), row]));
  const field = metric === "wins_contributed" ? "wins_contributed" : "value_contributed";
  return regularRows.map((regular) => {
    const postseason = postById.get(String(regular.player_id));
    if (!postseason || !finite(regular.games_played) || !finite(postseason.games_played)) return null;
    const regularValue = finite(regular[field]);
    const postseasonValue = finite(postseason[field]);
    return {
      player_id: String(regular.player_id),
      player_name: regular.player_name,
      teams: regular.teams ?? [],
      regular_games: finite(regular.games_played),
      postseason_games: finite(postseason.games_played),
      regular: display === "total" ? regularValue : regularValue / finite(regular.games_played),
      postseason: display === "total" ? postseasonValue : postseasonValue / finite(postseason.games_played),
    };
  }).filter(Boolean).map((row) => ({ ...row, change: row.postseason - row.regular }));
}
