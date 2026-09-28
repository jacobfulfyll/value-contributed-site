import { renderMobileArchetypes } from "./mobile-archetypes.js?v=mobile-archetypes-20260923-21";
// Side-effect import: name-fold.js is a classic script in the same UMD shape as
// team-directory.js, and it carries the site's one name-folding rule — the same
// rule `src/name_search.py` runs in Python and in SQL.
import "./name-fold.js";
// Side-effect import: page-notice.js turns a browser's own "Failed to
// fetch" into a sentence a reader can act on.
import "./page-notice.js";
import { renderMobileScatter, renderMobileComparison } from "./mobile-chart-previews.js?v=type-trends-mobile-20260927-1";
export { renderMobileTrend, renderMobileLift } from "./mobile-chart-previews.js?v=type-trends-mobile-20260927-1";
import { renderMobileTypeTrends } from "./mobile-chart-previews.js?v=type-trends-mobile-20260927-1";

const { foldName } = globalThis.ValueContributedNameFold;
const { readableError } = globalThis.ValueContributedPageNotice;

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS = ["#542788", "#2c7bb6", "#00a6ca", "#00a878", "#e3b505", "#f57c00", "#c2185b"];
const PCA_FEATURES = Object.freeze([
  ["Offense", "offensive_value_contributed"],
  ["Defense", "defensive_value_contributed"],
  ["General O context", "general_offense_context_value"],
  ["Teammate O context", "teammate_offense_context_value"],
  ["Opponent O context", "opponent_defense_context_value"],
  ["General D context", "general_defense_context_value"],
  ["Teammate D context", "teammate_defense_context_value"],
  ["Opponent D context", "opponent_offense_context_value"],
]);
const OFFENSE_TYPE_SOURCES = Object.freeze([
  "administrative_bonus_point", "assister", "defensive_lane_replacement_point",
  "ft_assister", "offensive_boxout", "oreb_pool", "regular_ft_shortfall",
  "retained_foul_drawn", "retained_foul_oreb_shortfall", "retained_foul_points",
  "scorer", "screen_assister", "terminal_fg_miss_2pt", "terminal_fg_miss_3pt", "turnover",
]);
const SCORING_TYPE_SOURCES = Object.freeze([
  "administrative_bonus_point", "defensive_lane_replacement_point", "oreb_pool",
  "regular_ft_shortfall", "retained_foul_drawn", "retained_foul_oreb_shortfall",
  "retained_foul_points", "scorer", "terminal_fg_miss_2pt", "terminal_fg_miss_3pt",
]);
const PLAYMAKING_TYPE_SOURCES = Object.freeze(["assister", "ft_assister"]);
const OFF_BALL_TYPE_SOURCES = Object.freeze(["screen_assister", "oreb_pool", "offensive_boxout", "retained_foul_drawn"]);
const SHOT_DEFENSE_TYPE_SOURCES = Object.freeze(["DFG_make", "DFG_miss", "block", "pressure_defense"]);
const DISRUPTION_TYPE_SOURCES = Object.freeze(["steal"]);
const POSSESSION_FINISH_TYPE_SOURCES = Object.freeze(["defensive_rebound", "defensive_boxout"]);
const DEFENSE_TYPE_SOURCES = Object.freeze([
  "DFG_make", "DFG_miss", "administrative_point_penalty", "block",
  "defensive_boxout", "defensive_lane_violation_penalty", "defensive_rebound",
  "ordinary_foul_penalty", "pressure_defense", "retained_foul_penalty", "steal",
]);
const CONTEXT_TYPE_SOURCES = Object.freeze([
  "general_offense", "general_defense", "teammate_offense", "teammate_defense",
  "opponent_offense", "opponent_defense",
]);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const number = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value)) : "—";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[character]);
const svg = (name, attrs = {}, text = null) => {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text !== null) node.textContent = text;
  return node;
};

function metricFields(payload) {
  const wins = payload?.breakdown_mode === "wc";
  return wins ? {
    short: "WC", label: "Wins Contributed", total: "wins_contributed",
    offense: "offensive_wins_contributed", defense: "defensive_wins_contributed", other: "other_wins_contributed",
  } : {
    short: "VC", label: "Value Contributed", total: "value_contributed",
    offense: "offensive_value_contributed", defense: "defensive_value_contributed", other: "other_value_contributed",
  };
}

function playerMinutes(row) {
  return finite(row.minutes_played, finite(row.seconds_played) / 60);
}

function per36(row, field) {
  const minutes = playerMinutes(row);
  return minutes > 0 ? finite(row[field]) * 36 / minutes : 0;
}

function paddedDomain(values, { includeZero = false, padding = 0.09 } = {}) {
  const observed = values.map(Number).filter(Number.isFinite);
  if (includeZero) observed.push(0);
  let low = Math.min(...observed);
  let high = Math.max(...observed);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [-1, 1];
  if (low === high) {
    const nudge = Math.max(1, Math.abs(low) * .1);
    low -= nudge;
    high += nudge;
  }
  const extra = (high - low) * padding;
  return [low - extra, high + extra];
}

function linearScale([low, high], start, end) {
  const span = high - low || 1;
  return { low, high, map: (value) => start + (finite(value) - low) / span * (end - start) };
}

function midrankPercentiles(rows, accessor) {
  const ordered = rows.map((row, index) => ({ index, value: finite(accessor(row)) }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const output = new Array(rows.length).fill(50);
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
    const midpoint = (start + end - 1) / 2;
    const percentile = ordered.length <= 1 ? 50 : 100 * midpoint / (ordered.length - 1);
    for (let index = start; index < end; index += 1) output[ordered[index].index] = percentile;
    start = end;
  }
  return output;
}

function playerHref(row, payload) {
  const params = new URLSearchParams({
    source: String(payload.stat_version ?? "original") === "original" ? "v9" : String(payload.stat_version),
    schedule: ({ All: "all", "Regular Season": "regular_season", PlayIn: "play_in", Playoffs: "playoffs", Postseason: "postseason" })[payload.phase] ?? "all",
    time_mode: payload.garbage_time_mode ?? "competitive",
    metric: metricFields(payload).total,
    player_id: String(row.player_id),
  });
  for (const season of payload.selected_seasons ?? (payload.season && payload.season !== "All Seasons" ? [payload.season] : [])) params.append("season", season);
  return `/players?${params}`;
}

function initials(name) {
  return String(name ?? "?").split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function headshotUrl(playerId) {
  return `https://cdn.nba.com/headshots/nba/latest/260x190/${Number(playerId)}.png`;
}

// The 260-wide headshot has only about 70 pixels across the face, which is no
// more than a high-resolution screen draws a chart face at, so faces there
// look soft. On such a screen at desktop width the chart faces use the
// 1040-wide headshot (about 200 KB against 16 KB); phones and ordinary
// screens keep the small one.
export function sharpFaces(view = globalThis.window) {
  return Number(view?.devicePixelRatio ?? 1) > 1.5 && Number(view?.innerWidth ?? 0) >= 768;
}

function chartFaceUrl(playerId) {
  return sharpFaces()
    ? `https://cdn.nba.com/headshots/nba/latest/1040x760/${Number(playerId)}.png`
    : headshotUrl(playerId);
}

function measuredChartSize(container, { minimumHeight = 500, maximumHeight = 660, ratio = .56 } = {}) {
  const width = Math.max(340, Math.floor(container.getBoundingClientRect().width || container.clientWidth || 900));
  return { width, height: Math.max(minimumHeight, Math.min(maximumHeight, Math.round(width * ratio))) };
}

// No mark carries a floating tooltip: pointing at one, tapping it or moving the
// keyboard focus to it highlights it, and the panel under the chart is the one
// place its details are shown. The highlight lets go as soon as the pointer
// leaves the mark, the focus moves on or the finger lifts, so no player stays
// lit after the reader has moved away. A player found with the search box is a
// choice, not a hover: he stays highlighted until the box is cleared.
// On a phone or a touch screen there is no hover, so tapping a face does what
// pointing at it does on a desktop — its card opens, a second tap closes it —
// and never follows the face's link to the profile (owner's note, 2026-09-27).
export function tapsShowHover(view = globalThis) {
  return view.matchMedia?.("(max-width: 760px), (hover: none)").matches ?? false;
}

function bindMarkHighlight(container, status, defaultStatus, search = null) {
  const marks = [...container.querySelectorAll("[data-player-mark]")];
  let selected = null;
  const apply = (active) => {
    container.classList.toggle("has-mark-highlight", Boolean(active));
    marks.forEach((mark) => {
      mark.classList.toggle("is-highlighted", mark === active);
      mark.classList.toggle("is-muted", Boolean(active) && mark !== active);
    });
    status.innerHTML = active ? active.dataset.hoverHtml : defaultStatus;
  };
  const hover = (mark) => apply(mark);
  const release = () => apply(selected);
  marks.forEach((mark) => {
    mark.addEventListener("click", (event) => {
      if (!tapsShowHover()) return;
      event.preventDefault();
      selected = selected === mark ? null : mark;
      apply(selected);
    });
    mark.addEventListener("pointerenter", () => hover(mark));
    mark.addEventListener("pointerleave", release);
    mark.addEventListener("focusin", () => hover(mark));
    mark.addEventListener("focusout", release);
    mark.addEventListener("touchend", release, { passive: true });
    mark.addEventListener("touchcancel", release, { passive: true });
  });
  // A pointer that leaves the whole chart (or a mark redrawn under it) lets go too.
  container.addEventListener("pointerleave", release);
  if (!search) return;
  const input = search.querySelector("input");
  const clear = search.querySelector("button");
  const selectMatch = () => {
    const raw = input.value.trim();
    // One folding rule for every name search on the site: "jokic" finds Jokić.
    const query = foldName(raw);
    if (!query) { selected = null; apply(null); return; }
    const ordered = marks.map((mark, index) => ({
      mark, index,
      id: String(mark.dataset.playerMark),
      name: foldName(mark.dataset.playerName),
    }));
    const match = ordered.find((item) => item.id === raw || item.name === query)
      ?? ordered.find((item) => item.name.startsWith(query))
      ?? ordered.find((item) => item.name.includes(query));
    if (!match) {
      selected = null;
      apply(null);
      status.innerHTML = `<strong>No chart match</strong><span>No displayed player matches “${escapeHtml(input.value.trim())}”. Try a full or partial name.</span>`;
      return;
    }
    selected = match.mark;
    apply(selected);
  };
  input.addEventListener("input", selectMatch);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    selectMatch();
  });
  clear.addEventListener("click", () => {
    input.value = "";
    selected = null;
    apply(null);
    input.focus();
  });
}

function appendPlayerFace(chart, row, {
  x, y, radius, payload, detail, index, color = null, withImage = true,
  dim = false, hoverFace = false,
}) {
  const clipId = `player-face-${String(row.player_id).replace(/\D/gu, "")}-${index}`;
  if (withImage) {
    let defs = chart.querySelector("defs");
    if (!defs) { defs = svg("defs"); chart.prepend(defs); }
    const clip = svg("clipPath", { id: clipId });
    clip.append(svg("circle", { cx: 0, cy: 0, r: Math.max(1, radius - 2) }));
    defs.append(clip);
  }
  const positioned = svg("g", { transform: `translate(${x} ${y})`, class: "player-mark-position" });
  // A chart that draws only its best players as faces still shows the face of
  // whoever is hovered or focused, so a dot is never anonymous.
  const hoverPortrait = hoverFace
    ? `<img class="chart-hover-face" src="${escapeHtml(headshotUrl(row.player_id))}" alt="" loading="lazy"/>`
    : "";
  const link = svg("a", {
    href: playerHref(row, payload),
    class: dim ? "player-face-mark is-dot-mark" : "player-face-mark",
    tabindex: 0,
    "data-player-mark": String(row.player_id),
    "data-player-name": String(row.player_name),
    "data-hover-html": `${hoverPortrait}<strong>${escapeHtml(row.player_name)}</strong><span>${escapeHtml(detail)}</span>`,
    "aria-label": `${row.player_name}. ${detail}. Open player profile.`,
  });
  const markColor = color ?? COLORS[index % COLORS.length];
  link.style.setProperty("--player-mark-color", markColor);
  link.append(svg("circle", { cx: 0, cy: 0, r: radius, class: "player-face-back", fill: markColor }));
  if (withImage) {
    link.append(svg("text", { x: 0, y: 4, "text-anchor": "middle", class: "player-face-initials" }, initials(row.player_name)));
    // Cropped close on the face rather than head and shoulders, so a small
    // mark is still recognisable.
    link.append(svg("image", {
      href: chartFaceUrl(row.player_id), x: -radius * 1.3, y: -radius * .9,
      width: radius * 2.6, height: radius * 2.3,
      preserveAspectRatio: "xMidYMin slice", "clip-path": `url(#${clipId})`, class: "player-face-image",
    }));
  }
  link.append(svg("circle", { cx: 0, cy: 0, r: radius, class: "player-face-ring", stroke: markColor }));
  // A thin dark edge keeps a face distinct from the dots and faces around it.
  if (withImage) link.append(svg("circle", { cx: 0, cy: 0, r: radius + 1, class: "player-face-outline" }));
  positioned.append(link);
  chart.append(positioned);
}

function appendAxes(chart, { width, height, margin, xScale, yScale, xLabel, yLabel, tickFormat = (value) => number(value, 1), reference = null }) {
  chart.append(svg("rect", {
    x: margin.left, y: margin.top, width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom, class: "chart-frame",
  }));
  for (let tick = 0; tick <= 4; tick += 1) {
    const xValue = xScale.low + (xScale.high - xScale.low) * tick / 4;
    const yValue = yScale.low + (yScale.high - yScale.low) * tick / 4;
    const x = xScale.map(xValue); const y = yScale.map(yValue);
    chart.append(svg("line", { x1: x, x2: x, y1: margin.top, y2: height - margin.bottom, class: "grid" }));
    chart.append(svg("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: "grid" }));
    chart.append(svg("text", { x, y: height - margin.bottom + 24, "text-anchor": "middle" }, tickFormat(xValue)));
    chart.append(svg("text", { x: margin.left - 10, y: y + 4, "text-anchor": "end" }, tickFormat(yValue)));
  }
  if (reference) {
    const x = xScale.map(reference.x); const y = yScale.map(reference.y);
    chart.append(svg("line", { x1: x, x2: x, y1: margin.top, y2: height - margin.bottom, class: "reference-line" }));
    chart.append(svg("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: "reference-line" }));
  }
  chart.append(svg("text", { x: (margin.left + width - margin.right) / 2, y: height - 15, "text-anchor": "middle", class: "axis-title" }, xLabel));
  chart.append(svg("text", { x: 18, y: height / 2, "text-anchor": "middle", transform: `rotate(-90 18 ${height / 2})`, class: "axis-title" }, yLabel));
}

function colorScaleLegend({ label, domain, format = (value) => number(value, 2), note = "" }) {
  const low = finite(domain?.[0]);
  const high = finite(domain?.[1]);
  const middle = low + (high - low) / 2;
  const legend = document.createElement("div");
  legend.className = "chart-color-legend";
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", `Color scale for ${label}: ${format(low)} to ${format(high)}`);

  const copy = document.createElement("div");
  copy.className = "chart-color-legend-copy";
  const heading = document.createElement("strong");
  heading.textContent = "Color";
  const description = document.createElement("span");
  description.textContent = label;
  copy.append(heading, description);
  if (note) {
    const explanation = document.createElement("small");
    explanation.textContent = note;
    copy.append(explanation);
  }

  const scale = document.createElement("div");
  scale.className = "chart-color-scale";
  const ramp = document.createElement("div");
  ramp.className = "chart-color-ramp";
  ramp.setAttribute("aria-hidden", "true");
  COLORS.forEach((color, index) => {
    const swatch = document.createElement("span");
    const start = low + (high - low) * index / COLORS.length;
    const end = low + (high - low) * (index + 1) / COLORS.length;
    swatch.style.backgroundColor = color;
    swatch.title = `${format(start)} to ${format(end)}`;
    ramp.append(swatch);
  });
  const values = document.createElement("div");
  values.className = "chart-color-values";
  [["Low", low], ["Middle", middle], ["High", high]].forEach(([prefix, value]) => {
    const item = document.createElement("span");
    item.textContent = `${prefix} ${format(value)}`;
    values.append(item);
  });
  scale.append(ramp, values);
  legend.append(copy, scale);
  return legend;
}

function faceScatter(container, rows, {
  xValue, yValue, radiusValue, xLabel, yLabel, payload, detail, ariaLabel,
  xDomain = null, yDomain = null, reference = null, diagonal = false, diagonalLabel = "same rate", colorValue = null,
  tickFormat = null, searchId = null, colorLegend = null, drawnNote = "",
  faceBudget = null, faceRank = null, faceNoun = "players",
  // Plain words for each part of the chart the dashed line(s) cut out, drawn
  // in its corner: [{ corner: "top-left" | "top-right" | "bottom-left" |
  // "bottom-right", text }]. `lineNote` says what the line(s) mean.
  regions = [], lineNote = "",
}) {
  if (!rows.length) {
    container.innerHTML = '<p class="rankings-chart-empty">No players match this visualization.</p>';
    return;
  }
  // A chart too crowded for every player to be a face gets more height, so
  // more of them have room to be one.
  const crowded = faceBudget === null && rows.length > CHART_FACE_CAP;
  const { width, height } = measuredChartSize(container, crowded ? { maximumHeight: 880, ratio: .68 } : {});
  const margin = { top: 30, right: 32, bottom: 74, left: width < 520 ? 62 : 78 };
  const resolvedX = xDomain ?? paddedDomain(rows.map(xValue));
  const resolvedY = yDomain ?? paddedDomain(rows.map(yValue));
  const xScale = linearScale(resolvedX, margin.left, width - margin.right);
  const yScale = linearScale(resolvedY, height - margin.bottom, margin.top);
  const largest = Math.max(1e-12, ...rows.map((row) => Math.max(0, radiusValue(row))));
  const status = document.createElement("div");
  status.className = "rankings-chart-hover";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const defaultStatus = "<strong>Pick a player on the map</strong><span>Point at a mark, tap it, or move the keyboard focus to it, and that player's numbers appear here.</span>";
  status.innerHTML = defaultStatus;
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": ariaLabel });
  appendAxes(chart, {
    width, height, margin, xScale, yScale, xLabel, yLabel, reference,
    ...(tickFormat ? { tickFormat } : {}),
  });
  if (diagonal) {
    const low = Math.max(xScale.low, yScale.low); const high = Math.min(xScale.high, yScale.high);
    chart.append(svg("line", { x1: xScale.map(low), y1: yScale.map(low), x2: xScale.map(high), y2: yScale.map(high), class: "diagonal-line" }));
    chart.append(svg("text", { x: xScale.map(high) - 5, y: yScale.map(high) - 8, "text-anchor": "end", class: "reference-label" }, diagonalLabel));
  }
  // The words for each region sit under the marks, so they never hide a player.
  for (const region of regions) {
    const left = String(region.corner).endsWith("left");
    const top = String(region.corner).startsWith("top");
    chart.append(svg("text", {
      x: left ? margin.left + 12 : width - margin.right - 12,
      y: top ? margin.top + 22 : height - margin.bottom - 14,
      "text-anchor": left ? "start" : "end", class: "region-label",
    }, region.text));
  }
  // Dots are drawn first and the faces after them, best last, so the players a
  // reader came for are never hidden under somebody else's mark.
  let plan = faceBudgetPlan(rows, {
    budget: faceBudget, cap: CHART_FACE_CAP,
    rank: faceRank ?? ((row) => radiusValue(row)),
  });
  // The rankings page's own rule (no budget): every face one size, all of
  // them faces up to ALL_FACES_LIMIT players, and chooseChartFaces above that.
  const faceRadius = width < 520 ? CHART_FACE_RADIUS_NARROW : CHART_FACE_RADIUS;
  const oneSize = plan.budget === null;
  let facePlace = new Map();
  if (oneSize) {
    const points = rows.map((row) => ({
      x: xScale.map(xValue(row)), y: yScale.map(yValue(row)), minutes: playerMinutes(row),
    }));
    const faces = rows.length <= ALL_FACES_LIMIT
      ? new Set(rows.keys())
      : chooseChartFaces(points, { radius: faceRadius, cap: CHART_FACE_CAP });
    // Faces that land (almost) on top of each other are nudged apart; a thin
    // line runs back to the player's exact spot. A short list keeps every
    // face where it is, as before.
    if (rows.length > ALL_FACES_LIMIT) {
      facePlace = spreadFaces(points, faces, {
        minDistance: 2 * faceRadius * (1 - FACE_OVERLAP),
        maxShift: faceRadius * 1.25,
        bounds: {
          left: margin.left + faceRadius, right: width - margin.right - faceRadius,
          top: margin.top + faceRadius, bottom: height - margin.bottom - faceRadius,
        },
      });
    }
    plan = {
      budget: faces.size,
      faces,
      // Dots first, then faces with the table's best drawn last, on top.
      order: [...rows.keys()].filter((index) => !faces.has(index))
        .concat([...rows.keys()].filter((index) => faces.has(index)).reverse()),
      scale: new Map(),
      faceCount: faces.size,
    };
  }
  for (const index of plan.order) {
    const row = rows[index];
    const withImage = plan.faces.has(index);
    // A budgeted chart keeps its dots deliberately small: they are the crowd a
    // face has to stay readable inside, not marks a reader is reading one by one.
    const base = withImage
      ? 12 * (plan.scale.get(index) ?? 1)
      : (plan.budget === null ? 6 : 4.5);
    const radius = oneSize
      ? (withImage ? faceRadius : 4)
      : base + base * Math.sqrt(Math.max(0, radiusValue(row)) / largest);
    const exactX = xScale.map(xValue(row));
    const exactY = yScale.map(yValue(row));
    const place = withImage ? facePlace.get(index) : null;
    if (place && Math.hypot(place.x - exactX, place.y - exactY) > 2) {
      chart.append(svg("line", { x1: exactX, y1: exactY, x2: place.x, y2: place.y, class: "face-leader" }));
      chart.append(svg("circle", { cx: exactX, cy: exactY, r: 2.5, class: "face-leader-spot" }));
    }
    appendPlayerFace(chart, row, {
      x: place?.x ?? exactX, y: place?.y ?? exactY, radius,
      payload, detail: detail(row), index,
      // No chart colours its marks by a measure any more unless it asks to.
      color: colorValue && !oneSize ? colorValue(row) : (withImage ? FACE_BACKGROUND : DOT_COLOR),
      withImage, dim: plan.budget !== null && !withImage,
      hoverFace: plan.budget !== null,
    });
  }
  let note = null;
  if (drawnNote && chartNotes.drawn) {
    note = document.createElement("p");
    note.className = "chart-drawn-note";
    const faces = faceBudgetNote(plan, rows.length, {
      noun: faceNoun, order: chartScope.order,
    });
    note.textContent = faces ? `${drawnNote} ${faces}` : drawnNote;
  }
  let search = null;
  if (searchId) {
    search = document.createElement("div");
    search.className = "chart-player-search";
    search.innerHTML = `<label for="${searchId}">Find a player on this chart</label><div><input id="${searchId}" type="search" autocomplete="off" placeholder="Player name"/><button type="button">Clear</button></div>`;
  }
  const legend = colorLegend ? colorScaleLegend(colorLegend) : null;
  // One line under the search saying what the dashed line(s) mean and, when
  // not everyone is a face, who is.
  const keyWords = [lineNote];
  if (oneSize && rows.length > ALL_FACES_LIMIT) {
    keyWords.push("Faces are the players on the edges of the chart and, in the crowded middle, those with the most minutes; point at any dot to see who it is.");
  }
  const key = keyWords.filter(Boolean).length ? document.createElement("p") : null;
  if (key) {
    key.className = "chart-key-note";
    key.textContent = keyWords.filter(Boolean).join(" ");
  }
  // The panel goes under the chart: it grows and shrinks as a reader moves
  // across the marks, and nothing above the chart may move while they do.
  container.replaceChildren(
    ...(search ? [search] : []), ...(legend ? [legend] : []),
    ...(key ? [key] : []), ...(note ? [note] : []), chart, status,
  );
  bindMarkHighlight(container, status, defaultStatus, search);
}

// --- how much of the table a chart draws ---------------------------------------
//
// Every chart above the total-history section draws the players the ranking
// table is showing, in the table's own order, so none of them carries a
// population control of its own. A whole-history selection is about 7,300
// player-seasons, which no scatter can show honestly, so a chart draws at most
// CHART_MARK_CAP of them and says how many of how many it drew.

export const CHART_MARK_CAP = 250;
// Above this many marks a face becomes a plain coloured dot: 250 headshots in
// one chart is slower than it is useful, and position is what the chart is for.
export const CHART_FACE_CAP = 120;

// --- who gets a face ------------------------------------------------------------
//
// The rankings page draws faces only while a chart is small enough for them to
// be read (CHART_FACE_CAP), and plain dots above that. The season room wants
// its best players recognisable whatever the size of the league, so a page can
// give a chart a *face budget* instead: the best N are faces, everybody else is
// a dot, and the sentence under the chart says so.
//
// The budget is only about how a mark is drawn. Which players are on the chart
// at all is still CHART_MARK_CAP and the page's own selection.
export const SEASON_FACE_BUDGET = 100;

// The largest and smallest a budgeted face is drawn, as a fraction of the
// ordinary face size: the best player is the biggest face on the chart and the
// hundredth is the smallest, so rank is readable before a name is.
const FACE_BUDGET_LARGEST = 0.82;
const FACE_BUDGET_SMALLEST = 0.5;

/**
 * Which marks are faces, in what order they are drawn, and how big each face is.
 *
 * With no budget this is exactly the rule the rankings page has always had:
 * every mark is a face while there are at most `cap` of them, none above that,
 * and the drawing order is the order the rows arrived in.
 *
 * With a budget, `rank` scores every row (higher is better, ties broken by the
 * row's own position, so the answer never depends on the order they arrive in),
 * the best `budget` rows become faces, and the order puts the dots down first
 * and the faces on top of them — worst face first, so the best player is the
 * last thing drawn and can never be covered.
 */
export function faceBudgetPlan(rows, { budget = null, cap = CHART_FACE_CAP, rank = null } = {}) {
  const count = (rows ?? []).length;
  const indexes = Array.from({ length: count }, (_, index) => index);
  if (budget === null || budget === undefined) {
    return {
      budget: null,
      faces: new Set(count <= cap ? indexes : []),
      order: indexes,
      scale: new Map(),
      faceCount: count <= cap ? count : 0,
    };
  }
  const allowed = Math.max(0, Math.min(Math.floor(Number(budget)) || 0, count));
  const score = (index) => {
    const value = Number(rank ? rank(rows[index], index) : 0);
    return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  };
  const ranked = [...indexes].sort((left, right) => score(right) - score(left) || left - right);
  const chosen = ranked.slice(0, allowed);
  const faces = new Set(chosen);
  const span = FACE_BUDGET_LARGEST - FACE_BUDGET_SMALLEST;
  const scale = new Map(chosen.map((index, place) => [
    index,
    allowed <= 1 ? FACE_BUDGET_LARGEST : FACE_BUDGET_LARGEST - span * place / (allowed - 1),
  ]));
  return {
    budget: allowed,
    faces,
    order: [...indexes.filter((index) => !faces.has(index)), ...[...chosen].reverse()],
    scale,
    faceCount: allowed,
  };
}

/** The plain sentence that says which marks are faces and which are dots. */
export function faceBudgetNote(plan, total, { noun = "players", order = "" } = {}) {
  if (!plan || plan.budget === null || plan.budget === undefined) {
    return plan?.faceCount ? "" : "At this many marks each player is a plain dot rather than a face.";
  }
  const drawn = Number(total) || 0;
  if (plan.faceCount >= drawn) return "";
  const rest = drawn - plan.faceCount;
  return `The first ${plan.faceCount}${order ? ` in ${order}` : ""} are drawn as faces; `
    + `the other ${rest} ${noun} are plain dots. `
    + "Hover or focus any dot to see that player's face and name.";
}

// --- whose face is drawn -----------------------------------------------------------
//
// Every face on the rankings charts is one size, CHART_FACE_RADIUS (the size the
// every-season chart uses). A chart showing at most ALL_FACES_LIMIT players
// makes every one of them a face. Above that, chooseChartFaces decides:
//
//   1. the edges first: the players farthest from the middle of the cloud (the
//      quarter farthest from the median player, measured on screen so both
//      axes count alike) are always eligible, farthest first, because a player
//      out on the edge is the one a reader wants to name;
//   2. then the crowded middle, in the table's order, but only players with
//      enough minutes (the top quarter by minutes among the players drawn);
//   3. a middle face is skipped when it would sit closer than `spacing` to a
//      face already chosen (faces may overlap by FACE_OVERLAP of their width);
//      an edge face only when it would sit almost exactly on one
//      (`edgeSpacing`), because spreadFaces then nudges it clear;
//   4. at most `cap` are chosen.
//
// Everybody else is a small dot that shows its face and name on hover or tap.

export const CHART_FACE_RADIUS = 18;
export const CHART_FACE_RADIUS_NARROW = 12;
// One neutral backing for every face and one colour for every dot: the charts
// no longer colour marks by a measure.
export const FACE_BACKGROUND = "#dfe8e2";
export const DOT_COLOR = "#7f9189";
export const ALL_FACES_LIMIT = 25;
export const FACE_OVERLAP = 0.25;
export const EDGE_SHARE = 0.25;
export const MINUTES_SHARE = 0.25;

function upperQuantile(values, share) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return Number.POSITIVE_INFINITY;
  const index = Math.min(ordered.length - 1, Math.max(0, Math.floor(ordered.length * (1 - share))));
  return ordered[index];
}

export function chooseChartFaces(points, {
  radius = CHART_FACE_RADIUS, cap = CHART_FACE_CAP,
  spacing: minimum = 2 * radius * (1 - FACE_OVERLAP),
  edgeSpacing = radius * 0.6,
  edgeShare = EDGE_SHARE, minutesShare = MINUTES_SHARE,
} = {}) {
  const valid = (points ?? []).map((point, index) => ({
    index, x: Number(point?.x), y: Number(point?.y), minutes: Number(point?.minutes),
  })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!valid.length) return new Set();
  const middleX = medianOf(valid.map((point) => point.x));
  const middleY = medianOf(valid.map((point) => point.y));
  for (const point of valid) point.distance = Math.hypot(point.x - middleX, point.y - middleY);
  const edgeFrom = upperQuantile(valid.map((point) => point.distance), edgeShare);
  const minutesFrom = upperQuantile(valid.map((point) => point.minutes), minutesShare);
  const edge = valid.filter((point) => point.distance >= edgeFrom)
    .sort((left, right) => right.distance - left.distance || left.index - right.index);
  const middle = valid.filter((point) => point.distance < edgeFrom && point.minutes >= minutesFrom);
  const chosen = new Set();
  const placed = [];
  const tooClose = (point, gap) => placed.some((other) => (other.x - point.x) ** 2 + (other.y - point.y) ** 2 < gap ** 2);
  for (const point of edge) {
    if (chosen.size >= cap) break;
    if (tooClose(point, edgeSpacing)) continue;
    chosen.add(point.index);
    placed.push(point);
  }
  for (const point of middle) {
    if (chosen.size >= cap) break;
    if (tooClose(point, minimum)) continue;
    chosen.add(point.index);
    placed.push(point);
  }
  return chosen;
}

/**
 * Where each chosen face is drawn: its own spot, or nudged just far enough
 * that no two faces sit closer than `minDistance`. A face never moves more
 * than `maxShift` from its player's exact spot and never leaves `bounds`, so
 * a very tight knot can still overlap a little. Deterministic: pairs are
 * pushed apart in a fixed order for a fixed number of rounds.
 * Returns Map(index -> { x, y }).
 */
export function spreadFaces(points, indexes, {
  minDistance = 2 * CHART_FACE_RADIUS * (1 - FACE_OVERLAP),
  maxShift = CHART_FACE_RADIUS * 1.25,
  bounds = null, rounds = 80,
} = {}) {
  const faces = [...indexes].map((index) => ({
    index, homeX: Number(points[index].x), homeY: Number(points[index].y),
    x: Number(points[index].x), y: Number(points[index].y),
  }));
  for (let round = 0; round < rounds; round += 1) {
    let moved = false;
    for (let left = 0; left < faces.length; left += 1) {
      for (let right = left + 1; right < faces.length; right += 1) {
        const a = faces[left];
        const b = faces[right];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;
        // Two faces on exactly the same spot part along a fixed direction.
        if (distance < 1e-6) { dx = 1; dy = 0.5; distance = Math.hypot(dx, dy); }
        const push = (minDistance - distance) / 2;
        a.x -= dx / distance * push; a.y -= dy / distance * push;
        b.x += dx / distance * push; b.y += dy / distance * push;
        moved = true;
      }
    }
    for (const face of faces) {
      const dx = face.x - face.homeX;
      const dy = face.y - face.homeY;
      const shift = Math.hypot(dx, dy);
      if (shift > maxShift) {
        face.x = face.homeX + dx / shift * maxShift;
        face.y = face.homeY + dy / shift * maxShift;
      }
      if (bounds) {
        face.x = Math.min(bounds.right, Math.max(bounds.left, face.x));
        face.y = Math.min(bounds.bottom, Math.max(bounds.top, face.y));
      }
    }
    if (!moved) break;
  }
  return new Map(faces.map((face) => [face.index, { x: face.x, y: face.y }]));
}

// The table's rows, in the table's order, capped. `rows` is already the table's
// own population (its statistic, seasons, schedule, game time, search and
// "Show" setting), so nothing here re-sorts or re-filters it.
export function scopedRows(rows, { cap = CHART_MARK_CAP } = {}) {
  const ordered = rows ?? [];
  return ordered.length > cap ? ordered.slice(0, cap) : [...ordered];
}

// The sentence a chart prints when it could not draw everything the table has.
// How a chart names the population it is drawing from. The rankings page's
// charts follow its table; the season room has no table, so it says so in its
// own words instead of inventing one.
const chartScope = {
  subject: "the table is showing",
  order: "the table's own order",
  control: "Change the table's “Show” setting to change which.",
};

// How the page the workspace is on wants faces drawn. `null` is the rankings
// page's own rule (CHART_FACE_CAP); a number is a face budget.
const chartFaces = { budget: null };
// The season room gives two charts a schedule switch of their own (regular
// season, full season, postseason) and the regular-to-postseason chart a
// player search; the rankings page passes neither, so its charts are unchanged.
const chartSchedule = { load: null };
const chartSearch = { regPost: false };
export const CHART_SCHEDULES = Object.freeze([
  ["Regular Season", "Regular season"], ["All", "Full season"], ["Postseason", "Postseason"],
]);
export const SCHEDULED_PANEL_KEYS = Object.freeze(["value-map", "similarity"]);

/** A chart's own schedule: full season until a reader picks another. */
export function chartScheduleOf(key) {
  const chosen = chartView(key).schedule;
  return CHART_SCHEDULES.some(([value]) => value === chosen) ? chosen : "All";
}

function scheduleControl(key) {
  return segmentedControl({
    label: "Schedule",
    options: CHART_SCHEDULES,
    value: chartScheduleOf(key),
    onChange: (schedule) => setChartView(key, { schedule }),
  });
}

// Whether a chart prints the sentence saying how many of how many marks it
// drew. The season room keeps it, because it has no table above it saying what
// the selection is; the rankings page asked for it to go.
const chartNotes = { drawn: true };

export function drawnCountNote(drawn, available, {
  noun = "players",
  subject = chartScope.subject,
  order = chartScope.order,
  control = chartScope.control,
} = {}) {
  if (drawn >= available) return `All ${available} ${noun} ${subject} are drawn.`;
  const tail = control ? ` ${control}` : "";
  return `Of the ${available} ${noun} ${subject}, the first ${drawn} in ${order} are drawn here.${tail}`;
}

function mobileChartRows(rows) {
  const limit = Number(document.querySelector("[data-mobile-chart-limit]")?.dataset.mobileChartLimit);
  return limit > 0 ? rows.slice(0, limit) : rows;
}
function mobileChartScopeNote(container, total) {
  const limit = Number(document.querySelector("[data-mobile-chart-limit]")?.dataset.mobileChartLimit);
  if (!limit || !container.querySelector(".mobile-preview")) return;
  const note = document.createElement("p"); note.className = "mobile-chart-scope";
  note.textContent = `${Math.min(limit,total)} of ${total} players · Wins Contributed order`;
  container.querySelector(".mobile-preview").prepend(note);
}

// --- each chart's own view --------------------------------------------------------
//
// Every chart under the rankings table can be read in Wins Contributed or Value
// Contributed on its own, whatever the table's responsibility view is; the
// value in wins and losses chart switches between totals and per game instead,
// and the every-season chart between one row per season and one combined row.
// Until a reader chooses, a chart follows the table. A choice lasts until the
// page is reloaded.

const chartViews = new Map();
// The workspace sets this so a control can redraw (or refetch) its own chart.
let redrawChart = () => {};

export function chartView(key) {
  return chartViews.get(key) ?? {};
}

function setChartView(key, patch) {
  chartViews.set(key, { ...chartView(key), ...patch });
  redrawChart(key);
}

/** The view a chart is drawn in: the reader's choice, else the table's. */
export function chartBreakdown(key, payload) {
  const chosen = chartView(key).breakdown;
  if (chosen === "wc" || chosen === "vc") return chosen;
  return payload?.breakdown_mode === "vc" ? "vc" : "wc";
}

// The every-season chart's own schedule, never the table's: full season until
// a reader picks the regular season or the postseason.
export const HISTORY_SCHEDULES = Object.freeze([
  ["All", "Full season"], ["Regular Season", "Regular season"], ["Postseason", "Postseason"],
]);

export function historySchedule() {
  const chosen = chartView("season-history").schedule;
  return HISTORY_SCHEDULES.some(([value]) => value === chosen) ? chosen : "All";
}

function withChartBreakdown(key, payload) {
  return { ...payload, breakdown_mode: chartBreakdown(key, payload) };
}

// The controls sit just above the chart, outside it, so the phone layout
// (which hides everything in the chart but its own drawing) keeps them.
function chartControls(container) {
  const holder = container.parentElement;
  let bar = holder?.querySelector(":scope > .chart-view-controls");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "chart-view-controls";
    holder?.insertBefore(bar, container);
  }
  bar.replaceChildren();
  return bar;
}

function segmentedControl({ label, options, value, onChange }) {
  const group = document.createElement("div");
  group.className = "chart-view-segment";
  group.style.setProperty("--options", String(options.length));
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  const caption = document.createElement("span");
  caption.className = "chart-view-label";
  caption.textContent = label;
  group.append(caption);
  for (const [optionValue, optionLabel] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = optionLabel;
    button.setAttribute("aria-pressed", String(optionValue === value));
    button.addEventListener("click", () => {
      if (optionValue !== value) onChange(optionValue);
    });
    group.append(button);
  }
  return group;
}

function breakdownControl(key, payload) {
  return segmentedControl({
    label: "Measure",
    options: [["wc", "Wins Contributed"], ["vc", "Value Contributed"]],
    value: chartBreakdown(key, payload),
    onChange: (breakdown) => setChartView(key, { breakdown }),
  });
}

function switchControl({ label, checked, onChange }) {
  const wrap = document.createElement("label");
  wrap.className = "chart-view-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const track = document.createElement("span");
  track.className = "chart-view-switch-track";
  track.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  wrap.append(input, track, text);
  return wrap;
}

function renderValueMap(tablePayload) {
  const payload = withChartBreakdown("value-map", tablePayload);
  const valueMapControls = chartControls(document.querySelector("#rankings-value-map-chart"));
  valueMapControls.append(breakdownControl("value-map", payload));
  if (chartSchedule.load) valueMapControls.append(scheduleControl("value-map"));
  const fields = metricFields(payload);
  const rows = (payload.rows ?? []).filter((row) => playerMinutes(row) > 0)
    .map((row) => ({ ...row, _offenseRaw: finite(row[fields.offense]), _defenseRaw: finite(row[fields.defense]) }));
  const visible = scopedRows(rows);
  // The dashed lines mark the middle player on each end, so the four corners
  // read as offense-first, defense-first, both and neither.
  const middle = { x: middleValue(visible.map((row) => row._offenseRaw)), y: middleValue(visible.map((row) => row._defenseRaw)) };
  faceScatter(document.querySelector("#rankings-value-map-chart"), visible, {
    xValue: (row) => row._offenseRaw, yValue: (row) => row._defenseRaw,
    radiusValue: (row) => playerMinutes(row),
    xDomain: paddedDomain(visible.map((row) => row._offenseRaw), { includeZero: true }),
    yDomain: paddedDomain(visible.map((row) => row._defenseRaw), { includeZero: true }),
    reference: middle.x === null ? null : middle,
    regions: [
      { corner: "top-right", text: "Above the middle on both ends" },
      { corner: "top-left", text: "Defense-first" },
      { corner: "bottom-right", text: "Offense-first" },
      { corner: "bottom-left", text: "Below the middle on both ends" },
    ],
    lineNote: "The dashed lines mark the middle player on offense and on defense.",
    xLabel: `Raw offensive ${fields.short}`, yLabel: `Raw defensive ${fields.short}`, payload,
    ariaLabel: `Raw offensive and defensive ${fields.label}`,
    searchId: "rankings-value-map-search",
    detail: (row) => `${number(row._offenseRaw, 3)} raw offensive ${fields.short} · ${number(row._defenseRaw, 3)} raw defensive ${fields.short} · ${number(per36(row, fields.total), 3)} ${fields.short}/36 · ${number(playerMinutes(row), 0)} minutes`,
    drawnNote: drawnCountNote(visible.length, rows.length),
    // A budgeted chart draws its faces in the order the page put the rows
    // in, which is the order the sentence above the chart already names.
    faceBudget: chartFaces.budget,
    faceRank: (_row, index) => -index,
  });
  if (document.querySelector("[data-mobile-charts]")) {
    renderMobileScatter(document.querySelector("#rankings-value-map-chart"), mobileChartRows(visible), {
      unit: fields.short, hrefFor: (row) => playerHref(row, payload),
    });
    mobileChartScopeNote(document.querySelector("#rankings-value-map-chart"), visible.length);
  }
  const valueMapTable = document.querySelector("#rankings-value-map-table");
  if (valueMapTable) valueMapTable.innerHTML = `<details><summary>View value map as a table</summary><table><thead><tr><th>Player</th><th>Raw offense</th><th>Raw defense</th><th>${fields.short}</th></tr></thead><tbody>${[...visible].sort((left, right) => finite(right[fields.total]) - finite(left[fields.total])).map((row) => `<tr><th><a href="${playerHref(row, payload)}">${escapeHtml(row.player_name)}</a></th><td>${number(row._offenseRaw, 3)}</td><td>${number(row._defenseRaw, 3)}</td><td>${number(row[fields.total])}</td></tr>`).join("")}</tbody></table></details>`;
}

function oneDimensionalProjection(rows, labels, accessor) {
  const means = labels.map((_, feature) => rows.reduce((sum, row) => sum + accessor(row, feature), 0) / Math.max(1, rows.length));
  const deviations = labels.map((_, feature) => Math.sqrt(rows.reduce((sum, row) => sum + (accessor(row, feature) - means[feature]) ** 2, 0) / Math.max(1, rows.length)));
  const active = deviations.map((value, index) => value > 1e-12 ? index : null).filter((value) => value !== null);
  if (!active.length || rows.length < 2) return { scores: rows.map(() => 0), label: "no varying features" };
  const standardized = rows.map((row) => active.map((feature) => (accessor(row, feature) - means[feature]) / deviations[feature]));
  const covariance = active.map((_, left) => active.map((__, right) => standardized.reduce((sum, row) => sum + row[left] * row[right], 0) / standardized.length));
  const component = principalComponent(covariance);
  const strongest = component.vector.map((value, index) => ({ value, label: labels[active[index]] }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value)).slice(0, 3)
    .map((item) => `${item.value < 0 ? "−" : "+"}${item.label}`).join(" · ");
  return { scores: standardized.map((row) => dot(row, component.vector)), label: strongest };
}

function sourceLabel(key) {
  return ({
    scorer: "scoring", assister: "made-shot creation", ft_assister: "FT creation",
    screen_assister: "screen creation", terminal_fg_miss_2pt: "2PT miss cost",
    terminal_fg_miss_3pt: "3PT miss cost", turnover: "turnover cost", oreb_pool: "OREB extension",
    DFG_make: "makes allowed", DFG_miss: "forced misses", block: "blocks",
    pressure_defense: "pressure", defensive_rebound: "defensive rebounds", steal: "steals",
    ordinary_foul_penalty: "foul cost", general_offense: "general O context",
    general_defense: "general D context", teammate_offense: "teammate O context",
    teammate_defense: "teammate D context", opponent_offense: "opponent O context",
    opponent_defense: "opponent D context",
  })[key] ?? String(key).replaceAll("_", " ");
}

function similarityProjection(payload) {
  const rows = (payload.rows ?? []).filter((row) => playerMinutes(row) > 0
    && row.raw_component_totals && Object.keys(row.raw_component_totals).length);
  const rate = (row, key, context = false) => {
    const minutes = playerMinutes(row);
    const value = context ? row.similarity_context?.[key] : row.raw_component_totals?.[key];
    return minutes > 0 ? finite(value) * 36 / minutes : 0;
  };
  const offense = oneDimensionalProjection(rows, OFFENSE_TYPE_SOURCES.map(sourceLabel), (row, feature) => rate(row, OFFENSE_TYPE_SOURCES[feature]));
  const defense = oneDimensionalProjection(rows, DEFENSE_TYPE_SOURCES.map(sourceLabel), (row, feature) => rate(row, DEFENSE_TYPE_SOURCES[feature]));
  const context = oneDimensionalProjection(rows, CONTEXT_TYPE_SOURCES.map(sourceLabel), (row, feature) => rate(row, CONTEXT_TYPE_SOURCES[feature], true));
  return {
    rows: rows.map((row, index) => ({ ...row, _similarityX: offense.scores[index], _similarityY: defense.scores[index], _similarityContext: context.scores[index] })),
    labels: ["Detailed offensive-source pattern", "Detailed defensive-source pattern", "Six-effect context pattern"],
  };
}

function multiAxisColor(value, domain) {
  const span = Math.max(1e-12, domain[1] - domain[0]);
  const normalized = Math.max(0, Math.min(1, (finite(value) - domain[0]) / span));
  return COLORS[Math.min(COLORS.length - 1, Math.floor(normalized * COLORS.length))];
}

const V9_SIMILARITY_HEADING = "Offense, defense, and context shape";
const V9_SIMILARITY_NOTE = "The horizontal and vertical coordinates summarize detailed offensive and defensive source patterns; color summarizes context influence. Nearby faces have more similar profiles. Bubble size shows the selected contribution metric, not similarity quality.";

// The panel's own heading and standing note describe whichever statistic drew
// it, so a V11 chart never carries V9's word "context".
function setSimilarityCopy({ heading, note, label = null, lede = null }) {
  const title = document.querySelector("#rankings-similarity-landscape-title");
  if (title) title.textContent = heading;
  const eyebrow = document.querySelector("#rankings-similarity-label");
  if (eyebrow && label) eyebrow.textContent = label;
  const summary = document.querySelector("#rankings-similarity-lede");
  if (summary && lede) summary.textContent = lede;
  const standing = document.querySelector("#rankings-similarity-note");
  if (standing) {
    standing.textContent = note;
    standing.hidden = !note;
  }
}

// The season room has no table under this chart; the rankings page's did.
function setSimilarityTable(html) {
  const table = document.querySelector("#rankings-similarity-table");
  if (table) table.innerHTML = html;
}

function renderSimilarityLandscape(payload) {
  styleSide.payload = payload;
  const similarityChart = document.querySelector("#rankings-similarity-chart");
  if (similarityChart) chartControls(similarityChart);
  const style = playerStyleLandscape(payload);
  // V11 describes a player season and names its type, so this panel answers a
  // question the old shape-against-shape map could not: who is at the front of
  // each type. V9 and V10 publish no types and keep their own chart.
  if (style?.catalog) {
    renderTypeLeaders(payload, style);
    ensureSideToggle(payload);
    return;
  }
  if (style) {
    setSimilarityCopy({
      heading: "Who leads each player type", note: "",
      label: "WHO LEADS EACH PLAYER TYPE",
      lede: "One lane per type, every player on it, and the names at the front of each lane.",
    });
    styleModelMissingNote(
      payload, "rankings-similarity-chart", "rankings-similarity-table",
      "rankings-similarity-axes",
      "This chart needs the style model this deployment has not built.",
    );
    return;
  }
  if (String(payload?.stat_version ?? "") === "v11") {
    // The lanes need the published descriptions; until they arrive this panel
    // says it is waiting rather than claiming V11 publishes nothing.
    document.querySelector("#rankings-similarity-chart").innerHTML = `<p class="rankings-chart-empty">${escapeHtml(describedSeasonsWait(payload))}</p>`;
    setSimilarityTable("");
    document.querySelector("#rankings-similarity-axes").textContent = "The lanes appear once this selection's player descriptions are loaded.";
    return;
  }
  setSimilarityCopy({
    heading: V9_SIMILARITY_HEADING, note: V9_SIMILARITY_NOTE,
    label: "PLAYER SIMILARITY LANDSCAPE",
    lede: "The same players placed by their offensive and defensive source patterns.",
  });
  const fields = metricFields(payload);
  const projection = similarityProjection(payload);
  const rows = scopedRows(projection.rows);
  const status = document.querySelector("#rankings-similarity-axes");
  if (!rows.length) {
    // The landscape needs the per-source and per-context vectors. A statistic
    // that publishes none (V11) says so rather than loading for ever; an empty
    // population is still on its way.
    const published = (payload.rows ?? []).length > 0;
    const unavailable = published && !projection.rows.length;
    const label = String(payload.stat_version ?? "").toUpperCase() || "this statistic";
    document.querySelector("#rankings-similarity-chart").innerHTML = unavailable
      ? `<p class="rankings-chart-empty">${escapeHtml(label)} publishes no per-source or context vectors, so the similarity landscape is not available for it.</p>`
      : '<p class="rankings-chart-empty">Loading governed source and context vectors…</p>';
    setSimilarityTable("");
    status.textContent = unavailable
      ? "This chart needs the detailed source and context breakdown the selected statistic does not publish."
      : "The chart appears after the complete selected-source population is loaded.";
    return;
  }
  const contextDomain = paddedDomain(rows.map((row) => row._similarityContext));
  faceScatter(document.querySelector("#rankings-similarity-chart"), rows, {
    xValue: (row) => row._similarityX, yValue: (row) => row._similarityY,
    radiusValue: (row) => Math.abs(finite(row[fields.total])), colorValue: (row) => multiAxisColor(row._similarityContext, contextDomain),
    xLabel: "Detailed offensive-source pattern", yLabel: "Detailed defensive-source pattern", payload,
    ariaLabel: "Player similarity landscape from governed offense, defense, and context features",
    searchId: "rankings-similarity-search",
    colorLegend: {
      label: "Six-effect context profile score", domain: contextDomain, format: (value) => number(value, 2),
      note: "Color separates context profiles; neither end is inherently better.",
    },
    detail: (row) => `${number(row[fields.total])} ${fields.short} · offense ${number(row._similarityX, 2)} · defense ${number(row._similarityY, 2)} · context ${number(row._similarityContext, 2)}`,
    drawnNote: drawnCountNote(rows.length, projection.rows.length),
  });
  status.textContent = "Horizontal position combines all 15 governed offensive sources; vertical position combines all 11 defensive sources. The multicolor scale encodes a third axis built from all six context effects. No single source names or defines an axis.";
  setSimilarityTable(`<details><summary>View similarity coordinates as a table</summary><table><thead><tr><th>Player</th><th>Offense</th><th>Defense</th><th>Context</th><th>${fields.short}</th></tr></thead><tbody>${rows.map((row) => `<tr><th><a href="${playerHref(row, payload)}">${escapeHtml(row.player_name)}</a></th><td>${number(row._similarityX, 3)}</td><td>${number(row._similarityY, 3)}</td><td>${number(row._similarityContext, 3)}</td><td>${number(row[fields.total])}</td></tr>`).join("")}</tbody></table></details>`);
}

function normalizeVector(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

function multiply(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function principalComponent(matrix, seedOffset = 0) {
  let vector = normalizeVector(matrix.map((_, index) => 1 / (index + 1 + seedOffset)));
  for (let iteration = 0; iteration < 80; iteration += 1) vector = normalizeVector(multiply(matrix, vector));
  const eigenvalue = dot(vector, multiply(matrix, vector));
  const anchor = vector.reduce((best, value, index) => Math.abs(value) > Math.abs(vector[best]) ? index : best, 0);
  if (vector[anchor] < 0) vector = vector.map((value) => -value);
  return { vector, eigenvalue };
}

function playerTypeProjection(rows, fields, side) {
  const hasDetailedSources = rows.some((row) => Object.keys(row.raw_component_totals ?? {}).length);
  const rateRows = rows.filter((row) => playerMinutes(row) > 0);
  if (!hasDetailedSources) return {
    rows: rateRows.map((row) => ({ ...row, _typeX: per36(row, side === "defense" ? fields.defense : fields.offense), _typeY: 0, _typeColor: 0, _typeSize: Math.abs(finite(row[fields.total])) })),
    labels: side === "defense"
      ? [`Defensive ${fields.short} / 36`, "Disruption value / 36", "Possession-finishing value / 36"]
      : [`Offensive ${fields.short} / 36`, "Playmaking value / 36", "Screens + OREB value / 36"],
  };
  const rate = (row, key) => finite(row.raw_component_totals?.[key]) * 36 / playerMinutes(row);
  const keys = side === "defense" ? SHOT_DEFENSE_TYPE_SOURCES : SCORING_TYPE_SOURCES;
  const horizontal = oneDimensionalProjection(rateRows, keys.map(sourceLabel), (row, feature) => rate(row, keys[feature]));
  const yKeys = side === "defense" ? DISRUPTION_TYPE_SOURCES : PLAYMAKING_TYPE_SOURCES;
  const colorKeys = side === "defense" ? POSSESSION_FINISH_TYPE_SOURCES : OFF_BALL_TYPE_SOURCES;
  const sizeKeys = side === "defense" ? DEFENSE_TYPE_SOURCES : SCORING_TYPE_SOURCES;
  return {
    rows: rateRows.map((row, index) => ({
      ...row,
      _typeX: horizontal.scores[index],
      _typeY: yKeys.reduce((sum, key) => sum + rate(row, key), 0),
      _typeColor: colorKeys.reduce((sum, key) => sum + rate(row, key), 0),
      _typeSize: sizeKeys.reduce((sum, key) => sum + Math.abs(finite(row.raw_component_totals?.[key])), 0),
    })),
    labels: side === "defense"
      ? ["Detailed shot-defense pattern", "Disruption value / 36", "Rebound + boxout value / 36"]
      : ["Detailed scoring-source pattern", "Playmaking value / 36", "Screens + OREB extension value / 36"],
  };
}

// --- V11 player and team styles ------------------------------------------------
//
// V11 describes a player-season with 36 measurements and names the region of
// that description it falls in. The two landscape charts read those published
// fields; nothing here re-derives a projection of its own.

// Okabe-Ito, chosen because the seven colours stay apart for the three common
// kinds of colour blindness. Every mark also carries its type's two-letter
// badge, so the chart never leans on colour alone.
const STYLE_COLORS = Object.freeze({
  screen_and_roll_big: "#0072b2",
  primary_creator: "#d55e00",
  two_way_big: "#009e73",
  floor_spacer: "#cc79a7",
  rotation_big: "#b07500",
  defensive_role_player: "#3b8bbd",
  perimeter_guard: "#4a4a4a",
  balanced_depth: "#0072b2",
  rim_pressure: "#d55e00",
  three_point_heavy: "#009e73",
  big_led: "#cc79a7",
  star_driven: "#b07500",
  // V13's fourteen groupings are not coloured here: V13's catalogue publishes
  // each grouping's colour, and styleCatalog reads it at draw time. Their
  // badges are below. An id neither table knows still takes a colour from
  // STYLE_FALLBACK_COLORS and a badge from its own first letters (styleVisual),
  // so a new statistic's types always draw.
  // V12's own types. Where a V12 type means what a V11 type meant it keeps the
  // V11 id, and with it the colour and badge above.
  lead_guard: "#d55e00",
  go_to_scorer: "#e69f00",
  pass_first_guard: "#4a4a4a",
  starting_wing: "#3b8bbd",
  ball_movement: "#009e73",
  defense_first: "#3b8bbd",
  // V12 offensive roles (two-axis model). The twelve colours are distinct from
  // one another; the defensive roles below are distinct among themselves.
  scoring_guard: "#a6361c",
  scoring_big: "#009e73",
  frontcourt_starter: "#b07500",
  energy_big: "#56b4e9",
  playmaker: "#7a4fa3",
  low_usage_role_player: "#8c8c5a",
  slashing_wing: "#6b3e26",
  movement_shooter: "#2f7f6f",
  // V12 defensive roles.
  rim_protector: "#0072b2",
  shot_blocking_roamer: "#009e73",
  switching_big: "#b07500",
  light_rim_big: "#56b4e9",
  drop_big: "#6b8e23",
  low_impact: "#7f7f7f",
  charge_pest: "#cc79a7",
  defensive_rebounder: "#4a4a4a",
  ball_hawk: "#d55e00",
  positional: "#e69f00",
  // V12 team styles (eight), named from the two lineup mixes.
  style_frontcourt_starter__light_rim_big: "#56b4e9",
  style_pass_first_guard__switching_big: "#e69f00",
  style_go_to_scorer__rim_protector: "#0072b2",
  style_playmaker__shot_blocking_roamer: "#009e73",
  style_screen_and_roll_big__ball_hawk: "#d55e00",
  style_screen_and_roll_big__positional: "#cc79a7",
  style_low_usage_role_player__charge_pest: "#4a4a4a",
  style_scoring_big__positional: "#b07500",
});
const STYLE_FALLBACK_COLORS = Object.freeze([
  "#0072b2", "#d55e00", "#009e73", "#cc79a7", "#b07500", "#3b8bbd", "#4a4a4a",
]);
const STYLE_BADGES = Object.freeze({
  screen_and_roll_big: "SR",
  primary_creator: "PC",
  two_way_big: "TB",
  floor_spacer: "FS",
  // "Frontcourt role player": the label moved, so the badge moved with it.
  rotation_big: "FR",
  defensive_role_player: "DR",
  perimeter_guard: "PG",
  balanced_depth: "BD",
  rim_pressure: "RP",
  three_point_heavy: "3P",
  big_led: "BL",
  star_driven: "SD",
  lead_guard: "LG",
  go_to_scorer: "GS",
  pass_first_guard: "PF",
  starting_wing: "SW",
  ball_movement: "BM",
  defense_first: "DF",
  scoring_guard: "PS",
  scoring_big: "SB",
  frontcourt_starter: "FC",
  energy_big: "EB",
  playmaker: "PM",
  low_usage_role_player: "LU",
  slashing_wing: "SL",
  movement_shooter: "MS",
  rim_protector: "RI",
  shot_blocking_roamer: "RO",
  switching_big: "SX",
  light_rim_big: "RB",
  drop_big: "DP",
  low_impact: "LI",
  charge_pest: "CP",
  defensive_rebounder: "DB",
  ball_hawk: "BH",
  positional: "PD",
  style_frontcourt_starter__light_rim_big: "FR",
  style_pass_first_guard__switching_big: "PX",
  style_go_to_scorer__rim_protector: "GR",
  style_playmaker__shot_blocking_roamer: "PB",
  style_screen_and_roll_big__ball_hawk: "RH",
  style_screen_and_roll_big__positional: "RD",
  style_low_usage_role_player__charge_pest: "RC",
  style_scoring_big__positional: "BG",
  // V13's groupings (its player type is the looser grouping of the four area
  // labels). Their colours come from V13's own catalogue.
  lead_creator: "LC",
  volume_scoring_star: "VS",
  box_out_anchor_big: "BA",
  off_the_dribble_guard: "OD",
  point_of_attack_lead_guard: "PA",
  spot_up_role_wing: "SU",
  disruptor_wing: "DW",
  crashing_rim_runner: "CR",
  rebounding_role_forward: "RF",
  interior_scoring_forward: "IF",
  scoring_hub_big: "SH",
  rim_running_anchor: "RA",
  disruptive_spot_up_wing: "DS",
  stopper_wing: "ST",
});
const UNTYPED = Object.freeze({ id: "__untyped__", label: "Not described", color: "#8b8b8b", badge: "—" });

// The frozen published half-distance of the player style model: the distance at
// which two descriptions score 50. It is part of the model, not of a payload,
// and the live rankings envelope does not carry it, so it is pinned here
// against `docs/v11-player-types-2026-09-20.md` and proved against real server
// answers by tests/test_v11_types_frontend.py. A payload that publishes the
// number itself always wins.
export const V11_PLAYER_STYLE_MODEL = "v11-styles-ft-net-2026-09-20";
export const V11_PLAYER_SIMILARITY_HALF_DISTANCE = 0.8262042246747208;

export function styleHalfDistance(block) {
  const published = Number(block?.similarity?.half_distance ?? block?.similarity_half_distance);
  if (Number.isFinite(published) && published > 0) return published;
  return String(block?.model_version ?? "") === V11_PLAYER_STYLE_MODEL
    ? V11_PLAYER_SIMILARITY_HALF_DISTANCE : null;
}

export function styleVisual(typeId, index = 0) {
  const id = String(typeId ?? "");
  const derived = id.replace(/[^a-z0-9]/giu, "").slice(0, 2).toUpperCase();
  return {
    color: STYLE_COLORS[id] ?? STYLE_FALLBACK_COLORS[index % STYLE_FALLBACK_COLORS.length],
    badge: STYLE_BADGES[id] ?? (derived || "—"),
  };
}

// A colour a catalogue publishes, if it is one a page can draw with safely.
function publishedColour(value) {
  const colour = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/iu.test(colour) ? colour : null;
}

// One catalogue for both kinds: the types with their plain descriptions, the
// measurement labels, and the plain sentences that name each axis.
export function styleCatalog(block) {
  if (!block || !Array.isArray(block.types) || !block.types.length) return null;
  const types = block.types.map((type, index) => {
    const visual = styleVisual(type.id, index);
    // V13 publishes a colour for each of its groupings; that colour wins, so
    // the type map, the area maps and the grouping cards all agree.
    const published = block.v13 ? publishedColour(type.color) : null;
    return {
      ...type,
      id: String(type.id),
      label: String(type.label ?? type.id),
      description: String(type.description ?? ""),
      ...visual,
      color: published ?? visual.color,
    };
  });
  return {
    modelVersion: String(block.model_version ?? ""),
    minimumMinutes: finite(block.minimum_minutes, 0),
    halfDistance: styleHalfDistance(block),
    similarityRule: String(block.similarity?.rule ?? ""),
    types,
    typeById: new Map(types.map((type) => [type.id, type])),
    featureById: new Map((block.features ?? []).map((feature) => [String(feature.key), feature])),
    axes: block.axes ?? {},
  };
}

export function confidenceWords(confidence) {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return "fit not measured";
  if (value >= 0.25) return "a clear fit";
  if (value >= 0.12) return "a good fit";
  if (value >= 0.04) return "leans this way";
  return "between types";
}

function featureLabel(catalog, key) {
  return String(catalog?.featureById.get(String(key))?.label ?? String(key).replaceAll("_", " "));
}

// The measurements that put this player furthest from the league that season.
export function definingFeatures(description, catalog, count = 4) {
  return Object.entries(description ?? {})
    .map(([key, value]) => ({ key, z: Number(value?.z), per36: Number(value?.per36) }))
    .filter((item) => Number.isFinite(item.z))
    .sort((left, right) => Math.abs(right.z) - Math.abs(left.z) || left.key.localeCompare(right.key))
    .slice(0, count)
    .map((item) => ({
      ...item,
      label: featureLabel(catalog, item.key),
      direction: item.z >= 0 ? "above" : "below",
      words: `${featureLabel(catalog, item.key).toLocaleLowerCase()} ${Math.abs(item.z) >= 1.5 ? "far " : ""}${item.z >= 0 ? "above" : "below"}`,
    }));
}

// Where the shots came from: the published shot-diet shares, largest first.
export function shotFamilyShares(description, catalog, count = 2) {
  return Object.entries(description ?? {})
    .filter(([key]) => key.startsWith("shot_share_"))
    .map(([key, value]) => ({ key, share: Number(value?.per36) }))
    .filter((item) => Number.isFinite(item.share) && item.share > 0)
    .sort((left, right) => right.share - left.share || left.key.localeCompare(right.key))
    .slice(0, count)
    .map((item) => ({
      ...item,
      label: featureLabel(catalog, item.key).replace(/ — share of shots$/u, ""),
    }));
}

// The root mean square difference over the measurements both descriptions
// actually have — V11's own masked distance, so an early season that never
// recorded deflections is never compared on them.
export function maskedDistance(left, right) {
  let total = 0;
  let shared = 0;
  for (const [key, value] of Object.entries(left ?? {})) {
    const other = right?.[key];
    const a = Number(value?.z);
    const b = Number(other?.z);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    total += (a - b) ** 2;
    shared += 1;
  }
  return shared ? Math.sqrt(total / shared) : null;
}

export function similarityScore(distance, halfDistance) {
  if (!Number.isFinite(distance) || !Number.isFinite(halfDistance) || halfDistance <= 0) return null;
  return 100 * Math.exp(-Math.LN2 * (distance / halfDistance) ** 2);
}

// The nearest descriptions to one row, in the same order and with the same
// scores the server publishes for that scope.
export function nearestDescriptions(rows, target, { limit = 10, halfDistance = null } = {}) {
  const key = (row) => `${row.player_id ?? row.team_id}:${row.season_end_year}`;
  const targetKey = key(target);
  return (rows ?? [])
    .filter((row) => key(row) !== targetKey)
    .map((row) => ({ row, distance: maskedDistance(target.description, row.description) }))
    .filter((item) => Number.isFinite(item.distance))
    .sort((left, right) => left.distance - right.distance
      || String(left.row.player_name ?? left.row.team_abbreviation)
        .localeCompare(String(right.row.player_name ?? right.row.team_abbreviation)))
    .slice(0, limit)
    .map((item) => ({ ...item, similarity: similarityScore(item.distance, halfDistance) }));
}

// What the legend shows: every type, whether it is switched on, and how many of
// the drawn rows belong to it.
export function styleLegendModel(rows, catalog, hidden = new Set()) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const id = String(row.style?.id ?? row.player_type?.id ?? row.team_type?.id ?? UNTYPED.id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const entries = (catalog?.types ?? []).map((type) => ({
    id: type.id,
    label: type.label,
    description: type.description,
    color: type.color,
    badge: type.badge,
    count: counts.get(type.id) ?? 0,
    visible: !hidden.has(type.id),
  }));
  if (counts.has(UNTYPED.id)) {
    entries.push({
      ...UNTYPED,
      description: "Below the minutes the model is fitted on, or not described in this season.",
      count: counts.get(UNTYPED.id),
      visible: !hidden.has(UNTYPED.id),
    });
  }
  return entries;
}

function styleOf(row, catalog) {
  const block = row.player_type ?? row.team_type ?? null;
  const type = block ? catalog?.typeById.get(String(block.id)) : null;
  if (!type) return { ...UNTYPED, confidence: null, provisional: Boolean(block?.provisional) };
  return {
    ...type,
    confidence: Number(block.confidence),
    provisional: Boolean(block.provisional),
  };
}

// Rows the landscape endpoints publish, with the fields the charts read added.
export function styleRows(landscape, catalog, { kind = "player" } = {}) {
  return (landscape?.rows ?? []).map((row) => {
    const minutes = kind === "team"
      ? finite(row.minutes)
      : finite(row.minutes_played, finite(row.seconds_played) / 60);
    return {
      ...row,
      style: styleOf(row, catalog),
      minutes,
      entity_id: kind === "team" ? Number(row.team_id) : Number(row.player_id),
      display_name: kind === "team"
        ? `${row.team_abbreviation ?? "—"} ${row.season ?? ""}`.trim()
        : String(row.player_name ?? "Unknown player"),
      search_name: kind === "team"
        ? `${row.team_abbreviation ?? ""} ${row.team_name ?? ""}`.trim()
        : String(row.player_name ?? ""),
    };
  });
}

function axisCaption(catalog, key, fallback) {
  const axis = catalog?.axes?.[key];
  if (!axis) return fallback;
  return String(axis.label ?? fallback);
}

function axisSentence(catalog, key) {
  const axis = catalog?.axes?.[key];
  if (!axis) return "";
  const high = String(axis.high ?? "").trim();
  return high ? `To the ${key === "type_y" || key === "defense_shape" ? "top" : "right"}: ${high}.` : "";
}

function teamsOf(row) {
  const list = row.team_abbreviations ?? (row.team_abbreviation ? [row.team_abbreviation] : []);
  return list.filter(Boolean).join(", ") || "—";
}

// --- on-court context on the style charts --------------------------------------
//
// A landscape row may publish `similarity_context`: the season total of each of
// the six on-court context factors, in Value Contributed. They are a small
// re-attribution between teammates — a few tenths over a season — so they are an
// optional colour on the similarity map and a line on the hover card, never an
// axis and never the default.

const CONTEXT_FACTOR_LABELS = Object.freeze({
  general_offense: "own lineups on offense",
  general_defense: "own lineups on defense",
  teammate_offense: "teammates on offense",
  teammate_defense: "teammates on defense",
  opponent_offense: "offenses faced",
  opponent_defense: "defenses faced",
});

// Brewer BrBG, which stays readable for the three common kinds of colour
// blindness. Brown is value lost to context, teal is value gained.
const CONTEXT_LIFT_COLORS = Object.freeze([
  "#8c510a", "#bf812d", "#dfc27d", "#c7c7c7", "#80cdc1", "#35978f", "#01665e",
]);

export function contextFactorEntries(row) {
  return Object.entries(row?.similarity_context ?? {})
    .filter(([key, value]) => key in CONTEXT_FACTOR_LABELS && Number.isFinite(Number(value)))
    .map(([key, value]) => ({ key, label: CONTEXT_FACTOR_LABELS[key], value: Number(value) }));
}

// The whole of a row's context, or null when the row publishes none. A row with
// a partial map is still summed: every factor it does publish is a real amount.
export function contextTotal(row) {
  const entries = contextFactorEntries(row);
  if (!entries.length) return null;
  return entries.reduce((total, entry) => total + entry.value, 0);
}

export function largestContextFactor(row) {
  const entries = contextFactorEntries(row);
  if (!entries.length) return null;
  return entries.reduce((best, entry) => Math.abs(entry.value) > Math.abs(best.value) ? entry : best);
}

// One sentence: how much this season gained or lost from context in total, and
// which of the six moved it most.
export function contextSummarySentence(row) {
  const total = contextTotal(row);
  if (total === null) return null;
  const largest = largestContextFactor(row);
  const totalWords = `Context ${total >= 0 ? "+" : "−"}${number(Math.abs(total), 3)}`;
  return largest
    ? `${totalWords} in total, most of it ${largest.label} (${largest.value >= 0 ? "+" : "−"}${number(Math.abs(largest.value), 3)})`
    : `${totalWords} in total`;
}

// A symmetric scale around zero, so the same distance either side of nothing
// gets the same strength of colour.
export function contextLiftScale(values) {
  const finiteValues = (values ?? []).filter((value) => Number.isFinite(Number(value))).map(Number);
  const extent = Math.max(1e-9, ...finiteValues.map((value) => Math.abs(value)));
  return {
    extent,
    color(value) {
      if (!Number.isFinite(Number(value))) return CONTEXT_LIFT_COLORS[3];
      const normalized = Math.max(-1, Math.min(1, Number(value) / extent));
      const index = Math.round((normalized + 1) / 2 * (CONTEXT_LIFT_COLORS.length - 1));
      return CONTEXT_LIFT_COLORS[index];
    },
  };
}

// One hover and focus card: who this is, what type, how clearly, what makes
// them different from the league that season, where the shots came from, and
// what on-court context did to the season when the row publishes it.
function styleHoverHtml(row, catalog) {
  const style = row.style;
  const heading = row.season && !String(row.display_name).includes(row.season)
    ? `${row.display_name} · ${teamsOf(row)} · ${row.season}`
    : `${row.display_name} · ${teamsOf(row)}`;
  const defining = definingFeatures(row.description, catalog, 4);
  const shots = shotFamilyShares(row.description, catalog, 2);
  const parts = [];
  parts.push(style.id === UNTYPED.id
    ? "No published style for this season"
    : `${style.label} — ${confidenceWords(style.confidence)}`);
  if (style.provisional) parts.push("thin record, so the shape is pulled toward the average player");
  if (defining.length) {
    parts.push(`Compared with the league that season: ${defining.map((item) => item.words).join(", ")}`);
  }
  if (shots.length) {
    parts.push(`Most of the field goals: ${shots.map((item) => `${item.label.toLocaleLowerCase()} ${Math.round(item.share * 100)}%`).join(", ")}`);
  }
  // Free throws are their own measurement rather than a kind of shot, and the
  // number is the net of the trips that beat what was expected and the ones
  // that fell short, so the card says so instead of leaving it to the shares.
  const freeThrows = Number(row.description?.free_throw_value?.per36);
  if (Number.isFinite(freeThrows) && Math.abs(freeThrows) >= 0.05) {
    parts.push(`Free throws ${freeThrows >= 0 ? "+" : "−"}${number(Math.abs(freeThrows), 2)} per 36, net`);
  }
  parts.push(`${number(row.minutes, 0)} minutes`);
  const context = contextSummarySentence(row);
  if (context) parts.push(context);
  return `<strong>${escapeHtml(heading)}</strong><span>${escapeHtml(parts.join(" · "))}</span>`;
}

function appendStyleMark(chart, row, {
  x, y, radius, href, kind, catalog, emphasis = "normal", faceColor = null,
}) {
  const style = row.style;
  // The face can carry a second reading (context gained or lost); the badge
  // always keeps the type's own colour, so colour is never the only signal.
  const markColor = faceColor ?? style.color;
  const positioned = svg("g", { transform: `translate(${x} ${y})`, class: "player-mark-position" });
  // Every face is drawn at full strength, thin record or not: a lighter mark
  // read as a lesser player rather than as a smaller sample. The reading under
  // the chart still says "thin record" in words.
  const classes = ["player-face-mark", "style-mark"];
  if (emphasis === "selected") classes.push("is-selected-style");
  if (emphasis === "match") classes.push("is-match-style");
  const label = `${row.display_name}. ${style.id === UNTYPED.id ? "No published style" : style.label}.`;
  const link = svg("a", {
    href, class: classes.join(" "), tabindex: 0,
    "data-player-mark": String(row.entity_id),
    "data-player-name": row.search_name,
    "data-style-id": style.id,
    "data-hover-html": styleHoverHtml(row, catalog),
    "aria-label": `${label} Open the profile.`,
  });
  link.style.setProperty("--player-mark-color", markColor);
  link.append(svg("circle", { cx: 0, cy: 0, r: radius, class: "player-face-back", fill: markColor }));
  if (kind === "team") {
    link.append(svg("text", { x: 0, y: 4, "text-anchor": "middle", class: "player-face-initials" },
      String(row.team_abbreviation ?? "—")));
  } else {
    const clipId = `style-face-${String(row.entity_id).replace(/\D/gu, "")}-${row.season_end_year ?? 0}`;
    let defs = chart.querySelector("defs");
    if (!defs) { defs = svg("defs"); chart.prepend(defs); }
    const clip = svg("clipPath", { id: clipId });
    clip.append(svg("circle", { cx: 0, cy: 0, r: Math.max(1, radius - 2) }));
    defs.append(clip);
    link.append(svg("text", { x: 0, y: 4, "text-anchor": "middle", class: "player-face-initials" }, initials(row.display_name)));
    link.append(svg("image", {
      href: headshotUrl(row.entity_id), x: -radius, y: -radius * .84,
      width: radius * 2, height: radius * 1.84,
      preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${clipId})`, class: "player-face-image",
    }));
  }
  link.append(svg("circle", { cx: 0, cy: 0, r: radius, class: "player-face-ring", stroke: markColor }));
  const badgeRadius = Math.max(6.5, radius * .46);
  const badge = svg("g", { transform: `translate(${radius * .74} ${radius * .74})`, class: "style-badge" });
  badge.append(svg("circle", { cx: 0, cy: 0, r: badgeRadius, fill: style.color }));
  badge.append(svg("text", { x: 0, y: badgeRadius * .36, "text-anchor": "middle" }, style.badge));
  link.append(badge);
  positioned.append(link);
  chart.append(positioned);
}

// A soft one-standard-deviation region per type, drawn under the marks. Style is
// a continuum, so these overlap on purpose.
function appendStyleRegions(chart, rows, catalog, { xScale, yScale }) {
  const labels = [];
  const grouped = new Map();
  for (const row of rows) {
    const id = row.style.id;
    if (id === UNTYPED.id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  for (const [id, group] of grouped) {
    if (group.length < 5) continue;
    const type = catalog.typeById.get(id);
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const spread = (values, centre) => Math.sqrt(mean(values.map((value) => (value - centre) ** 2)));
    const xs = group.map((row) => finite(row.x_value));
    const ys = group.map((row) => finite(row.y_value));
    const cx = mean(xs); const cy = mean(ys);
    const rx = Math.abs(xScale.map(cx + spread(xs, cx)) - xScale.map(cx));
    const ry = Math.abs(yScale.map(cy + spread(ys, cy)) - yScale.map(cy));
    if (!(rx > 4 && ry > 4)) continue;
    chart.append(svg("ellipse", {
      cx: xScale.map(cx), cy: yScale.map(cy), rx, ry,
      class: "style-region", fill: type.color, stroke: type.color,
    }));
    labels.push(svg("text", {
      x: xScale.map(cx), y: yScale.map(cy) - ry - 7, "text-anchor": "middle",
      class: "style-region-label", fill: type.color,
    }, type.label));
  }
  return labels;
}

// The colour and badge key stays readable while the list is closed: the summary
// carries a chip for every type — its badge in its own colour and its short
// label — and opening it adds the descriptions, the counts and the buttons.
function styleLegendChips(entries) {
  const chips = document.createElement("span");
  chips.className = "style-legend-chips";
  chips.innerHTML = entries.map((entry) => `<span class="style-chip${entry.visible ? "" : " is-off"}" style="--style-color:${escapeHtml(entry.color)}">${escapeHtml(entry.badge)} ${escapeHtml(entry.label)}</span>`).join("");
  return chips;
}

function styleLegendNode(entries, { onToggle, onOnly, onReset, kindLabel = "Player types" }) {
  const shell = document.createElement("details");
  shell.className = "style-legend-shell";
  shell.open = styleViewState.legendOpen;
  shell.addEventListener("toggle", () => { styleViewState.legendOpen = shell.open; });
  const summary = document.createElement("summary");
  summary.className = "style-legend-summary";
  const heading = document.createElement("span");
  heading.className = "style-legend-summary-heading";
  heading.textContent = `${kindLabel} · ${entries.length}`;
  const hint = document.createElement("span");
  hint.className = "style-legend-summary-hint";
  hint.textContent = "what each one means, how many are in view, show only one";
  summary.append(heading, styleLegendChips(entries), hint);
  const legend = document.createElement("div");
  legend.className = "style-legend";
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", `${kindLabel} on this chart`);
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = `style-legend-row${entry.visible ? "" : " is-off"}`;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "style-legend-toggle";
    toggle.setAttribute("aria-pressed", String(entry.visible));
    toggle.innerHTML = `<i class="style-legend-swatch" style="--style-color:${escapeHtml(entry.color)}" aria-hidden="true">${escapeHtml(entry.badge)}</i><span><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.description)}</small></span><em>${entry.count} in view</em>`;
    toggle.addEventListener("click", () => onToggle(entry.id));
    const only = document.createElement("button");
    only.type = "button";
    only.className = "style-legend-only";
    only.textContent = "Only";
    only.setAttribute("aria-label", `Show only ${entry.label}`);
    only.addEventListener("click", () => onOnly(entry.id));
    row.append(toggle, only);
    legend.append(row);
  }
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "style-legend-reset";
  reset.textContent = "Show every type";
  reset.addEventListener("click", onReset);
  legend.append(reset);
  shell.append(summary, legend);
  return shell;
}

// The one chart both landscapes and both entity pages draw.
export function renderStyleLandscape({
  container, rows, catalog, kind = "player", hrefFor,
  xKey = "type_x", yKey = "type_y", searchId = null,
  hidden = new Set(), onHiddenChange = null,
  selectedId = null, matchKeys = new Set(), regions = true,
  emptyNote = "No rows match this view.",
  faceColorFor = null, extraLegend = null,
}) {
  if (!container) return;
  const positioned = rows
    .map((row) => ({ ...row, x_value: Number(row[xKey]), y_value: Number(row[yKey]) }))
    .filter((row) => Number.isFinite(row.x_value) && Number.isFinite(row.y_value));
  const drawn = positioned.filter((row) => !hidden.has(row.style.id));
  // The legend is built from every placed row, not only the drawn ones, so a
  // type that is switched off can be switched back on.
  const buildLegend = () => onHiddenChange ? styleLegendNode(
    styleLegendModel(positioned, catalog, hidden), {
      onToggle: (id) => onHiddenChange(toggledSet(hidden, id)),
      onOnly: (id) => onHiddenChange(isolatedSet(positioned, catalog, id)),
      onReset: () => onHiddenChange(new Set()),
      kindLabel: kind === "team" ? "Team styles" : "Player types",
    },
  ) : null;
  if (!drawn.length) {
    const note = document.createElement("p");
    note.className = "rankings-chart-empty";
    note.textContent = positioned.length ? "Every type is switched off. Switch one back on to see the map." : emptyNote;
    const legend = buildLegend();
    container.replaceChildren(note, ...(legend ? [legend] : []));
    return;
  }
  const { width, height } = measuredChartSize(container);
  const margin = { top: 30, right: 32, bottom: 74, left: width < 520 ? 62 : 78 };
  const xScale = linearScale(paddedDomain(drawn.map((row) => row.x_value)), margin.left, width - margin.right);
  const yScale = linearScale(paddedDomain(drawn.map((row) => row.y_value)), height - margin.bottom, margin.top);
  const largestMinutes = Math.max(1e-12, ...drawn.map((row) => Math.max(0, row.minutes)));
  const status = document.createElement("div");
  status.className = "rankings-chart-hover";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  // Every chart in this section reads the same way: pointing at, tapping or
  // tabbing to a mark selects it, and the one-line reading under the chart is
  // where its details are written.
  const defaultStatus = `<strong>Pick a ${kind === "team" ? "team season" : "player"} on the map</strong><span>Point at a face, tap it, or move the keyboard focus to it, and its type, what sets it apart and where the shots came from appear here.</span>`;
  status.innerHTML = defaultStatus;
  const chart = svg("svg", {
    viewBox: `0 0 ${width} ${height}`, role: "img",
    "aria-label": `${kind === "team" ? "Team style" : "Player type"} map of ${drawn.length} ${kind === "team" ? "team seasons" : "player seasons"}`,
  });
  appendAxes(chart, {
    width, height, margin, xScale, yScale,
    xLabel: axisCaption(catalog, xKey, "Style, side to side"),
    yLabel: axisCaption(catalog, yKey, "Style, top to bottom"),
  });
  const regionLabels = regions ? appendStyleRegions(chart, drawn, catalog, { xScale, yScale }) : [];
  const ordered = [...drawn].sort((left, right) => left.minutes - right.minutes);
  for (const row of ordered) {
    const key = `${row.entity_id}:${row.season_end_year}`;
    const emphasis = selectedId !== null && String(selectedId) === String(row.entity_id) ? "selected"
      : matchKeys.has(key) ? "match" : "normal";
    appendStyleMark(chart, row, {
      x: xScale.map(row.x_value), y: yScale.map(row.y_value),
      radius: 9 + 10 * Math.sqrt(Math.max(0, row.minutes) / largestMinutes),
      href: hrefFor(row), kind, catalog, emphasis,
      faceColor: faceColorFor ? faceColorFor(row) : null,
    });
  }
  // The region names sit on top of the marks so a crowded corner cannot hide
  // which part of the map it is.
  for (const label of regionLabels) chart.append(label);
  let search = null;
  if (searchId) {
    search = document.createElement("div");
    search.className = "chart-player-search";
    search.innerHTML = `<label for="${searchId}">Find a ${kind === "team" ? "team" : "player"} on this chart</label><div><input id="${searchId}" type="search" autocomplete="off" placeholder="${kind === "team" ? "Team name" : "Player name"}"/><button type="button">Clear</button></div>`;
  }
  const legend = buildLegend();
  // The panel is under the chart, so a card that grows as a reader moves across
  // the faces never shifts the chart out from under the pointer.
  container.replaceChildren(
    ...(search ? [search] : []),
    ...(legend ? [legend] : []),
    ...(extraLegend ? [extraLegend] : []),
    chart, status,
  );
  // Only a chosen entity *with* neighbours dims the rest; a profile map simply
  // rings the season it is about and leaves the league readable.
  container.classList.toggle("has-style-selection", matchKeys.size > 0);
  bindMarkHighlight(container, status, defaultStatus, search);
}

function toggledSet(hidden, id) {
  const next = new Set(hidden);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function isolatedSet(rows, catalog, id) {
  const every = new Set([...(catalog?.types ?? []).map((type) => type.id), UNTYPED.id]);
  const present = new Set(rows.map((row) => row.style.id));
  const next = new Set([...every].filter((value) => value !== id && present.has(value)));
  return next.size === present.size ? new Set() : next;
}

export function styleLandscapeTable(rows, catalog, {
  kind = "player", hrefFor, summary, xKey = "type_x", yKey = "type_y",
}) {
  const xLabel = axisCaption(catalog, xKey, "Side to side");
  const yLabel = axisCaption(catalog, yKey, "Top to bottom");
  const header = kind === "team"
    ? `<th>Team season</th><th>Style</th><th>Fit</th><th>${escapeHtml(xLabel)}</th><th>${escapeHtml(yLabel)}</th><th class="numeric">Minutes</th>`
    : `<th>Player</th><th>Team</th><th>Season</th><th>Type</th><th>Fit</th><th>${escapeHtml(xLabel)}</th><th>${escapeHtml(yLabel)}</th><th class="numeric">Minutes</th>`;
  const body = rows.map((row) => {
    const cells = kind === "team"
      ? `<th><a href="${hrefFor(row)}">${escapeHtml(row.display_name)}</a></th><td>${escapeHtml(row.style.label)}</td><td>${escapeHtml(confidenceWords(row.style.confidence))}</td>`
      : `<th><a href="${hrefFor(row)}">${escapeHtml(row.display_name)}</a></th><td>${escapeHtml(teamsOf(row))}</td><td>${escapeHtml(row.season ?? "—")}</td><td>${escapeHtml(row.style.label)}${row.style.provisional ? " (thin record)" : ""}</td><td>${escapeHtml(confidenceWords(row.style.confidence))}</td>`;
    return `<tr>${cells}<td>${number(row[xKey], 2)}</td><td>${number(row[yKey], 2)}</td><td class="numeric">${number(row.minutes, 0)}</td></tr>`;
  }).join("");
  return `<details><summary>${escapeHtml(summary)}</summary><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></details>`;
}

function styleHref(row, payload) {
  const params = new URLSearchParams({
    source: String(payload.stat_version ?? "v11"),
    schedule: ({ All: "all", "Regular Season": "regular_season", PlayIn: "play_in", Playoffs: "playoffs", Postseason: "postseason" })[payload.phase] ?? "all",
    time_mode: payload.garbage_time_mode ?? payload.time_mode ?? "competitive",
    metric: metricFields(payload).total,
    player_id: String(row.player_id),
  });
  if (row.season) params.append("season", row.season);
  return `/players?${params}`;
}

// How many player-seasons the type map draws; a whole-history selection is
// 7,000 faces otherwise.
// A described player season for each player the table is showing, in the
// table's own order. A player who changed type across a multi-season selection
// is placed by the season he played most of, and the caption says so.
export function describedRowsForScope(styleRows, tableRows) {
  const byPlayer = new Map();
  for (const row of styleRows ?? []) {
    const key = String(row.entity_id ?? row.player_id);
    const held = byPlayer.get(key);
    if (!held
      || row.minutes > held.minutes
      || (row.minutes === held.minutes
        && Number(row.season_end_year) > Number(held.season_end_year))) {
      byPlayer.set(key, row);
    }
  }
  const chosen = [];
  for (const row of tableRows ?? []) {
    const described = byPlayer.get(String(row.player_id));
    if (described) chosen.push(described);
  }
  return chosen;
}

const styleViewState = {
  typeHidden: new Set(),
  // The type list starts closed behind its own disclosure; the badges stay on
  // the summary so the colour key is readable either way.
  legendOpen: false,
};

// The entity pages draw the same map from a team landscape, and from a player
// landscape with one player lit up, so they call this instead of re-drawing it.
export function createStyleLandscapeView({
  container, tableContainer = null, landscape, kind = "player", hrefFor,
  xKey = "type_x", yKey = "type_y", searchId = null, regions = true,
  selectedId = null, limit = null, tableSummary = "View this map as a table",
  emptyNote = "No rows carry a published description in this view.",
}) {
  const catalog = styleCatalog(kind === "team" ? landscape?.team_types : landscape?.player_types);
  if (!container) return null;
  if (!catalog) {
    container.innerHTML = `<p class="similarity-empty">${escapeHtml(emptyNote)}</p>`;
    if (tableContainer) tableContainer.innerHTML = "";
    return null;
  }
  const every = styleRows(landscape, catalog, { kind });
  const ordered = [...every].sort((left, right) => right.minutes - left.minutes);
  const selectedKey = selectedId === null ? null : String(selectedId);
  const chosen = limit
    ? ordered.filter((row, index) => index < limit || String(row.entity_id) === selectedKey)
    : ordered;
  let hidden = new Set();
  const draw = () => {
    renderStyleLandscape({
      container, rows: chosen, catalog, kind, hrefFor, xKey, yKey, searchId,
      hidden, onHiddenChange: (next) => { hidden = next; draw(); },
      selectedId, regions, emptyNote,
    });
    if (tableContainer) {
      tableContainer.innerHTML = styleLandscapeTable(
        chosen.filter((row) => !hidden.has(row.style.id)),
        catalog, { kind, hrefFor, summary: tableSummary, xKey, yKey },
      );
    }
  };
  draw();
  return { catalog, rows: every, drawn: chosen };
}

// Three states, and the page must tell them apart: no landscape yet, a landscape
// whose deployment has no style model, and a landscape with one.
// A statistic with two role axes (V12) publishes its defensive side inside the
// catalogue and on every row. The two map panels share one Offense / Defense
// switch; the defensive view is the same charts drawn from the defensive
// fields, so no chart needs to know which side it is drawing.
const styleSide = { value: "offense", payload: null };

export function sideLandscape(landscape, side = styleSide.value) {
  const defense = landscape?.player_types?.defense;
  if (!defense || side !== "defense") return landscape;
  return {
    ...landscape,
    player_types: { ...landscape.player_types, ...defense },
    rows: (landscape.rows ?? []).map((row) => ({
      ...row,
      player_type: row.defense_type ?? null,
      type_x: row.defense_x,
      type_y: row.defense_y,
      description: row.defense_description ?? {},
    })),
  };
}

function roleNoun(payload) {
  if (!payload?.player_landscape?.player_types?.defense) return "player type";
  return styleSide.value === "defense" ? "defensive role" : "offensive role";
}

function ensureSideToggle(payload) {
  const twoAxis = Boolean(payload?.player_landscape?.player_types?.defense);
  for (const selector of ["#rankings-player-types-chart", "#rankings-similarity-chart"]) {
    const chart = document.querySelector(selector);
    if (!chart?.parentNode) continue;
    let bar = chart.parentNode.querySelector(":scope > .style-side-toggle");
    if (!twoAxis) {
      bar?.remove();
      continue;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "style-side-toggle";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Which side of the ball");
      chart.parentNode.insertBefore(bar, chart.parentNode.firstChild);
    }
    bar.innerHTML = [["offense", "Offensive roles"], ["defense", "Defensive roles"]].map(([side, label]) =>
      `<button type="button" data-style-side="${side}" aria-pressed="${styleSide.value === side}">${label}</button>`,
    ).join("") + `<span class="style-side-note">${styleSide.value === "defense"
      ? "Placed by what he does without the ball."
      : "Placed by what he does with the ball."}</span>`;
    for (const button of bar.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        if (styleSide.value === button.dataset.styleSide) return;
        styleSide.value = button.dataset.styleSide;
        const current = styleSide.payload;
        if (!current) return;
        renderPlayerTypes(current);
        renderSimilarityLandscape(current);
      });
    }
  }
}

function playerStyleLandscape(payload) {
  const landscape = sideLandscape(payload?.player_landscape ?? null);
  if (!landscape) return null;
  const catalog = styleCatalog(landscape.player_types);
  if (!catalog) return { landscape, catalog: null, rows: [] };
  return { landscape, catalog, rows: styleRows(landscape, catalog, { kind: "player" }) };
}

// A statistic that answers its landscape without a style model says so once,
// rather than loading for ever.
function styleModelMissingNote(payload, chartId, tableId, noteId = null, noteText = "") {
  const label = String(payload?.stat_version ?? "").toUpperCase() || "This statistic";
  // V12's types are built from its own results, so a missing model there
  // means they have not been built from the current results yet.
  const v12 = String(payload?.stat_version ?? "") === "v12";
  // V13's style build is being written beside it; until it is installed the
  // landscape carries no types, and the chart says only that.
  const v13 = String(payload?.stat_version ?? "") === "v13";
  document.querySelector(`#${chartId}`).innerHTML = v12
    ? '<p class="rankings-chart-empty">The V12 player types have not been built from the current V12 results yet, so there is nothing to place on the map.</p>'
    : v13
      ? '<p class="rankings-chart-empty">V13 player types have not been built yet.</p>'
      : `<p class="rankings-chart-empty">${escapeHtml(label)} answers this page, but this deployment has no player style model built, so there is nothing to place on the map.</p>`;
  document.querySelector(`#${tableId}`).innerHTML = "";
  const note = noteId ? document.querySelector(`#${noteId}`) : null;
  if (note) {
    note.textContent = v12 && noteText
      ? "This chart needs the V12 player types, which have not been built yet."
      : v13 && noteText
        ? "This chart needs the V13 player types, which have not been built yet."
        : noteText;
  }
}

// --- the player type map -------------------------------------------------------
//
// One chart, the full width of its panel, coloured by player type and nothing
// else. Which players are on it comes from the ranking table, and a mark is
// read the way every other chart in this section is read: pointing at it, or
// tapping it, or tabbing to it selects it, and the line under the chart says
// who he is, what type, what sets the season apart and what he played.

function renderPlayerStyleMap(payload, style) {
  const tableRows = payload.rows ?? [];
  const scope = describedRowsForScope(style.rows, tableRows);
  const rows = scopedRows(scope);
  renderStyleLandscape({
    container: document.querySelector("#rankings-player-types-chart"),
    rows, catalog: style.catalog, kind: "player",
    hrefFor: (row) => styleHref(row, payload),
    xKey: "type_x", yKey: "type_y",
    searchId: "rankings-player-types-search",
    hidden: styleViewState.typeHidden,
    onHiddenChange: (next) => {
      styleViewState.typeHidden = next;
      renderPlayerStyleMap(payload, style);
    },
    emptyNote: "No player seasons in this selection carry a published description.",
  });
  if (document.querySelector("[data-mobile-charts]")) {
    renderMobileArchetypes(document.querySelector("#rankings-player-types-chart"), mobileChartRows(rows), style.catalog, {
      hrefFor: row => styleHref(row, payload),
      highlightsFor: row => definingFeatures(row.description, style.catalog, 3).map(item => item.words),
      fitFor: row => confidenceWords(row.style.confidence),
    });
    mobileChartScopeNote(document.querySelector("#rankings-player-types-chart"), rows.length);
  }
  document.querySelector("#rankings-player-types-table").replaceChildren();
}

// How many seasons of published descriptions this selection is about to read.
// One season is about a megabyte; the whole history is thirteen of them, which
// is worth saying out loud before a reader waits for it on a phone.
function describedSeasonsWait(payload) {
  const selected = payload?.selected_seasons ?? [];
  const seasons = selected.length || 13;
  if (seasons === 1) {
    return "Reading this season's published player descriptions…";
  }
  return `Reading the published player descriptions for ${seasons} seasons — `
    + "the largest thing this page loads. One file per season.";
}

function renderPlayerTypes(payload) {
  styleSide.payload = payload;
  const style = playerStyleLandscape(payload);
  if (style?.catalog) {
    renderPlayerStyleMap(payload, style);
    ensureSideToggle(payload);
    return;
  }
  if (style) {
    styleModelMissingNote(
      payload, "rankings-player-types-chart", "rankings-player-types-table",
    );
    return;
  }
  if (String(payload?.stat_version ?? "") === "v11") {
    // The published descriptions are the heaviest thing this site holds, and
    // they are read one season at a time, so the wait says how many seasons it
    // is reading rather than leaving a bare "Loading…" on screen.
    document.querySelector("#rankings-player-types-chart").innerHTML = `<p class="rankings-chart-empty">${escapeHtml(describedSeasonsWait(payload))}</p>`;
    document.querySelector("#rankings-player-types-table").innerHTML = "";
    return;
  }
  const fields = metricFields(payload);
  // V9 and V10 publish no player types, so this panel keeps their own
  // value-source projection. It reads the offensive sources: the side control
  // it used to carry was a population control of its own and is gone.
  const projection = playerTypeProjection(payload.rows ?? [], fields, "offense");
  const rows = scopedRows(projection.rows);
  const colorDomain = paddedDomain(rows.map((row) => row._typeColor));
  faceScatter(document.querySelector("#rankings-player-types-chart"), rows, {
    xValue: (row) => row._typeX, yValue: (row) => row._typeY,
    radiusValue: (row) => row._typeSize,
    colorValue: (row) => multiAxisColor(row._typeColor, colorDomain),
    xLabel: projection.labels[0], yLabel: projection.labels[1], payload,
    ariaLabel: "Offensive player value-source profile landscape",
    searchId: "rankings-player-types-search",
    colorLegend: {
      label: projection.labels[2], domain: colorDomain, format: (value) => number(value, 3),
      note: "Lower to higher value on the chart’s third profile dimension.",
    },
    detail: (row) => `${number(row._typeY, 3)} ${projection.labels[1].toLowerCase()} · ${number(row._typeColor, 3)} ${projection.labels[2].toLowerCase()} · ${number(row[fields.total])} ${fields.short}`,
    drawnNote: drawnCountNote(rows.length, projection.rows.length),
  });
  document.querySelector("#rankings-player-types-table").replaceChildren();
}

// --- who leads each player type ------------------------------------------------
//
// One lane per type. Every player the table is showing sits on his type's lane
// at his selected total, nudged off the line only far enough not to cover his
// neighbour. The three at the front of each lane are named, and a tick marks
// the middle of the lane.

// Deterministic: the same positions always produce the same offsets, and the
// order the marks arrive in never changes the answer, because the packing walks
// them left to right and breaks ties by their original position.
export function beeswarmOffsets(positions, { radius = 7, maxOffset = 34, step = null } = {}) {
  const spacing = step ?? Math.max(1, radius * 1.05);
  const rungs = Math.max(1, Math.floor(maxOffset / spacing));
  const candidates = [0];
  for (let rung = 1; rung <= rungs; rung += 1) candidates.push(rung * spacing, -rung * spacing);
  const order = (positions ?? [])
    .map((value, index) => ({ x: Number(value), index }))
    .filter((item) => Number.isFinite(item.x))
    .sort((left, right) => left.x - right.x || left.index - right.index);
  const offsets = new Array((positions ?? []).length).fill(0);
  const placed = [];
  let windowStart = 0;
  const clearance = (2 * radius) ** 2;
  for (const item of order) {
    while (windowStart < placed.length && (item.x - placed[windowStart].x) ** 2 >= clearance) {
      windowStart += 1;
    }
    // The first rung with room wins. A lane so crowded that no rung has room
    // takes the roomiest one rather than piling everyone on the last, so the
    // marks stay inside the lane and stay as far apart as the lane allows.
    let chosen = null;
    let bestRoom = -Infinity;
    for (const candidate of candidates) {
      let nearest = Infinity;
      for (let index = windowStart; index < placed.length; index += 1) {
        const other = placed[index];
        const gap = (other.x - item.x) ** 2 + (other.y - candidate) ** 2;
        if (gap < nearest) nearest = gap;
      }
      if (nearest >= clearance) { chosen = candidate; break; }
      if (nearest > bestRoom) { bestRoom = nearest; chosen = candidate; }
    }
    offsets[item.index] = chosen;
    placed.push({ x: item.x, y: chosen });
  }
  return offsets;
}

export function medianOf(values) {
  const ordered = (values ?? []).map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

// One lane per published type, in the catalogue's own order, holding only the
// players the table is showing. A type nobody in the selection belongs to is
// left out rather than drawn as an empty lane.
export function typeLaneModel(rows, catalog) {
  const byType = new Map();
  for (const row of rows ?? []) {
    const id = String(row.style?.id ?? UNTYPED.id);
    if (!byType.has(id)) byType.set(id, []);
    byType.get(id).push(row);
  }
  const order = [...(catalog?.types ?? []).map((type) => type.id), UNTYPED.id];
  return order
    .filter((id) => byType.has(id))
    .map((id) => {
      const type = catalog?.typeById.get(id) ?? UNTYPED;
      const players = [...byType.get(id)].sort((left, right) => right.total - left.total
        || String(left.display_name).localeCompare(String(right.display_name)));
      return {
        id,
        label: type.label ?? UNTYPED.label,
        color: type.color ?? UNTYPED.color,
        badge: type.badge ?? UNTYPED.badge,
        players,
        count: players.length,
        median: medianOf(players.map((player) => player.total)),
      };
    });
}

// One lane per group of one V13 area, in the catalogue's own order, holding
// only the typed players drawn. Each player carries his group as `style`, so
// the lanes, their hover cards and the table read exactly as the type lanes do.
export function v13AreaLaneModel(rows, catalogue, area) {
  const title = String(catalogue?.titles?.[area] ?? area);
  return v13AreaGroups(catalogue, area).map((group) => {
    const label = String(group.label);
    const color = v13AreaColour(catalogue, area, group.index);
    const badge = label.split(/[\s:-]+/u).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
    const style = { id: `${area}:${group.index}`, label, color, badge, area: title };
    const players = (rows ?? [])
      .filter((row) => Number(row.v13?.areas?.[area]?.index) === Number(group.index))
      .map((row) => ({ ...row, style }))
      .sort((left, right) => right.total - left.total
        || String(left.display_name).localeCompare(String(right.display_name)));
    // The lane is named by the group's short name ("Disruptor", not its full
    // description), which the hover card still carries.
    return {
      id: style.id, label: v13Short(label), color, badge, players, count: players.length,
      median: medianOf(players.map((player) => player.total)),
    };
  }).filter((lane) => lane.count);
}

// What the type lanes place players by: the value from games won (Wins
// Contributed), from every game (Value Contributed) or from games lost
// (Losses Contributed), picked with the chart's own filter.
export const LANE_MEASURES = Object.freeze({
  wins: { total: "wins_contributed", offense: "offensive_wins_contributed", defense: "defensive_wins_contributed", label: "Wins Contributed", short: "WC" },
  total: { total: "value_contributed", offense: "offensive_value_contributed", defense: "defensive_value_contributed", label: "Value Contributed", short: "VC" },
  losses: { total: "losses_contributed", offense: null, defense: null, label: "Losses Contributed", short: "LC" },
});

export function laneMeasureOf() {
  const chosen = chartView("similarity").measure;
  return Object.hasOwn(LANE_MEASURES, chosen) ? chosen : "wins";
}

// The described season of every player the table is showing, carrying the
// table's own totals so the lane position is the number the table is sorted on.
function laneRows(payload, style, fields = metricFields(payload)) {
  const tableRows = payload.rows ?? [];
  const byPlayer = new Map(tableRows.map((row) => [String(row.player_id), row]));
  return describedRowsForScope(style.rows, tableRows).map((row) => {
    const tableRow = byPlayer.get(String(row.entity_id)) ?? {};
    return {
      ...row,
      total: finite(tableRow[fields.total]),
      offense: fields.offense ? finite(tableRow[fields.offense]) : null,
      defense: fields.defense ? finite(tableRow[fields.defense]) : null,
    };
  });
}

function laneHoverHtml(player, fields) {
  const parts = [];
  parts.push(player.style.id === UNTYPED.id
    ? "No published type for this season"
    : player.style.area
      ? `${player.style.area}: ${player.style.label}`
      : `${player.style.label} — ${confidenceWords(player.style.confidence)}`);
  if (player.style.provisional) parts.push("thin record, so the shape is pulled toward the average player");
  parts.push(`${number(player.total, 3)} ${fields.short}`);
  if (player.offense !== null && player.defense !== null) parts.push(`offense ${number(player.offense, 3)} · defense ${number(player.defense, 3)}`);
  const context = contextSummarySentence(player);
  if (context) parts.push(context);
  parts.push(`${number(player.minutes, 0)} minutes`);
  const heading = player.season && !String(player.display_name).includes(player.season)
    ? `${player.display_name} · ${teamsOf(player)} · ${player.season}`
    : `${player.display_name} · ${teamsOf(player)}`;
  return `<strong>${escapeHtml(heading)}</strong><span>${escapeHtml(parts.join(" · "))}</span>`;
}

function renderTypeLeaders(payload, style) {
  const noun = roleNoun(payload);
  setSimilarityCopy({
    heading: `Who leads each ${noun}`, note: "",
    label: `WHO LEADS EACH ${noun.toUpperCase()}`,
    lede: noun === "player type"
      ? "One lane per type, every player on it, and the names at the front of each lane."
      : `One lane per ${noun}, every player on it, and the names at the front of each lane.`,
  });
  const fields = LANE_MEASURES[laneMeasureOf()];
  const container = document.querySelector("#rankings-similarity-chart");
  // V13 labels every player four times, once per part of the game, so its
  // lanes are one part's groups at a time, picked with the switch above the
  // chart (owner's note, 2026-09-27). Every other statistic keeps one lane per
  // published type.
  const v13 = payload?.player_landscape?.player_types?.v13 ?? null;
  const areas = (v13?.order ?? []).filter((key) => v13.areas?.[key]);
  const bar = container ? chartControls(container) : null;
  if (chartSchedule.load) bar?.append(scheduleControl("similarity"));
  bar?.append(segmentedControl({
    label: "Value from",
    options: [["wins", "Wins"], ["total", "Total"], ["losses", "Losses"]],
    value: laneMeasureOf(),
    onChange: (measure) => setChartView("similarity", { measure }),
  }));
  let scope = laneRows(payload, style, fields);
  let drawn;
  let lanes;
  if (areas.length) {
    const chosen = chartView("similarity").area;
    const area = areas.includes(chosen) ? chosen : areas[0];
    const title = String(v13.titles?.[area] ?? area);
    bar?.prepend(segmentedControl({
      label: "Part of the game",
      options: areas.map((key) => [key, String(v13.titles?.[key] ?? key)]),
      value: area,
      onChange: (next) => setChartView("similarity", { area: next }),
    }));
    setSimilarityCopy({
      heading: "Who leads each player type", note: "",
      label: "WHO LEADS EACH PLAYER TYPE",
      lede: `One lane per ${title.toLocaleLowerCase()} group, every player on it, and the names at the front of each lane.`,
    });
    scope = scope.filter((row) => Number.isFinite(Number(row.v13?.areas?.[area]?.index)));
    drawn = scopedRows(scope);
    lanes = v13AreaLaneModel(drawn, v13, area);
  } else {
    drawn = scopedRows(scope);
    lanes = typeLaneModel(drawn, style.catalog);
  }
  const axes = document.querySelector("#rankings-similarity-axes");
  const table = document.querySelector("#rankings-similarity-table");
  if (!container) return;
  if (!lanes.length) {
    container.innerHTML = '<p class="rankings-chart-empty">No player in this selection carries a published type, so there are no lanes to draw.</p>';
    if (table) table.innerHTML = "";
    if (axes) axes.textContent = "The lanes appear once this selection's player descriptions are loaded.";
    return;
  }
  const width = Math.max(340, Math.floor(container.getBoundingClientRect().width || container.clientWidth || 900));
  // On a phone the type name will not fit beside the lane, so it moves above
  // the line and the gutter keeps only the badge.
  const narrow = width < 620;
  // Wide enough for the longest lane name beside its badge.
  const longest = Math.max(0, ...lanes.map((lane) => String(lane.label).length));
  const gutter = narrow ? 44 : Math.min(320, Math.max(196, 64 + Math.ceil(longest * 7.2)));
  const margin = { top: narrow ? 34 : 26, right: 26, bottom: 54, left: gutter };
  const laneHeight = narrow ? 104 : 92;
  const height = margin.top + margin.bottom + laneHeight * lanes.length;
  const totals = drawn.map((player) => player.total);
  const xScale = linearScale(paddedDomain(totals, { includeZero: true }), margin.left, width - margin.right);
  const markRadius = narrow ? 5 : drawn.length > 160 ? 5 : drawn.length > 80 ? 6 : 7;
  // A phone has no room for three names beside every lane, so the names go to
  // the table under the chart and the caption says where they went.
  const showLeaderNames = !narrow;

  const chart = svg("svg", {
    viewBox: `0 0 ${width} ${height}`, role: "img",
    "aria-label": `${lanes.length} player types, ${drawn.length} players placed by ${fields.label}`,
  });
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = xScale.low + (xScale.high - xScale.low) * tick / 4;
    const x = xScale.map(value);
    chart.append(svg("line", { x1: x, x2: x, y1: margin.top, y2: height - margin.bottom, class: "grid" }));
    chart.append(svg("text", { x, y: height - margin.bottom + 24, "text-anchor": "middle" }, number(value, 1)));
  }
  chart.append(svg("text", {
    x: (margin.left + width - margin.right) / 2, y: height - 14,
    "text-anchor": "middle", class: "axis-title",
  }, `${fields.label}${chartSchedule.load ? ` · ${CHART_SCHEDULES.find(([value]) => value === chartScheduleOf("similarity"))[1].toLocaleLowerCase()}` : " over the selected games"}`));

  const status = document.createElement("div");
  status.className = "rankings-chart-hover";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const defaultStatus = "<strong>Pick a player on the lanes</strong><span>Point at a mark, tap it, or move the keyboard focus to it, and his type, his total and how it split between offense and defense appear here.</span>";
  status.innerHTML = defaultStatus;

  lanes.forEach((lane, laneIndex) => {
    const baseline = margin.top + laneHeight * laneIndex + laneHeight / 2;
    chart.append(svg("line", {
      x1: margin.left, x2: width - margin.right, y1: baseline, y2: baseline, class: "lane-baseline",
    }));
    const badge = svg("g", { transform: `translate(${gutter - 18} ${baseline})`, class: "style-badge lane-badge" });
    badge.append(svg("circle", { cx: 0, cy: 0, r: 11, fill: lane.color }));
    badge.append(svg("text", { x: 0, y: 4, "text-anchor": "middle" }, lane.badge));
    chart.append(badge);
    const players = `${lane.count} player${lane.count === 1 ? "" : "s"}`;
    if (narrow) {
      chart.append(svg("text", {
        x: gutter, y: baseline - laneHeight * .40, "text-anchor": "start", class: "lane-label",
      }, `${lane.label} · ${players}`));
    } else {
      chart.append(svg("text", {
        x: gutter - 36, y: baseline - 3, "text-anchor": "end", class: "lane-label",
      }, lane.label));
      chart.append(svg("text", {
        x: gutter - 36, y: baseline + 13, "text-anchor": "end", class: "lane-count",
      }, players));
    }
    if (lane.median !== null) {
      const medianX = xScale.map(lane.median);
      chart.append(svg("line", {
        x1: medianX, x2: medianX, y1: baseline - laneHeight * .34, y2: baseline + laneHeight * .34,
        class: "lane-median", stroke: lane.color,
      }));
    }
    const positions = lane.players.map((player) => xScale.map(player.total));
    const offsets = beeswarmOffsets(positions, {
      radius: markRadius, maxOffset: laneHeight * .36,
    });
    // The three at the front of a lane are often next to each other, so their
    // names alternate above and below the line instead of colliding.
    const leaders = new Map(lane.players.slice(0, 3)
      .map((player, rank) => [`${player.entity_id}:${player.season_end_year}`, rank]));
    lane.players.forEach((player, index) => {
      const key = `${player.entity_id}:${player.season_end_year}`;
      const leaderRank = leaders.get(key);
      const isLeader = leaderRank !== undefined;
      const x = positions[index];
      const y = baseline + offsets[index];
      const radius = isLeader ? markRadius + 5 : markRadius;
      const positioned = svg("g", { transform: `translate(${x} ${y})`, class: "player-mark-position" });
      const link = svg("a", {
        href: styleHref(player, payload),
        class: `player-face-mark lane-mark${isLeader ? " is-lane-leader" : ""}`,
        tabindex: 0,
        "data-player-mark": String(player.entity_id),
        "data-player-name": player.search_name,
        "data-style-id": player.style.id,
        "data-hover-html": laneHoverHtml(player, fields),
        "aria-label": `${player.display_name}. ${player.style.label}. ${number(player.total, 3)} ${fields.label}. Open the profile.`,
      });
      link.style.setProperty("--player-mark-color", lane.color);
      link.append(svg("circle", { cx: 0, cy: 0, r: radius, class: "player-face-back", fill: lane.color }));
      if (isLeader) {
        const clipId = `lane-face-${String(player.entity_id).replace(/\D/gu, "")}-${player.season_end_year ?? 0}`;
        let defs = chart.querySelector("defs");
        if (!defs) { defs = svg("defs"); chart.prepend(defs); }
        const clip = svg("clipPath", { id: clipId });
        clip.append(svg("circle", { cx: 0, cy: 0, r: Math.max(1, radius - 2) }));
        defs.append(clip);
        link.append(svg("text", { x: 0, y: 4, "text-anchor": "middle", class: "player-face-initials" }, initials(player.display_name)));
        link.append(svg("image", {
          href: headshotUrl(player.entity_id), x: -radius, y: -radius * .84,
          width: radius * 2, height: radius * 1.84,
          preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${clipId})`, class: "player-face-image",
        }));
      }
      link.append(svg("circle", { cx: 0, cy: 0, r: radius, class: "player-face-ring", stroke: lane.color }));
      positioned.append(link);
      chart.append(positioned);
      if (isLeader && showLeaderNames) {
        const above = leaderRank % 2 === 0;
        const lift = above ? -(radius + 8 + (leaderRank === 2 ? 12 : 0)) : radius + 17;
        chart.append(svg("text", {
          x, y: y + lift,
          "text-anchor": x > width - margin.right - 90 ? "end"
            : x < margin.left + 60 ? "start" : "middle",
          class: "lane-leader-label",
        }, player.display_name));
      }
    });
  });

  const children = [];
  if (chartNotes.drawn) {
    const note = document.createElement("p");
    note.className = "chart-drawn-note";
    note.textContent = drawnCountNote(drawn.length, scope.length, { noun: "described players" });
    children.push(note);
  }
  container.replaceChildren(...children, chart, status);
  bindMarkHighlight(container, status, defaultStatus);

  if (axes) axes.textContent = "";

  if (table) {
    const body = lanes.flatMap((lane) => lane.players.map((player, index) => `<tr><td>${escapeHtml(lane.label)}</td><td class="numeric">${index + 1}</td><th><a href="${styleHref(player, payload)}">${escapeHtml(player.display_name)}</a></th><td>${escapeHtml(teamsOf(player))}</td><td class="numeric">${number(player.total, 3)}</td></tr>`)).join("");
    table.innerHTML = `<details><summary>View who leads each type as a table</summary><table><thead><tr><th>Type</th><th class="numeric">Rank in type</th><th>Player</th><th>Team</th><th class="numeric">${escapeHtml(fields.short)}</th></tr></thead><tbody>${body}</tbody></table></details>`;
  }
}

function postseasonValues(row, fields) {
  const wins = fields.total === "wins_contributed";
  const regularTotal = wins ? finite(row.regular_wins_contributed) : finite(row.regular_value_contributed);
  const postTotal = wins ? finite(row.postseason_wins_contributed) : finite(row.postseason_value_contributed);
  return { regular: regularTotal / finite(row.regular_games), postseason: postTotal / finite(row.postseason_games) };
}

// Only a player who actually appeared in both schedules has a place on this
// chart: one of the two rates would otherwise be a division by no games.
export function bothSchedules(rows) {
  return (rows ?? []).filter((row) => finite(row.regular_games) > 0 && finite(row.postseason_games) > 0);
}

function renderRegPost(tablePayload) {
  const payload = withChartBreakdown("reg-post", tablePayload);
  chartControls(document.querySelector("#rankings-reg-post-chart")).append(breakdownControl("reg-post", payload));
  const fields = metricFields(payload);
  const eligible = bothSchedules(payload.rows)
    .map((row) => ({ ...row, _comparison: postseasonValues(row, fields) }));
  const rows = scopedRows(eligible);
  const values = rows.flatMap((row) => [row._comparison.regular, row._comparison.postseason]);
  const sharedDomain = paddedDomain(values);
  const unit = `${fields.short} / game`;
  faceScatter(document.querySelector("#rankings-reg-post-chart"), rows, {
    xValue: (row) => row._comparison.regular,
    yValue: (row) => row._comparison.postseason,
    radiusValue: (row) => finite(row.postseason_games),
    xDomain: sharedDomain, yDomain: sharedDomain, diagonal: true,
    regions: [
      { corner: "top-left", text: "Better in the postseason" },
      { corner: "bottom-right", text: "Better in the regular season" },
    ],
    lineNote: "On the dashed line a player's per-game rate was the same in both; above it higher in the postseason, below it higher in the regular season.",
    tickFormat: (value) => number(value, 2),
    xLabel: `Regular-season ${unit}`, yLabel: `Postseason ${unit}`, payload,
    ariaLabel: `Regular-season versus postseason ${fields.label}`,
    detail: (row) => `${number(row._comparison.regular)} regular → ${number(row._comparison.postseason)} postseason (${row._comparison.postseason - row._comparison.regular >= 0 ? "+" : ""}${number(row._comparison.postseason - row._comparison.regular)}) · ${finite(row.postseason_games)} postseason games`,
    drawnNote: drawnCountNote(rows.length, eligible.length, { noun: "players with both schedules" }),
    faceBudget: chartFaces.budget,
    faceRank: (_row, index) => -index,
    faceNoun: "players with both schedules",
    ...(chartSearch.regPost ? { searchId: "rankings-reg-post-search" } : {}),
  });
  if (document.querySelector("[data-mobile-charts]")) {
    renderMobileComparison(document.querySelector("#rankings-reg-post-chart"), mobileChartRows(rows), {
      unit: fields.short, hrefFor: (row) => playerHref(row, payload),
    });
    mobileChartScopeNote(document.querySelector("#rankings-reg-post-chart"), rows.length);
  }
  const regPostStatus = document.querySelector("#rankings-reg-post-status");
  if (regPostStatus) {
    regPostStatus.textContent = rows.length
      ? `${rows.length} of the table's players appeared in both schedules · above the diagonal means a higher postseason per-game rate`
      : "No players in this scope have both regular-season and postseason appearances.";
  }
  const regPostTable = document.querySelector("#rankings-reg-post-table");
  if (regPostTable) regPostTable.innerHTML = `<details><summary>View regular-to-postseason values as a table</summary><table><thead><tr><th>Player</th><th>Regular</th><th>Postseason</th><th>Change</th><th>Post GP</th></tr></thead><tbody>${rows.map((row) => `<tr><th><a href="${playerHref(row, payload)}">${escapeHtml(row.player_name)}</a></th><td>${number(row._comparison.regular)}</td><td>${number(row._comparison.postseason)}</td><td>${number(row._comparison.postseason - row._comparison.regular)}</td><td>${finite(row.postseason_games)}</td></tr>`).join("")}</tbody></table></details>`;
}

// --- per 36 minutes against the total -----------------------------------------
//
// The players the table is showing, each placed by the total the table ranks
// (Wins VC or VC) against the same value per 36 minutes played. Far right piled
// up the most; high up did the most with each minute. Face size is minutes, and
// the dashed lines mark the middle player on each measure, so the four corners
// read as "a lot of both", "rate without the minutes", "minutes without the
// rate" and "neither".

export function middleValue(values) {
  // Number(null) and Number("") are 0, so a missing value is dropped before it
  // can be counted as a zero.
  const ordered = (values ?? []).filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function renderLoadRate(tablePayload) {
  const container = document.querySelector("#rankings-load-rate-chart");
  if (!container) return;
  const payload = withChartBreakdown("load-rate", tablePayload);
  chartControls(container).append(breakdownControl("load-rate", payload));
  const fields = metricFields(payload);
  const rows = (payload.rows ?? []).filter((row) => playerMinutes(row) > 0)
    .map((row) => ({ ...row, _totalRaw: finite(row[fields.total]), _per36Raw: per36(row, fields.total) }));
  const visible = scopedRows(rows);
  const reference = { x: middleValue(visible.map((row) => row._totalRaw)), y: middleValue(visible.map((row) => row._per36Raw)) };
  faceScatter(container, visible, {
    xValue: (row) => row._totalRaw, yValue: (row) => row._per36Raw,
    radiusValue: (row) => playerMinutes(row),
    regions: [
      { corner: "top-right", text: "High rate and a big total" },
      { corner: "top-left", text: "High rate in fewer minutes" },
      { corner: "bottom-right", text: "Big total from heavy minutes" },
      { corner: "bottom-left", text: "Lower rate, smaller total" },
    ],
    lineNote: "The dashed lines mark the middle player on each measure.",
    // Fitted to the players drawn, not to zero: a top 25 all sit far from it.
    xDomain: paddedDomain(visible.map((row) => row._totalRaw)),
    yDomain: paddedDomain(visible.map((row) => row._per36Raw)),
    reference: reference.x === null ? null : reference,
    tickFormat: (value) => number(value, Math.abs(value) < 2 ? 2 : 1),
    xLabel: `Total ${fields.short}`, yLabel: `${fields.short} per 36 minutes`, payload,
    ariaLabel: `Total ${fields.label} against ${fields.label} per 36 minutes`,
    searchId: "rankings-load-rate-search",
    detail: (row) => `${number(row._totalRaw, 3)} ${fields.short} total · ${number(row._per36Raw, 3)} per 36 minutes · ${number(playerMinutes(row), 0)} minutes in ${finite(row.games_played)} games`,
    drawnNote: drawnCountNote(visible.length, rows.length),
    faceBudget: chartFaces.budget,
    faceRank: (_row, index) => -index,
  });
  if (document.querySelector("[data-mobile-charts]")) {
    renderMobileScatter(container, mobileChartRows(visible), {
      unit: "", hrefFor: (row) => playerHref(row, payload),
      axes: {
        xKey: "_totalRaw", yKey: "_per36Raw", xLabel: `Total ${fields.short}`, yLabel: `${fields.short} per 36`, digits: 2,
        pairs: (row) => [[`Total ${fields.short}`, row._totalRaw], ["Per 36 minutes", row._per36Raw]],
        context: (row) => `${number(playerMinutes(row), 0)} minutes in ${finite(row.games_played)} games`,
      },
    });
    mobileChartScopeNote(container, visible.length);
  }
  const fallback = document.querySelector("#rankings-load-rate-table");
  if (fallback) fallback.innerHTML = `<details><summary>View per 36 minutes and totals as a table</summary><table><thead><tr><th>Player</th><th>Total ${fields.short}</th><th>Per 36 minutes</th><th>Minutes</th><th>Games</th></tr></thead><tbody>${visible.map((row) => `<tr><th><a href="${playerHref(row, payload)}">${escapeHtml(row.player_name)}</a></th><td>${number(row._totalRaw, 3)}</td><td>${number(row._per36Raw, 3)}</td><td>${number(playerMinutes(row), 0)}</td><td>${finite(row.games_played)}</td></tr>`).join("")}</tbody></table></details>`;
}

// --- value in wins against value in losses ------------------------------------
//
// The players the table is showing, each placed by the value produced in games
// the team won (Wins VC) against the value produced in games it lost (Loss VC).
// The two add up to VC, whichever view the table is in. Below the dashed line
// more of a player's value came in wins; the colour is the share that did, and
// face size is games played.

export function winShare(row) {
  const wins = Number(row?.wins_contributed);
  const losses = Number(row?.losses_contributed);
  const total = wins + losses;
  return Number.isFinite(total) && total > 0 ? wins / total : null;
}

// Wins VC per win and Loss VC per loss: null when the record has no such game.
export function perGameSplit(row) {
  const wins = Number(row?.wins);
  const losses = Number(row?.losses);
  const winsValue = Number(row?.wins_contributed);
  const lossValue = Number(row?.losses_contributed);
  return {
    perWin: wins > 0 && Number.isFinite(winsValue) ? winsValue / wins : null,
    perLoss: losses > 0 && Number.isFinite(lossValue) ? lossValue / losses : null,
  };
}

function renderWinsLosses(payload) {
  const container = document.querySelector("#rankings-wins-losses-chart");
  if (!container) return;
  const perGame = chartView("wins-losses").scale === "per_game";
  chartControls(container).append(segmentedControl({
    label: "Show",
    options: [["total", "Totals"], ["per_game", "Per game"]],
    value: perGame ? "per_game" : "total",
    onChange: (scale) => setChartView("wins-losses", { scale }),
  }));
  const rows = (payload.rows ?? [])
    .filter((row) => Number.isFinite(Number(row.wins_contributed)) && Number.isFinite(Number(row.losses_contributed)))
    .map((row) => {
      const split = perGameSplit(row);
      return {
        ...row,
        _winsRaw: perGame ? split.perWin : finite(row.wins_contributed),
        _lossesRaw: perGame ? split.perLoss : finite(row.losses_contributed),
        _share: winShare(row),
      };
    })
    // Per game needs at least one win and one loss to place a player.
    .filter((row) => row._winsRaw !== null && row._lossesRaw !== null);
  const visible = scopedRows(rows);
  // One scale on both axes, so the dashed line really is "as much in losses as
  // in wins", fitted to the players drawn rather than stretched to zero.
  const shared = paddedDomain(visible.flatMap((row) => [row._winsRaw, row._lossesRaw]));
  const percent = (value) => `${Math.round(finite(value) * 100)}%`;
  const digits = perGame ? 3 : 1;
  const words = perGame
    ? { x: "Wins VC per win", y: "Loss VC per loss", line: "as much per loss as per win", short: ["Per win", "Per loss"] }
    : { x: "Wins VC (value in games won)", y: "Loss VC (value in games lost)", line: "as much in losses as in wins", short: ["Wins VC", "Loss VC"] };
  const numbers = (row) => perGame
    ? `${number(row._winsRaw, 3)} Wins VC per win over ${finite(row.wins)} wins · ${number(row._lossesRaw, 3)} Loss VC per loss over ${finite(row.losses)} losses`
    : `${number(row._winsRaw, 3)} Wins VC in ${finite(row.wins)} wins · ${number(row._lossesRaw, 3)} Loss VC in ${finite(row.losses)} losses`;
  faceScatter(container, visible, {
    xValue: (row) => row._winsRaw, yValue: (row) => row._lossesRaw,
    radiusValue: (row) => finite(row.games_played),
    xDomain: shared, yDomain: shared, diagonal: true, diagonalLabel: words.line,
    regions: perGame
      ? [{ corner: "top-left", text: "More per loss than per win" }, { corner: "bottom-right", text: "More per win than per loss" }]
      : [{ corner: "top-left", text: "More value in losses than in wins" }, { corner: "bottom-right", text: "More value in wins than in losses" }],
    lineNote: perGame
      ? "On the dashed line a player gave the same per win as per loss; above it more per loss, below it more per win."
      : "On the dashed line a player's value came as much in losses as in wins; above it more came in losses, below it more in wins.",
    tickFormat: (value) => number(value, perGame ? 2 : 1),
    xLabel: words.x, yLabel: words.y, payload,
    ariaLabel: perGame
      ? "Value per win against value per loss"
      : "Value produced in wins against value produced in losses",
    searchId: "rankings-wins-losses-search",
    detail: (row) => `${numbers(row)} · ${percent(row._share)} of all value came in wins`,
    drawnNote: drawnCountNote(visible.length, rows.length),
    faceBudget: chartFaces.budget,
    faceRank: (_row, index) => -index,
  });
  if (document.querySelector("[data-mobile-charts]")) {
    renderMobileScatter(container, mobileChartRows(visible), {
      unit: "", hrefFor: (row) => playerHref(row, payload),
      axes: {
        xKey: "_winsRaw", yKey: "_lossesRaw", xLabel: words.short[0], yLabel: words.short[1], digits: perGame ? 2 : 1,
        pairs: (row) => [[words.short[0], row._winsRaw], [words.short[1], row._lossesRaw]],
        context: (row) => `${finite(row.wins)}–${finite(row.losses)} record · ${percent(row._share)} of all value came in wins`,
      },
    });
    mobileChartScopeNote(container, visible.length);
  }
  const fallback = document.querySelector("#rankings-wins-losses-table");
  if (fallback) fallback.innerHTML = `<details><summary>View value in wins and losses as a table</summary><table><thead><tr><th>Player</th><th>${words.short[0]}</th><th>${words.short[1]}</th><th>Share in wins</th><th>Record</th></tr></thead><tbody>${visible.map((row) => `<tr><th><a href="${playerHref(row, payload)}">${escapeHtml(row.player_name)}</a></th><td>${number(row._winsRaw, digits + (perGame ? 0 : 2))}</td><td>${number(row._lossesRaw, digits + (perGame ? 0 : 2))}</td><td>${percent(row._share)}</td><td>${finite(row.wins)}–${finite(row.losses)}</td></tr>`).join("")}</tbody></table></details>`;
}

// --- Wins Contributed by player type ------------------------------------------
//
// Built like Rolling Wins Contributed: one line per V13 player type (the
// grouping), each point the type's combined Wins Contributed that season
// averaged over one, three or five seasons, with the same Schedule and Average
// window filters. Early seasons average only the seasons they have and are
// drawn hollow, as partial windows are on the rolling chart.
//
// Hovering a line, a point or a legend row picks the type out. Clicking a
// legend row, or a point on a line, opens a drawer under that type's row in
// the legend on the right: the type's best one to four players in one season
// (the reader chooses how many), with ‹ › to step through the seasons. A point
// opens the drawer at its own season. The drawer names each season's own
// leaders, not the averaging window's.

export const TYPE_TREND_WINDOWS = Object.freeze([["1", "1 year"], ["3", "3 years"], ["5", "5 years"]]);
export const TYPE_TREND_LEADER_COUNTS = Object.freeze([["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]]);

export function typeTrendView() {
  const view = chartView("type-trends");
  const schedule = HISTORY_SCHEDULES.some(([value]) => value === view.schedule) ? view.schedule : "All";
  const windowYears = ["1", "3", "5"].includes(String(view.window)) ? Number(view.window) : 3;
  const leaders = ["1", "2", "3", "4"].includes(String(view.leaders)) ? Number(view.leaders) : 3;
  return { schedule, windowYears, leaders };
}

// The best `count` players of one type-season, most Wins Contributed first.
export function typeTrendLeaders(point, count) {
  return (point?.leaders ?? []).slice(0, Math.max(0, Math.min(4, Number(count) || 0)));
}

// Which season the drawer shows: the one asked for when the type has it, else
// the latest season.
export function typeTrendDrawerSeason(seasons, wanted) {
  const list = seasons ?? [];
  return list.includes(wanted) ? wanted : (list.at(-1) ?? null);
}

// Remember what the drawer shows without redrawing the chart, so a later
// redraw (another filter, a resize) opens it where the reader left it.
function rememberTypeTrendDrawer(patch) {
  chartViews.set("type-trends", { ...chartView("type-trends"), ...patch });
}

function renderTypeTrends(payload) {
  const container = document.querySelector("#rankings-type-trends-chart");
  if (!container) return;
  const { schedule, windowYears, leaders } = typeTrendView();
  chartControls(container).append(
    segmentedControl({
      label: "Schedule",
      options: HISTORY_SCHEDULES,
      value: schedule,
      onChange: (next) => setChartView("type-trends", { schedule: next }),
    }),
    segmentedControl({
      label: "Average window",
      options: TYPE_TREND_WINDOWS,
      value: String(windowYears),
      onChange: (next) => setChartView("type-trends", { window: next }),
    }),
    segmentedControl({
      label: "Top players",
      options: TYPE_TREND_LEADER_COUNTS,
      value: String(leaders),
      onChange: (next) => setChartView("type-trends", { leaders: next }),
    }),
  );
  const types = payload?.types ?? [];
  const seasons = payload?.seasons ?? [];
  if (!types.length || !seasons.length) {
    container.innerHTML = '<p class="rankings-chart-empty">No player types to show for this schedule.</p>';
    return;
  }
  const width = 1120;
  const height = 580;
  const margin = { top: 28, right: 24, bottom: 86, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = types.flatMap((type) => type.seasons.map((point) => Number(point.rolling_average)));
  const top = Math.max(1, ...values);
  const yMax = top * 1.08;
  const x = (season) => margin.left + (seasons.indexOf(season) / Math.max(1, seasons.length - 1)) * plotWidth;
  const y = (value) => margin.top + ((yMax - value) / yMax) * plotHeight;
  const chart = svg("svg", {
    viewBox: `0 0 ${width} ${height}`, class: "type-trend-svg", role: "img",
    "aria-label": `Wins Contributed by player type, ${windowYears}-season averages, ${seasons[0]} to ${seasons.at(-1)}`,
  });
  const grid = svg("g", { class: "chart-grid" });
  for (const value of roundTicks(0, yMax, 5)) {
    const position = y(value);
    grid.append(svg("line", { x1: margin.left, x2: width - margin.right, y1: position, y2: position }));
    grid.append(svg("text", { x: margin.left - 12, y: position + 4, "text-anchor": "end" }, number(value, 0)));
  }
  for (const season of seasons) {
    const position = x(season);
    grid.append(svg("line", { x1: position, x2: position, y1: margin.top, y2: height - margin.bottom, class: "vertical-grid" }));
    grid.append(svg("text", {
      x: position, y: height - margin.bottom + 23, "text-anchor": "end",
      transform: `rotate(-42 ${position} ${height - margin.bottom + 23})`,
    }, season));
  }
  grid.append(svg("text", {
    x: 18, y: margin.top + plotHeight / 2, "text-anchor": "middle",
    transform: `rotate(-90 18 ${margin.top + plotHeight / 2})`, class: "axis-title",
  }, "Wins Contributed by type"));
  chart.append(grid);

  const wrap = document.createElement("div");
  wrap.className = "chart-wrap type-trend-wrap";
  const tooltip = document.createElement("div");
  tooltip.className = "trend-tooltip";
  tooltip.hidden = true;
  const scheduleWords = ({ "Regular Season": "regular season", Postseason: "postseason" })[schedule] ?? "full season";

  // The drawer's state: which type is open and which season it shows.
  const remembered = chartView("type-trends");
  let picked = types.some((type) => type.id === remembered.picked) ? remembered.picked : null;
  let drawerSeason = typeTrendDrawerSeason(seasons, remembered.season);
  const marker = svg("circle", { r: 9, class: "type-trend-picked-point", visibility: "hidden" });

  const highlight = (id = null) => {
    const active = id ?? picked;
    container.querySelectorAll("[data-type-trend]").forEach((node) => {
      node.classList.toggle("is-highlighted", active !== null && node.dataset.typeTrend === active);
      node.classList.toggle("is-muted", active !== null && node.dataset.typeTrend !== active);
    });
  };
  const showTip = (event, type, point) => {
    const partial = point.window_span < point.window_years;
    tooltip.innerHTML = `<strong>${escapeHtml(type.label)}</strong>`
      + `<span>${escapeHtml(point.season)} · ${point.players} player${point.players === 1 ? "" : "s"}</span>`
      + `<span>Season total: ${number(point.season_value, 1)} Wins Contributed</span>`
      + (point.window_years > 1
        ? `<span>${partial ? `${point.window_span}-season partial` : `${point.window_years}-season`} average: ${number(point.rolling_average, 1)}</span>`
        : "")
      + "<em>Click to see its top players</em>";
    const box = wrap.getBoundingClientRect();
    const clientX = Number.isFinite(event.clientX) ? event.clientX : box.left + box.width / 2;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : box.top + 40;
    tooltip.style.left = `${Math.max(8, Math.min(clientX - box.left + 14, box.width - 230))}px`;
    tooltip.style.top = `${Math.max(8, clientY - box.top - 36)}px`;
    tooltip.hidden = false;
  };

  const legend = document.createElement("aside");
  legend.className = "trend-legend";
  legend.setAttribute("aria-label", "Player types");
  const latest = seasons.at(-1);
  legend.innerHTML = `<h3>Player types</h3><p>${types.filter((type) => type.typed).length} V13 types, ${escapeHtml(scheduleWords)}; the number is each type's ${windowYears > 1 ? `${windowYears}-season average` : "total"} in ${escapeHtml(latest)}. Click a type, or a point on its line, for its top players. Players under ${number(payload.minimum_minutes ?? 500, 0)} regular-season minutes have no type.</p>`;
  const list = document.createElement("div");
  list.className = "trend-legend-list";
  const drawer = document.createElement("div");
  drawer.className = "type-trend-drawer";
  drawer.setAttribute("role", "region");
  const rows = new Map();

  const linkFor = (leader, season) => playerHref({ player_id: leader.player_id }, {
    stat_version: "v13", phase: schedule, garbage_time_mode: payload.time_mode,
    breakdown_mode: "wc", selected_seasons: [season],
  });
  const drawDrawer = () => {
    rows.forEach((row, id) => row.setAttribute("aria-expanded", String(id === picked)));
    const type = types.find((entry) => entry.id === picked);
    if (!type) {
      drawer.remove();
      marker.setAttribute("visibility", "hidden");
      rememberTypeTrendDrawer({ picked: null });
      return;
    }
    const point = type.seasons.find((entry) => entry.season === drawerSeason) ?? type.seasons.at(-1);
    drawerSeason = point.season;
    rememberTypeTrendDrawer({ picked, season: drawerSeason });
    const index = seasons.indexOf(point.season);
    const best = typeTrendLeaders(point, leaders);
    const total = Number(point.season_value) || 0;
    const topShare = total > 0 ? best.reduce((sum, leader) => sum + leader.wins_contributed, 0) / total : 0;
    drawer.style.setProperty("--player-color", type.color);
    drawer.setAttribute("aria-label", `Top players, ${type.label}, ${point.season}`);
    drawer.innerHTML = `<div class="type-trend-drawer-head">
        <button type="button" data-step="-1" aria-label="Previous season"${index <= 0 ? " disabled" : ""}>‹</button>
        <strong>${escapeHtml(point.season)}</strong>
        <button type="button" data-step="1" aria-label="Next season"${index >= seasons.length - 1 ? " disabled" : ""}>›</button>
      </div>
      <p class="type-trend-drawer-sub">${number(total, 1)} Wins Contributed from ${point.players} player${point.players === 1 ? "" : "s"}</p>
      ${best.length ? `<ol class="type-trend-drawer-list">${best.map((leader) => {
        const share = total > 0 ? leader.wins_contributed / total : 0;
        return `<li>
          <span class="type-trend-leader-face"><img src="${headshotUrl(leader.player_id)}" alt="" loading="lazy"></span>
          <span class="type-trend-drawer-name"><a href="${escapeHtml(linkFor(leader, point.season))}">${escapeHtml(leader.player_name)}</a><small>${escapeHtml((leader.team_abbreviations ?? []).join("/"))}</small></span>
          <span class="type-trend-drawer-value">${number(leader.wins_contributed, 1)}<small>${Math.round(share * 100)}%</small></span>
          <span class="type-trend-drawer-bar" aria-hidden="true"><i style="width:${Math.max(2, Math.round(share * 100))}%"></i></span>
        </li>`;
      }).join("")}</ol>
      <p class="type-trend-drawer-sub">${best.length === 1 ? "The top player holds" : `The top ${best.length} hold`} ${Math.round(topShare * 100)}% of the type's ${escapeHtml(point.season)} total.</p>`
      : '<p class="type-trend-drawer-sub">Nobody of this type played that season.</p>'}`;
    drawer.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = seasons[index + Number(button.dataset.step)];
      if (!next) return;
      drawerSeason = next;
      drawDrawer();
    }));
    rows.get(type.id)?.after(drawer);
    marker.setAttribute("cx", x(point.season));
    marker.setAttribute("cy", y(point.rolling_average));
    marker.style.setProperty("--player-color", type.color);
    marker.setAttribute("visibility", "visible");
  };
  const open = (id, season = null) => {
    if (season) {
      picked = id;
      drawerSeason = season;
    } else {
      picked = picked === id ? null : id;
    }
    highlight();
    drawDrawer();
    if (picked) drawer.scrollIntoView({ block: "nearest" });
  };

  const lines = svg("g", { class: "trend-lines" });
  for (const type of types) {
    const group = svg("g", {
      class: `trend-player type-trend${type.typed ? "" : " is-untyped"}`,
      "data-type-trend": type.id,
      style: `--player-color: ${type.color}`,
    });
    const line = svg("polyline", {
      points: type.seasons.map((point) => `${x(point.season)},${y(point.rolling_average)}`).join(" "),
      class: "trend-line", fill: "none",
    });
    line.addEventListener("mouseenter", () => highlight(type.id));
    line.addEventListener("mouseleave", () => highlight());
    line.addEventListener("click", () => open(type.id));
    group.append(line);
    for (const point of type.seasons) {
      const partial = point.window_span < point.window_years;
      const dot = svg("circle", {
        cx: x(point.season), cy: y(point.rolling_average), r: 4,
        class: `trend-point ${partial ? "partial-window" : "complete-window"}`,
        tabindex: 0, role: "button",
        "aria-label": `${type.label}, ${point.season}, ${number(point.rolling_average, 1)} Wins Contributed${point.window_years > 1 ? ` averaged over ${point.window_span} seasons` : ""}. Show its top players that season.`,
      });
      const enter = (event) => { highlight(type.id); showTip(event, type, point); };
      const leave = () => { tooltip.hidden = true; highlight(); };
      dot.addEventListener("mouseenter", enter);
      dot.addEventListener("mousemove", (event) => showTip(event, type, point));
      dot.addEventListener("mouseleave", leave);
      dot.addEventListener("focus", enter);
      dot.addEventListener("blur", leave);
      dot.addEventListener("click", () => open(type.id, point.season));
      dot.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(type.id, point.season);
      });
      group.append(dot);
    }
    lines.append(group);
  }
  chart.append(lines, marker);
  wrap.append(chart, tooltip);

  for (const type of types) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "legend-player";
    button.dataset.typeTrend = type.id;
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `<span class="legend-swatch" style="--player-color: ${escapeHtml(type.color)}"></span><span>${escapeHtml(type.label)}</span><small>${number(type.seasons.at(-1)?.rolling_average, 1)}</small>`;
    button.addEventListener("mouseenter", () => highlight(type.id));
    button.addEventListener("mouseleave", () => highlight());
    button.addEventListener("click", () => open(type.id));
    rows.set(type.id, button);
    list.append(button);
  }
  legend.append(list);
  const layout = document.createElement("div");
  layout.className = "trend-layout type-trend-layout";
  const left = document.createElement("div");
  left.append(wrap);
  layout.append(left, legend);
  const note = document.createElement("p");
  note.className = "chart-key-note";
  note.textContent = "Each line is one player type's combined Wins Contributed. Every season's lines add up to the whole league, so a season with fewer games (2019-20, 2020-21) is lower for every type. Hollow points average fewer seasons than the window.";
  // On a phone the same answer is drawn as the Rolling Wins Contributed
  // explorer, one type in the place of each player; the desktop chart is
  // hidden there.
  const phone = document.createElement("div");
  phone.className = "type-trend-mobile";
  container.replaceChildren(note, phone, layout);
  renderMobileTypeTrends(phone, payload);
  highlight();
  drawDrawer();
}

// --- every season, side by side -----------------------------------------------
//
// One lane per season the statistic has, oldest at the top. Each lane holds that
// season's best HISTORY_LANE_SIZE players by the table's own total (Wins VC or
// VC), under the table's schedule and game-time settings, so a reader can see
// how a season's leaders compare with every other season's. The best
// HISTORY_LANE_FACES in every lane are faces; the rest are small dots whose
// face and name appear on hover, focus or tap. The seasons the table is
// showing are tinted. Pointing at a player lights up every season he has on
// the chart.

export const HISTORY_LANE_SIZE = 50;
export const HISTORY_LANE_FACES = 15;

/**
 * Every mark the chart draws, and where each one stands.
 *
 * `lanes` is `[{ season, rows }]` with each lane's rows best first. A lane that
 * came back full may have left players out, and every one of them is worth no
 * more than the last player it kept, so a player-season's place among all the
 * seasons is only exact when he is worth at least the highest of those
 * "last kept" values (`bound`). Below it, `place` is null and the chart says
 * only where he stood in his own season.
 */
export function historyLaneModel(lanes, field, { laneSize = HISTORY_LANE_SIZE, faces = HISTORY_LANE_FACES } = {}) {
  const entries = [];
  let bound = Number.NEGATIVE_INFINITY;
  // A player's name can be spelled differently in different seasons
  // ("Jokic", later "Jokić"); the chart uses the newest spelling everywhere.
  const newestName = new Map();
  for (const lane of lanes ?? []) {
    for (const row of lane.rows ?? []) newestName.set(String(row?.player_id), row?.player_name);
  }
  (lanes ?? []).forEach((lane, laneIndex) => {
    const rows = (lane.rows ?? [])
      .filter((row) => Number.isFinite(Number(row?.[field])))
      .slice(0, laneSize);
    if (rows.length >= laneSize) bound = Math.max(bound, Number(rows.at(-1)[field]));
    rows.forEach((row, index) => entries.push({
      row: { ...row, player_name: newestName.get(String(row.player_id)) ?? row.player_name },
      season: lane.season, laneIndex, value: Number(row[field]),
      seasonRank: index + 1, face: index < faces,
    }));
  });
  const values = entries.map((entry) => entry.value).sort((left, right) => right - left);
  for (const entry of entries) {
    entry.place = entry.value >= bound
      ? values.findIndex((value) => value <= entry.value) + 1
      : null;
  }
  // Every player-season the statistic has in these seasons, drawn or not.
  const seasonTotals = (lanes ?? []).map((lane) => Number(lane.total_count));
  const population = seasonTotals.every(Number.isFinite) ? seasonTotals.reduce((sum, value) => sum + value, 0) : null;
  return { entries, bound, total: entries.length, population };
}

// Round tick values (steps of 1, 2, 2.5 or 5 times a power of ten) across a
// domain, about `target` of them.
export function roundTicks(low, high, target = 6) {
  const span = Number(high) - Number(low);
  if (!Number.isFinite(span) || span <= 0) return [Number(low)];
  const rough = span / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const ticks = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

function ordinal(value) {
  const n = Math.abs(Math.round(Number(value)));
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th";
  return `${n}${tail}`;
}

// The seasons the combined row draws: the reader's choice, kept to seasons the
// chart has, and every season when nothing (or nothing valid) is chosen.
export function chosenHistorySeasons(allSeasons, chosen) {
  const available = [...(allSeasons ?? [])];
  if (!Array.isArray(chosen) || !chosen.length) return available;
  const wanted = new Set(chosen);
  const kept = available.filter((season) => wanted.has(season));
  return kept.length ? kept : available;
}

// How a set of seasons reads in a sentence: a run as "A to B", a few as a
// list, more than four scattered ones as "N seasons from A to B".
export function seasonSpanWords(seasons, allSeasons) {
  const list = [...(seasons ?? [])];
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  const order = [...(allSeasons ?? list)];
  const first = order.indexOf(list[0]);
  const last = order.indexOf(list.at(-1));
  const contiguous = first >= 0 && last - first + 1 === list.length;
  if (contiguous) return `${list[0]} to ${list.at(-1)}`;
  if (list.length <= 4) return list.join(", ");
  return `${list.length} seasons from ${list[0]} to ${list.at(-1)}`;
}

// A season picker in the same shape as the rankings table's: shortcuts, one
// box per season, and an Apply button, so nothing redraws until the reader
// has finished choosing.
function historySeasonPicker(allSeasons, chosen, onApply) {
  const picker = document.createElement("details");
  picker.className = "season-ranking-picker chart-season-picker";
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.textContent = chosen.length === allSeasons.length
    ? `All ${allSeasons.length} seasons`
    : `${chosen.length} of ${allSeasons.length} seasons`;
  const chevron = document.createElement("span");
  chevron.className = "season-picker-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";
  summary.append(label, chevron);
  summary.setAttribute("aria-label", `Seasons in the combined row: ${label.textContent}`);
  const panel = document.createElement("div");
  panel.className = "season-picker-panel";
  const shortcuts = document.createElement("div");
  shortcuts.className = "season-picker-shortcuts";
  shortcuts.setAttribute("aria-label", "Season range shortcuts");
  const boxes = document.createElement("div");
  boxes.className = "season-ranking-checkboxes";
  boxes.setAttribute("role", "group");
  boxes.setAttribute("aria-label", "Seasons in the combined row");
  const selected = new Set(chosen);
  for (const season of allSeasons) {
    const option = document.createElement("label");
    option.className = "season-ranking-option";
    option.innerHTML = `<input type="checkbox" value="${escapeHtml(season)}"${selected.has(season) ? " checked" : ""}/><span>${escapeHtml(season)}</span>`;
    boxes.append(option);
  }
  const inputs = () => [...boxes.querySelectorAll("input")];
  const status = document.createElement("p");
  status.className = "season-picker-status";
  status.setAttribute("aria-live", "polite");
  const setChecked = (seasons) => {
    const wanted = new Set(seasons);
    inputs().forEach((input) => { input.checked = wanted.has(input.value); });
    status.textContent = "";
  };
  for (const [name, seasons] of [
    ["All", allSeasons],
    ["First 5", allSeasons.slice(0, 5)],
    ["Last 5", allSeasons.slice(-5)],
    ["Unselect all", []],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.addEventListener("click", () => setChecked(seasons));
    shortcuts.append(button);
  }
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "season-picker-apply";
  apply.textContent = "Apply seasons";
  apply.addEventListener("click", () => {
    const picked = inputs().filter((input) => input.checked).map((input) => input.value);
    if (!picked.length) {
      status.textContent = "Choose at least one season before applying.";
      return;
    }
    picker.open = false;
    onApply(picked.length === allSeasons.length ? null : picked);
  });
  panel.append(shortcuts, boxes, status, apply);
  picker.append(summary, panel);
  return picker;
}

// The every-season chart packs 15 faces into each season's row, so its faces
// are smaller than the scatter charts'.
export const HISTORY_FACE_RADIUS = 14;
export const HISTORY_FACE_RADIUS_NARROW = 10;
export const HISTORY_COMBINED_FACE_RADIUS = 22;
export const HISTORY_COMBINED_FACE_RADIUS_NARROW = 14;

// In one combined row this many of the best player-seasons are faces.
export const HISTORY_COMBINED_FACES = 50;

function renderSeasonHistory(payload) {
  const container = document.querySelector("#rankings-history-chart");
  if (!container) return;
  const fields = metricFields(payload);
  const allLanes = payload.history_lanes ?? [];
  const allSeasons = allLanes.map((lane) => lane.season);
  const combined = chartView("season-history").layout === "combined";
  // The combined row can be narrowed to chosen seasons; one row per season
  // always shows them all.
  const chosenSeasons = combined ? chosenHistorySeasons(allSeasons, chartView("season-history").seasons) : allSeasons;
  const chosenSet = new Set(chosenSeasons);
  const lanes = allLanes.filter((lane) => chosenSet.has(lane.season));
  const narrowed = lanes.length < allLanes.length;
  const controls = chartControls(container);
  const schedule = historySchedule();
  const scheduleWords = ({ "Regular Season": " in the regular season", Postseason: " in the postseason" })[schedule] ?? "";
  controls.append(
    breakdownControl("season-history", payload),
    segmentedControl({
      label: "Schedule",
      options: HISTORY_SCHEDULES,
      value: schedule,
      onChange: (next) => setChartView("season-history", { schedule: next }),
    }),
    switchControl({
      label: "Combine seasons into one row",
      checked: combined,
      onChange: (on) => setChartView("season-history", { layout: on ? "combined" : "separate" }),
    }),
  );
  if (combined) {
    controls.append(historySeasonPicker(allSeasons, chosenSeasons,
      (seasons) => setChartView("season-history", { seasons })));
  }
  const selected = new Set(payload.selected_seasons ?? (payload.season && payload.season !== "All Seasons" ? [payload.season] : []));
  const model = historyLaneModel(lanes, fields.total);
  if (!model.entries.length) {
    container.innerHTML = '<p class="rankings-chart-empty">No seasons have players to compare in this view.</p>';
    return;
  }
  const span = seasonSpanWords(chosenSeasons, allSeasons);
  // One row holds every lane's marks; its faces are the best player-seasons
  // of all, not each season's own top ten.
  if (combined) {
    const best = new Set([...model.entries].sort((left, right) => right.value - left.value)
      .slice(0, HISTORY_COMBINED_FACES));
    for (const entry of model.entries) {
      entry.drawLane = 0;
      entry.face = best.has(entry);
    }
  } else {
    for (const entry of model.entries) entry.drawLane = entry.laneIndex;
  }
  const rowsDrawn = combined ? [{ season: span }] : lanes;
  const width = Math.max(320, Math.floor(container.getBoundingClientRect().width || container.clientWidth || 900));
  const narrow = width < 560;
  const laneHeight = combined ? (narrow ? 300 : 420) : (narrow ? 60 : 86);
  // One combined row has room to spare, so its faces are larger.
  const faceRadius = combined
    ? (narrow ? HISTORY_COMBINED_FACE_RADIUS_NARROW : HISTORY_COMBINED_FACE_RADIUS)
    : (narrow ? HISTORY_FACE_RADIUS_NARROW : HISTORY_FACE_RADIUS);
  const dotRadius = narrow ? 3.5 : 4.5;
  const margin = {
    top: combined ? 30 : 12, right: narrow ? 14 : 28, bottom: 52,
    left: combined ? (narrow ? 14 : 28) : (narrow ? 70 : 76),
  };
  const height = margin.top + margin.bottom + laneHeight * rowsDrawn.length;
  const xScale = linearScale(paddedDomain(model.entries.map((entry) => entry.value), { padding: 0.04 }), margin.left, width - margin.right);
  const chart = svg("svg", {
    viewBox: `0 0 ${width} ${height}`, role: "img",
    "aria-label": combined
      ? `Every season's top ${HISTORY_LANE_SIZE} players by ${fields.label}, ${span}, in one row`
      : `Each season's top ${HISTORY_LANE_SIZE} players by ${fields.label}, one row per season`,
  });
  chart.append(svg("rect", {
    x: margin.left, y: margin.top, width: width - margin.left - margin.right,
    height: laneHeight * rowsDrawn.length, class: "chart-frame",
  }));
  for (const value of roundTicks(xScale.low, xScale.high, narrow ? 4 : 7)) {
    const x = xScale.map(value);
    chart.append(svg("line", { x1: x, x2: x, y1: margin.top, y2: height - margin.bottom, class: "grid" }));
    chart.append(svg("text", { x, y: height - margin.bottom + 20, "text-anchor": "middle" }, Number.isInteger(value) ? String(value) : number(value, 1)));
  }
  chart.append(svg("text", {
    x: (margin.left + width - margin.right) / 2, y: height - 12, "text-anchor": "middle", class: "axis-title",
  }, fields.label));
  const laneCenter = (laneIndex) => margin.top + laneHeight * (laneIndex + 0.5);
  if (combined) {
    chart.append(svg("text", { x: margin.left, y: margin.top - 10, class: "history-lane-label" }, `${span}, all in one row`));
  } else {
    lanes.forEach((lane, laneIndex) => {
      const top = margin.top + laneHeight * laneIndex;
      const isSelected = selected.has(lane.season);
      chart.append(svg("rect", {
        x: margin.left, y: top, width: width - margin.left - margin.right, height: laneHeight,
        class: `history-lane-band${isSelected ? " is-selected" : ""}${laneIndex % 2 ? " is-odd" : ""}`,
      }));
      chart.append(svg("text", {
        x: margin.left - 8, y: laneCenter(laneIndex) + 4, "text-anchor": "end",
        class: `history-lane-label${isSelected ? " is-selected" : ""}`,
      }, lane.season));
    });
  }
  // Dots first, faces on top, and within the faces the best last, so a
  // season's leader is never covered by the players below.
  const dots = model.entries.filter((entry) => !entry.face);
  const faces = model.entries.filter((entry) => entry.face)
    .sort((left, right) => (combined ? left.value - right.value : right.seasonRank - left.seasonRank));
  const offsetsFor = (group, radius) => {
    const offsets = new Map();
    rowsDrawn.forEach((_, laneIndex) => {
      const inLane = group.filter((entry) => entry.drawLane === laneIndex);
      const shifts = beeswarmOffsets(inLane.map((entry) => xScale.map(entry.value)), {
        radius, maxOffset: laneHeight / 2 - radius - 1,
      });
      inLane.forEach((entry, index) => offsets.set(entry, shifts[index]));
    });
    return offsets;
  };
  const dotOffsets = offsetsFor(dots, dotRadius);
  const faceOffsets = offsetsFor(faces, faceRadius);
  const detail = (entry) => {
    const where = entry.place
      ? `${ordinal(entry.place)} of ${model.population
        ? `${model.population.toLocaleString("en-US")} player-seasons ${narrowed ? `in ${span}` : `since ${lanes[0].season}`}`
        : "every season on this chart"}`
      : `inside ${entry.season}'s top ${HISTORY_LANE_SIZE}`;
    return `${entry.season} · ${number(entry.value, 3)} ${fields.short} · ${ordinal(entry.seasonRank)} that season · ${where}`;
  };
  let markIndex = 0;
  const draw = (entry, { radius, offset, face }) => {
    const isSelected = selected.has(entry.season);
    appendPlayerFace(chart, entry.row, {
      x: xScale.map(entry.value), y: laneCenter(entry.drawLane) + offset, radius,
      payload: { ...payload, selected_seasons: [entry.season] },
      detail: detail(entry), index: markIndex += 1,
      color: face ? FACE_BACKGROUND : (isSelected ? "#2c7bb6" : "#a19f96"),
      withImage: face, dim: !face, hoverFace: true,
    });
  };
  dots.forEach((entry) => draw(entry, { radius: dotRadius, offset: dotOffsets.get(entry) ?? 0, face: false }));
  faces.forEach((entry) => draw(entry, { radius: faceRadius, offset: faceOffsets.get(entry) ?? 0, face: true }));

  const status = document.createElement("div");
  status.className = "rankings-chart-hover";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const defaultStatus = "<strong>Pick a player on the chart</strong><span>Point at a face or dot, tap it, or move the keyboard focus to it. Every season that player has on the chart lights up.</span>";
  status.innerHTML = defaultStatus;
  const search = document.createElement("div");
  search.className = "chart-player-search";
  search.innerHTML = '<label for="rankings-history-search">Find a player on this chart</label><div><input id="rankings-history-search" type="search" autocomplete="off" placeholder="Player name"/><button type="button">Clear</button></div>';
  const note = document.createElement("p");
  note.className = "chart-drawn-note";
  note.textContent = combined
    ? `Each season's top ${HISTORY_LANE_SIZE} by ${fields.label}${scheduleWords} in one row, ${span}. The best ${Math.min(HISTORY_COMBINED_FACES, model.entries.length)} player-seasons are faces${selected.size ? "; blue dots are the seasons the table is showing" : ""}.`
    : `Each row is one season's top ${HISTORY_LANE_SIZE} by ${fields.label}${scheduleWords}. The top ${HISTORY_LANE_FACES} of every season are faces${selected.size ? "; the seasons the table is showing are shaded" : ""}.`;
  container.replaceChildren(search, note, chart, status);
  bindSeasonHistoryHighlight(container, status, defaultStatus, search, model, fields);
  const tableRows = model.entries.filter((entry) => entry.seasonRank <= HISTORY_LANE_FACES)
    .sort((left, right) => left.laneIndex - right.laneIndex || left.seasonRank - right.seasonRank);
  const fallback = document.querySelector("#rankings-history-table");
  if (fallback) {
    fallback.innerHTML = `<details><summary>View every season's top ${HISTORY_LANE_FACES} as a table</summary><table><thead><tr><th>Season</th><th>Rank</th><th>Player</th><th>${fields.short}</th><th>Place on the chart</th></tr></thead><tbody>${tableRows.map((entry) => `<tr><td>${escapeHtml(entry.season)}</td><td>${entry.seasonRank}</td><th><a href="${playerHref(entry.row, { ...payload, selected_seasons: [entry.season] })}">${escapeHtml(entry.row.player_name)}</a></th><td>${number(entry.value)}</td><td>${entry.place ? ordinal(entry.place) : "—"}</td></tr>`).join("")}</tbody></table></details>`;
  }
}

// Pointing at one mark lights up every season that player has on the chart,
// and the panel under the chart lists them. A name found with the search box
// stays lit until the box is cleared.
function bindSeasonHistoryHighlight(container, status, defaultStatus, search, model, fields) {
  const marks = [...container.querySelectorAll("[data-player-mark]")];
  const seasonsOf = new Map();
  for (const entry of model.entries) {
    const key = String(entry.row.player_id);
    if (!seasonsOf.has(key)) seasonsOf.set(key, []);
    seasonsOf.get(key).push(entry);
  }
  const careerLine = (playerId) => (seasonsOf.get(playerId) ?? [])
    .slice().sort((left, right) => left.laneIndex - right.laneIndex)
    .map((entry) => `${entry.season} ${ordinal(entry.seasonRank)} (${number(entry.value, 2)})`).join(" · ");
  let selected = null;
  const apply = (mark) => {
    const playerId = mark?.dataset.playerMark ?? null;
    container.classList.toggle("has-mark-highlight", Boolean(playerId));
    marks.forEach((item) => {
      const same = playerId !== null && item.dataset.playerMark === playerId;
      item.classList.toggle("is-highlighted", same);
      item.classList.toggle("is-muted", playerId !== null && !same);
    });
    if (!mark) { status.innerHTML = defaultStatus; return; }
    const count = seasonsOf.get(playerId)?.length ?? 0;
    status.innerHTML = `${mark.dataset.hoverHtml}<span class="history-career-line">${count > 1 ? `${count} seasons on this chart: ` : ""}${escapeHtml(careerLine(playerId))}</span>`;
  };
  const release = () => apply(selected);
  marks.forEach((mark) => {
    mark.addEventListener("click", (event) => {
      if (!tapsShowHover()) return;
      event.preventDefault();
      selected = selected === mark ? null : mark;
      apply(selected);
    });
    mark.addEventListener("pointerenter", () => apply(mark));
    mark.addEventListener("pointerleave", release);
    mark.addEventListener("focusin", () => apply(mark));
    mark.addEventListener("focusout", release);
    mark.addEventListener("touchend", release, { passive: true });
    mark.addEventListener("touchcancel", release, { passive: true });
  });
  container.addEventListener("pointerleave", release);
  const input = search.querySelector("input");
  const clear = search.querySelector("button");
  const find = () => {
    const raw = input.value.trim();
    const query = foldName(raw);
    if (!query) { selected = null; apply(null); return; }
    // The first season a match has, so a player's whole run lights up.
    const match = marks.find((mark) => foldName(mark.dataset.playerName) === query)
      ?? marks.find((mark) => foldName(mark.dataset.playerName).startsWith(query))
      ?? marks.find((mark) => foldName(mark.dataset.playerName).includes(query));
    if (!match) {
      selected = null;
      apply(null);
      status.innerHTML = `<strong>No chart match</strong><span>No player on this chart matches “${escapeHtml(raw)}”. Only each season's top ${HISTORY_LANE_SIZE} by ${escapeHtml(fields.label)} are drawn.</span>`;
      return;
    }
    selected = match;
    apply(selected);
  };
  input.addEventListener("input", find);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    find();
  });
  clear.addEventListener("click", () => {
    input.value = "";
    selected = null;
    apply(null);
    input.focus();
  });
}

// --- V13: area maps and groupings ---------------------------------------------
//
// Two charts only V13 has. V13 labels every typed player season four times —
// scoring, playmaking, rebounding and defense, each part grouped on its own —
// and the four labels together are his exact type. Players with the same four
// labels share a type, and every exact type sits whole inside one of V13's
// looser groupings.
//
// Both charts draw exactly the typed players the table is showing, the same way
// the type map chooses them (describedRowsForScope, capped at CHART_MARK_CAP).
// The maps themselves are the catalogue's (`player_types.v13.maps`), built with
// the catalogue's own rules (`map_rules`), so nothing here names a measure: a
// map is a list of terms, each term a plain sum of the values it names.

export const V13_ONLY_PANEL_KEYS = Object.freeze(["area-maps", "groupings", "type-trends"]);

// What one reference names on a V13 row: `<area>.<key>` is a measure,
// `context.<key>` a context value, `plane.<name>.<0|1>` a stored map place.
export function v13RefValue(row, ref) {
  const v13 = row?.v13;
  if (!v13) return null;
  const [head, key, index] = String(ref ?? "").split(".");
  let value;
  if (head === "context") value = v13.context?.[key];
  else if (head === "plane") value = v13.maps?.[key]?.[Number(index)];
  else value = v13.measures?.[head]?.[key];
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// A term is the plain sum of what its references name, and missing when any
// one of them is.
export function v13TermValue(row, term) {
  const refs = term?.refs ?? [];
  if (!refs.length) return null;
  let total = 0;
  for (const ref of refs) {
    const value = v13RefValue(row, ref);
    if (value === null) return null;
    total += value;
  }
  return total;
}

// Standard units among the players drawn. The values are first held inside
// the players' own 1st and 99th places (sorted values v: v[floor(n × .01)] and
// v[ceil(n × .99) − 1]), so one extreme season cannot squeeze everybody else
// into a corner; the spread is the population standard deviation, and 1 when
// every value is the same.
export function v13StandardUnits(values) {
  const sorted = (values ?? []).map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return () => 0;
  const low = sorted[Math.floor(sorted.length * 0.01)];
  const high = sorted[Math.ceil(sorted.length * 0.99) - 1];
  const clip = (value) => Math.min(high, Math.max(low, value));
  const clipped = sorted.map(clip);
  const mean = clipped.reduce((sum, value) => sum + value, 0) / clipped.length;
  const spread = Math.sqrt(clipped.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clipped.length) || 1;
  return (value) => (clip(Number(value)) - mean) / spread;
}

// One direction of a map from each drawn player's term values.
//   stored   the stored value as it is;
//   raw_sum  the weighted sum of the terms (and, with `std`, in standard units);
//   std_mix  each term in standard units, the weighted sum, and that sum put
//            back in standard units, so both directions use the same scale.
function v13Direction(termRows, direction, std) {
  const weights = (direction?.terms ?? []).map((term) => (
    Number.isFinite(Number(term?.weight)) ? Number(term.weight) : 1
  ));
  const combine = String(direction?.combine ?? "raw_sum");
  if (combine === "std_mix") {
    const scaled = weights.map((_, column) => {
      const values = termRows.map((terms) => terms[column]);
      const units = v13StandardUnits(values);
      return values.map(units);
    });
    const summed = termRows.map((_, index) => weights.reduce(
      (sum, weight, column) => sum + weight * scaled[column][index], 0,
    ));
    const units = v13StandardUnits(summed);
    return summed.map(units);
  }
  const summed = termRows.map((terms) => weights.reduce((sum, weight, column) => sum + weight * terms[column], 0));
  if (combine === "raw_sum" && std) {
    const units = v13StandardUnits(summed);
    return summed.map(units);
  }
  return summed;
}

// Where every player lands on one catalogue map. Players outside the map's
// subset, and players missing any value an axis needs, are left off; every
// standard unit is then measured among the players who are left.
export function v13MapPoints(rows, map) {
  const perimeter = String(map?.subset ?? "all") === "perimeter";
  const eligible = (rows ?? []).filter((row) => row?.v13
    && (!perimeter || Number(row.v13.areas?.defense?.index) !== 0));
  const directions = [map?.x, map?.y];
  const kept = [];
  const termRows = [[], []];
  for (const row of eligible) {
    const terms = directions.map((direction) => (direction?.terms ?? []).map((term) => v13TermValue(row, term)));
    if (terms.some((values) => !values.length || values.some((value) => value === null))) continue;
    kept.push(row);
    terms.forEach((values, axis) => termRows[axis].push(values));
  }
  const std = Boolean(map?.std);
  const [x, y] = directions.map((direction, axis) => v13Direction(termRows[axis], direction, std));
  const size = map?.size_by ? kept.map((row) => v13RefValue(row, map.size_by)) : null;
  return { rows: kept, x, y, size };
}

// The share of drawn players whose nearest group middle (the mean place of a
// group on this map) is their own group's, as a whole percentage.
export function v13NearestOwnShare(x, y, groups) {
  const count = Math.min(x?.length ?? 0, y?.length ?? 0, groups?.length ?? 0);
  if (!count) return null;
  const ids = [...new Set(groups.slice(0, count))];
  const middles = ids.map((id) => {
    let sx = 0; let sy = 0; let n = 0;
    for (let index = 0; index < count; index += 1) {
      if (groups[index] !== id) continue;
      sx += x[index]; sy += y[index]; n += 1;
    }
    return [sx / n, sy / n];
  });
  let near = 0;
  for (let index = 0; index < count; index += 1) {
    let best = 0; let bestDistance = Infinity;
    middles.forEach(([mx, my], place) => {
      const distance = (x[index] - mx) ** 2 + (y[index] - my) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = place; }
    });
    if (ids[best] === groups[index]) near += 1;
  }
  return Math.round(100 * near / count);
}

// Two player seasons share an exact type only inside one season: the same four
// labels in two different seasons are two types.
export function v13ExactKey(row) {
  return `${row?.season_end_year ?? ""}:${row?.v13?.exact_type ?? ""}`;
}

function v13Wins(row) {
  return finite(row?.v13?.wins_contributed, finite(row?.wins_contributed));
}

// The grouping cards: one per grouping with anyone in it, ordered by the wins
// its players add up to. Inside a card, each exact type two or more of these
// players share is a row of its own (largest first), and the players nobody
// here shares four labels with come last.
export function v13GroupingCards(rows, catalogue) {
  const known = catalogue?.groupings?.groups ?? [];
  const cards = new Map(known.map((group) => [String(group.id), { group, rows: [] }]));
  for (const row of rows ?? []) {
    const block = row?.v13?.grouping;
    if (!block) continue;
    const id = String(block.id);
    if (!cards.has(id)) cards.set(id, { group: { ...block, makeup: [] }, rows: [] });
    cards.get(id).rows.push(row);
  }
  const byWins = (left, right) => v13Wins(right) - v13Wins(left)
    || String(left.player_name ?? "").localeCompare(String(right.player_name ?? ""));
  const total = (list) => list.reduce((sum, row) => sum + v13Wins(row), 0);
  return [...cards.values()]
    .filter((card) => card.rows.length)
    .map(({ group, rows: members }) => {
      const ordered = [...members].sort(byWins);
      const types = new Map();
      for (const row of ordered) {
        const key = v13ExactKey(row);
        if (!types.has(key)) types.set(key, []);
        types.get(key).push(row);
      }
      const shared = [...types.entries()].filter(([, list]) => list.length > 1)
        .map(([key, list]) => ({ key, rows: list, wins: total(list) }))
        .sort((left, right) => right.rows.length - left.rows.length || right.wins - left.wins
          || left.key.localeCompare(right.key));
      const alone = [...types.values()].filter((list) => list.length === 1).map((list) => list[0]).sort(byWins);
      return {
        id: String(group.id), label: String(group.label ?? group.id), color: group.color ?? null,
        makeup: group.makeup ?? [], rows: ordered, wins: total(ordered), shared, alone,
      };
    })
    .sort((left, right) => right.wins - left.wins || left.label.localeCompare(right.label));
}

// The typed players the table is showing: the type map's own choice of one
// described season per player, in the table's order, keeping only the seasons
// V13 typed and capped like every other chart.
export function v13ScopedRows(styleRowsList, tableRows, { cap = CHART_MARK_CAP } = {}) {
  const scope = describedRowsForScope(styleRowsList, tableRows);
  const typed = scope.filter((row) => row?.v13);
  return { rows: scopedRows(typed, { cap }), typed: typed.length, available: (tableRows ?? []).length };
}

// Game DNA draws one map per part of the game (owner's note, 2026-09-27):
// scoring has only its group map; playmaking the map drawn to pull its groups
// apart; rebounding its two widest spreads; defense the map of every player,
// paint anchors included. A catalogue without one of these falls back to its
// first map rather than drawing nothing.
export const V13_AREA_MAP = Object.freeze({
  scoring: "groups", playmaking: "spreads", rebounding: "spreads", defense: "all",
});

const v13View = { area: null, callout: true, pick: null, find: "", open: null };

// How many of the season's most valuable players (by Value Contributed) are
// drawn as faces on each Game DNA map; everyone else stays a dot.
export const V13_DNA_FACES = 20;
let v13FaceClip = 0;

function v13Short(label) {
  return String(label ?? "").split(":")[0];
}

function v13AreaGroups(catalogue, area) {
  return catalogue?.areas?.[area]?.groups ?? [];
}

function v13AreaColour(catalogue, area, index, fallback = null) {
  const group = v13AreaGroups(catalogue, area).find((entry) => Number(entry.index) === Number(index));
  return publishedColour(group?.color) ?? publishedColour(fallback) ?? "#8b8b8b";
}

function v13Scope(payload) {
  const landscape = payload?.player_landscape ?? null;
  const catalogue = landscape?.player_types?.v13 ?? null;
  if (!landscape || !catalogue) return { landscape, catalogue, rows: [], typed: 0, available: 0 };
  const every = styleRows(landscape, styleCatalog(landscape.player_types), { kind: "player" });
  return { landscape, catalogue, ...v13ScopedRows(every, payload?.rows ?? []) };
}

// The sentence each V13 chart opens with: how many of the players the table is
// showing have a V13 type, and how many of them are drawn.
export function v13ScopeSentence(drawn, typed, available, {
  minimum = 500, basis = "competitive regular-season minutes",
  subject = chartScope.subject, order = chartScope.order,
} = {}) {
  const rule = `at least ${number(minimum, 0)} ${basis}`;
  const head = typed === available
    ? `All ${available} players ${subject} have a V13 type (${rule})`
    : `${typed} of the ${available} players ${subject} have a V13 type (${rule})`;
  if (!typed) return `None of the ${available} players ${subject} has a V13 type yet: a type needs ${rule}.`;
  return drawn < typed
    ? `${head}; the first ${drawn} in ${order} are drawn.`
    : `${head}; ${typed === 1 ? "he is" : "all of them are"} drawn.`;
}

function v13EmptyNote(container, text) {
  container.innerHTML = `<p class="rankings-chart-empty">${escapeHtml(text)}</p>`;
}

// Nothing to draw yet, or nothing V13 can draw: say which, once.
function v13Unavailable(container, payload, scope) {
  if (String(payload?.stat_version ?? "") !== "v13") {
    container.replaceChildren();
    return true;
  }
  if (!scope.landscape) {
    v13EmptyNote(container, "Reading V13's player types…");
    return true;
  }
  if (!scope.catalogue) {
    v13EmptyNote(container, "V13 player types have not been built yet.");
    return true;
  }
  return false;
}

function v13ScopeLine(scope) {
  const types = scope.landscape?.player_types ?? {};
  return `<p class="v13-scope">${escapeHtml(v13ScopeSentence(scope.rows.length, scope.typed, scope.available, {
    minimum: finite(types.minimum_minutes, 500),
    basis: String(scope.catalogue?.basis ?? types.basis ?? "competitive regular-season minutes"),
  }))}</p>`;
}

function v13Segment(name, label, options, current) {
  return `<div><span class="v13-seg-label">${escapeHtml(label)}</span><span class="v13-seg" role="group" aria-label="${escapeHtml(label)}">${options.map(([value, text]) => `<button type="button" data-${name}="${escapeHtml(value)}" aria-pressed="${String(value === current)}">${escapeHtml(text)}</button>`).join("")}</span></div>`;
}

// The hover card of one player on an area map.
function v13TipHtml(row, catalogue) {
  const v13 = row.v13;
  const others = Math.max(0, finite(v13.exact_type_size, 1) - 1);
  const seasonWords = row.season ? ` · ${row.season}` : "";
  const shared = others
    ? `Shares his exact type with ${others} other${others === 1 ? "" : "s"}${row.season ? " that season" : ""}`
    : "One of a kind: no one else has all four of his labels";
  const labels = (catalogue.order ?? []).map((area) => {
    const block = v13.areas?.[area] ?? {};
    return `<li><span>${escapeHtml(catalogue.titles?.[area] ?? area)}</span><i style="background:${v13AreaColour(catalogue, area, block.index, block.color)}"></i>${escapeHtml(block.label ?? "—")}</li>`;
  }).join("");
  return `<strong>${escapeHtml(row.display_name ?? row.player_name)}</strong><span>${escapeHtml(teamsOf(row))}${escapeHtml(seasonWords)}</span>`
    + `<b class="v13-tip-shared">${escapeHtml(shared)}</b><ul>${labels}</ul>`
    + `<dl><dt>Grouping</dt><dd>${escapeHtml(v13.grouping?.label ?? "—")}</dd><dt>Wins Contributed</dt><dd>${number(v13Wins(row), 2)}</dd></dl>`;
}

function v13Median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

// A measured scatter: one unit across is the same length as one unit up, the
// group names sit at their groups' medians (pushed apart where they collide),
// and pointing at or tapping near a player opens his card.
function v13Scatter(plot, { rows, x, y, groupOf, colourOf, labels, radiusOf, tipHtml, ariaLabel, faceOf = null }) {
  plot.querySelector("svg")?.remove();
  const tip = plot.querySelector(".v13-tip");
  const width = Math.max(280, Math.floor(plot.getBoundingClientRect().width || plot.clientWidth || 900));
  const small = width < 560;
  const height = Math.round(Math.min(640, Math.max(small ? 340 : 400, width * 0.62)));
  const margin = { top: 12, right: 14, bottom: 12, left: 14 };
  const padded = (values) => {
    const low = Math.min(...values); const high = Math.max(...values);
    const span = high - low || 1;
    return [low - span * 0.04, high + span * 0.04];
  };
  const [x0, x1] = padded(x);
  const [y0, y1] = padded(y);
  const unit = Math.min((width - margin.left - margin.right) / (x1 - x0), (height - margin.top - margin.bottom) / (y1 - y0));
  const ox = margin.left + ((width - margin.left - margin.right) - unit * (x1 - x0)) / 2;
  const oy = margin.top + ((height - margin.top - margin.bottom) - unit * (y1 - y0)) / 2;
  const X = (value) => ox + (value - x0) * unit;
  const Y = (value) => oy + (y1 - value) * unit;
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": ariaLabel });
  const faced = [];
  const points = rows.map((row, index) => {
    const cx = X(x[index]); const cy = Y(y[index]);
    if (faceOf?.(row, index)) {
      const point = { x: cx, y: cy, row, node: null };
      faced.push(point);
      return point;
    }
    const node = svg("circle", {
      class: "v13-dot", cx: cx.toFixed(1), cy: cy.toFixed(1), r: radiusOf(row, index, small).toFixed(1),
      fill: colourOf(row), "data-type": String(groupOf(row)),
    });
    chart.append(node);
    return { x: cx, y: cy, row, node };
  });
  // The faces go on top of every dot, least valuable first, so the most
  // valuable player is never covered; the group names still go over them.
  if (faced.length) {
    const defs = svg("defs");
    chart.append(defs);
    const faceRadius = small ? 9 : 13;
    faced.sort((left, right) => finite(left.row.value_contributed) - finite(right.row.value_contributed));
    for (const point of faced) {
      v13FaceClip += 1;
      const clipId = `v13-face-clip-${v13FaceClip}`;
      const clip = svg("clipPath", { id: clipId });
      clip.append(svg("circle", { cx: 0, cy: 0, r: faceRadius - 1.5 }));
      defs.append(clip);
      const colour = colourOf(point.row);
      const node = svg("g", {
        class: "v13-dot v13-dot-face", "data-type": String(groupOf(point.row)),
        transform: `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`,
      });
      node.append(svg("circle", { cx: 0, cy: 0, r: faceRadius, fill: colour }));
      node.append(svg("image", {
        href: chartFaceUrl(point.row.player_id), x: -faceRadius, y: -faceRadius * .84,
        width: faceRadius * 2, height: faceRadius * 1.84,
        preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${clipId})`,
      }));
      node.append(svg("circle", { cx: 0, cy: 0, r: faceRadius, fill: "none", stroke: colour, "stroke-width": 2.5, class: "v13-face-ring" }));
      chart.append(node);
      point.node = node;
    }
  }
  if (labels?.length) {
    const size = small ? 11 : 12.5; const line = size + 5;
    const placed = labels.map((label) => {
      const own = rows.map((row, index) => index).filter((index) => groupOf(rows[index]) === label.index);
      if (!own.length) return null;
      return { ...label, x: X(v13Median(own.map((index) => x[index]))), y: Y(v13Median(own.map((index) => y[index]))) };
    }).filter(Boolean);
    for (let pass = 0; pass < 80; pass += 1) {
      let moved = false;
      for (let a = 0; a < placed.length; a += 1) {
        for (let b = a + 1; b < placed.length; b += 1) {
          const A = placed[a]; const B = placed[b];
          const across = (A.text.length + B.text.length) * size * 0.28 - Math.abs(A.x - B.x);
          const up = line - Math.abs(A.y - B.y);
          if (across > 0 && up > 0) {
            const push = (up / 2 + 0.5) * (A.y <= B.y ? -1 : 1);
            A.y += push; B.y -= push; moved = true;
          }
        }
      }
      if (!moved) break;
    }
    for (const label of placed) {
      const half = label.text.length * size * 0.28;
      chart.append(svg("text", {
        class: "v13-type-label", "text-anchor": "middle",
        x: Math.min(width - margin.right - half, Math.max(margin.left + half, label.x)).toFixed(1),
        y: Math.min(height - margin.bottom - 4, Math.max(margin.top + size, label.y)).toFixed(1),
        style: `fill:${label.color};font-size:${size}px`,
      }, label.text));
    }
  }
  plot.insertBefore(chart, tip);
  const hide = () => {
    tip.hidden = true;
    plot.classList.remove("has-hover");
    plot.querySelectorAll(".v13-dot.is-on").forEach((node) => node.classList.remove("is-on"));
  };
  const nearest = (event) => {
    const box = chart.getBoundingClientRect(); const scale = width / (box.width || width);
    const px = (event.clientX - box.left) * scale; const py = (event.clientY - box.top) * scale;
    let best = null; let bestDistance = (16 * scale) ** 2;
    for (const point of points) {
      const distance = (point.x - px) ** 2 + (point.y - py) ** 2;
      if (distance < bestDistance) { best = point; bestDistance = distance; }
    }
    return { best, box, scale };
  };
  const show = (event) => {
    const { best, box, scale } = nearest(event);
    plot.querySelectorAll(".v13-dot.is-on").forEach((node) => node.classList.remove("is-on"));
    if (!best) { hide(); return; }
    plot.classList.add("has-hover");
    best.node.classList.add("is-on");
    tip.innerHTML = tipHtml(best.row);
    tip.hidden = false;
    const frame = plot.getBoundingClientRect();
    const at = { x: best.x / scale + box.left - frame.left, y: best.y / scale + box.top - frame.top };
    const w = tip.offsetWidth; const h = tip.offsetHeight;
    let left = at.x + 14; let top = at.y + 14;
    if (left + w > frame.width) left = Math.max(0, at.x - w - 14);
    if (top + h > frame.height) top = Math.max(0, at.y - h - 14);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  // A mouse reads the map by moving across it; a finger reads it by tapping,
  // and the card stays until the next tap lands somewhere else.
  chart.addEventListener("pointermove", (event) => { if (event.pointerType !== "touch") show(event); });
  chart.addEventListener("pointerdown", show);
  chart.addEventListener("pointerleave", (event) => { if (event.pointerType !== "touch") hide(); });
  return chart;
}

function v13Legend(list, groups, counts) {
  list.innerHTML = groups.map((group) => `<li data-type="${Number(group.index)}" tabindex="0"><i style="background:${escapeHtml(group.colour)}"></i>${escapeHtml(group.label)} <small>${counts.get(Number(group.index)) ?? 0}</small></li>`).join("");
}

function v13BindLegend(list, plot) {
  const mark = (index) => {
    plot.classList.toggle("has-type", index !== null);
    plot.querySelectorAll(".v13-dot").forEach((node) => node.classList.toggle("in-type", Number(node.dataset.type) === index));
    list.querySelectorAll("li").forEach((item) => item.classList.toggle("is-dim", index !== null && Number(item.dataset.type) !== index));
  };
  list.querySelectorAll("li").forEach((item) => {
    const on = () => mark(Number(item.dataset.type));
    const off = () => mark(null);
    item.addEventListener("pointerenter", on);
    item.addEventListener("pointerleave", off);
    item.addEventListener("focus", on);
    item.addEventListener("blur", off);
  });
}

function renderV13AreaMaps(payload) {
  const container = document.querySelector("#rankings-area-maps-chart");
  if (!container) return;
  const scope = v13Scope(payload);
  if (v13Unavailable(container, payload, scope)) return;
  const { catalogue } = scope;
  const order = (catalogue.order ?? []).filter((area) => catalogue.areas?.[area]);
  if (!order.includes(v13View.area)) v13View.area = order[0];
  const area = v13View.area;
  const maps = catalogue.maps?.[area] ?? [];
  const map = maps.find((entry) => entry.key === V13_AREA_MAP[area]) ?? maps[0];
  const info = catalogue.areas[area];
  const groups = v13AreaGroups(catalogue, area).map((group) => ({
    index: Number(group.index), label: String(group.label), colour: v13AreaColour(catalogue, area, group.index),
  }));
  container.innerHTML = `<div class="v13-dna-tabs">${v13Segment("v13-area", "Part of the game", order.map((key) => [key, catalogue.titles?.[key] ?? info.title ?? key]), area)}</div>`
    + '<div class="v13-dna-frame"><ul class="v13-legend"></ul>'
    + '<p class="v13-axis-cap v13-axis-top"></p><div class="v13-plot"><div class="v13-tip" role="status" hidden></div></div><div class="v13-axis-bottom"></div></div>'
    + `<div class="v13-dna-details"></div>${v13ScopeLine(scope)}`;
  for (const button of container.querySelectorAll("[data-v13-area]")) {
    button.addEventListener("click", () => { v13View.area = button.dataset.v13Area; renderV13AreaMaps(payload); });
  }
  const indexOf = (row) => Number(row.v13?.areas?.[area]?.index);
  const counts = new Map();
  for (const row of scope.rows) counts.set(indexOf(row), (counts.get(indexOf(row)) ?? 0) + 1);
  const legend = container.querySelector(".v13-legend");
  v13Legend(legend, groups, counts);
  // What each group means: one closed drawer under the map, its cards in a
  // single row that scrolls sideways (owner's note, 2026-09-27).
  const groupBody = (group) => {
    const here = counts.get(Number(group.index)) ?? 0;
    const examples = (group.examples ?? []).slice(0, 3).join(", ");
    return `<b>${escapeHtml(group.label)}</b><small>${here} here</small>`
      + `${(group.defined ?? []).length ? `<em>${escapeHtml(group.defined.join(" · "))}</em>` : ""}`
      + `${examples ? `<span>e.g. ${escapeHtml(examples)}</span>` : ""}`;
  };
  const areaGroups = v13AreaGroups(catalogue, area);
  container.querySelector(".v13-dna-details").innerHTML = `<details class="v13-types-drawer"><summary>What each ${escapeHtml(String(info.title ?? area).toLocaleLowerCase())} group means <small>${areaGroups.length} groups</small></summary>`
    + `<div class="v13-types">${areaGroups.map((group) => `<div style="--group-colour:${escapeHtml(v13AreaColour(catalogue, area, group.index))}">${groupBody(group)}</div>`).join("")}</div></details>`;
  const plot = container.querySelector(".v13-plot");
  const placed = map ? v13MapPoints(scope.rows, map) : { rows: [], x: [], y: [], size: null };
  if (!placed.rows.length) {
    plot.innerHTML = '<p class="rankings-chart-empty">None of the players the table is showing can be placed on this map.</p>';
    return;
  }
  const axes = map.axes ?? [];
  const top = container.querySelector(".v13-axis-top");
  top.textContent = axes[1]?.high ? `↑ ${axes[1].high}` : "";
  top.hidden = !axes[1]?.high;
  container.querySelector(".v13-axis-bottom").innerHTML = `<p class="v13-axis-cap">${axes[0]?.low ? `← ${escapeHtml(axes[0].low)}` : ""}</p>`
    + `<p class="v13-axis-cap">${axes[1]?.low ? `↓ ${escapeHtml(axes[1].low)}` : ""}</p>`
    + `<p class="v13-axis-cap">${axes[0]?.high ? `${escapeHtml(axes[0].high)} →` : ""}</p>`
    // On a phone the "up" caption joins the other three in one column under
    // the plot (owner's note, 2026-09-28); a desktop keeps it above the plot.
    + `<p class="v13-axis-cap v13-axis-up">${axes[1]?.high ? `↑ ${escapeHtml(axes[1].high)}` : ""}</p>`;
  const faceKeys = new Set([...placed.rows]
    .sort((left, right) => finite(right.value_contributed) - finite(left.value_contributed))
    .slice(0, V13_DNA_FACES)
    .map((row) => `${row.player_id}:${row.season_end_year}`));
  const largestWins = Math.max(0.01, ...placed.rows.map((row) => Math.max(0, v13Wins(row))));
  const largestSize = placed.size ? Math.max(1e-9, ...placed.size.map((value) => Math.max(0, finite(value)))) : 1;
  v13Scatter(plot, {
    rows: placed.rows, x: placed.x, y: placed.y,
    groupOf: indexOf,
    colourOf: (row) => v13AreaColour(catalogue, area, indexOf(row), row.v13.areas?.[area]?.color),
    labels: map.labels ? groups.map((group) => ({ index: group.index, text: v13Short(group.label), color: group.colour })) : null,
    radiusOf: placed.size
      ? (row, index, small) => (small ? 2 : 2.5) + (small ? 5 : 7) * (Math.max(0, finite(placed.size[index])) / largestSize) ** 1.5
      : (row, index, small) => (small ? 2.4 : 3) + (small ? 3 : 4) * Math.sqrt(Math.max(0, v13Wins(row)) / largestWins),
    tipHtml: (row) => v13TipHtml(row, catalogue),
    ariaLabel: `${info.title ?? area} map, ${map.label}: ${placed.rows.length} players coloured by their ${String(info.title ?? area).toLocaleLowerCase()} group`,
    faceOf: (row) => faceKeys.has(`${row.player_id}:${row.season_end_year}`),
  });
  v13BindLegend(legend, plot);
}

function v13FaceButton(row) {
  const name = String(row.display_name ?? row.player_name ?? "");
  const parts = name.split(/\s+/u).filter(Boolean);
  const short = parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
  const key = `${row.player_id}:${row.season_end_year}`;
  return `<button type="button" class="v13-face" data-v13-player="${escapeHtml(key)}" data-v13-type="${escapeHtml(v13ExactKey(row))}" title="${escapeHtml(`${name} · ${number(v13Wins(row), 2)} wins`)}"><span class="v13-face-photo"><span>${escapeHtml(initials(name))}</span><img src="${headshotUrl(row.player_id)}" alt="" loading="lazy" decoding="async"></span>${escapeHtml(short)}</button>`;
}

function v13TypeCaption(row, catalogue) {
  return (catalogue.order ?? []).map((area) => v13Short(row.v13.areas?.[area]?.label)).join(" · ");
}

// Folded for a forgiving name search: no case, no accents.
function v13Fold(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/gu, "").toLocaleLowerCase();
}

// Groupings as a mosaic (owner's note, 2026-09-27): a tile per grouping with
// its five best faces, its size and its wins. Opening a tile shows its
// players directly under that tile's row, in a panel that scrolls on its own;
// opening it again, or "Close", folds it away. Specificity picks whether the
// players are split into exact types (the same four labels) or shown as one
// general set.
export const V13_SPECIFICITY = Object.freeze([["exact", "Exact"], ["general", "General"]]);

function renderV13Groupings(payload) {
  const container = document.querySelector("#rankings-groupings-chart");
  if (!container) return;
  const scope = v13Scope(payload);
  if (v13Unavailable(container, payload, scope)) return;
  const { catalogue } = scope;
  const cards = v13GroupingCards(scope.rows, catalogue);
  const palette = (catalogue.grouping_palette ?? []).map(publishedColour).filter(Boolean);
  const rowColour = (index) => (palette.length ? palette[index % palette.length] : "#8b8b8b");
  const cardColour = (card) => publishedColour(card.color) ?? "#8b8b8b";
  const mostWins = Math.max(0.01, ...cards.map((card) => card.wins));
  // Every grouping starts closed (owner's note, 2026-09-28); one opens when a
  // reader picks its tile or finds one of its players.
  if (!cards.some((card) => card.id === v13View.open)) v13View.open = null;

  const byKey = new Map(scope.rows.map((row) => [`${row.player_id}:${row.season_end_year}`, row]));
  const cardOf = new Map(cards.flatMap((card) => card.rows.map((row) => [`${row.player_id}:${row.season_end_year}`, card.id])));

  const inner = (card) => (v13View.callout
    ? card.shared.map((type, index) => `<div class="v13-type-row" style="border-left-color:${rowColour(index)}"><div class="v13-type-caption"><b>${type.rows.length} share a type:</b> ${escapeHtml(v13TypeCaption(type.rows[0], catalogue))}</div><div class="v13-faces">${type.rows.map(v13FaceButton).join("")}</div></div>`).join("")
      + (card.alone.length ? `<div class="v13-type-row"><div class="v13-type-caption"><b>One of a kind (${card.alone.length})</b></div><div class="v13-faces">${card.alone.map(v13FaceButton).join("")}</div></div>` : "")
    : `<div class="v13-faces">${card.rows.map(v13FaceButton).join("")}</div>`);
  const detail = (card) => {
    const mostly = card.makeup.length ? `<p class="v13-mostly">Mostly ${escapeHtml(card.makeup.map((part) => v13Short(part.label)).join(" · "))}</p>` : "";
    return `<section class="v13-card is-detail" data-v13-card="${escapeHtml(card.id)}" style="--card-colour:${escapeHtml(cardColour(card))}">`
      + `<header class="v13-card-head"><h4><span><i style="background:${escapeHtml(cardColour(card))}"></i>${escapeHtml(card.label)}</span><small>${card.rows.length} player${card.rows.length === 1 ? "" : "s"} · ${number(card.wins, 1)} wins <button type="button" class="v13-card-close" data-v13-close>Close</button></small></h4>${mostly}</header>`
      + `<div class="v13-card-body">${inner(card)}</div></section>`;
  };
  const tile = (card) => {
    const lead = card.rows.slice(0, 5);
    const more = card.rows.length - lead.length;
    const open = card.id === v13View.open;
    return `<button type="button" class="v13-tile" data-v13-open="${escapeHtml(card.id)}" aria-expanded="${String(open)}" style="--card-colour:${escapeHtml(cardColour(card))}">`
      + `<b>${escapeHtml(card.label)}</b>`
      + `<span class="v13-stack">${lead.map((row) => `<span class="v13-face-photo"><span>${escapeHtml(initials(row.display_name ?? row.player_name))}</span><img src="${headshotUrl(row.player_id)}" alt="" loading="lazy" decoding="async"></span>`).join("")}${more > 0 ? `<span class="v13-stack-more">+${more}</span>` : ""}</span>`
      + `<small>${card.rows.length} player${card.rows.length === 1 ? "" : "s"} · ${number(card.wins, 1)} wins</small>`
      + `<span class="v13-wins-bar"><span style="width:${(100 * Math.max(0, card.wins) / mostWins).toFixed(1)}%;background:${escapeHtml(cardColour(card))}"></span></span></button>`;
  };

  container.innerHTML = `<div class="v13-bar">${v13Segment("v13-callout", "Specificity", V13_SPECIFICITY, v13View.callout ? "exact" : "general")}`
    + `<label class="v13-find"><span class="v13-seg-label">Find a player</span><input type="search" autocomplete="off" placeholder="Player name" value="${escapeHtml(v13View.find)}"></label></div>`
    + `<div class="v13-pickbar-host"></div><div class="v13-grid-host"></div>${v13ScopeLine(scope)}`;
  const host = container.querySelector(".v13-grid-host");
  const bar = container.querySelector(".v13-pickbar-host");

  const light = () => {
    const grid = host.querySelector(".v13-bgrid");
    if (!grid) return;
    grid.classList.toggle("has-pick", v13View.pick !== null);
    grid.querySelectorAll(".v13-face.is-lit").forEach((node) => node.classList.remove("is-lit"));
    if (v13View.pick === null) { bar.innerHTML = ""; return; }
    const row = byKey.get(v13View.pick);
    const type = v13ExactKey(row);
    grid.querySelectorAll(".v13-face").forEach((node) => node.classList.toggle("is-lit", node.dataset.v13Type === type));
    const others = scope.rows.filter((entry) => v13ExactKey(entry) === type).length - 1;
    bar.innerHTML = `<div class="v13-pickbar" role="status"><b>${escapeHtml(row.display_name)}</b> ${escapeHtml(teamsOf(row))}${row.season ? ` · ${escapeHtml(row.season)}` : ""} · ${number(v13Wins(row), 2)} wins · ${escapeHtml(row.v13.exact_type_label ?? v13TypeCaption(row, catalogue))} · ${others > 0 ? `lit up: the ${others} other${others === 1 ? "" : "s"} here with the same four labels` : "no one else here has these four labels"} <button type="button">clear</button></div>`;
    bar.querySelector("button").addEventListener("click", () => { v13View.pick = null; light(); });
  };
  // The open grouping's players go directly under the row its tile is on,
  // however many tiles a row holds at this width.
  const draw = () => {
    if (!cards.length) {
      host.innerHTML = '<p class="rankings-chart-empty">None of the players the table is showing has a V13 grouping.</p>';
      return;
    }
    host.innerHTML = `<div class="v13-bgrid is-mosaic"><div class="v13-tiles">${cards.map(tile).join("")}</div></div>`;
    const tiles = host.querySelector(".v13-tiles");
    const openIndex = cards.findIndex((card) => card.id === v13View.open);
    if (openIndex >= 0) {
      const columns = Math.max(1, getComputedStyle(tiles).gridTemplateColumns.split(" ").filter(Boolean).length);
      const after = Math.min(cards.length - 1, Math.floor(openIndex / columns) * columns + columns - 1);
      tiles.children[after].insertAdjacentHTML("afterend", detail(cards[openIndex]));
      const column = openIndex % columns;
      host.querySelector(".v13-card.is-detail")?.style.setProperty("--notch", `calc(${(column + .5) / columns * 100}% - 9px)`);
    }
    for (const image of host.querySelectorAll(".v13-face img, .v13-stack img")) {
      image.addEventListener("error", () => image.remove(), { once: true });
    }
    light();
  };
  // Pick a player: open his grouping, light his exact type, and bring his face
  // into view inside the open panel.
  const pick = (key, { reveal = false } = {}) => {
    v13View.pick = key && byKey.has(key) ? key : null;
    if (v13View.pick !== null && cardOf.get(v13View.pick) !== v13View.open) {
      v13View.open = cardOf.get(v13View.pick);
      draw();
    } else {
      light();
    }
    if (reveal && v13View.pick !== null) {
      host.querySelector(`.v13-face[data-v13-player="${CSS.escape(v13View.pick)}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  };

  for (const button of container.querySelectorAll("[data-v13-callout]")) {
    button.addEventListener("click", () => {
      v13View.callout = button.dataset.v13Callout === "exact";
      container.querySelectorAll("[data-v13-callout]").forEach((node) => node.setAttribute("aria-pressed", String(node === button)));
      draw();
    });
  }
  const find = container.querySelector(".v13-find input");
  find.addEventListener("input", () => {
    v13View.find = find.value;
    const query = v13Fold(find.value.trim());
    if (query.length < 2) { if (!query) pick(null); return; }
    const match = scope.rows.filter((row) => v13Fold(row.display_name ?? row.player_name).includes(query))
      .sort((left, right) => v13Wins(right) - v13Wins(left))[0];
    if (match) pick(`${match.player_id}:${match.season_end_year}`, { reveal: true });
  });
  host.addEventListener("click", (event) => {
    const face = event.target.closest(".v13-face");
    if (face) { pick(v13View.pick === face.dataset.v13Player ? null : face.dataset.v13Player); return; }
    if (event.target.closest("[data-v13-close]")) {
      v13View.open = null;
      v13View.pick = null;
      draw();
      return;
    }
    const opener = event.target.closest("[data-v13-open]");
    if (opener) {
      v13View.open = v13View.open === opener.dataset.v13Open ? null : opener.dataset.v13Open;
      if (v13View.pick !== null && cardOf.get(v13View.pick) !== v13View.open) v13View.pick = null;
      draw();
      host.querySelector(`[data-v13-open="${CSS.escape(opener.dataset.v13Open)}"]`)?.focus({ preventScroll: true });
      host.querySelector(".v13-card.is-detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
  draw();
}

// --- the workspace -------------------------------------------------------------
//
// Six chart panels, each closed until a reader opens one. A panel is drawn the
// first time it is opened and never before, so a closed panel costs neither a
// request nor a render. Each page passes the panel elements it has; a key it
// has no element for is simply never open there (the rankings page keeps only
// the value map and regular against postseason; the season page has all six).
// The two V13 panels (V13_ONLY_PANEL_KEYS) are hidden, and closed, whenever
// the page is showing any other statistic.

export const CHART_PANEL_KEYS = Object.freeze([
  "value-map", "load-rate", "wins-losses", "player-types", "area-maps", "groupings",
  "similarity", "reg-post", "season-history", "type-trends",
]);
// The two total-history charts are collapsible in exactly the same way, but the
// page owns their data, so they are only named here — never drawn here.
export const HISTORY_PANEL_KEYS = Object.freeze(["trends", "lift"]);
export const ALL_PANEL_KEYS = Object.freeze([...CHART_PANEL_KEYS, ...HISTORY_PANEL_KEYS]);

// An older link, or a link someone wrote by hand, can name a chart in words
// this page no longer uses.
const PANEL_ALIASES = Object.freeze({
  visual: "value-map",
  "value_map": "value-map",
  values: "value-map",
  types: "player-types",
  "player_types": "player-types",
  landscape: "player-types",
  leaders: "similarity",
  "type-leaders": "similarity",
  "reg_post": "reg-post",
  postseason: "reg-post",
  "area_maps": "area-maps",
  areas: "area-maps",
  maps: "area-maps",
  buckets: "groupings",
  trend: "trends",
  rolling: "trends",
  "every-season": "season-history",
  "per-36": "load-rate",
  per36: "load-rate",
  "load_rate": "load-rate",
  "wins_losses": "wins-losses",
  "type_trends": "type-trends",
  "types-over-time": "type-trends",
  "season_history": "season-history",
});

function panelKey(value) {
  const name = String(value ?? "").trim().toLowerCase();
  if (ALL_PANEL_KEYS.includes(name)) return name;
  return PANEL_ALIASES[name] ?? null;
}

// Which panels a page should open, in order of who gets to decide.
//
// 1. `panels` in the query string, whenever it is there — the page writes it on
//    every change, and `panels=none` really does mean all of them closed.
// 2. A link that targets a chart by name, or that carries a non-default setting
//    of one of the two history charts: it was written to be followed.
// 3. What the last visit left behind.
// 4. Nothing: every panel starts closed.
export function parseOpenPanels(search, { stored = null } = {}) {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/u, ""));
  const named = params.get("panels");
  if (named !== null) return orderedPanels(splitPanels(named));
  const targeted = new Set();
  for (const key of ["view", "rankings_view", "panel", "chart"]) {
    const resolved = panelKey(params.get(key));
    if (resolved) targeted.add(resolved);
  }
  if (params.get("trend_window") && params.get("trend_window") !== "3") targeted.add("trends");
  if (params.get("trend_phase") && params.get("trend_phase") !== "All") targeted.add("trends");
  if (params.get("lift_window") && params.get("lift_window") !== "3") targeted.add("lift");
  if (params.get("lift_group") && params.get("lift_group") !== "top") targeted.add("lift");
  if (targeted.size) return orderedPanels(targeted);
  if (stored !== null && stored !== undefined) return orderedPanels(splitPanels(stored));
  return [];
}

function splitPanels(value) {
  const parts = String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.includes("none")) return new Set();
  const open = new Set();
  for (const part of parts) {
    const resolved = panelKey(part);
    if (resolved) open.add(resolved);
  }
  return open;
}

function orderedPanels(open) {
  return ALL_PANEL_KEYS.filter((key) => open.has(key));
}

// The one string the query and the remembered set share. Always a value, so
// "nothing is open" survives a reload instead of being read as "unset".
export function serializeOpenPanels(keys) {
  const open = orderedPanels(new Set((keys ?? []).map((key) => panelKey(key)).filter(Boolean)));
  return open.length ? open.join(",") : "none";
}

// A panel needs the complete visual payload (the landscape or the per-source
// vectors) before it means anything; the value map reads the ranking rows the
// table already has.
const PANELS_NEEDING_VISUAL_PAYLOAD = Object.freeze(["player-types", "area-maps", "groupings", "similarity"]);
// Where a panel that could not read its landscape says why.
const PANEL_CHART_IDS = Object.freeze({
  "player-types": "rankings-player-types-chart",
  "area-maps": "rankings-area-maps-chart",
  groupings: "rankings-groupings-chart",
});

// Whether a payload is one the V13-only panels can be shown for.
export function v13PanelsShown(payload) {
  return String(payload?.stat_version ?? "") === "v13";
}
const PANELS_NEEDING_COMPARISON = Object.freeze(["reg-post"]);
// Every season's own top players, fetched only when the panel is opened.
const PANELS_NEEDING_HISTORY = Object.freeze(["season-history"]);
// Each player type's season totals, fetched only when the panel is opened.
const PANELS_NEEDING_TYPE_TRENDS = Object.freeze(["type-trends"]);

export function createRankingsVisualWorkspace({
  panelElements = null,
  onPanelsChange = () => {},
  scopeCopy = null,
  // `null` keeps the rankings page's own rule: every mark is a face up to
  // CHART_FACE_CAP and a plain dot above it. A number is a face budget — the
  // best that many are faces whatever the size of the chart.
  faceBudget = null,
  // Whether a chart prints "N of M drawn". The rankings page says no: its table
  // above already says what the selection is.
  drawnNotes = true,
  loadVisualPayload = async (nextPayload) => nextPayload,
  loadComparisonPayload = async (nextPayload) => nextPayload,
  // Every season's top players for the every-season chart. A page that does
  // not pass one never opens that chart (it has no element for it either).
  loadHistoryPayload = async () => null,
  // Each V13 player type's season totals for "Wins Contributed by player type".
  loadTypeTrendsPayload = async () => null,
  // The statistic the page is showing before any chart has read a payload (the
  // season page draws nothing until a panel is opened, yet a V13 panel has to
  // be there to open).
  sourceBeforePayload = () => null,
  // The ranking payload of one schedule of the page's selection ("Regular
  // Season", "All" or "Postseason"). A page that passes it gives the
  // offense/defense chart and the type lanes a schedule switch.
  loadSchedulePayload = null,
  // Whether the regular-to-postseason chart carries a player search.
  regPostSearch = false,
} = {}) {
  let payload = null;
  let visualPayload = null;
  let comparisonPayload = null;
  let requestToken = 0;
  let resizeTimer = null;
  let visualRequest = null;
  let comparisonRequest = null;
  // One every-season answer per measure (Wins or Value Contributed): each
  // season's top players differ between the two.
  const historyPayloads = new Map();
  const historyRequests = new Map();
  const historyKey = () => `${chartBreakdown("season-history", payload)}|${historySchedule()}`;
  const typeTrendPayloads = new Map();
  const typeTrendKey = () => { const view = typeTrendView(); return `${view.schedule}|${view.windowYears}`; };
  const drawn = new Set();
  const schedulePayloads = new Map();
  chartSchedule.load = typeof loadSchedulePayload === "function" ? loadSchedulePayload : null;
  chartSearch.regPost = Boolean(regPostSearch);
  // The payload a scheduled chart draws: the page's own for the full season,
  // else the same payload carrying that schedule's rows.
  const scheduledPayload = (key, base) => {
    const schedule = chartSchedule.load ? chartScheduleOf(key) : "All";
    if (!base || schedule === "All" || !schedulePayloads.has(schedule)) return base;
    return { ...base, rows: schedulePayloads.get(schedule)?.rows ?? [] };
  };
  if (scopeCopy) Object.assign(chartScope, scopeCopy);
  chartNotes.drawn = drawnNotes !== false;
  // `Number(null)` is 0 and 0 is finite, so "no budget" has to be recognised
  // before it is measured — the same trap a missing percentile carries.
  chartFaces.budget = faceBudget === null || faceBudget === undefined
    || !Number.isFinite(Number(faceBudget))
    ? null
    : Number(faceBudget);

  const panelFor = (key) => panelElements?.get?.(key) ?? null;
  // A V13-only panel is only ever open while the page shows V13.
  const v13Shown = () => (payload
    ? v13PanelsShown(payload)
    : String(sourceBeforePayload?.() ?? "") === "v13");
  const shownFor = (key) => !V13_ONLY_PANEL_KEYS.includes(key) || v13Shown();
  // No panel elements at all means nothing collapses: every chart is on screen.
  const isOpen = (key) => shownFor(key)
    && (panelElements ? Boolean(panelFor(key)?.open) && !panelFor(key)?.hidden : true);
  const openKeys = () => CHART_PANEL_KEYS.filter(isOpen);

  // Show the V13 panels for V13 and hide them for anything else; a hidden
  // panel is closed too, so it is not left open behind the page's back.
  const syncSourcePanels = () => {
    if (!panelElements) return;
    const shown = v13Shown();
    for (const key of V13_ONLY_PANEL_KEYS) {
      const panel = panelFor(key);
      if (!panel) continue;
      if (!shown && panel.open) panel.open = false;
      panel.hidden = !shown;
    }
  };

  const drawPanel = (key) => {
    if (!payload) return;
    if (!shownFor(key)) return;
    if (key === "value-map") renderValueMap(scheduledPayload(key, payload));
    if (key === "load-rate") renderLoadRate(payload);
    if (key === "wins-losses") renderWinsLosses(payload);
    if (key === "player-types") renderPlayerTypes(visualPayload ?? payload);
    if (key === "area-maps") renderV13AreaMaps(visualPayload ?? payload);
    if (key === "groupings") renderV13Groupings(visualPayload ?? payload);
    if (key === "similarity") renderSimilarityLandscape(scheduledPayload(key, visualPayload ?? payload));
    if (key === "reg-post" && comparisonPayload) renderRegPost(comparisonPayload);
    if (key === "season-history" && historyPayloads.get(historyKey())) renderSeasonHistory(historyPayloads.get(historyKey()));
    if (key === "type-trends" && typeTrendPayloads.get(typeTrendKey())) renderTypeTrends(typeTrendPayloads.get(typeTrendKey()));
    drawn.add(key);
  };

  const ensureVisualPayload = async (token) => {
    if (visualPayload) return visualPayload;
    if (!visualRequest) visualRequest = loadVisualPayload(payload);
    const complete = await visualRequest;
    if (token !== requestToken) return null;
    visualPayload = complete;
    return complete;
  };

  const ensureComparisonPayload = async (token) => {
    if (comparisonPayload) return comparisonPayload;
    if (!comparisonRequest) comparisonRequest = loadComparisonPayload(visualPayload ?? payload);
    const complete = await comparisonRequest;
    if (token !== requestToken) return null;
    comparisonPayload = complete;
    return complete;
  };

  const ensureHistoryPayload = async (token) => {
    const key = historyKey();
    if (historyPayloads.has(key)) return historyPayloads.get(key);
    if (!historyRequests.has(key)) {
      historyRequests.set(key, loadHistoryPayload(payload, {
        breakdown: chartBreakdown("season-history", payload),
        schedule: historySchedule(),
      }));
    }
    const complete = await historyRequests.get(key);
    if (token !== requestToken) return null;
    historyPayloads.set(key, complete);
    return complete;
  };

  // Opening a panel is the moment its data is fetched and its chart is drawn.
  const openPanel = async (key) => {
    if (!payload || !CHART_PANEL_KEYS.includes(key) || !shownFor(key)) return;
    const token = requestToken;
    if (PANELS_NEEDING_VISUAL_PAYLOAD.includes(key) && !visualPayload) {
      drawPanel(key);
      try {
        await ensureVisualPayload(token);
      } catch (error) {
        if (token === requestToken && error?.name !== "AbortError") {
          if (key === "similarity") {
            const note = document.querySelector("#rankings-similarity-axes");
            if (note) note.textContent = readableError(error);
          } else {
            const chart = document.querySelector(`#${PANEL_CHART_IDS[key] ?? PANEL_CHART_IDS["player-types"]}`);
            if (chart) chart.innerHTML = `<p class="rankings-chart-empty">${escapeHtml(readableError(error))}</p>`;
          }
        }
        return;
      }
      if (token !== requestToken) return;
    }
    if (PANELS_NEEDING_COMPARISON.includes(key) && !comparisonPayload) {
      const status = document.querySelector("#rankings-reg-post-status");
      if (status) status.textContent = "Loading regular and postseason values…";
      try {
        await ensureComparisonPayload(token);
      } catch (error) {
        if (token === requestToken && status && error?.name !== "AbortError") {
          status.textContent = readableError(error);
        }
        return;
      }
      if (token !== requestToken) return;
    }
    if (PANELS_NEEDING_TYPE_TRENDS.includes(key) && !typeTrendPayloads.has(typeTrendKey())) {
      const chart = document.querySelector("#rankings-type-trends-chart");
      if (chart) chart.innerHTML = '<p class="rankings-chart-empty">Adding up every player type…</p>';
      const wanted = typeTrendKey();
      try {
        const complete = await loadTypeTrendsPayload(payload, typeTrendView());
        if (token !== requestToken) return;
        typeTrendPayloads.set(wanted, complete);
        if (!complete && chart) {
          chart.innerHTML = '<p class="rankings-chart-empty">This statistic has no player types to show.</p>';
          return;
        }
      } catch (error) {
        if (token === requestToken && chart && error?.name !== "AbortError") {
          chart.innerHTML = `<p class="rankings-chart-empty">${escapeHtml(readableError(error))}</p>`;
        }
        return;
      }
      if (wanted !== typeTrendKey()) return;
    }
    if (chartSchedule.load && SCHEDULED_PANEL_KEYS.includes(key)) {
      const schedule = chartScheduleOf(key);
      if (schedule !== "All" && !schedulePayloads.has(schedule)) {
        try {
          const complete = await chartSchedule.load(schedule);
          if (token !== requestToken) return;
          schedulePayloads.set(schedule, complete);
        } catch (error) {
          const chart = document.querySelector(key === "value-map" ? "#rankings-value-map-chart" : "#rankings-similarity-chart");
          if (token === requestToken && chart && error?.name !== "AbortError") {
            chart.innerHTML = `<p class="rankings-chart-empty">${escapeHtml(readableError(error))}</p>`;
          }
          return;
        }
      }
    }
    if (PANELS_NEEDING_HISTORY.includes(key) && !historyPayloads.has(historyKey())) {
      const chart = document.querySelector("#rankings-history-chart");
      if (chart) chart.innerHTML = '<p class="rankings-chart-empty">Loading every season…</p>';
      try {
        const complete = await ensureHistoryPayload(token);
        if (token === requestToken && !complete && chart) {
          chart.innerHTML = '<p class="rankings-chart-empty">This statistic has no season-by-season comparison yet.</p>';
        }
      } catch (error) {
        historyRequests.delete(historyKey());
        if (token === requestToken && chart && error?.name !== "AbortError") {
          chart.innerHTML = `<p class="rankings-chart-empty">${escapeHtml(readableError(error))}</p>`;
        }
        return;
      }
      if (token !== requestToken || !historyPayloads.get(historyKey())) return;
    }
    drawPanel(key);
  };

  const redrawOpenPanels = () => {
    for (const key of openKeys()) {
      if (drawn.has(key)) drawPanel(key);
      else openPanel(key);
    }
  };

  if (panelElements) {
    for (const key of CHART_PANEL_KEYS) {
      panelFor(key)?.addEventListener("toggle", () => {
        onPanelsChange(openKeys());
        if (panelFor(key)?.open) openPanel(key);
      });
    }
  }
  // A chart's own control redraws that chart alone, fetching first when its
  // new view needs data it does not have yet.
  redrawChart = (key) => {
    if (!isOpen(key)) return;
    drawn.delete(key);
    openPanel(key);
  };
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawOpenPanels, 120);
  });

  return {
    get openPanels() { return openKeys(); },
    openPanel,
    async render(nextPayload) {
      requestToken += 1;
      payload = nextPayload;
      visualPayload = null;
      comparisonPayload = null;
      visualRequest = null;
      comparisonRequest = null;
      historyPayloads.clear();
      historyRequests.clear();
      typeTrendPayloads.clear();
      schedulePayloads.clear();
      drawn.clear();
      syncSourcePanels();
      await Promise.all(openKeys().map((key) => openPanel(key)));
    },
    renderRegularPost(nextPayload) {
      comparisonPayload = nextPayload;
      comparisonRequest = Promise.resolve(nextPayload);
      if (isOpen("reg-post")) drawPanel("reg-post");
    },
  };
}
