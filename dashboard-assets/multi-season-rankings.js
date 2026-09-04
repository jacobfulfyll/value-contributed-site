const ADDITIVE_FIELDS = Object.freeze([
  "games_played",
  "wins",
  "losses",
  "value_contributed",
  "wins_contributed",
  "losses_contributed",
  "offense_value",
  "defense_value",
  "hustle_value",
  "other_value",
  "offensive_value_contributed",
  "defensive_value_contributed",
  "other_value_contributed",
  "offensive_wins_contributed",
  "defensive_wins_contributed",
  "other_wins_contributed",
  "raw_no_context_value",
  "teammate_context_value",
  "opponent_context_value",
  "wins_raw_no_context_value",
  "wins_teammate_context_value",
  "wins_opponent_context_value",
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

const IDENTITY_FIELDS = Object.freeze([
  "release_id",
  "release_receipt",
  "run_id",
  "configuration_receipt",
  "calculation_receipt",
  "certification_status",
  "stat_version",
  "phase",
  "garbage_time_mode",
  "breakdown_mode",
]);

const PERCENTAGE_FIELDS = Object.freeze([
  ["offensive_value_contributed_pct", "offensive_value_contributed", "value_contributed"],
  ["defensive_value_contributed_pct", "defensive_value_contributed", "value_contributed"],
  ["other_value_contributed_pct", "other_value_contributed", "value_contributed"],
  ["offensive_wins_contributed_pct", "offensive_wins_contributed", "wins_contributed"],
  ["defensive_wins_contributed_pct", "defensive_wins_contributed", "wins_contributed"],
  ["other_wins_contributed_pct", "other_wins_contributed", "wins_contributed"],
  ["raw_no_context_pct", "raw_no_context_value", "value_contributed"],
  ["teammate_context_pct", "teammate_context_value", "value_contributed"],
  ["opponent_context_pct", "opponent_context_value", "value_contributed"],
  ["wins_raw_no_context_pct", "wins_raw_no_context_value", "wins_contributed"],
  ["wins_teammate_context_pct", "wins_teammate_context_value", "wins_contributed"],
  ["wins_opponent_context_pct", "wins_opponent_context_value", "wins_contributed"],
]);

const SELECTED_TOTAL_PERCENTAGE_FIELDS = Object.freeze([
  ["side_context_raw_pct", "side_context_raw_value"],
  ["offense_context_pct", "offense_context_value"],
  ["defense_context_pct", "defense_context_value"],
  ["general_offense_context_pct", "general_offense_context_value"],
  ["general_defense_context_pct", "general_defense_context_value"],
  ["teammate_offense_context_pct", "teammate_offense_context_value"],
  ["opponent_offense_context_pct", "opponent_offense_context_value"],
  ["teammate_defense_context_pct", "teammate_defense_context_value"],
  ["opponent_defense_context_pct", "opponent_defense_context_value"],
]);

export const MULTI_SEASON_UNAVAILABLE_SORTS = Object.freeze(new Set([
  "postseason_value_per_game_difference",
  "postseason_rank_change",
]));

function finiteNumber(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`The ${field} value is missing from a selected-season ranking.`);
  }
  return numeric;
}

function fsum(values) {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const numeric = finiteNumber(value, "additive ranking");
    const next = sum + numeric;
    correction += Math.abs(sum) >= Math.abs(numeric)
      ? (sum - next) + numeric
      : (numeric - next) + sum;
    sum = next;
  }
  return sum + correction;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function percent(numerator, denominator) {
  return denominator === 0 ? null : (100 * numerator) / denominator;
}

function comparePlayerId(left, right) {
  const leftNumeric = Number(left.player_id);
  const rightNumeric = Number(right.player_id);
  if (Number.isSafeInteger(leftNumeric) && Number.isSafeInteger(rightNumeric)) {
    return leftNumeric - rightNumeric;
  }
  return String(left.player_id).localeCompare(String(right.player_id));
}

function compareNullable(left, right, direction = "desc") {
  const leftMissing = left === null || left === undefined || !Number.isFinite(Number(left));
  const rightMissing = right === null || right === undefined || !Number.isFinite(Number(right));
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  const comparison = Number(left) - Number(right);
  return direction === "asc" ? comparison : -comparison;
}

function assertCompatiblePayloads(payloads) {
  if (!Array.isArray(payloads) || payloads.length < 2) {
    throw new Error("At least two selected-season ranking payloads are required.");
  }
  const first = payloads[0];
  if (!first || !Array.isArray(first.rows)) {
    throw new Error("A selected-season ranking payload is invalid.");
  }
  for (const payload of payloads.slice(1)) {
    if (!payload || !Array.isArray(payload.rows)) {
      throw new Error("A selected-season ranking payload is invalid.");
    }
    for (const field of IDENTITY_FIELDS) {
      if ((payload[field] ?? null) !== (first[field] ?? null)) {
        throw new Error(`Selected-season rankings do not share one ${field.replaceAll("_", " ")}.`);
      }
    }
  }
  return first;
}

function seasonStart(value) {
  const match = /^(\d{4})-(\d{2})$/u.exec(String(value));
  return match ? Number(match[1]) : null;
}

export function seasonSelectionLabel(seasons, allAvailableSeasons = seasons) {
  const selected = [...new Set((seasons || []).map(String))];
  const available = [...new Set((allAvailableSeasons || []).map(String))];
  if (!selected.length) return "Choose seasons";
  if (available.length && selected.length === available.length
      && available.every((season) => selected.includes(season))) {
    return "All seasons";
  }
  if (selected.length === 1) return selected[0];
  const chronological = selected
    .map((season) => ({ season, start: seasonStart(season) }))
    .sort((left, right) => (left.start ?? Number.MAX_SAFE_INTEGER)
      - (right.start ?? Number.MAX_SAFE_INTEGER));
  const contiguous = chronological.every((row, index) => (
    index === 0 || row.start === chronological[index - 1].start + 1
  ));
  if (contiguous && chronological.every((row) => row.start !== null)) {
    return `${chronological[0].season}–${chronological.at(-1).season} · ${selected.length} seasons`;
  }
  return `${selected.length} selected seasons`;
}

export function mergeSeasonRankingPayloads(payloads, {
  seasons,
  label,
  sortBy = "wins_contributed",
  sortDirection = "desc",
  metric = "value_contributed",
  search = "",
  limit = 25,
} = {}) {
  const first = assertCompatiblePayloads(payloads);
  const selectedSeasons = [...new Set((seasons || payloads.map((payload) => payload.season)).map(String))];
  if (selectedSeasons.length !== payloads.length) {
    throw new Error("Selected-season ranking payloads do not match the requested seasons.");
  }
  if (!new Set(["asc", "desc"]).has(sortDirection)) {
    throw new Error("The multi-season ranking sort direction is invalid.");
  }
  const requestedLimit = Number(limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("The multi-season ranking limit is invalid.");
  }

  const byPlayer = new Map();
  payloads.forEach((payload, payloadIndex) => {
    if (String(payload.season) !== selectedSeasons[payloadIndex]) {
      throw new Error("A selected-season ranking response named the wrong season.");
    }
    for (const sourceRow of payload.rows) {
      const playerId = String(sourceRow.player_id ?? "");
      if (!/^\d+$/u.test(playerId)) {
        throw new Error("A selected-season ranking row has no player identity.");
      }
      if (!byPlayer.has(playerId)) {
        byPlayer.set(playerId, {
          player_id: playerId,
          player_name: String(sourceRow.player_name || `NBA ID ${playerId}`),
          _values: Object.fromEntries(ADDITIVE_FIELDS.map((field) => [field, []])),
          _teams: new Map(),
        });
      }
      const target = byPlayer.get(playerId);
      if (payloadIndex === 0 || !target.player_name) {
        target.player_name = String(sourceRow.player_name || target.player_name);
      }
      for (const field of ADDITIVE_FIELDS) {
        target._values[field].push(finiteNumber(sourceRow[field], field));
      }
      for (const team of sourceRow.teams || []) {
        const teamId = String(team?.id ?? team?.abbreviation ?? team?.name ?? "");
        if (teamId && !target._teams.has(teamId)) target._teams.set(teamId, { ...team });
      }
    }
  });

  const rows = [...byPlayer.values()].map((target) => {
    const row = {
      rank: null,
      season: label || seasonSelectionLabel(selectedSeasons),
      player_id: target.player_id,
      player_name: target.player_name,
      teams: [...target._teams.values()],
    };
    for (const field of ADDITIVE_FIELDS) row[field] = fsum(target._values[field]);
    row.value_per_win = ratio(row.wins_contributed, row.wins);
    row.value_per_game = ratio(row.value_contributed, row.games_played);
    row.value_per_game_rank = null;
    row.value_per_loss = ratio(row.losses_contributed, row.losses);
    row.win_loss_difference = row.value_per_win === null || row.value_per_loss === null
      ? null
      : row.value_per_win - row.value_per_loss;

    // Per-season public snapshots intentionally suppress one-sided postseason
    // comparisons. A partial multi-season merge therefore cannot reconstruct
    // those columns without game-level data; show them as unavailable instead
    // of presenting incomplete totals.
    row.regular_games = null;
    row.postseason_games = null;
    row.regular_value_contributed = null;
    row.postseason_value_contributed = null;
    row.regular_value_per_game = null;
    row.postseason_value_per_game = null;
    row.postseason_value_per_game_difference = null;
    row.regular_wins_contributed = null;
    row.postseason_wins_contributed = null;
    row.regular_season_rank = null;
    row.postseason_rank = null;
    row.postseason_rank_change = null;

    for (const [percentageField, amountField, totalField] of PERCENTAGE_FIELDS) {
      row[percentageField] = percent(row[amountField], row[totalField]);
    }
    const selectedTotal = first.breakdown_mode === "wc"
      ? row.wins_contributed
      : row.value_contributed;
    for (const [percentageField, amountField] of SELECTED_TOTAL_PERCENTAGE_FIELDS) {
      row[percentageField] = percent(row[amountField], selectedTotal);
    }
    return row;
  });

  [...rows]
    .sort((left, right) => compareNullable(left.value_per_game, right.value_per_game)
      || comparePlayerId(left, right))
    .forEach((row, index) => { row.value_per_game_rank = index + 1; });

  const sortKey = sortBy === "selected_metric" ? metric : sortBy;
  rows.sort((left, right) => compareNullable(left[sortKey], right[sortKey], sortDirection)
    || comparePlayerId(left, right));
  rows.forEach((row, index) => { row.rank = index + 1; });
  const normalizedSearch = String(search).trim().toLocaleLowerCase();
  const searched = normalizedSearch
    ? rows.filter((row) => row.player_name.toLocaleLowerCase().includes(normalizedSearch))
    : rows;

  return {
    ...first,
    season: label || seasonSelectionLabel(selectedSeasons),
    selected_seasons: selectedSeasons,
    metric,
    sort_by: sortBy,
    sort_direction: sortDirection,
    postseason_comparison: {
      ...(first.postseason_comparison || {}),
      available: false,
      unavailable_reason: "Postseason comparisons are available for one season or All Seasons.",
    },
    rows: searched.slice(0, requestedLimit),
  };
}
