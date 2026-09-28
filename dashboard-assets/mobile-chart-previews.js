// Three local mobile treatments, all reading the existing dashboard payloads.
// No fetching, policy changes, or writes. Desktop renderers remain in place.
const NS = "http://www.w3.org/2000/svg";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const fmt = (value, digits = 3) => Number(value).toLocaleString("en-US", {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt(Math.abs(value))}`;
const valid = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const node = (name, attributes = {}, text = null) => {
  const element = document.createElementNS(NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text !== null) element.textContent = text;
  return element;
};
const domain = (values) => {
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const pad = Math.max((hi - lo) * .08, .01);
  return [lo < 0 ? lo - pad : 0, hi + pad];
};
const scale = ([lo, hi], start, end) => (value) => start + (Number(value) - lo) / (hi - lo || 1) * (end - start);
const badge = (letter, title, copy) => `<div class="mobile-preview-heading"><span class="mobile-preview-badge">${letter}</span><div><strong>${title}</strong><p>${copy}</p></div></div>`;
const fold = (value) => globalThis.ValueContributedNameFold?.foldName(value)
  ?? String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function mount(container, style, heading) {
  container.querySelector(":scope > .mobile-preview")?.remove();
  container.classList.add("has-mobile-preview");
  const root = document.createElement("section");
  root.className = `mobile-preview mobile-preview-${style}`;
  root.innerHTML = heading;
  container.append(root);
  return root;
}

// Used by both the real trend renderer and the numeric regression checks.
// Calendar gaps remain separate paths; zero-valued observations stay present.
export function trendSegments(points) {
  const segments = [];
  let previous = null;
  for (const point of points) {
    if (!valid(point.rolling_average) || !valid(point.season_start)) { previous = null; continue; }
    if (!previous || Number(point.season_start) !== Number(previous.season_start) + 1) segments.push([]);
    segments.at(-1).push(point);
    previous = point;
  }
  return segments;
}

export function comparisonOrder(rows, direction = "gains") {
  return rows.filter((row) => valid(row._comparison?.regular) && valid(row._comparison?.postseason))
    .slice().sort((a, b) => {
      const change = (row) => Number(row._comparison.postseason) - Number(row._comparison.regular);
      return (direction === "drops" ? 1 : -1) * (change(a) - change(b))
        || String(a.player_name).localeCompare(String(b.player_name));
    });
}

export function mobileScatterAxes(rows) {
  const spread = key => {
    const values = rows.map(row => Number(row[key]));
    return Math.max(...values) - Math.min(...values);
  };
  const offenseVertical = spread("_offenseRaw") >= spread("_defenseRaw");
  return offenseVertical
    ? { xKey: "_defenseRaw", yKey: "_offenseRaw", xLabel: "Defense", yLabel: "Offense" }
    : { xKey: "_offenseRaw", yKey: "_defenseRaw", xLabel: "Offense", yLabel: "Defense" };
}

let mobileMapInstance = 0;

// `axes` lets a chart name its own two measures instead of offense/defense:
// { xKey, yKey, xLabel, yLabel, digits, pairs(row), context(row) }.
export function renderMobileScatter(container, rows, {unit, hrefFor, comparison = false, axes = null}) {
  const root = mount(container, "map", "");
  const eligible = rows.filter((r) => axes
    ? valid(r[axes.xKey]) && valid(r[axes.yKey])
    : comparison
      ? valid(r._regularRaw) && valid(r._postseasonRaw)
      : valid(r._offenseRaw) && valid(r._defenseRaw));
  if (!eligible.length) { root.insertAdjacentHTML("beforeend", "<p>No players in this selection.</p>"); return; }
  const {xKey, yKey, xLabel, yLabel} = axes ?? (comparison
    ? {xKey: "_regularRaw", yKey: "_postseasonRaw", xLabel: "Regular season", yLabel: "Postseason"}
    : mobileScatterAxes(eligible));
  const digits = axes?.digits ?? (comparison ? 2 : 1);
  const axisTitle = (label) => unit ? `${label} · ${unit}` : label;
  const width = 320, height = 410, left = 44, right = 303, top = 30, bottom = 354;
  const sharedDomain = comparison ? domain(eligible.flatMap(r => [Number(r[xKey]), Number(r[yKey])])) : null;
  const xd = sharedDomain ?? domain(eligible.map(r => Number(r[xKey])));
  const yd = sharedDomain ?? domain(eligible.map(r => Number(r[yKey])));
  const x = scale(xd, left, right), y = scale(yd, bottom, top);
  const chart = node("svg", {viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": `${yLabel} vertically versus ${xLabel} horizontally in ${unit}`});
  for (let i = 0; i <= 3; i++) {
    const xv = xd[0] + (xd[1] - xd[0]) * i / 3, yv = yd[0] + (yd[1] - yd[0]) * i / 3;
    chart.append(node("line", {x1:left,x2:right,y1:y(yv),y2:y(yv),class:"preview-grid"}));
    chart.append(node("text", {x:left-7,y:y(yv)+4,"text-anchor":"end"},fmt(yv,digits)));
    chart.append(node("text", {x:x(xv),y:bottom+22,"text-anchor":"middle"},fmt(xv,digits)));
  }
  chart.append(node("text", {x:44,y:14,class:"preview-axis-title"}, axisTitle(yLabel)));
  chart.append(node("text", {x:303,y:402,"text-anchor":"end",class:"preview-axis-title"}, axisTitle(xLabel)));
  if (xd[0] < 0) chart.append(node("line",{x1:x(0),x2:x(0),y1:top,y2:bottom,class:"preview-zero"}));
  if (yd[0] < 0) chart.append(node("line",{x1:left,x2:right,y1:y(0),y2:y(0),class:"preview-zero"}));
  if (comparison) chart.append(node("line", {
    x1:x(xd[0]), y1:y(xd[0]), x2:x(xd[1]), y2:y(xd[1]),
    stroke:"#8aa8b8", "stroke-width":1.5, "stroke-dasharray":"5 4",
    class:"preview-equal-rate", "aria-label":"Equal regular-season and postseason rates",
  }));
  const positions = eligible.map(row => ({x:x(row[xKey]), y:y(row[yKey])}));
  const faceRadius = 13, mapId = ++mobileMapInstance;
  const defs = node("defs"), faces = node("g", {class:"preview-map-faces"});
  chart.append(defs, faces);
  const marks = eligible.map((row, index) => {
    const p = positions[index], clipId = `mobile-map-face-${mapId}-${index}`;
    const clip = node("clipPath", {id:clipId});
    clip.append(node("circle", {cx:p.x,cy:p.y,r:faceRadius})); defs.append(clip);
    const mark = node("g",{class:"preview-map-player", "data-map-player": index,
      role:"button",tabindex:0,"aria-label": `${row.player_name}, ${xLabel} ${fmt(row[xKey])}, ${yLabel} ${fmt(row[yKey])}`});
    const initials = row.player_name.split(" ").map(part=>part[0]).slice(0,2).join("");
    const fallback = node("text", {x:p.x,y:p.y+4,"text-anchor":"middle",class:"preview-map-initials",visibility:"hidden"},initials);
    const photo = node("image", {href:`https://cdn.nba.com/headshots/nba/latest/260x190/${encodeURIComponent(row.player_id)}.png`,
      x:p.x-faceRadius,y:p.y-faceRadius,width:faceRadius*2,height:faceRadius*2,
      preserveAspectRatio:"xMidYMid slice","clip-path":`url(#${clipId})`,class:"preview-map-photo"});
    photo.addEventListener("error",()=>{photo.remove();fallback.setAttribute("visibility","visible");});
    mark.append(node("circle",{cx:p.x,cy:p.y,r:faceRadius,class:"preview-map-face-back"}),fallback,photo,
      node("circle",{cx:p.x,cy:p.y,r:faceRadius,class:"preview-map-face-ring"}));
    faces.append(mark); return mark;
  });
  const selection = node("circle",{r:faceRadius+3,class:"preview-map-selection","pointer-events":"none"});
  chart.append(selection);
  let selectedIndex = null;
  const detail = document.createElement("div"); detail.className = "mobile-preview-detail";
  detail.setAttribute("aria-live","polite");
  detail.hidden = true;
  const search = document.createElement("label");
  search.className = "mobile-preview-picker";
  search.innerHTML = 'Find a player<input type="search" placeholder="Search names" aria-label="Search Player on map" autocomplete="off"><span class="mobile-preview-search-status" role="status"></span>';
  const searchInput = search.querySelector("input"), searchStatus = search.querySelector("[role=status]");
  if (comparison) searchInput.setAttribute("aria-label", "Search player on regular-to-postseason map");
  root.append(search,chart,detail);
  const select = (index, clearSearch = true) => {
    if (clearSearch) { searchInput.value = ""; searchStatus.textContent = ""; }
    selectedIndex = index;
    const row = eligible[index];
    marks.forEach((mark,i) => {mark.classList.toggle("is-selected",i===index);mark.setAttribute("aria-pressed",String(i===index));});
    selection.setAttribute("visibility", index === null ? "hidden" : "visible");
    detail.hidden = index === null;
    if (index === null) {
      detail.replaceChildren();
      return;
    }
    faces.append(marks[index]);
    selection.setAttribute("cx",positions[index].x); selection.setAttribute("cy",positions[index].y);
    const pairs = axes?.pairs ? axes.pairs(row) : comparison
      ? [["Regular season", row._regularRaw], ["Postseason", row._postseasonRaw]]
      : [["Offense", row._offenseRaw], ["Defense", row._defenseRaw]];
    const context = axes?.context ? axes.context(row) : comparison
      ? `${signed(row._postseasonRaw-row._regularRaw)} ${unit} · ${row.postseason_games} postseason games`
      : `${unit} in the current rankings scope · ${eligible.length} players shown`;
    detail.innerHTML = `<a href="${escape(hrefFor(row))}">${escape(row.player_name)}</a><div class="preview-value-pair">${pairs.map(([label,value])=>`<span>${escape(label)}<strong>${fmt(value)}</strong></span>`).join("")}</div><small>${escape(context)}</small>`;
  };
  searchInput.addEventListener("input", () => {
    const query = fold(searchInput.value).trim();
    const index = query ? eligible.findIndex(row => fold(row.player_name).includes(query)) : -1;
    select(index < 0 ? null : index, false);
    searchStatus.textContent = query && index < 0 ? "No matching player." : "";
  });
  select(null);
  const toggle = index => select(selectedIndex === index ? null : index);
  chart.addEventListener("click",(event) => {
    const direct = event.target.closest("[data-map-player]");
    if (direct) {toggle(Number(direct.dataset.mapPlayer));return;}
    const box = chart.getBoundingClientRect();
    const px=(event.clientX-box.left)*width/box.width, py=(event.clientY-box.top)*height/box.height;
    let nearest=0, distance=Infinity;
    positions.forEach((p,i) => {const d=(p.x-px)**2+(p.y-py)**2;if(d<distance){distance=d;nearest=i;}});
    if (distance <= 24**2) toggle(nearest);
  });
  chart.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key)) return;
    const target = event.target.closest("[data-map-player]");
    if (target) {event.preventDefault();toggle(Number(target.dataset.mapPlayer));}
  });
  root.append(chart,detail);
}

export function renderMobileComparison(container, rows, {unit, hrefFor}) {
  renderMobileScatter(container, rows.map(row => ({
    ...row, _regularRaw: row._comparison?.regular, _postseasonRaw: row._comparison?.postseason,
  })), {unit: `${unit} / game`, hrefFor, comparison: true});
}

const CAREER_COLORS = ["#67b7ff", "#ff766c", "#ffdc58", "#b899ff", "#69dfad", "#ff9ed5", "#ffae51", "#6fe8f2", "#f5f0dc", "#b9cc73"];

export function careerColorSlots(players, previous = new Map()) {
  const ids = players.map(player => String(player.player_id));
  const slots = new Map([...previous].filter(([id]) => ids.includes(id)));
  for (const id of ids) if (!slots.has(id)) {
    slots.set(id, CAREER_COLORS.findIndex((_, slot) => ![...slots.values()].includes(slot)));
  }
  return slots;
}
const CAREER_DASHES = ["none", "7 3", "2 3", "10 3 2 3"];
const careerChartStates = new WeakMap();
const careerReadoutObservers = new WeakMap();

export function careerComparisonModel(players) {
  const series = players.map(player => ({
    player, segments: trendSegments(player.seasons ?? []),
  }));
  const points = series.flatMap(item => item.segments.flat());
  const years = [...new Set(points.map(point => Number(point.season_start)))].sort((a, b) => a - b);
  return { series, years, yDomain: domain(points.map(point => Number(point.rolling_average))) };
}

export function careerPointAt(player, year) {
  return trendSegments(player.seasons ?? []).flat()
    .find(point => Number(point.season_start) === Number(year)) ?? null;
}

export function topCareersAt(players, year, limit = 10, direction = "top") {
  return players.map(player => ({ player, point: careerPointAt(player, year) }))
    .filter(item => item.point)
    .sort((a, b) => (direction === "bottom" ? -1 : 1) * (Number(b.point.rolling_average) - Number(a.point.rolling_average))
      || Number(a.player.player_id) - Number(b.player.player_id))
    .slice(0, limit).map(item => item.player);
}

export function renderMobileTrend(container, payload) {
  renderMobileHistory(container, payload);
}

export function renderMobileLift(container, payload, group = "top") {
  renderMobileHistory(container, payload, { isLift: true, direction: group === "bottom" ? "bottom" : "top" });
}

// "Wins Contributed by player type" on a phone (owner's note, 2026-09-27):
// the same explorer as Rolling Wins Contributed, with each player type in the
// place of a player — its season-by-season average, the season stepper, the
// readout and the picker.
export function renderMobileTypeTrends(container, payload) {
  renderMobileHistory(container, {
    window_years: payload?.window_years,
    players: (payload?.types ?? []).map((type) => ({
      player_id: type.id,
      player_name: type.label,
      seasons: (type.seasons ?? []).map((point) => ({ ...point, season_start: Number(point.season_end_year) - 1 })),
    })),
  }, { types: true });
}

function renderMobileHistory(container, payload, { isLift = false, direction = "top", types = false } = {}) {
  if (!container) return;
  const saved = careerChartStates.get(container) ?? { season: null };
  careerChartStates.set(container, saved);
  let careerSeason = saved.season, careerSelection = [], careerAll = false;
  const rankedPlayers = year => topCareersAt(allPlayers, year, 10, direction);
  const valueText = value => isLift ? signed(Number(value)) : fmt(value);
  careerReadoutObservers.get(container)?.disconnect();
  careerReadoutObservers.delete(container);
  container.replaceChildren();
  const root = mount(container, "explorer", "");
  const allPlayers = (payload.players ?? []).filter(player => trendSegments(player.seasons ?? []).length);
  if (!allPlayers.length) {
    root.insertAdjacentHTML("beforeend", types ? "<p>No player types in this schedule.</p>" : "<p>No players qualified in this schedule.</p>");
    return;
  }
  const byId = new Map(allPlayers.map(player => [String(player.player_id), player]));
  const fullModel = careerComparisonModel(allPlayers);
  if (!fullModel.years.includes(careerSeason)) careerSeason = fullModel.years.at(-1);
  let players = rankedPlayers(careerSeason);
  careerAll = false;
  careerSelection = players.slice(0, 5).map(player => ({ id: String(player.player_id) }));
  let colorSlots = careerColorSlots(players);
  const careerColor = id => CAREER_COLORS[colorSlots.get(String(id))];

  const picker = document.createElement("details");
  picker.className = "preview-career-picker";
  picker.innerHTML = types
    ? '<summary>Select types <span class="preview-career-count"></span></summary><div class="mobile-preview-picker"><label>Find a type<input type="search" placeholder="Search types" aria-label="Search player types to compare" autocomplete="off"></label><div class="preview-season-buttons"><button type="button">Select all</button><button type="button">Clear selection</button></div><div class="preview-career-options" role="group" aria-label="Player types to compare"></div></div>'
    : '<summary>Select players <span class="preview-career-count"></span></summary><div class="mobile-preview-picker"><label>Find a player<input type="search" placeholder="Search careers" aria-label="Search careers to compare" autocomplete="off"></label><div class="preview-season-buttons"><button type="button">Select all</button><button type="button">Clear selection</button></div><div class="preview-career-options" role="group" aria-label="Players to compare"></div></div>';
  const search = picker.querySelector("input"), count = picker.querySelector(".preview-career-count"), options = picker.querySelector(".preview-career-options");
  const [selectAll, clear] = picker.querySelectorAll("button");
  const detail = document.createElement("div");
  detail.className = "preview-career-readout";
  detail.setAttribute("aria-live", "polite");
  const chart = node("svg", { viewBox: "0 0 320 260", role: "img", "aria-label": types ? "Player types' Wins Contributed on a shared scale" : isLift ? "Postseason rank changes on a shared scale" : "Compared careers on the same rolling Wins Contributed scale" });
  const buttons = document.createElement("div");
  buttons.className = "preview-season-buttons";
  buttons.innerHTML = '<button type="button">Previous season</button><button type="button">Next season</button>';
  const [previous, next] = buttons.children;
  root.append(chart, buttons, detail, picker);
  let model, x, y, cursors, guide, highlighted = null;

  const fitPlayerRows = () => {
    const rows = [...detail.querySelectorAll(".preview-career-value")];
    if (rows.length <= 5) { detail.style.maxHeight = "none"; return; }
    if (!detail.getBoundingClientRect().width) return;
    const header = detail.querySelector(".preview-career-season");
    const outerHeight = element => {
      const style = getComputedStyle(element);
      return element.getBoundingClientRect().height
        + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    };
    detail.style.maxHeight = `${Math.ceil(outerHeight(header)
      + rows.slice(0, 5).reduce((height, row) => height + outerHeight(row), 0))}px`;
  };
  const readoutObserver = new ResizeObserver(fitPlayerRows);
  careerReadoutObservers.set(container, readoutObserver);

  const applyHighlight = () => {
    if (!careerSelection.some(item => item.id === highlighted)) highlighted = null;
    chart.querySelectorAll("[data-career-series]").forEach(group => {
      const active = group.dataset.careerSeries === highlighted;
      group.style.opacity = highlighted && !active ? ".16" : "1";
      group.querySelectorAll(".preview-comparison-line").forEach(line => {
        line.style.strokeWidth = active ? "4.5px" : "2.5px";
      });
      if (active) chart.append(group);
    });
    const focused = detail.contains(document.activeElement) ? document.activeElement : null;
    const rows = new Map([...detail.querySelectorAll("[data-highlight-career]")]
      .map(button => [button.dataset.highlightCareer, button]));
    const ordered = [...careerSelection.filter(item => item.id === highlighted),
      ...careerSelection.filter(item => item.id !== highlighted)];
    ordered.forEach(item => {
      const button = rows.get(item.id);
      button.setAttribute("aria-pressed", String(item.id === highlighted));
      detail.append(button);
    });
    if (focused?.isConnected) focused.focus({ preventScroll: true });
    detail.scrollTop = 0;
    fitPlayerRows();
  };
  detail.addEventListener("click", event => {
    const button = event.target.closest("[data-highlight-career]");
    if (!button) return;
    highlighted = highlighted === button.dataset.highlightCareer ? null : button.dataset.highlightCareer;
    applyHighlight();
  });

  const updatePicker = () => {
    count.textContent = `${careerSelection.length} of ${players.length}`;
    const available = players.filter(player => fold(player.player_name).includes(fold(search.value)));
    options.replaceChildren();
    available.forEach(player => {
      const id = String(player.player_id), label = document.createElement("label"), checkbox = document.createElement("input"), name = document.createElement("span");
      label.className = "preview-career-option";
      label.style.setProperty("--career-color", careerColor(id));
      checkbox.type = "checkbox";
      checkbox.checked = careerSelection.some(item => item.id === id);
      name.textContent = player.player_name;
      checkbox.addEventListener("change", () => {
        careerAll = false;
        if (checkbox.checked) careerSelection.push({ id, slot: colorSlots.get(String(player.player_id)) });
        else careerSelection = careerSelection.filter(item => item.id !== id);
        draw(false);
      });
      label.append(checkbox, name); options.append(label);
    });
    if (!available.length) options.textContent = types ? "No matching types." : "No matching careers.";
  };

  const setSeason = (index) => {
    const i = Math.max(0, Math.min(model.years.length - 1, index));
    careerSeason = model.years[i];
    saved.season = careerSeason;
    previous.disabled = i === 0;
    next.disabled = i === model.years.length - 1;
    const label = `${careerSeason}-${String(careerSeason + 1).slice(-2)}`;
    guide.setAttribute("x1", x(careerSeason)); guide.setAttribute("x2", x(careerSeason));
    const values = careerSelection.map((item, j) => {
      const player = byId.get(item.id), point = careerPointAt(player, careerSeason);
      cursors[j].setAttribute("visibility", point ? "visible" : "hidden");
      if (point) { cursors[j].setAttribute("cx", x(careerSeason)); cursors[j].setAttribute("cy", y(point.rolling_average)); }
      const notes = [];
      if (!point) notes.push("No value in this season");
      else {
        if (Number(point.window_span) < Number(point.window_years)) notes.push(`${point.window_span}-season partial`);
        if (Number(isLift ? point.window_appearances : point.window_size) < Number(point.window_span)) notes.push("Includes zero-filled seasons");
        if (isLift) {
          if (point.comparison_season) notes.push(`Regular #${point.regular_season_rank} → Postseason #${point.postseason_rank}`);
          else notes.push("No postseason comparison this season");
        } else if (point.qualifying_window) notes.push("Qualifying window");
      }
      return `<button type="button" class="preview-career-value" data-highlight-career="${escape(item.id)}" aria-label="Highlight ${escape(player.player_name)}" aria-pressed="false" style="--career-color:${careerColor(item.id)}"><span>#${players.indexOf(player) + 1} ${escape(player.player_name)}<small>${escape(notes.join(" · "))}</small></span><strong>${point ? valueText(point.rolling_average) : "—"}</strong></button>`;
    }).join("");
    const readoutLabel = types
      ? `${Number(payload.window_years) > 1 ? `${payload.window_years}-year average` : "season"} WC`
      : `${payload.window_years}-year ${isLift ? "rank change · " + (direction === "bottom" ? "Bottom" : "Top") : "rolling WC"}`;
    detail.innerHTML = `<div class="preview-career-season"><strong>${label}</strong><span>${readoutLabel}</span></div>${values || (types ? '<p>Select types below to compare them.</p>' : '<p>Select players below to compare their careers.</p>')}`;
    readoutObserver.disconnect();
    readoutObserver.observe(detail);
    [...detail.children].forEach(row => readoutObserver.observe(row));

  };

  const draw = (refreshPicker = true) => {
    players = rankedPlayers(careerSeason);
    colorSlots = careerColorSlots(players, colorSlots);
    const selectedIds = new Set((careerSelection ?? []).map(item => item.id));
    careerSelection = players.filter(player => careerAll || selectedIds.has(String(player.player_id)))
      .map(player => ({ id: String(player.player_id), slot: colorSlots.get(String(player.player_id)) }));
    model = careerComparisonModel(careerSelection.map(item => byId.get(item.id)));
    // Keep a stable scale while the season's top 10 changes or players are hidden.
    model.years = fullModel.years;
    model.yDomain = fullModel.yDomain;
    x = scale([model.years[0], model.years.at(-1)], 42, 300);
    y = scale(model.yDomain, 216, 20);
    chart.replaceChildren();
    for (let i = 0; i <= 3; i++) {
      const value = model.yDomain[0] + (model.yDomain[1] - model.yDomain[0]) * i / 3;
      chart.append(node("line", { x1: 42, x2: 300, y1: y(value), y2: y(value), class: "preview-grid" }));
      chart.append(node("text", { x: 35, y: y(value) + 4, "text-anchor": "end" }, fmt(value, 1)));
    }
    if (isLift && model.yDomain[0] < 0 && model.yDomain[1] > 0) {
      chart.append(node("line", { x1: 42, x2: 300, y1: y(0), y2: y(0), class: "preview-season-guide" }));
      chart.append(node("text", { x: 35, y: y(0) + 4, "text-anchor": "end" }, "0"));
    }
    guide = node("line", { y1: 20, y2: 216, class: "preview-season-guide" });
    chart.append(guide);
    cursors = [];
    model.series.forEach(({segments}, index) => {
      const slot = careerSelection[index].slot, color = careerColor(careerSelection[index].id);
      const group = node("g", { "data-career-series": careerSelection[index].id });
      for (const segment of segments) if (segment.length > 1) group.append(node("polyline", {
        points: segment.map(point => `${x(point.season_start)},${y(point.rolling_average)}`).join(" "),
        fill: "none", class: "preview-comparison-line", stroke: color, "stroke-dasharray": CAREER_DASHES[slot % CAREER_DASHES.length],
      }));
      segments.flat().forEach(point => group.append(node("circle", { cx: x(point.season_start), cy: y(point.rolling_average), r: 2.4, fill: color })));
      const cursor = node("circle", { r: 6, fill: "#17382e", stroke: color, "stroke-width": 2.5 });
      cursors.push(cursor);
      group.append(cursor);
      chart.append(group);
    });
    const first = model.years[0], last = model.years.at(-1);
    chart.append(node("text", { x: 42, y: 246 }, `${first}-${String(first + 1).slice(-2)}`),
      node("text", { x: 300, y: 246, "text-anchor": "end" }, `${last}-${String(last + 1).slice(-2)}`));
    const preserved = model.years.indexOf(careerSeason);
    setSeason(preserved >= 0 ? preserved : model.years.length - 1);
    count.textContent = `${careerSelection.length} of ${players.length}`;
    if (refreshPicker) updatePicker();
    applyHighlight();
  };
  search.addEventListener("input", updatePicker);
  selectAll.addEventListener("click", () => {
    careerAll = true;
    draw();
  });
  clear.addEventListener("click", () => { careerAll = false; careerSelection = []; draw(); });
  const changeSeason = index => {
    careerSeason = model.years[Math.max(0, Math.min(model.years.length - 1, index))];
    careerAll = false;
    careerSelection = rankedPlayers(careerSeason).slice(0, 5)
      .map(player => ({ id: String(player.player_id) }));
    search.value = "";
    draw();
  };
  previous.addEventListener("click", () => changeSeason(model.years.indexOf(careerSeason) - 1));
  next.addEventListener("click", () => changeSeason(model.years.indexOf(careerSeason) + 1));
  chart.addEventListener("click", event => {
    const box = chart.getBoundingClientRect();
    const px = (event.clientX - box.left) * 320 / box.width;
    const py = (event.clientY - box.top) * 260 / box.height;
    let nearest = null, distance = Infinity;
    model.series.forEach(({player, segments}) => {
      segments.forEach(segment => segment.forEach((point, i) => {
        const a = {x: x(point.season_start), y: y(point.rolling_average)};
        const end = segment[i + 1] ?? point;
        const b = {x: x(end.season_start), y: y(end.rolling_average)};
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(px - a.x - t * dx, py - a.y - t * dy);
        if (d < distance) { distance = d; nearest = String(player.player_id); }
      }));
    });
    if (distance > 14) return;
    highlighted = highlighted === nearest ? null : nearest;
    applyHighlight();
  });
  draw();
}
