// The model behind the player and team profile: how a published profile
// section becomes a radar, how a carousel of radars is ordered, how the six
// context amounts become a bar chart rather than a shape, how a career becomes
// a path across the type map, and how one season becomes a lane of everybody
// of the same type.
//
// Everything here is a pure function of a payload, so the shapes on the page
// can be proved against the server's own numbers under node rather than
// described in prose.  Nothing in this file touches the DOM: the drawing
// functions build a string of SVG, which the player page and the comparison
// page both hand to one element, so there is one radar in the site rather than
// two that drift apart.

/**
 * Where a spoke should reach, with outward always meaning better.
 *
 * `percentile` is where the entity stands on the number the axis publishes.
 * `direction` says whether a larger published number is better, and the two
 * together are the only orientation a chart needs: a turnover rate at the 98th
 * percentile of turnovers reaches 0.02, not 0.98, so a costly habit never
 * draws as an achievement.
 */
export function orientedPercentile(axis) {
  // `Number(null)` is 0, which is finite, so an axis the seasons record no
  // comparison for would otherwise draw at the very centre as if it were the
  // worst in the league. A missing percentile is missing.
  const raw = axis?.percentile;
  if (raw === null || raw === undefined) return null;
  const place = Number(raw);
  if (!Number.isFinite(place)) return null;
  const oriented = String(axis?.direction) === "lower_is_better" ? 1 - place : place;
  return Math.min(1, Math.max(0, oriented));
}

/** A percentile said the way a person would say it. */
export function percentileWords(value, noun = "players") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "not compared";
  }
  const percent = Math.min(99, Math.max(1, Math.round(Number(value) * 100)));
  return `better than ${percent}% of ${noun}`;
}

/**
 * The published sections are written about a player, and a team page shows the
 * same ones. Only our own sentences pass through here, so the four pronouns
 * are rewritten whole-word rather than a description being duplicated.
 */
export function forTeam(text) {
  return String(text ?? "")
    .replace(/\bhe\b/g, "it")
    .replace(/\bHe\b/g, "It")
    .replace(/\bhis\b/g, "its")
    .replace(/\bHis\b/g, "Its")
    .replace(/\bhim\b/g, "it");
}

/**
 * The one published sentence that names the pool a percentile was measured
 * against, said about a team.
 *
 * V11 publishes a team-worded rule of its own now, so this is a no-op on a
 * current payload; it is kept because a snapshot taken before that change —
 * or a source that never had one — still sends the player-worded sentence, and
 * a team page must not say "players" where it means team seasons. It is
 * deliberately separate from `forTeam`: a section label and a description are
 * never put through it, so no noun is rewritten by accident.
 */
export function forTeamRule(text) {
  return forTeam(text)
    .replace(/\bplayers\b/g, "team seasons")
    .replace(/\bplayer\b/g, "team season")
    .replace(/\bPlayers\b/g, "Team seasons")
    .replace(/\bPlayer\b/g, "Team season");
}

/**
 * Which way one section's own chart reads.
 *
 * Every section but one is `better`: `direction` orients the spoke, so outward
 * is always better and a cost never draws as an achievement. `negative_value`
 * is `cost`: every axis on it is an amount of value lost, so the chart draws
 * the *size* of the cost and further out means it cost him more. A player who
 * turns the ball over more than almost anybody then has a long turnovers
 * spoke instead of a point at the centre, which is the honest picture of a
 * chart titled "Where he lost value".
 */
export function sectionOrientation(section) {
  return String(section?.orientation ?? "better") === "cost" ? "cost" : "better";
}

/** Where a spoke reaches on a section that reads one way or the other. */
export function spokeReach(axis, orientation = "better") {
  if (orientation === "cost") {
    const raw = axis?.percentile;
    if (raw === null || raw === undefined) return null;
    const place = Number(raw);
    if (!Number.isFinite(place)) return null;
    // A cost axis publishes the amount it cost, so its own percentile already
    // rises with the cost: no turn, and the chart says which way it reads.
    return Math.min(1, Math.max(0, place));
  }
  return orientedPercentile(axis);
}

// Half the league holding exactly this entity's own number is not a place in
// the league; it is a tie. A percentile of a tie draws as a spike or as a
// point on the centre and means neither.
export const TIE_LIMIT = 0.5;

/** Whether an axis is a reading at all, or a tie standing in for one. */
export function isLevelWithTheLeague(axis) {
  const share = axis?.tie_share;
  if (share === null || share === undefined) return false;
  const value = Number(share);
  return Number.isFinite(value) && value >= TIE_LIMIT;
}

/**
 * The spokes of one radar: plain labels, the same spokes in the same order for
 * every entity, never a zero standing in for something a season did not
 * record.
 *
 * Which axes carry a spoke is the payload's own choice (`axis.chart`), not a
 * per-entity one, so two players' charts of the same area are the same chart
 * and can be read against each other. Three things still drop an axis here,
 * and each of them is named under the chart rather than drawn:
 *
 * * an axis the selected seasons record no comparison for (`masked`);
 * * an axis with no percentile at all;
 * * an axis where this entity and most of the league hold the same number,
 *   which is a tie rather than a reading (`tie_share`).
 *
 * Every axis, drawn or not, stays in the table beside the chart.
 */
// Twelve, not ten, since 2026-09-22: passing is sorted by the same ten shot
// families scoring is, and its screens, its fouls drawn and its secondary
// assists sit beside them. Ten cut the three the owner asked to see.
export function radarSpokes(section, { limit = 12, masked = new Set() } = {}) {
  const orientation = sectionOrientation(section);
  const axes = (section?.axes ?? []).map((axis, index) => ({
    axis,
    index,
    // A measurement the selected seasons never recorded is stored as a zero
    // beside a missing standard score, and every player carries the same zero,
    // so a percentile of it is a tie at the middle ring standing in for
    // evidence that does not exist. It gets no spoke.
    outward: masked.has(String(axis.key)) ? null : spokeReach(axis, orientation),
    wanted: axis.chart !== false,
    level: isLevelWithTheLeague(axis),
  }));
  const named = (item) => String(item.axis.label ?? item.axis.key);
  const omitted = axes
    .filter((item) => item.wanted && item.outward === null)
    .map(named);
  const tied = axes
    .filter((item) => item.wanted && item.outward !== null && item.level)
    .map(named);
  const usable = axes.filter(
    (item) => item.wanted && item.outward !== null && !item.level,
  );
  const chosen = usable
    .slice(0, Math.max(0, limit))
    .map((item) => ({ ...item.axis, outward: item.outward }));
  return {
    spokes: chosen,
    omitted,
    tied,
    orientation,
    shown: chosen.length,
    available: usable.length,
  };
}

const HOW_TO_READ = Object.freeze({
  scoring: "Every spoke is a kind of shot or a free throw; further out means he "
    + "produced more of his value that way than most of the league.",
  playmaking: "Further out means more value created for other people, sorted by "
    + "the shot his pass made.",
  rebounding_and_hustle: "Further out means he kept more possessions alive, ended "
    + "more of them, or did more of the work that never becomes a shot.",
  defense: "Further out means more shots defended or taken away.",
  defended_shots: "One spoke per place on the floor he was nearest defender on. "
    + "Further out means the shots from there cost the other team more than they "
    + "cost his own.",
  context: "One bar per factor, signed: to the right the game around him added "
    + "value, to the left it took value away. These are season totals, not rates, "
    + "and they are small on purpose.",
  negative_value: "This is the one chart where further out is worse: every spoke "
    + "is a cost, and the further out it reaches the more it cost him.",
  overall: "One spoke per measurement, grouped by offense, defense, role and shot "
    + "mix, each at the place it stands in the league that season.",
  // V12's value sections.
  passing: "Further out means more value from his passing, sorted by the shot "
    + "each pass created; the turnover spoke reaches further the less they cost him.",
  rebounding: "Further out means more value from rebounds, contested and "
    + "uncontested, at each end.",
  little_things: "Further out means more value from the work that never becomes "
    + "a shot: screens, box-outs, jump balls and loose balls.",
  // V13's two defense radars.
  shot_defense: "Further out means more shots contested, on his own man and in "
    + "help, and more value from the shots he defended, the blocks he made and "
    + "the fouls he avoided giving up.",
  disruption: "Further out means more of the ball taken away or knocked loose, "
    + "more charges drawn, and tougher players to guard.",
  // V13's matchup charts: who he guarded, and who guarded him.
  guarded_types: "Further out means he spent more of his defense on that kind of "
    + "scorer than most defenders did.",
  guarded_by_types: "Further out means that kind of defender guarded him more "
    + "than it guarded most scorers.",
});

/** The wheel's caption when a payload names its own groups (V12). */
export function wheelHowToRead(groups) {
  const labels = (groups ?? []).map((group) => String(group.label ?? group.key).toLowerCase());
  if (!labels.length) return howToRead("overall");
  const listed = labels.length > 1
    ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
    : labels[0];
  return `One spoke per measurement, grouped by ${listed}, each at the place it `
    + "stands in the league that season.";
}

/** The one-sentence caption a slide carries under its own title. */
export function howToRead(key) {
  return HOW_TO_READ[String(key)] ?? "Further out is better on every spoke.";
}

// What the rings mean, said at the rings themselves. A cost chart's rings read
// the other way round, and say so rather than leaving a reader to work it out.
const RING_WORDS = Object.freeze({
  better: Object.freeze({
    25: "behind 75%", 50: "league middle", 75: "better than 75%",
  }),
  cost: Object.freeze({
    25: "cheaper than 75%", 50: "league middle", 75: "costlier than 75%",
  }),
});

export function ringWords(orientation = "better") {
  return RING_WORDS[orientation === "cost" ? "cost" : "better"];
}

/** How a spoke's own reach is said in words, which way round the chart reads. */
export function reachWords(reach, noun = "players", orientation = "better") {
  if (reach === null || reach === undefined || !Number.isFinite(Number(reach))) {
    return "not compared";
  }
  const percent = Math.min(99, Math.max(1, Math.round(Number(reach) * 100)));
  return orientation === "cost"
    ? `cost him more than it cost ${percent}% of ${noun}`
    : `better than ${percent}% of ${noun}`;
}

/**
 * The carousel: one slide per published section, then the whole-profile wheel.
 *
 * A section with fewer than three comparable axes cannot be a radar, so it
 * travels as a table-only slide rather than as a triangle of nothing.
 */
export function carouselModel(
  sections, {
    limit = 12, overall = true, masked = new Set(), kind = "player", wheelGroups = null,
  } = {},
) {
  const say = kind === "team" ? forTeam : (text) => String(text ?? "");
  // The pool sentence is the only one that names a noun rather than a pronoun.
  const sayRule = kind === "team" ? forTeamRule : (text) => String(text ?? "");
  const slides = (sections ?? [])
    .filter((section) => (section?.axes ?? []).length > 0)
    .map((section) => {
      const {
        spokes, omitted, tied, orientation, shown, available,
      } = radarSpokes(section, { limit, masked });
      // Six of the seven sections are radars. The context amounts are six
      // small signed totals that net to zero across teammates, so the payload
      // asks for bars and the page draws bars.
      const wanted = String(section.chart ?? "radar");
      const drawn = wanted === "diverging_bars"
        ? "bars"
        : (spokes.length >= 3 ? "radar" : "levels");
      return {
        key: String(section.key),
        label: say(section.label ?? section.key),
        description: say(section.description ?? ""),
        comparison: String(section.comparison ?? "per_36"),
        orientation,
        percentileRule: sayRule(section.percentile_rule ?? ""),
        howToRead: say(howToRead(section.key)),
        kind: drawn,
        spokes,
        omitted,
        tied,
        maskedKeys: (section.axes ?? [])
          .map((axis) => String(axis.key))
          .filter((key) => masked.has(key)),
        shown,
        available,
        axes: section.axes ?? [],
      };
    });
  if (overall) {
    slides.push({
      key: "overall",
      label: "Everything at once",
      description: "Every measurement of the description on one wheel.",
      comparison: "per_36",
      orientation: "better",
      percentileRule: slides[0]?.percentileRule ?? "",
      howToRead: say(wheelGroups ? wheelHowToRead(wheelGroups) : howToRead("overall")),
      kind: "wheel",
      spokes: [],
      omitted: [],
      tied: [],
      maskedKeys: [],
      shown: 0,
      available: 0,
      axes: [],
    });
  }
  return slides;
}

// --- drawing: one radar, one set of rules, both pages ------------------------------
//
// The player page draws one shape and the comparison page draws up to four, so
// the radar is written once here and handed a list of series. Everything a
// label needs is measured before the box is drawn, which is the whole point:
// the viewBox reserves room for the longest wrapped label, so no measurement
// name is ever cut off or painted outside the chart at any width.

// Approximate text metrics, deliberately generous: `charWidth` is wider than
// the widest ordinary character of the font at this size, so a label that fits
// the reserved gutter by this arithmetic fits it on screen with room to spare.
export const LABEL_TYPE = Object.freeze({
  size: 9,
  lineHeight: 10.4,
  charWidth: 5.6,
  maxChars: 15,
  maxLines: 3,
  pad: 7,
});

/** The width one wrapped line takes, by the same arithmetic the box reserves. */
export function lineWidth(text, type = LABEL_TYPE) {
  return String(text ?? "").length * type.charWidth;
}

/**
 * A label broken onto at most three lines at word boundaries.
 *
 * Nothing is ever cut: a word longer than a line keeps its own line whole, and
 * the last line carries whatever is left rather than ending in an ellipsis. A
 * label that needs more than three lines is a label that needs shortening at
 * the source, and the test that measures every published label says so.
 */
export function wrapLabel(text, type = LABEL_TYPE) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  for (const word of words) {
    const held = lines.length ? lines[lines.length - 1] : null;
    if (held === null) { lines.push(word); continue; }
    const joined = `${held} ${word}`;
    if (joined.length <= type.maxChars || lines.length >= type.maxLines) {
      lines[lines.length - 1] = joined;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

/**
 * Every label of a set, wrapped, with the widest line each one needs.
 *
 * A label is either a plain string, in which case it belongs to the spoke of
 * the same position, or `{ index, text, description }` — which is how a wheel
 * of thirty-eight measurements carries four group names instead of thirty-eight
 * of its own.
 */
export function labelBlocks(labels, type = LABEL_TYPE) {
  return (labels ?? []).map((entry, position) => {
    const text = typeof entry === "string" ? entry : String(entry?.text ?? "");
    const lines = wrapLabel(text, type);
    return {
      label: text,
      index: typeof entry === "string" ? position : Number(entry?.index ?? position),
      description: typeof entry === "string" ? "" : String(entry?.description ?? ""),
      lines,
      lines_used: lines.length,
      width: Math.max(0, ...lines.map((line) => lineWidth(line, type))),
    };
  });
}

/**
 * The box a radar needs, given the labels it has to print in full.
 *
 * The gutter is the widest wrapped label rather than a guess, so a chart is
 * exactly as wide as its own names need and the shape stays in the middle of
 * it — no empty half beside a wheel pushed to one side.
 */
export function radarGeometry(labels, {
  radius = 118, type = LABEL_TYPE, count = null,
} = {}) {
  const blocks = labelBlocks(labels, type);
  const gutter = Math.max(0, ...blocks.map((block) => block.width)) + type.pad;
  const tall = Math.max(1, ...blocks.map((block) => block.lines_used))
    * type.lineHeight + type.pad;
  const reach = radius + 13;
  const width = Math.round((reach + gutter) * 2);
  const height = Math.round((reach + tall) * 2);
  const cx = width / 2;
  const cy = height / 2;
  const spokes = Math.max(1, Number(count) || blocks.length);
  const point = (index, scale) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / spokes;
    return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
  };
  return {
    width, height, cx, cy, radius, reach, gutter, blocks, count: spokes, point, type,
  };
}

/**
 * Where every printed label sits, and the box the chart reserved for them.
 *
 * The drawing places a label by the same arithmetic, so a test that measures
 * these boxes against the viewBox is measuring the chart itself: a label that
 * fits here is a label that is printed in full on screen.
 */
export function labelBoxes(labels, { radius = 118, type = LABEL_TYPE, count = null } = {}) {
  const geometry = radarGeometry(labels, { radius, type, count });
  const boxes = geometry.blocks.map((block) => {
    const [x, y] = geometry.point(block.index, geometry.reach / radius);
    const anchor = x < geometry.cx - 6 ? "end" : x > geometry.cx + 6 ? "start" : "middle";
    const above = y < geometry.cy - radius * 0.35;
    const below = y > geometry.cy + radius * 0.35;
    const first = above
      ? y - (block.lines_used - 1) * type.lineHeight
      : below
        ? y + type.size
        : y - (block.lines_used - 1) * type.lineHeight / 2 + type.size * 0.36;
    const width = block.width;
    const x0 = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x;
    return {
      label: block.label,
      lines: block.lines,
      anchor,
      x0,
      x1: x0 + width,
      y0: first - type.size,
      y1: first + (block.lines_used - 1) * type.lineHeight + type.size * 0.25,
    };
  });
  return { width: geometry.width, height: geometry.height, boxes, geometry };
}

// A reading exactly on the centre makes a shape a line through the origin and
// a marker impossible to hit, so every spoke starts a little way out and the
// caption says so.
export const SPOKE_FLOOR = 0.08;

export function spokeScale(reach) {
  return SPOKE_FLOOR + (1 - SPOKE_FLOOR) * Math.min(1, Math.max(0, Number(reach) || 0));
}

/**
 * How one shape is drawn when it has no comparison for some of its spokes.
 *
 * Every spoke present is one closed polygon, which is the ordinary case. A gap
 * is a real gap: the shape becomes one open line per unbroken run of spokes it
 * does have, starting after a gap so a run never wraps through one.
 */
export function spokeRuns(values) {
  const present = (values ?? []).map((row) => Boolean(row?.present));
  const count = present.length;
  if (!count) return { closed: false, runs: [] };
  if (present.every(Boolean)) return { closed: true, runs: [present.map((_row, index) => index)] };
  const firstGap = present.indexOf(false);
  const runs = [];
  let run = [];
  for (let step = 1; step <= count; step += 1) {
    const index = (firstGap + step) % count;
    if (present[index]) run.push(index);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return { closed: false, runs };
}

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fixed(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "—";
}

// A vertex: the marker shape the series carries, focusable, and carrying its
// own sentence so hovering or focusing it says the measurement, the rate and
// where it stands.
function markerMarkup(shape, x, y, size, colour, words) {
  const open = `class="radar-marker" fill="${escapeText(colour)}" tabindex="0" role="img" `
    + `aria-label="${escapeText(words)}"`;
  const title = `<title>${escapeText(words)}</title>`;
  const polygon = (points) => `<polygon ${open} points="${points
    .map((pair) => pair.map((value) => value.toFixed(1)).join(",")).join(" ")}">${title}</polygon>`;
  if (shape === "square") {
    return `<rect ${open} x="${(x - size).toFixed(1)}" y="${(y - size).toFixed(1)}" `
      + `width="${(size * 2).toFixed(1)}" height="${(size * 2).toFixed(1)}">${title}</rect>`;
  }
  if (shape === "triangle") {
    return polygon([[x, y - size * 1.2], [x + size * 1.1, y + size], [x - size * 1.1, y + size]]);
  }
  if (shape === "diamond") {
    return polygon([[x, y - size * 1.3], [x + size * 1.3, y], [x, y + size * 1.3],
      [x - size * 1.3, y]]);
  }
  return `<circle ${open} cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size}">${title}</circle>`;
}

/**
 * One radar, with one shape on it or with four.
 *
 * `spokes` are the axes to draw, in the order the payload publishes them.
 * `series` is one entry per shape: `{ name, color, dash, marker, readings }`,
 * where `readings[i]` is that shape's reading of `spokes[i]` — `present`,
 * `reach` (0 to 1, already oriented), `per36` and `value`.
 */
export function radarChartMarkup(spokes, series, {
  radius = 118,
  type = LABEL_TYPE,
  noun = "players",
  orientation = "better",
  ariaLabel = "",
  comparison = "per_36",
  seriesAttribute = null,
  labels = null,
  labelClass = "radar-label",
} = {}) {
  const list = spokes ?? [];
  const shapes = series ?? [];
  const printed = labels ?? list.map((spoke, index) => ({
    index, text: spoke.label, description: spoke.description ?? "",
  }));
  const geometry = radarGeometry(printed, { radius, type, count: list.length });
  const { cx, cy, point, blocks } = geometry;
  const rings = [[0.25, "is-quartile", "25"], [0.5, "is-median", "50"],
    [0.75, "is-quartile", "75"], [1, "is-edge", ""]]
    .map(([scale, className, name]) => (
      `<circle class="radar-ring ${className}" cx="${cx}" cy="${cy}" `
      + `r="${(radius * scale).toFixed(1)}"/>`
      + (name
        ? `<text class="radar-ring-label" x="${(cx + 3).toFixed(1)}" `
          + `y="${(cy - radius * scale + 3).toFixed(1)}">${name}</text>`
        : "")
    )).join("");
  const lines = list.map((_spoke, index) => {
    const [x, y] = point(index, 1);
    return `<line class="radar-spoke" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" `
      + `y2="${y.toFixed(1)}"/>`;
  }).join("");
  const drawn = shapes.map((shape, order) => {
    const readings = list.map((_spoke, index) => shape.readings?.[index] ?? { present: false });
    const { closed, runs } = spokeRuns(readings);
    const at = (index) => point(index, spokeScale(readings[index].reach))
      .map((value) => value.toFixed(1)).join(" ");
    const colour = escapeText(shape.color ?? "#28755d");
    const dash = shape.dash ? ` stroke-dasharray="${escapeText(shape.dash)}"` : "";
    const body = closed
      ? `<polygon class="radar-shape" points="${runs[0].map(at).join(" ")}" fill="${colour}" `
        + `fill-opacity="${shapes.length > 1 ? 0.13 : 0.2}" stroke="${colour}" `
        + `stroke-width="${shapes.length > 1 ? 2.4 : 2}"${dash}/>`
      : runs.filter((run) => run.length > 1).map((run) => (
        `<polyline class="radar-shape is-open" points="${run.map(at).join(" ")}" fill="none" `
        + `stroke="${colour}" stroke-width="${shapes.length > 1 ? 2.4 : 2}"${dash}/>`
      )).join("");
    const dots = list.map((spoke, index) => {
      const reading = readings[index];
      if (!reading.present) return "";
      const [x, y] = point(index, spokeScale(reading.reach));
      // A rate (matchup difficulty) is his own number, not a count per 36.
      const rate = spoke.unit === "ratio"
        ? `${fixed(reading.per36, 2)} × a league-average assignment`
        : spoke.unit === "per_100"
          ? `${fixed(reading.per36, 1)} per 100 possessions`
          : spoke.unit === "percent" || spoke.unit === "share"
            ? `${fixed(Number(reading.per36) * 100, 1)}%${spoke.unit === "share" ? " of his matchup possessions" : ""}`
            : comparison === "season_total"
          ? `${fixed(reading.value, 2)} over the season`
          : `${fixed(reading.per36, 2)} per 36`;
      // V12's shot types, locations and free throws publish both halves; the
      // reading names them beside the net. A payload without them reads as before.
      const halves = Number.isFinite(reading.makes) && Number.isFinite(reading.misses)
        ? ` (makes ${fixed(reading.makes, 2)}, misses ${fixed(reading.misses, 2)})`
        : "";
      const words = `${shape.name ? `${shape.name} · ` : ""}${spoke.label}: `
        + `${rate}${halves} · ${reachWords(reading.reach, noun, orientation)}`;
      return markerMarkup(
        shape.marker ?? "circle", x, y, shapes.length > 1 ? 4 : 3.6, colour, words,
      );
    }).join("");
    const attribute = seriesAttribute
      ? ` data-compare-series="${escapeText(`${seriesAttribute}-${order}`)}"`
      : "";
    return `<g class="radar-series${seriesAttribute ? " compare-series" : ""}"${attribute}>`
      + `${body}${dots}</g>`;
  }).join("");
  const texts = blocks.map((block) => {
    const outward = geometry.reach / radius;
    const [labelX, labelY] = point(block.index, outward);
    const anchor = labelX < cx - 6 ? "end" : labelX > cx + 6 ? "start" : "middle";
    const above = labelY < cy - radius * 0.35;
    const below = labelY > cy + radius * 0.35;
    const first = above
      ? labelY - (block.lines_used - 1) * geometry.type.lineHeight
      : below
        ? labelY + geometry.type.size
        : labelY - (block.lines_used - 1) * geometry.type.lineHeight / 2
          + geometry.type.size * 0.36;
    const spans = block.lines.map((line, row) => (
      `<tspan x="${labelX.toFixed(1)}" y="${(first + row * geometry.type.lineHeight).toFixed(1)}">`
      + `${escapeText(line)}</tspan>`
    )).join("");
    const title = block.description
      ? `<title>${escapeText(`${block.label}: ${block.description}`)}</title>` : "";
    return `<text class="${escapeText(labelClass)}" text-anchor="${anchor}">${spans}${title}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${geometry.width} ${geometry.height}" class="radar-svg`
    + `${orientation === "cost" ? " is-cost" : ""}" role="img" `
    + `aria-label="${escapeText(ariaLabel)}">${rings}${lines}${drawn}${texts}</svg>`;
}

/**
 * Fewer than three spokes is not a shape, so those sections draw bars: one row
 * per measurement, each reaching to where that entity stands in the league.
 */
export function levelBarsMarkup(spokes, series, {
  noun = "players", orientation = "better",
} = {}) {
  const list = spokes ?? [];
  const shapes = series ?? [];
  if (!list.length) return "";
  return `<ul class="level-bars${orientation === "cost" ? " is-cost" : ""}">${list.map(
    (spoke, index) => {
      const bars = shapes.map((shape) => {
        const reading = shape.readings?.[index];
        if (!reading?.present) {
          return '<li class="level-bar is-missing"><span>not compared</span></li>';
        }
        const width = Math.round(spokeScale(reading.reach) * 100);
        return `<li class="level-bar"><span class="level-name">${escapeText(shape.name ?? "")}`
          + `</span><span class="level-track"><span class="level-fill" style="width:${width}%;`
          + `background:${escapeText(shape.color ?? "#28755d")}"></span></span>`
          + `<b>${escapeText(reachWords(reading.reach, noun, orientation))}</b></li>`;
      }).join("");
      return `<li class="level-row"><b title="${escapeText(spoke.description ?? "")}">`
        + `${escapeText(spoke.label)}</b><ul>${bars}</ul></li>`;
    },
  ).join("")}</ul>`;
}

// --- the six context amounts, as bars rather than as a shape -----------------------
//
// A context amount is a small signed season total that nets to zero across a
// roster, and "value with every factor neutral" is not a factor at all. Ranking
// six of those in the league and joining the dots draws a shape that means
// nothing, which is what the comparison page was drawing. They are signed
// amounts, so they are drawn as signed bars either side of zero, and the
// arithmetic that matters — before, plus the six, is the published total — is
// printed beside them and closes on screen.

export function contextBaseline(section) {
  return (section?.axes ?? []).find(
    (axis) => String(axis.role ?? "") === "baseline"
      || String(axis.key) === "context_raw_value",
  ) ?? null;
}

export function contextFactors(section) {
  return (section?.axes ?? []).filter(
    (axis) => String(axis.key) !== "context_raw_value"
      && String(axis.role ?? "factor") !== "baseline",
  );
}

/**
 * One row per factor, in the payload's own fixed order, with one signed amount
 * per selection, and the three numbers that have to close beside each name.
 */
export function contextBarsModel(entries) {
  const list = (entries ?? []).filter((entry) => entry?.section);
  const order = [];
  const named = new Map();
  for (const entry of list) {
    for (const axis of contextFactors(entry.section)) {
      const key = String(axis.key);
      if (!named.has(key)) { named.set(key, axis); order.push(key); }
    }
  }
  const rows = order.map((key) => ({
    key,
    label: String(named.get(key).label ?? key),
    description: String(named.get(key).description ?? ""),
    values: list.map((entry) => {
      const axis = (entry.section.axes ?? []).find((row) => String(row.key) === key);
      const value = Number(axis?.value);
      return Number.isFinite(value) ? { present: true, value } : { present: false, value: 0 };
    }),
  }));
  const totals = list.map((entry) => {
    const baseline = contextBaseline(entry.section);
    const raw = Number(baseline?.value);
    const context = contextFactors(entry.section)
      .reduce((sum, axis) => sum + (Number.isFinite(Number(axis.value)) ? Number(axis.value) : 0), 0);
    return {
      name: String(entry.name ?? ""),
      seasons: String(entry.seasons ?? ""),
      raw: Number.isFinite(raw) ? raw : null,
      context,
      total: Number.isFinite(raw) ? raw + context : null,
      baselineLabel: String(baseline?.label ?? "Value before context"),
    };
  });
  const scale = Math.max(1e-6, ...rows.flatMap(
    (row) => row.values.filter((cell) => cell.present).map((cell) => Math.abs(cell.value)),
  ));
  return { rows, totals, scale, series: list.length };
}

/**
 * The same chart drawn for a narrow screen.
 *
 * A 620-unit box in a 317-pixel panel is drawn at 70%: the bars come out 9 px
 * tall and the amounts beside them under 6 px. This type is a third larger and
 * wraps sooner, and `CONTEXT_BARS_NARROW.width` is close enough to a phone's
 * own width that the chart is drawn at about its designed size. Every
 * measurement in the chart is expressed in units of `type.size`, so nothing has
 * to be re-tuned: the gutter, the bars and the spacing all follow the type.
 */
export const PHONE_LABEL_TYPE = Object.freeze({
  size: 12,
  lineHeight: 13.9,
  charWidth: 7.5,
  maxChars: 11,
  maxLines: 3,
  pad: 7,
});

export const CONTEXT_BARS_WIDE = Object.freeze({ width: 620, type: LABEL_TYPE });
export const CONTEXT_BARS_NARROW = Object.freeze({ width: 344, type: PHONE_LABEL_TYPE });

/** The diverging bar chart itself: a zero line, signed bars, amounts printed. */
export function contextBarsMarkup(model, series, {
  width = 620, unit = "Value Contributed", seriesAttribute = null,
  type = LABEL_TYPE, variant = "",
} = {}) {
  const shapes = series ?? [];
  if (!model?.rows?.length) return "";
  // Every fixed distance below is written at the default type's size and
  // scaled, so a larger type gives a proportionally roomier chart rather than
  // one whose labels collide with its bars.
  const k = type.size / LABEL_TYPE.size;
  const gutter = Math.max(56 * k, ...model.rows.flatMap(
    (row) => wrapLabel(row.label, type).map((line) => lineWidth(line, type)),
  )) + 12 * k;
  const left = Math.round(gutter);
  const right = 12 * k;
  const top = 20 * k;
  const barHeight = (shapes.length > 1 ? 13 : 17) * k;
  const gap = 4 * k;
  const rowGap = 14 * k;
  const plot = width - left - right;
  const zero = left + plot / 2;
  const room = Math.max(12 * k, plot / 2 - 52 * k);
  const place = (value) => zero + (value / model.scale) * room;
  let cursor = top;
  const blocks = model.rows.map((row) => {
    const lines = wrapLabel(row.label, type);
    const height = Math.max(
      lines.length * type.lineHeight,
      shapes.length * barHeight + (shapes.length - 1) * gap,
    );
    const block = { row, lines, top: cursor, height };
    cursor += height + rowGap;
    return block;
  });
  const height = Math.round(cursor - rowGap + 14 * k);
  const body = blocks.map((block) => {
    const middle = block.top + block.height / 2;
    const first = middle - (block.lines.length - 1) * type.lineHeight / 2 + type.size * 0.36;
    const label = `<text class="bar-label" text-anchor="end">${block.lines.map((line, index) => (
      `<tspan x="${(left - 10 * k).toFixed(1)}" y="${(first + index * type.lineHeight).toFixed(1)}">`
      + `${escapeText(line)}</tspan>`
    )).join("")}<title>${escapeText(`${block.row.label}: ${block.row.description}`)}</title></text>`;
    const bars = shapes.map((shape, order) => {
      const cell = block.row.values[order] ?? { present: false, value: 0 };
      const y = block.top + (block.height - (shapes.length * barHeight
        + (shapes.length - 1) * gap)) / 2 + order * (barHeight + gap);
      if (!cell.present) {
        return `<text class="bar-amount is-missing" x="${(zero + 6 * k).toFixed(1)}" `
          + `y="${(y + barHeight * 0.78).toFixed(1)}">no amount published</text>`;
      }
      const end = place(cell.value);
      const from = Math.min(zero, end);
      const span = Math.max(1.4, Math.abs(end - zero));
      const colour = escapeText(shape.color ?? "#28755d");
      const amount = `${cell.value >= 0 ? "+" : "−"}${fixed(Math.abs(cell.value), 2)}`;
      const words = `${shape.name ? `${shape.name} · ` : ""}${block.row.label}: `
        + `${amount} ${unit}`;
      const attribute = seriesAttribute
        ? ` data-compare-series="${escapeText(`${seriesAttribute}-${order}`)}"`
        : "";
      return `<g class="bar-series${seriesAttribute ? " compare-series" : ""}"${attribute}>`
        + `<rect class="context-bar is-${cell.value >= 0 ? "up" : "down"}" `
        + `x="${from.toFixed(1)}" y="${y.toFixed(1)}" width="${span.toFixed(1)}" `
        + `height="${barHeight.toFixed(1)}" fill="${colour}" fill-opacity="${cell.value >= 0 ? 0.9 : 0.45}" `
        + `stroke="${colour}" stroke-width="1"><title>${escapeText(words)}</title></rect>`
        + `<text class="bar-amount" x="${(cell.value >= 0 ? end + 5 * k : end - 5 * k).toFixed(1)}" `
        + `y="${(y + barHeight * 0.78).toFixed(1)}" `
        + `text-anchor="${cell.value >= 0 ? "start" : "end"}">${escapeText(amount)}</text></g>`;
    }).join("");
    return `${label}${bars}`;
  }).join("");
  const axis = `<line class="bar-zero" x1="${zero.toFixed(1)}" y1="${(top - 8 * k).toFixed(1)}" `
    + `x2="${zero.toFixed(1)}" y2="${(height - 16 * k).toFixed(1)}"/>`
    + `<text class="bar-zero-label" x="${zero.toFixed(1)}" y="${(top - 12 * k).toFixed(1)}" `
    + 'text-anchor="middle">0</text>';
  const classes = `context-bars${variant ? ` ${variant}` : ""}`;
  return `<svg viewBox="0 0 ${width} ${height}" class="${classes}" role="img" `
    + `aria-label="${escapeText(`Context factors in ${unit}, signed`)}">${axis}${body}</svg>`;
}

/**
 * Both drawings of the context chart, wide first.
 *
 * Only one is ever displayed — the stylesheet picks by viewport width — so a
 * reader sees one chart, a rotation needs no re-render and no resize listener
 * has to exist. The narrow one carries the same numbers, the same order and
 * the same titles as the wide one.
 */
export function contextBarsPair(model, series, options = {}) {
  return contextBarsMarkup(model, series, {
    ...options, ...CONTEXT_BARS_WIDE, variant: "is-wide",
  }) + contextBarsMarkup(model, series, {
    ...options, ...CONTEXT_BARS_NARROW, variant: "is-narrow",
  });
}

/**
 * Measurements the selected seasons simply do not record.
 *
 * Two shapes mean the same thing. A season that carries no value at all for a
 * measurement is plainly unavailable. A season from before the league recorded
 * it — box-outs and deflections before 2016-17, screen assists before that —
 * carries a stored zero for everybody, and the model marks it by leaving the
 * standard score out instead: every player ties, so a percentile of it is a
 * tie at the middle ring rather than a reading. Both are missing evidence, and
 * both are named rather than drawn.
 */
export function maskedMeasurements(dimensions) {
  const standardScore = (row) => (
    Object.prototype.hasOwnProperty.call(row, "similarity_value")
      ? row.similarity_value : row.z
  );
  return (dimensions ?? [])
    .filter((row) => row && (
      row.available === false
      || standardScore(row) === null || standardScore(row) === undefined
    ))
    .map((row) => ({ key: String(row.key), label: String(row.label ?? row.key) }))
    .filter((row) => row.key);
}

/**
 * The path a career took across the type map: only the selected seasons, in
 * time order, so a change of type is a line rather than a claim.
 */
export function careerPathModel(history, seasonEndYears = []) {
  const wanted = new Set((seasonEndYears ?? []).map(Number).filter(Number.isFinite));
  // Same trap as a missing percentile: `Number(null)` is 0, so a season with no
  // place on the map has to be recognised before it is measured.
  const placed = (value) => value !== null && value !== undefined
    && Number.isFinite(Number(value));
  return (history ?? [])
    .filter((row) => placed(row?.x) && placed(row?.y))
    .filter((row) => !wanted.size || wanted.has(Number(row.season_end_year)))
    .map((row) => ({
      season: String(row.season ?? ""),
      season_end_year: Number(row.season_end_year),
      id: String(row.id ?? ""),
      label: String(row.label ?? row.id ?? ""),
      provisional: Boolean(row.provisional),
      minutes: Number(row.minutes ?? 0),
      x: Number(row.x),
      y: Number(row.y),
    }))
    .sort((left, right) => left.season_end_year - right.season_end_year);
}

/**
 * One season, one lane: everybody of the same type that season, ordered by the
 * page's own metric, with this entity, his ten closest and the leaders marked.
 */
export function rankLaneModel(rows, {
  entityId,
  typeId,
  metric = "wins_contributed",
  similarIds = [],
  idOf = (row) => Number(row.player_id ?? row.team_id),
  nameOf = (row) => String(row.player_name ?? row.team_abbreviation ?? ""),
  typeOf = (row) => String(row.player_type?.id ?? row.team_type?.id ?? ""),
} = {}) {
  const similar = new Set((similarIds ?? []).map(Number));
  const peers = (rows ?? [])
    .filter((row) => String(typeOf(row)) === String(typeId))
    .map((row) => ({
      id: idOf(row),
      name: nameOf(row),
      season: String(row.season ?? ""),
      total: Number(row[metric]),
      minutes: Number(row.minutes ?? (Number(row.seconds_played) / 60)),
      teams: row.team_abbreviations ?? (row.team_abbreviation ? [row.team_abbreviation] : []),
    }))
    .filter((row) => Number.isFinite(row.total))
    .sort((left, right) => right.total - left.total
      || String(left.name).localeCompare(String(right.name)))
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      selected: Number(row.id) === Number(entityId),
      similar: similar.has(Number(row.id)),
    }));
  const selected = peers.find((row) => row.selected) ?? null;
  return {
    metric,
    peers,
    count: peers.length,
    selected,
    leaders: peers.slice(0, 3),
    median: medianOfTotals(peers),
    lowest: peers.length ? peers[peers.length - 1].total : null,
    highest: peers.length ? peers[0].total : null,
  };
}

function medianOfTotals(peers) {
  const ordered = peers.map((row) => row.total).sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

/**
 * Where each type sits on the map, as a faint region behind a path.
 *
 * One ellipse per type at the mean of its drawn seasons, one standard
 * deviation wide, which is the same shape the rankings map draws.  It is a
 * background, so a type with fewer than four seasons on the chart is left out
 * rather than drawn as a dot pretending to be a region.
 */
export function typeRegions(rows, { minimum = 4 } = {}) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    const id = String(row?.style?.id ?? row?.player_type?.id ?? row?.team_type?.id ?? "");
    const x = Number(row?.type_x);
    const y = Number(row?.type_y);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push([x, y]);
  }
  const regions = [];
  for (const [id, points] of grouped) {
    if (points.length < minimum) continue;
    const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    const spreadX = Math.sqrt(points.reduce(
      (sum, point) => sum + (point[0] - meanX) ** 2, 0,
    ) / points.length);
    const spreadY = Math.sqrt(points.reduce(
      (sum, point) => sum + (point[1] - meanY) ** 2, 0,
    ) / points.length);
    regions.push({ id, x: meanX, y: meanY, rx: spreadX, ry: spreadY, count: points.length });
  }
  return regions.sort((left, right) => right.count - left.count);
}

/**
 * Which seasons of a career path carry a label, and where every mark is drawn.
 *
 * Thirteen seasons of one career land in a small part of the map, and thirteen
 * labels and thirteen badges on top of each other is not a chart. Only the
 * first season, the last season and every season where the type changed are
 * named; the rest are small dots that say their own season on hover and on
 * focus. Marks that land on the same spot are nudged apart in season order, so
 * two seasons in the same corner stay two seasons.
 */
export function careerPathLayout(path, { x, y, spread = 9 } = {}) {
  const place = typeof x === "function" ? x : (value) => value;
  const height = typeof y === "function" ? y : (value) => value;
  const used = [];
  return (path ?? []).map((point, index) => {
    const previous = index ? path[index - 1] : null;
    const labelled = index === 0
      || index === path.length - 1
      || (previous !== null && String(previous.id) !== String(point.id));
    let px = place(point.x);
    let py = height(point.y);
    // A nudge, not a new position: the same ordered spiral every time, so a
    // reload draws the same chart.
    let turn = 0;
    while (used.some((seen) => Math.hypot(seen.px - px, seen.py - py) < spread)) {
      turn += 1;
      if (turn > 12) break;
      const angle = turn * (Math.PI * 2) / 6;
      const radius = spread * (1 + Math.floor((turn - 1) / 6));
      px = place(point.x) + Math.cos(angle) * radius;
      py = height(point.y) + Math.sin(angle) * radius;
    }
    used.push({ px, py });
    return { ...point, px, py, labelled, nudged: turn > 0 };
  });
}

/**
 * Where a lane's names go without covering each other.
 *
 * Every label used to be drawn on one line at its own mark's x, so three
 * leaders inside a point of each other printed on top of one another. The
 * names are laid out left to right on two rows, and a name that still has no
 * room is dropped — except the one the page is about, which is always kept.
 */
export function laneLabelLayout(labels, {
  rows = [0, -14], minimumGap = 58, keep = null,
} = {}) {
  const ordered = [...(labels ?? [])].sort((left, right) => left.x - right.x);
  const lastAt = rows.map(() => Number.NEGATIVE_INFINITY);
  const placed = [];
  for (const label of ordered) {
    const mustKeep = keep !== null && String(label.id) === String(keep);
    const row = lastAt.findIndex((last) => label.x - last >= minimumGap);
    if (row === -1) {
      if (!mustKeep) continue;
      // The one name the page is about never disappears: it takes the row it
      // fits least badly and the neighbour it crowds is the one dropped.
      const best = lastAt.indexOf(Math.min(...lastAt));
      const crowded = placed.findIndex((item) => item.row === best
        && label.x - item.x < minimumGap);
      if (crowded > -1) placed.splice(crowded, 1);
      lastAt[best] = label.x;
      placed.push({ ...label, row: best, dy: rows[best] });
      continue;
    }
    lastAt[row] = label.x;
    placed.push({ ...label, row, dy: rows[row] });
  }
  return placed;
}
