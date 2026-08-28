const state = {
  controller: null,
  trendController: null,
  liftController: null,
  topGamesController: null,
  seasonWinsController: null,
  highValueRecordsController: null,
  contextController: null,
  searchTimer: null,
  trendSearchTimer: null,
  liftSearchTimer: null,
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
  v8RunId: null,
  recordColumnsExpanded: false,
  contextColumnsExpanded: false,
};

const contextSorts = new Set([
  "side_context_raw_value",
  "teammate_offense_context_value",
  "opponent_offense_context_value",
  "teammate_defense_context_value",
  "opponent_defense_context_value",
]);

const elements = {
  statVersion: document.querySelector("#stat-version"),
  season: document.querySelector("#season"),
  phase: document.querySelector("#phase"),
  garbageTimeMode: document.querySelector("#garbage-time-mode"),
  breakdownControl: document.querySelector("#breakdown-control"),
  breakdownMode: document.querySelector("#breakdown-mode"),
  search: document.querySelector("#search"),
  limit: document.querySelector("#limit"),
  title: document.querySelector("#results-title"),
  meta: document.querySelector("#results-meta"),
  body: document.querySelector("#rankings-body"),
  error: document.querySelector("#error"),
  sortableHeadings: Array.from(
    document.querySelectorAll(".rankings-table .sortable-heading"),
  ),
  mobileSort: document.querySelector("#mobile-sort"),
  mobileSortDirection: document.querySelector("#mobile-sort-direction"),
  topGamesSeason: document.querySelector("#top-games-season"),
  topGamesPhase: document.querySelector("#top-games-phase"),
  topGamesOutcomes: Array.from(
    document.querySelectorAll('input[name="top-games-outcome"]'),
  ),
  topGamesLimit: document.querySelector("#top-games-limit"),
  topGamesMeta: document.querySelector("#top-games-meta"),
  topGamesBody: document.querySelector("#top-games-body"),
  topGamesError: document.querySelector("#top-games-error"),
  seasonWinsPhase: document.querySelector("#season-wins-phase"),
  seasonWinsPhaseLabel: document.querySelector("#season-wins-phase-label"),
  seasonWinsMeta: document.querySelector("#season-wins-meta"),
  seasonWinsBody: document.querySelector("#season-wins-body"),
  seasonWinsError: document.querySelector("#season-wins-error"),
  highValuePhase: document.querySelector("#high-value-phase"),
  highValueRecordsMeta: document.querySelector("#high-value-records-meta"),
  highValuePlayerCount: document.querySelector("#high-value-player-count"),
  highValueRecordsBody: document.querySelector("#high-value-records-body"),
  highValueRecordsError: document.querySelector("#high-value-records-error"),
  highValueSortableHeadings: Array.from(
    document.querySelectorAll(".high-value-sortable-heading"),
  ),
  highValueMobileSort: document.querySelector("#high-value-mobile-sort"),
  highValueMobileSortDirection: document.querySelector(
    "#high-value-mobile-sort-direction",
  ),
  trendChart: document.querySelector("#trend-chart"),
  trendMeta: document.querySelector("#trends-meta"),
  trendError: document.querySelector("#trends-error"),
  trendSearch: document.querySelector("#trend-search"),
  trendPhases: Array.from(document.querySelectorAll('input[name="trend-phase"]')),
  trendWindows: Array.from(document.querySelectorAll('input[name="trend-window"]')),
  trendLegend: document.querySelector("#trend-legend-list"),
  legendSummary: document.querySelector("#legend-summary"),
  trendTooltip: document.querySelector("#trend-tooltip"),
  liftChart: document.querySelector("#lift-chart"),
  liftMeta: document.querySelector("#lift-meta"),
  liftError: document.querySelector("#lift-error"),
  liftSearch: document.querySelector("#lift-search"),
  liftWindows: Array.from(document.querySelectorAll('input[name="lift-window"]')),
  liftGroups: Array.from(document.querySelectorAll('input[name="lift-group"]')),
  liftLegend: document.querySelector("#lift-legend-list"),
  liftLegendSummary: document.querySelector("#lift-legend-summary"),
  liftTooltip: document.querySelector("#lift-tooltip"),
  rankingsTable: document.querySelector("#rankings-table"),
  sideGroupHeading: document.querySelector("#side-group-heading"),
  recordColumnsToggle: document.querySelector("#record-columns-toggle"),
  contextColumnsToggle: document.querySelector("#context-columns-toggle"),
  v8ContextOnly: Array.from(document.querySelectorAll(".v8-context-only")),
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

function garbageTimeLabel() {
  return elements.garbageTimeMode.value === "all_minutes"
    ? "Garbage time included"
    : "Garbage time excluded";
}

function statVersionLabel() {
  const labels = {
    v8: "V8 four-part context + side responsibility",
    v7_positive_only: "V7 separate context + positive-only close",
    v6_signed_gross: "V6 possession context + signed-gross close",
    v5_adjusted: "V5 ratings + opponent context",
    v5_before_context: "V5 after teammate ratings",
    v4_adjusted: "V4 lineup-adjusted",
    v3_before_context: "V3 before lineup adjustment",
  };
  return labels[elements.statVersion.value] || elements.statVersion.value;
}

function isV8() {
  return elements.statVersion.value === "v8";
}

function selectedBreakdownMode() {
  return elements.breakdownMode.value === "wc" ? "wc" : "vc";
}

function currentContextScopeSignature() {
  return JSON.stringify({
    run_id: state.rankingsRunId,
    player_id: state.selectedContextPlayerId,
    season: elements.season.value,
    phase: elements.phase.value,
    garbage_time_mode: elements.garbageTimeMode.value,
    stat_version: elements.statVersion.value,
    breakdown_mode: selectedBreakdownMode(),
    page: state.contextPage,
  });
}

function responseContextScopeSignature(payload) {
  return JSON.stringify({
    run_id: payload.run_id,
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
  document.body.classList.toggle("v8-dashboard", active);
  elements.rankingsTable.classList.toggle("v8-rankings", active);
  elements.breakdownControl.hidden = !active;
  elements.sideGroupHeading.colSpan = active ? 3 : 4;
  elements.sideGroupHeading.textContent = active ? "Responsibility" : "Value source";
  elements.v8ContextOnly.forEach((element) => {
    element.hidden = !active;
  });
  const hustleMobileOption = elements.mobileSort.querySelector(
    'option[value="hustle_value"]',
  );
  if (hustleMobileOption) {
    hustleMobileOption.disabled = active;
    hustleMobileOption.hidden = active;
  }
  if (
    (active && state.sortBy === "hustle_value")
    || (!active && contextSorts.has(state.sortBy))
  ) {
    state.sortBy = "wins_contributed";
    state.sortDirection = "desc";
  }
  updateColumnGroupPresentation();
  elements.rankingsDefinition.innerHTML = active
    ? "<strong>V8 responsibility</strong> allocates every player’s stored Final VC across nonnegative Offense, Defense, and genuine side-neutral Other amounts. <strong>Context</strong> shows the additive Raw VC, Teammate O, Opponent O, Teammate D, and Opponent D bridge to the same selected final total. Each percentage is that amount divided by the final total. VC uses all selected games; WC uses wins only in both the amounts and denominator."
    : "<strong>Value Contributed</strong> sums a player’s final team-value share in wins and losses. <strong>Wins Contributed</strong> sums that same value only when the player’s team won; <strong>Loss VC</strong> is the remainder from losses. VC / game is total Value Contributed divided by games played; <strong>VC/G rank</strong> ranks that rate within the active season and schedule filters. Each game’s normalization is distributed across its weighted components before they roll up into <strong>Offense, Defense, Hustle, and Other</strong>.";
  elements.rankingsGuideSummary.textContent = active
    ? "Responsibility and Context use the selected VC or WC total."
    : "Wins VC is value in wins; VC/game uses all selected appearances.";
}

function updateColumnGroupPresentation() {
  const contextExpanded = isV8() && state.contextColumnsExpanded;
  elements.rankingsTable.classList.toggle(
    "record-columns-expanded",
    state.recordColumnsExpanded,
  );
  elements.rankingsTable.classList.toggle(
    "context-columns-expanded",
    contextExpanded,
  );
  elements.recordColumnsToggle.setAttribute(
    "aria-expanded",
    String(state.recordColumnsExpanded),
  );
  elements.recordColumnsToggle.querySelector(".column-group-toggle-state").textContent =
    state.recordColumnsExpanded ? "Hide" : "Show";
  elements.contextColumnsToggle.setAttribute(
    "aria-expanded",
    String(contextExpanded),
  );
  elements.contextColumnsToggle.querySelector(".column-group-toggle-state").textContent =
    contextExpanded ? "Hide" : "Show";
}

function visibleRankingColumnCount() {
  const baseColumns = isV8() ? 12 : 13;
  return baseColumns
    + (state.recordColumnsExpanded ? 3 : 0)
    + (isV8() && state.contextColumnsExpanded ? 5 : 0);
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

function setLoading() {
  elements.error.hidden = true;
  elements.body.innerHTML = `
    <tr class="loading-row">
      <td colspan="${visibleRankingColumnCount()}">Reading the canonical calculation…</td>
    </tr>`;
  elements.meta.textContent = "Loading…";
}

function setTopGamesLoading() {
  elements.topGamesError.hidden = true;
  elements.topGamesBody.innerHTML = `
    <tr class="loading-row">
      <td colspan="9">Reading the highest single-game values…</td>
    </tr>`;
  elements.topGamesMeta.textContent = "Loading single-game leaders…";
}

function setHighValueRecordsLoading() {
  elements.highValueRecordsError.hidden = true;
  elements.highValueRecordsBody.innerHTML = `
    <tr class="loading-row">
      <td colspan="7">Reading .400-plus game records…</td>
    </tr>`;
  elements.highValuePlayerCount.textContent = "—";
  elements.highValueRecordsMeta.textContent = "Loading qualifying-player records…";
}

function setTrendLoading() {
  elements.trendError.hidden = true;
  elements.trendMeta.textContent = `Loading ${selectedTrendWindow()}-year history…`;
  elements.trendLegend.innerHTML = "";
  elements.trendChart.innerHTML = `
    <text class="chart-loading" x="560" y="290" text-anchor="middle">
      Reading rolling averages…
    </text>`;
}

function setLiftLoading() {
  elements.liftError.hidden = true;
  elements.liftMeta.textContent = `Loading ${selectedLiftWindow()}-year rank changes…`;
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
      ? "Sort .400-plus records low to high; tap to reverse"
      : "Sort .400-plus records high to low; tap to reverse",
  );
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
    const amounts = displayClosedTriplet(
      amountKeys.map((key) => row[key]),
      target,
      3,
    );
    const rawPercentages = pctKeys.map((key) => row[key]);
    const percentages = rawPercentages.every(
      (value) => value !== null && value !== undefined,
    )
      ? displayClosedTriplet(rawPercentages, 100, 1)
      : [null, null, null];
    const sides = ["Offense", "Defense", "Other"];
    const classes = ["offense", "defense", "other"];
    return sides
      .map(
        (side, index) => `
          <td class="numeric category-cell category-${classes[index]}-cell" data-label="${side} ${winsMode ? "WC" : "VC"}">
            <span class="category-value">${fixedDisplay(amounts[index], 3)}</span>
            <span class="category-percent">${percentages[index] === null ? "—" : `${fixedDisplay(percentages[index], 1)}%`}</span>
          </td>`,
      )
      .join("");
  };
  const v8ContextCells = (row) => {
    const winsMode = selectedBreakdownMode() === "wc";
    const target = Number(winsMode ? row.wins_contributed : row.value_contributed);
    const labels = ["Raw VC", "Teammate O", "Opponent O", "Teammate D", "Opponent D"];
    const amountKeys = [
      "side_context_raw_value",
      "teammate_offense_context_value",
      "opponent_offense_context_value",
      "teammate_defense_context_value",
      "opponent_defense_context_value",
    ];
    const pctKeys = [
      "side_context_raw_pct",
      "teammate_offense_context_pct",
      "opponent_offense_context_pct",
      "teammate_defense_context_pct",
      "opponent_defense_context_pct",
    ];
    const classes = [
      "raw",
      "teammate-offense",
      "opponent-offense",
      "teammate-defense",
      "opponent-defense",
    ];
    const rawAmounts = amountKeys.map((key) => row[key]);
    const amounts = rawAmounts.every(
      (value) => value !== null && value !== undefined,
    )
      ? displayClosedTriplet(rawAmounts, target, 3)
      : rawAmounts;
    const rawPercentages = pctKeys.map((key) => row[key]);
    const percentages = rawPercentages.every(
      (value) => value !== null && value !== undefined,
    )
      ? displayClosedTriplet(rawPercentages, 100, 1)
      : rawPercentages;
    return labels
      .map((label, index) => {
        const amount = amounts[index];
        const percentage = percentages[index];
        const amountSignClass = Number(amount) < 0 ? " negative-value" : "";
        const percentSignClass = Number(percentage) < 0 ? " negative-value" : "";
        const dataLabel = index === 0
          ? `Raw ${winsMode ? "WC" : "VC"}`
          : `${label} ${winsMode ? "WC" : "VC"}`;
        return `
          <td class="numeric category-cell context-composition-cell context-column context-${classes[index]}-cell" data-label="${dataLabel}">
            <span class="category-value${amountSignClass}">${amount === null || amount === undefined ? "—" : fixedDisplay(amount, 3)}</span>
            <span class="category-percent${percentSignClass}">${percentage === null || percentage === undefined ? "—" : `${fixedDisplay(percentage, 1)}%`}</span>
          </td>`;
      })
      .join("");
  };
  const postseasonRankChange = (row) => {
    if (row.postseason_rank_change === null) {
      return `<span class="rate-value">—</span><span class="rate-context">No postseason comparison</span>`;
    }
    const title = `Regular season: #${row.regular_season_rank}, ${number(row.regular_wins_contributed)} Wins Contributed in ${row.regular_games} games; postseason: #${row.postseason_rank}, ${number(row.postseason_wins_contributed)} Wins Contributed in ${row.postseason_games} games`;
    return `<span class="rate-value" title="${escapeHtml(title)}">${signedRank(row.postseason_rank_change)}</span><span class="rate-context">#${row.regular_season_rank} → #${row.postseason_rank}</span>`;
  };
  const valuePerGameRank = (row) => {
    if (row.value_per_game_rank === null) {
      return `<span class="rate-value">—</span>`;
    }
    return `<span class="rate-value">#${row.value_per_game_rank}</span><span class="rate-context">Active scope</span>`;
  };
  const postseasonValuePerGameDifference = (row) => {
    if (row.postseason_value_per_game_difference === null) {
      return `<span class="rate-value">—</span><span class="rate-context">No postseason comparison</span>`;
    }
    const regularGameLabel = `${row.regular_games} game${row.regular_games === 1 ? "" : "s"}`;
    const postseasonGameLabel = `${row.postseason_games} game${row.postseason_games === 1 ? "" : "s"}`;
    const title = `Regular season: ${number(row.regular_value_per_game)} VC/game in ${regularGameLabel}; postseason: ${number(row.postseason_value_per_game)} VC/game in ${postseasonGameLabel}`;
    return `<span class="rate-value" title="${escapeHtml(title)}">${signedNumber(row.postseason_value_per_game_difference)}</span><span class="rate-context">${number(row.regular_value_per_game)} → ${number(row.postseason_value_per_game)}</span>`;
  };

  elements.body.innerHTML = rows
    .map((row) => {
      const sideCells = isV8()
        ? v8ResponsibilityCells(row)
        : `
          <td class="numeric category-cell category-offense-cell" data-label="Offense">${contribution(row.offense_value, Number(row.value_contributed))}</td>
          <td class="numeric category-cell category-defense-cell" data-label="Defense">${contribution(row.defense_value, Number(row.value_contributed))}</td>
          <td class="numeric category-cell category-hustle-cell" data-label="Hustle">${contribution(row.hustle_value, Number(row.value_contributed))}</td>
          <td class="numeric category-cell category-other-cell" data-label="Other">${contribution(row.other_value, Number(row.value_contributed))}</td>`;
      return `
        <tr>
          <td class="rank-number" data-label="Rank">${row.rank}</td>
          <td class="player-cell">
            <span class="player-name">${escapeHtml(row.player_name)}</span>
            <span class="player-teams" title="${escapeHtml(row.teams.map((team) => team.name).join(" · "))}">${row.teams.map((team) => escapeHtml(team.abbreviation)).join(" · ")}</span>
          </td>
          <td class="numeric summary-cell record-column" data-label="GP">${row.games_played}</td>
          <td class="numeric summary-cell record-column" data-label="Wins">${row.wins}</td>
          <td class="numeric summary-cell record-column" data-label="Losses">${row.losses}</td>
          <td class="numeric total-cell" data-label="Wins VC" title="${row.wins_contributed}">${number(row.wins_contributed)}</td>
          <td class="numeric total-cell" data-label="VC" title="${row.value_contributed}">${number(row.value_contributed)}</td>
          <td class="numeric total-cell" data-label="Loss VC" title="${row.losses_contributed}">${number(row.losses_contributed)}</td>
          <td class="numeric rate-cell" data-label="VC / game">${rate(row.value_per_game)}</td>
          ${sideCells}
          ${isV8() ? v8ContextCells(row) : ""}
          <td class="numeric rate-cell comparison-cell" data-label="VC/game rank">${valuePerGameRank(row)}</td>
          <td class="numeric rate-cell comparison-cell" data-label="Post VC/game difference">${postseasonValuePerGameDifference(row)}</td>
          <td class="numeric rate-cell comparison-cell" data-label="Post rank change">${postseasonRankChange(row)}</td>
        </tr>`;
    })
    .join("");
}

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
        <td colspan="9">No games match these filters.</td>
      </tr>`;
    return;
  }

  elements.topGamesBody.innerHTML = rows
    .map((row) => {
      const venue = row.location === "home" ? "vs." : row.location === "away" ? "@" : "vs.";
      const outcomeClass = row.win_loss ? "game-win" : "game-loss";
      const outcomeShort = row.win_loss ? "W" : "L";
      return `
        <tr>
          <td class="rank-number" data-label="Rank">${row.rank}</td>
          <td class="player-cell">
            <span class="player-name">${escapeHtml(row.player_name)}</span>
            <span class="player-id">NBA ID ${escapeHtml(row.player_id)}</span>
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
        </tr>`;
    })
    .join("");
}

function seasonWinsPhase() {
  return ["Regular Season", "Postseason", "All"][Number(elements.seasonWinsPhase.value)] || "Regular Season";
}

function renderSeasonWinsLeaders(rows) {
  if (!rows.length) {
    elements.seasonWinsBody.innerHTML = '<tr class="empty-row"><td colspan="8">No season leaders are available.</td></tr>';
    return;
  }
  elements.seasonWinsBody.innerHTML = rows.map((row) => `
    <tr>
      <td class="rank-number" data-label="Rank">${row.rank}</td>
      <td class="player-cell"><span class="player-name">${escapeHtml(row.player_name)}</span><span class="player-id">NBA ID ${escapeHtml(row.player_id)}</span></td>
      <td class="season-wins-year" data-label="Year"><strong>${escapeHtml(row.season)}</strong></td>
      <td class="season-wins-team-cell" data-label="Team(s)" title="${escapeHtml(row.teams.map((team) => team.name).join(" · "))}">${row.teams.map((team) => escapeHtml(team.abbreviation)).join(" · ")}</td>
      <td class="numeric" data-label="Games">${row.games_played}</td>
      <td class="numeric season-wins-total-cell" data-label="Wins VC" title="${row.wins_contributed}">${number(row.wins_contributed)}</td>
      <td class="numeric season-wins-offense-cell" data-label="Offense" title="${row.offensive_wins_contributed}">${number(row.offensive_wins_contributed)}<span class="category-percent">${number((row.offensive_wins_contributed / row.wins_contributed) * 100)}%</span></td>
      <td class="numeric season-wins-defense-cell" data-label="Defense" title="${row.defensive_wins_contributed}">${number(row.defensive_wins_contributed)}<span class="category-percent">${number((row.defensive_wins_contributed / row.wins_contributed) * 100)}%</span></td>
    </tr>`).join("");
}

async function loadSeasonWinsLeaders() {
  state.seasonWinsController?.abort();
  state.seasonWinsController = new AbortController();
  elements.seasonWinsError.hidden = true;
  elements.seasonWinsPhaseLabel.textContent = {"Regular Season": "Regular season", Postseason: "Postseason", All: "Full season"}[seasonWinsPhase()];
  elements.seasonWinsMeta.textContent = `V8 · ${elements.seasonWinsPhaseLabel.textContent} · Top 15 player-seasons`;
  try {
    const params = new URLSearchParams({ phase: seasonWinsPhase(), garbage_time_mode: elements.garbageTimeMode.value, limit: "15" });
    const response = await fetch(`/api/rankings/season-wins-leaders?${params}`, { signal: state.seasonWinsController.signal });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "The season leaderboard could not be loaded.");
    const payload = await response.json();
    renderSeasonWinsLeaders(payload.rows);
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.seasonWinsBody.innerHTML = "";
    elements.seasonWinsError.textContent = error.message;
    elements.seasonWinsError.hidden = false;
  }
}

function renderHighValueRecords(rows) {
  if (!rows.length) {
    elements.highValueRecordsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">No players have a .400-plus game.</td>
      </tr>`;
    return;
  }

  elements.highValueRecordsBody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td class="rank-number" data-label="Rank">${row.rank}</td>
          <td class="player-cell">
            <span class="player-name">${escapeHtml(row.player_name)}</span>
            <span class="player-id">NBA ID ${escapeHtml(row.player_id)}</span>
          </td>
          <td class="numeric high-value-summary-cell" data-label="Games ≥ .400">${row.games_played}</td>
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

function sortLabel() {
  const labels = {
    value_contributed: "Value Contributed",
    wins_contributed: "Wins Contributed",
    losses_contributed: "Loss VC",
    value_per_game: "VC per game",
    value_per_game_rank: "VC/game rank",
    postseason_value_per_game_difference: "postseason VC/game difference",
    postseason_rank_change: "postseason rank change",
    games_played: "games played",
    wins: "wins",
    losses: "losses",
    offense_value: "Offense",
    defense_value: "Defense",
    hustle_value: "Hustle",
    other_value: "Other",
    side_context_raw_value: "Context Raw VC",
    teammate_offense_context_value: "Context Teammate O",
    opponent_offense_context_value: "Context Opponent O",
    teammate_defense_context_value: "Context Teammate D",
    opponent_defense_context_value: "Context Opponent D",
  };
  return `${labels[state.sortBy]} ${state.sortDirection === "asc" ? "low to high" : "high to low"}`;
}

function highValueSortLabel() {
  const labels = {
    games_played: "qualifying games",
    wins: "wins",
    value_contributed: "Value Contributed",
    wins_contributed: "Wins Contributed",
    winning_percentage: "winning percentage",
  };
  return `${labels[state.highValueSortBy]} ${state.highValueSortDirection === "asc" ? "low to high" : "high to low"}`;
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

function renderContextPayload(payload) {
  const summary = payload.summary;
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
  const summaryPercentages = rawSummaryPercentages.every(
    (value) => value !== null && value !== undefined,
  )
    ? displayClosedTriplet(rawSummaryPercentages, 100, 1)
    : [null, null, null];
  const summaryLabels = ["Raw / no context", "Teammate context", "Opponent context"];
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

  const ppp = (points, possessions) =>
    Number(possessions) > 0 ? fixedDisplay(Number(points) / Number(possessions), 3) : "—";
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
          const contextPercentages = game.raw_percent_of_final === null
            ? [null, null, null]
            : displayClosedTriplet(
                [
                  game.raw_percent_of_final,
                  game.teammate_percent_of_final,
                  game.opponent_percent_of_final,
                ],
                100,
                1,
              );
          const outcome = game.win_loss ? "Win" : "Loss";
          return `
            <details class="context-game">
              <summary>
                <span><strong>${escapeHtml(displayGameDate(game.game_date))}</strong> · ${escapeHtml(game.team.abbreviation)} vs ${escapeHtml(game.opponent.abbreviation)} · ${outcome}</span>
                <span>${fixedDisplay(game.final_value_contributed, 3)} VC</span>
              </summary>
              <div class="context-game-grid">
                <section>
                  <h4>Context composition</h4>
                  ${summaryLabels.map((label, index) => `<p><span>${label}</span><strong>${fixedDisplay(contextAmounts[index], 3)} · ${contextPercentages[index] === null ? "—" : `${fixedDisplay(contextPercentages[index], 1)}%`}</strong></p>`).join("")}
                </section>
                <section>
                  <h4>Responsibility</h4>
                  <p><span>Offense</span><strong>${fixedDisplay(game.offensive_value_contributed, 3)}</strong></p>
                  <p><span>Defense</span><strong>${fixedDisplay(game.defensive_value_contributed, 3)}</strong></p>
                  <p><span>Other</span><strong>${fixedDisplay(game.other_value_contributed, 3)}</strong></p>
                </section>
                <section>
                  <h4>Signed raw ledger</h4>
                  <p><span>Offense</span><strong>${signedNumber(game.signed_raw_offense)}</strong></p>
                  <p><span>Defense</span><strong>${signedNumber(game.signed_raw_defense)}</strong></p>
                  <p><span>Other</span><strong>${signedNumber(game.signed_raw_other)}</strong></p>
                </section>
                <section>
                  <h4>Multiplier changes</h4>
                  <p><span>Teammate offense / defense</span><strong>${signedNumber(game.teammate_offense_multiplier_percentage, "%")} / ${signedNumber(game.teammate_defense_multiplier_percentage, "%")}</strong></p>
                  <p><span>Opponent offense / defense</span><strong>${signedNumber(game.opponent_offense_multiplier_percentage, "%")} / ${signedNumber(game.opponent_defense_multiplier_percentage, "%")}</strong></p>
                  <p><span>Combined offense / defense</span><strong>${signedNumber(game.combined_offense_multiplier_percentage, "%")} / ${signedNumber(game.combined_defense_multiplier_percentage, "%")}</strong></p>
                </section>
                <section>
                  <h4>Player-on PPP</h4>
                  <p><span>Offense actual / expected</span><strong>${ppp(game.actual_offense_points_on, game.offensive_possessions_on)} / ${ppp(game.expected_offense_points_on, game.offensive_possessions_on)}</strong></p>
                  <p><span>Opponent actual / expected</span><strong>${ppp(game.actual_opponent_points_on, game.defensive_possessions_on)} / ${ppp(game.expected_opponent_points_on, game.defensive_possessions_on)}</strong></p>
                  <p><span>Opponent defense / offense strength</span><strong>${signedNumber(game.opponent_defense_strength_mean)} / ${signedNumber(game.opponent_offense_strength_mean)}</strong></p>
                </section>
                <section>
                  <h4>Responsibility evidence</h4>
                  <p><span>Positive O / D / Other</span><strong>${fixedDisplay(game.offense_component_positive, 3)} / ${fixedDisplay(game.defense_component_positive, 3)} / ${fixedDisplay(game.other_component_positive, 3)}</strong></p>
                  <p><span>Negative O / D / Other</span><strong>${fixedDisplay(game.offense_component_negative_magnitude, 3)} / ${fixedDisplay(game.defense_component_negative_magnitude, 3)} / ${fixedDisplay(game.other_component_negative_magnitude, 3)}</strong></p>
                  <p><span>Basis O / D / Other</span><strong>${fixedDisplay(game.offense_responsibility_basis, 3)} / ${fixedDisplay(game.defense_responsibility_basis, 3)} / ${fixedDisplay(game.other_responsibility_basis, 3)}</strong></p>
                </section>
              </div>
            </details>`;
        })
        .join("")
    : '<p class="context-empty">No games match this exact scope.</p>';

  elements.contextDialogContent.innerHTML = `
    <section class="context-summary" aria-label="Selected-scope context composition">
      ${summaryCards}
      <div class="context-summary-total"><span>Selected final ${selectedBreakdownMode() === "wc" ? "WC" : "VC"}</span><strong>${fixedDisplay(summary.final_value, 3)}</strong></div>
    </section>
    <section class="context-games" aria-label="Player game context">
      <h3>Player games</h3>
      ${gameCards}
    </section>`;
  const pagination = payload.pagination;
  elements.contextPageStatus.textContent = pagination.total_pages
    ? `Page ${pagination.page} of ${pagination.total_pages}`
    : "No pages";
  elements.contextPagePrevious.disabled = pagination.page <= 1;
  elements.contextPageNext.disabled =
    pagination.total_pages === 0 || pagination.page >= pagination.total_pages;
}

async function loadPlayerContext() {
  if (!isV8() || !state.selectedContextPlayerId) return;
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
    season: elements.season.value,
    phase: elements.phase.value,
    garbage_time_mode: elements.garbageTimeMode.value,
    stat_version: "v8",
    breakdown_mode: selectedBreakdownMode(),
    page: String(requestPage),
    per_page: "20",
  });
  try {
    const response = await fetch(`/api/rankings/player-context?${params}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "Player context could not be loaded.");
    }
    const payload = await response.json();
    if (requestScopeSignature !== currentContextScopeSignature()) return;
    if (requestScopeSignature !== responseContextScopeSignature(payload)) {
      throw new Error("Player context response did not match the requested scope.");
    }
    if (payload.games[0]?.player_name) {
      state.selectedContextPlayerName = payload.games[0].player_name;
    }
    elements.contextDialogTitle.textContent = `${state.selectedContextPlayerName || `NBA ID ${requestPlayerId}`} context`;
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
  if (!isV8()) return;
  state.selectedContextPlayerId = String(playerId);
  state.selectedContextPlayerName = playerName || `NBA ID ${playerId}`;
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
    season: elements.season.value,
    phase: elements.phase.value,
    garbage_time_mode: elements.garbageTimeMode.value,
    limit: elements.limit.value,
    trend_phase: selectedTrendPhase(),
    trend_window: String(selectedTrendWindow()),
    lift_window: String(selectedLiftWindow()),
    lift_group: selectedLiftGroup(),
    game_season: elements.topGamesSeason.value,
    game_phase: elements.topGamesPhase.value,
    game_outcome: selectedTopGamesOutcome(),
    game_limit: elements.topGamesLimit.value,
    high_value_sort_by: state.highValueSortBy,
    high_value_sort_direction: state.highValueSortDirection,
    high_value_phase: elements.highValuePhase.value,
    sort_by: state.sortBy,
    sort_direction: state.sortDirection,
  });
  if (isV8()) params.set("breakdown_mode", selectedBreakdownMode());
  if (state.selectedContextPlayerId) {
    params.set("player_id", state.selectedContextPlayerId);
    params.set("context_page", String(state.contextPage));
    if (state.v8RunId) params.set("context_run_id", state.v8RunId);
  }
  if (elements.search.value.trim()) {
    params.set("search", elements.search.value.trim());
  }
  const method = historyMode === "push" ? "pushState" : "replaceState";
  history[method]({ playerContext: Boolean(state.selectedContextPlayerId) }, "", `?${params.toString()}`);
}

async function loadRankings() {
  if (!elements.season.value) return;

  updateV8Presentation();
  state.controller?.abort();
  state.controller = new AbortController();
  setSortHighlight();
  setLoading();
  syncUrl();

  const params = new URLSearchParams({
    stat_version: elements.statVersion.value,
    season: elements.season.value,
    phase: elements.phase.value,
    garbage_time_mode: elements.garbageTimeMode.value,
    sort_by: state.sortBy,
    sort_direction: state.sortDirection,
    limit: elements.limit.value,
    search: elements.search.value.trim(),
    breakdown_mode: selectedBreakdownMode(),
  });

  try {
    const response = await fetch(`/api/rankings?${params}`, {
      signal: state.controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "The rankings could not be loaded.");
    }

    const payload = await response.json();
    if (isV8() && state.v8RunId && payload.run_id !== state.v8RunId) {
      throw new Error("The V8 rankings response did not match the available immutable run.");
    }
    state.rankingsRunId = payload.run_id;
    const scopeLabel = payload.season === "All Seasons" ? "Career" : payload.season;
    elements.title.textContent = `${scopeLabel} player value`;
    elements.meta.textContent = `${statVersionLabel()} · ${scheduleLabel(payload.phase)} · ${garbageTimeLabel()} · ${payload.rows.length} player${payload.rows.length === 1 ? "" : "s"} · Sorted by ${sortLabel()}`;
    renderRows(payload.rows);
    if (state.selectedContextPlayerId && isV8()) loadPlayerContext();
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.body.innerHTML = "";
    elements.meta.textContent = "";
    elements.error.textContent = error.message;
    elements.error.hidden = false;
  }
}

async function loadTopGames() {
  state.topGamesController?.abort();
  state.topGamesController = new AbortController();
  setTopGamesLoading();
  syncUrl();

  const params = new URLSearchParams({
    stat_version: elements.statVersion.value,
    season: elements.topGamesSeason.value,
    phase: elements.topGamesPhase.value,
    outcome: selectedTopGamesOutcome(),
    garbage_time_mode: elements.garbageTimeMode.value,
    limit: elements.topGamesLimit.value,
  });

  try {
    const response = await fetch(`/api/rankings/top-games?${params}`, {
      signal: state.topGamesController.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "The single-game leaders could not be loaded.");
    }

    const payload = await response.json();
    const seasonLabel = payload.season === "All Seasons" ? "All seasons" : payload.season;
    const phaseLabel = {
      All: "All games",
      "Regular Season": "Regular season",
      Playoffs: "Playoffs",
      Postseason: "Postseason",
    }[payload.phase] ?? payload.phase;
    const outcomeLabel = {
      Both: "wins and losses",
      Wins: "wins only",
      Losses: "losses only",
    }[payload.outcome] ?? payload.outcome;
    renderTopGames(payload.rows);
    elements.topGamesMeta.textContent = `${statVersionLabel()} · ${seasonLabel} · ${phaseLabel} · ${outcomeLabel} · ${garbageTimeLabel()} · Top ${payload.rows.length}`;
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.topGamesBody.innerHTML = "";
    elements.topGamesMeta.textContent = "";
    elements.topGamesError.textContent = error.message;
    elements.topGamesError.hidden = false;
  }
}

async function loadHighValueRecords() {
  state.highValueRecordsController?.abort();
  state.highValueRecordsController = new AbortController();
  setHighValueSortHighlight();
  setHighValueRecordsLoading();
  syncUrl();

  const params = new URLSearchParams({
    stat_version: elements.statVersion.value,
    phase: elements.highValuePhase.value,
    garbage_time_mode: elements.garbageTimeMode.value,
    sort_by: state.highValueSortBy,
    sort_direction: state.highValueSortDirection,
  });

  try {
    const response = await fetch(`/api/rankings/high-value-records?${params}`, {
      signal: state.highValueRecordsController.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "The .400-plus records could not be loaded.");
    }

    const payload = await response.json();
    const phaseLabel = {
      All: "All games",
      "Regular Season": "Regular season",
      Playoffs: "Playoffs · no Play-In",
      Postseason: "Postseason · Play-In + playoffs",
    }[payload.phase] ?? payload.phase;
    renderHighValueRecords(payload.rows);
    elements.highValuePlayerCount.textContent = String(payload.total_players);
    elements.highValueRecordsMeta.textContent = `${statVersionLabel()} · ${phaseLabel} · ${garbageTimeLabel()} · ${payload.total_players} qualifying player${payload.total_players === 1 ? "" : "s"} · Sorted by ${highValueSortLabel()}`;
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.highValueRecordsBody.innerHTML = "";
    elements.highValuePlayerCount.textContent = "—";
    elements.highValueRecordsMeta.textContent = "";
    elements.highValueRecordsError.textContent = error.message;
    elements.highValueRecordsError.hidden = false;
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
  const query = elements.trendSearch.value.trim().toLocaleLowerCase();
  if (query) {
    return new Set(
      state.trendPayload.players
        .filter((player) => player.player_name.toLocaleLowerCase().includes(query))
        .map((player) => player.player_id),
    );
  }
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
      elements.trendSearch.value = "";
      applyTrendHighlight();
    });
    button.addEventListener("mouseenter", () =>
      applyTrendHighlight(button.dataset.trendPlayer),
    );
    button.addEventListener("mouseleave", () => applyTrendHighlight());
  });
}

function renderTrendChart(payload) {
  state.trendPayload = payload;
  state.activeTrendPlayer = null;
  const { players, seasons } = payload;
  if (!players.length || !seasons.length) {
    elements.trendChart.innerHTML = `
      <text class="chart-loading" x="560" y="290" text-anchor="middle">
        No players qualified in this schedule.
      </text>`;
    elements.trendMeta.textContent = `No qualifying ${payload.window_years}-season windows`;
    elements.trendLegend.innerHTML = "";
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
  elements.trendMeta.textContent = `${statVersionLabel()} · ${scheduleLabel(payload.phase)} · ${players.length} top-${payload.qualification_rank} qualifiers · ${payload.window_years}-year Wins Contributed average`;
}

async function loadTrends() {
  state.trendController?.abort();
  state.trendController = new AbortController();
  setTrendLoading();
  const params = new URLSearchParams({
    stat_version: elements.statVersion.value,
    phase: selectedTrendPhase(),
    window_years: String(selectedTrendWindow()),
    garbage_time_mode: elements.garbageTimeMode.value,
  });
  try {
    const response = await fetch(`/api/rankings/rolling-trends?${params}`, {
      signal: state.trendController.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "The rolling history could not be loaded.");
    }
    renderTrendChart(await response.json());
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.trendChart.innerHTML = "";
    elements.trendMeta.textContent = "";
    elements.trendError.textContent = error.message;
    elements.trendError.hidden = false;
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
  const query = elements.liftSearch.value.trim().toLocaleLowerCase();
  const players = visibleLiftPlayers();
  if (query) {
    return new Set(
      players
        .filter((player) => player.player_name.toLocaleLowerCase().includes(query))
        .map((player) => player.player_id),
    );
  }
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
      elements.liftSearch.value = "";
      applyLiftHighlight();
    });
    button.addEventListener("mouseenter", () =>
      applyLiftHighlight(button.dataset.liftPlayer),
    );
    button.addEventListener("mouseleave", () => applyLiftHighlight());
  });
}

function renderLiftChart(payload = state.liftPayload) {
  state.liftPayload = payload;
  const players = visibleLiftPlayers();
  const { seasons } = payload;
  if (!players.length || !seasons.length) {
    elements.liftChart.innerHTML = `
      <text class="chart-loading" x="560" y="290" text-anchor="middle">
        No qualifying postseason rank changes.
      </text>`;
    elements.liftMeta.textContent = "No qualifying postseason rank changes";
    elements.liftLegend.innerHTML = "";
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
  elements.liftMeta.textContent = `${statVersionLabel()} · ${players.length} ${groupLabel} · ${payload.window_years}-year average · All Seasons WC top 100`;
}

async function loadLiftTrends() {
  state.liftController?.abort();
  state.liftController = new AbortController();
  setLiftLoading();
  const params = new URLSearchParams({
    stat_version: elements.statVersion.value,
    window_years: String(selectedLiftWindow()),
    garbage_time_mode: elements.garbageTimeMode.value,
  });
  try {
    const response = await fetch(`/api/rankings/postseason-lift-trends?${params}`, {
      signal: state.liftController.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "The postseason rank changes could not be loaded.");
    }
    state.activeLiftPlayer = null;
    renderLiftChart(await response.json());
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.liftChart.innerHTML = "";
    elements.liftMeta.textContent = "";
    elements.liftError.textContent = error.message;
    elements.liftError.hidden = false;
  }
}

async function loadSelectedStatistic() {
  setTopGamesLoading();
  setHighValueRecordsLoading();
  setTrendLoading();
  setLiftLoading();
  await loadRankings();
  await Promise.all([
    loadTopGames(),
    loadSeasonWinsLeaders(),
    loadHighValueRecords(),
    loadTrends(),
    loadLiftTrends(),
  ]);
}

async function initialize() {
  const params = new URLSearchParams(window.location.search);

  try {
    const response = await fetch("/api/rankings/options");
    if (!response.ok) throw new Error("The season list could not be loaded.");
    const payload = await response.json();
    state.v8RunId = payload.v8_run_id;

    elements.statVersion.innerHTML = payload.stat_versions
      .map(
        (version) =>
          `<option value="${escapeHtml(version.value)}">${escapeHtml(
            version.label,
          )}</option>`,
      )
      .join("");
    const requestedStatVersion = params.get("stat_version");
    const validStatVersions = payload.stat_versions.map(
      (version) => version.value,
    );
    elements.statVersion.value = validStatVersions.includes(requestedStatVersion)
      ? requestedStatVersion
      : payload.default_stat_version;
    elements.breakdownMode.value = params.get("breakdown_mode") === "wc"
      ? "wc"
      : "vc";

    elements.season.innerHTML = payload.seasons
      .map(
        (season) =>
          `<option value="${escapeHtml(season)}">${escapeHtml(season)}</option>`,
      )
      .join("");
    const requestedSeason = params.get("season");
    elements.season.value = payload.seasons.includes(requestedSeason)
      ? requestedSeason
      : payload.default_season;

    const validGarbageTimeModes = payload.garbage_time_modes.map(
      (mode) => mode.value,
    );
    const requestedGarbageTimeMode = params.get("garbage_time_mode");
    elements.garbageTimeMode.value = validGarbageTimeModes.includes(
      requestedGarbageTimeMode,
    )
      ? requestedGarbageTimeMode
      : payload.default_garbage_time_mode;

    elements.topGamesSeason.innerHTML = payload.seasons
      .map(
        (season) =>
          `<option value="${escapeHtml(season)}">${escapeHtml(
            season === "All Seasons" ? "All seasons" : season,
          )}</option>`,
      )
      .join("");
    const requestedGameSeason = params.get("game_season");
    elements.topGamesSeason.value = payload.seasons.includes(requestedGameSeason)
      ? requestedGameSeason
      : "All Seasons";

    const validPhases = ["All", "Regular Season", "PlayIn", "Playoffs", "Postseason"];
    const requestedPhase = params.get("phase");
    elements.phase.value = validPhases.includes(requestedPhase)
      ? requestedPhase
      : "All";
    elements.search.value = params.get("search") || "";
    const requestedLimit = params.get("limit");
    elements.limit.value = ["25", "50", "100", "250"].includes(requestedLimit)
      ? requestedLimit
      : "50";

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
    const liftGroup = ["top", "bottom", "both"].includes(requestedLiftGroup)
      ? requestedLiftGroup
      : "top";
    const liftGroupInput = document.querySelector(
      `input[name="lift-group"][value="${liftGroup}"]`,
    );
    if (liftGroupInput) liftGroupInput.checked = true;

    const requestedGamePhase = params.get("game_phase");
    elements.topGamesPhase.value = [
      "All",
      "Regular Season",
      "Playoffs",
      "Postseason",
    ].includes(requestedGamePhase)
      ? requestedGamePhase
      : "All";

    const requestedGameOutcome = params.get("game_outcome");
    const gameOutcome = ["Both", "Wins", "Losses"].includes(requestedGameOutcome)
      ? requestedGameOutcome
      : "Both";
    const gameOutcomeInput = document.querySelector(
      `input[name="top-games-outcome"][value="${gameOutcome}"]`,
    );
    if (gameOutcomeInput) gameOutcomeInput.checked = true;

    const requestedGameLimit = params.get("game_limit");
    elements.topGamesLimit.value = ["25", "50", "100"].includes(requestedGameLimit)
      ? requestedGameLimit
      : "25";

    const requestedSort = params.get("sort_by");
    const validSorts = [
      "value_contributed",
      "wins_contributed",
      "losses_contributed",
      "value_per_game",
      "value_per_game_rank",
      "postseason_value_per_game_difference",
      "postseason_rank_change",
      "games_played",
      "wins",
      "losses",
      "offense_value",
      "defense_value",
      "hustle_value",
      "other_value",
      "side_context_raw_value",
      "teammate_offense_context_value",
      "opponent_offense_context_value",
      "teammate_defense_context_value",
      "opponent_defense_context_value",
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
    const requestedHighValuePhase = params.get("high_value_phase");
    elements.highValuePhase.value = [
      "All",
      "Regular Season",
      "Playoffs",
      "Postseason",
    ].includes(requestedHighValuePhase)
      ? requestedHighValuePhase
      : "All";

    const requestedContextPlayer = params.get("player_id");
    const requestedContextRun = params.get("context_run_id");
    const contextRunMatches = !requestedContextRun
      || requestedContextRun === state.v8RunId;
    if (
      isV8()
      && contextRunMatches
      && /^\d+$/.test(requestedContextPlayer || "")
    ) {
      state.selectedContextPlayerId = requestedContextPlayer;
      state.selectedContextPlayerName = `NBA ID ${requestedContextPlayer}`;
      const requestedContextPage = Number(params.get("context_page"));
      state.contextPage = Number.isInteger(requestedContextPage) && requestedContextPage > 0
        ? requestedContextPage
        : 1;
      elements.contextDialog.showModal();
    }
    updateV8Presentation();

    await loadSelectedStatistic();
  } catch (error) {
    elements.body.innerHTML = "";
    elements.error.textContent = `${error.message} Make sure local Postgres is running.`;
    elements.error.hidden = false;
    elements.title.textContent = "Dashboard unavailable";
    elements.trendChart.innerHTML = "";
    elements.liftChart.innerHTML = "";
    elements.topGamesBody.innerHTML = "";
    elements.highValueRecordsBody.innerHTML = "";
  }
}

elements.season.addEventListener("change", () => {
  invalidatePlayerContextScope();
  loadRankings();
});
elements.phase.addEventListener("change", () => {
  invalidatePlayerContextScope();
  loadRankings();
});
elements.statVersion.addEventListener("change", () => {
  if (!isV8()) closePlayerContext();
  updateV8Presentation();
  loadSelectedStatistic();
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
elements.topGamesSeason.addEventListener("change", loadTopGames);
elements.topGamesPhase.addEventListener("change", loadTopGames);
elements.topGamesOutcomes.forEach((input) => {
  input.addEventListener("change", loadTopGames);
});
elements.topGamesLimit.addEventListener("change", loadTopGames);
elements.seasonWinsPhase.addEventListener("input", loadSeasonWinsLeaders);
elements.highValuePhase.addEventListener("change", loadHighValueRecords);
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
    loadHighValueRecords();
  });
});
elements.highValueMobileSort.addEventListener("change", () => {
  state.highValueSortBy = elements.highValueMobileSort.value;
  state.highValueSortDirection = "desc";
  loadHighValueRecords();
});
elements.highValueMobileSortDirection.addEventListener("click", () => {
  state.highValueSortDirection =
    state.highValueSortDirection === "desc" ? "asc" : "desc";
  loadHighValueRecords();
});
elements.trendPhases.forEach((input) => {
  input.addEventListener("change", () => {
    syncUrl();
    loadTrends();
  });
});
elements.trendWindows.forEach((input) => {
  input.addEventListener("change", () => {
    syncUrl();
    loadTrends();
  });
});
elements.liftWindows.forEach((input) => {
  input.addEventListener("change", () => {
    syncUrl();
    loadLiftTrends();
  });
});
elements.liftGroups.forEach((input) => {
  input.addEventListener("change", () => {
    state.activeLiftPlayer = null;
    elements.liftSearch.value = "";
    syncUrl();
    renderLiftChart();
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
      state.sortDirection = sortBy === "value_per_game_rank" ? "asc" : "desc";
    }
    loadRankings();
  });
});
elements.recordColumnsToggle.addEventListener("click", () => {
  state.recordColumnsExpanded = !state.recordColumnsExpanded;
  updateColumnGroupPresentation();
  const placeholder = elements.body.querySelector(".loading-row td, .empty-row td");
  if (placeholder) placeholder.colSpan = visibleRankingColumnCount();
});
elements.contextColumnsToggle.addEventListener("click", () => {
  state.contextColumnsExpanded = !state.contextColumnsExpanded;
  updateColumnGroupPresentation();
  const placeholder = elements.body.querySelector(".loading-row td, .empty-row td");
  if (placeholder) placeholder.colSpan = visibleRankingColumnCount();
});
elements.mobileSort.addEventListener("change", () => {
  state.sortBy = elements.mobileSort.value;
  state.sortDirection =
    state.sortBy === "value_per_game_rank" ? "asc" : "desc";
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
elements.trendSearch.addEventListener("input", () => {
  clearTimeout(state.trendSearchTimer);
  state.trendSearchTimer = setTimeout(() => {
    state.activeTrendPlayer = null;
    applyTrendHighlight();
  }, 80);
});
elements.liftSearch.addEventListener("input", () => {
  clearTimeout(state.liftSearchTimer);
  state.liftSearchTimer = setTimeout(() => {
    state.activeLiftPlayer = null;
    applyLiftHighlight();
  }, 80);
});

window.addEventListener("popstate", () => {
  invalidatePlayerContextScope({ resetPage: false });
  const previousStatVersion = elements.statVersion.value;
  const previousGarbageTimeMode = elements.garbageTimeMode.value;
  const params = new URLSearchParams(window.location.search);
  const optionValues = (select) => Array.from(select.options, (option) => option.value);
  const requestedStatVersion = params.get("stat_version");
  if (optionValues(elements.statVersion).includes(requestedStatVersion)) {
    elements.statVersion.value = requestedStatVersion;
  }
  const requestedSeason = params.get("season");
  if (optionValues(elements.season).includes(requestedSeason)) {
    elements.season.value = requestedSeason;
  }
  const requestedPhase = params.get("phase");
  if (optionValues(elements.phase).includes(requestedPhase)) {
    elements.phase.value = requestedPhase;
  }
  const requestedTimeMode = params.get("garbage_time_mode");
  if (optionValues(elements.garbageTimeMode).includes(requestedTimeMode)) {
    elements.garbageTimeMode.value = requestedTimeMode;
  }
  const requestedLimit = params.get("limit");
  if (optionValues(elements.limit).includes(requestedLimit)) {
    elements.limit.value = requestedLimit;
  }
  elements.search.value = params.get("search") || "";
  const requestedSort = params.get("sort_by");
  if (optionValues(elements.mobileSort).includes(requestedSort)) {
    state.sortBy = requestedSort;
  }
  state.sortDirection = params.get("sort_direction") === "asc" ? "asc" : "desc";
  if (isV8()) {
    elements.breakdownMode.value = params.get("breakdown_mode") === "wc"
      ? "wc"
      : "vc";
  }
  const playerId = params.get("player_id");
  const contextRunId = params.get("context_run_id");
  const contextRunMatches = !contextRunId || contextRunId === state.v8RunId;
  if (isV8() && contextRunMatches && /^\d+$/.test(playerId || "")) {
    state.selectedContextPlayerId = playerId;
    state.selectedContextPlayerName = `NBA ID ${playerId}`;
    const page = Number(params.get("context_page"));
    state.contextPage = Number.isInteger(page) && page > 0 ? page : 1;
    if (!elements.contextDialog.open) elements.contextDialog.showModal();
  } else {
    closePlayerContext({ updateUrl: false });
  }
  updateV8Presentation();
  const selectedStatisticScopeChanged =
    elements.statVersion.value !== previousStatVersion
    || elements.garbageTimeMode.value !== previousGarbageTimeMode;
  if (selectedStatisticScopeChanged) {
    loadSelectedStatistic();
  } else {
    loadRankings();
  }
});

setupMobileCharts();
initialize();
