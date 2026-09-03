export const RANKING_CARD_WIDTH = 1080;
export const RANKING_CARD_HEIGHT = 1350;
export const RANKING_CARD_ROW_COUNT = 10;

const METRICS = Object.freeze({
  value_contributed: { label: "Value Contributed", kind: "decimal" },
  wins_contributed: { label: "Wins Contributed", kind: "decimal" },
  losses_contributed: { label: "Loss VC", kind: "decimal" },
  value_per_game: { label: "VC per game", kind: "decimal" },
  value_per_game_rank: { label: "VC/game rank", kind: "rank" },
  postseason_value_per_game_difference: { label: "Postseason VC/game Δ", kind: "signed_decimal" },
  postseason_rank_change: { label: "Postseason rank Δ", kind: "signed_integer" },
  games_played: { label: "Games played", kind: "integer" },
  wins: { label: "Wins", kind: "integer" },
  losses: { label: "Losses", kind: "integer" },
  offense_value: { label: "Offense", kind: "decimal" },
  defense_value: { label: "Defense", kind: "decimal" },
  hustle_value: { label: "Hustle", kind: "decimal" },
  other_value: { label: "Other", kind: "decimal" },
  side_context_raw_value: { label: "Context Raw VC", kind: "decimal" },
  offense_context_value: { label: "Offense Context", kind: "decimal" },
  defense_context_value: { label: "Defense Context", kind: "decimal" },
  general_offense_context_value: { label: "Context General O", kind: "signed_decimal" },
  general_defense_context_value: { label: "Context General D", kind: "signed_decimal" },
  teammate_offense_context_value: { label: "Context Teammate O", kind: "signed_decimal" },
  opponent_offense_context_value: { label: "Context Opponent D", kind: "signed_decimal" },
  teammate_defense_context_value: { label: "Context Teammate D", kind: "signed_decimal" },
  opponent_defense_context_value: { label: "Context Opponent O", kind: "signed_decimal" },
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMetric(value, kind) {
  const numeric = finiteNumber(value);
  if (numeric === null) return "—";
  if (kind === "integer") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric);
  }
  if (kind === "rank") return `#${Math.round(numeric)}`;
  if (kind === "signed_integer") return `${numeric > 0 ? "+" : ""}${Math.round(numeric)}`;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(numeric);
  return kind === "signed_decimal" && numeric > 0 ? `+${formatted}` : formatted;
}

function rowTeams(row) {
  if (!Array.isArray(row?.teams)) return "";
  return row.teams
    .map((team) => typeof team === "string" ? team : team?.abbreviation || team?.name)
    .filter(Boolean)
    .join(" · ");
}

function cleanText(value, fallback, maximumLength = 120) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, maximumLength);
}

export function buildRankingCardModel({
  sourceName,
  isExperiment = false,
  season,
  phase,
  timeMode,
  sortBy,
  sortDirection,
  rows,
  siteLabel = "VALUE CONTRIBUTED",
} = {}) {
  const metric = METRICS[sortBy];
  if (!metric) throw new Error("The selected ranking metric cannot be rendered on a share card.");
  if (!Array.isArray(rows) || rows.length < RANKING_CARD_ROW_COUNT) {
    throw new Error("A ranking card requires at least ten players.");
  }
  if (!new Set(["asc", "desc"]).has(sortDirection)) {
    throw new Error("The ranking-card sort direction is invalid.");
  }
  const cardRows = rows.slice(0, RANKING_CARD_ROW_COUNT).map((row, index) => ({
    rank: index + 1,
    playerName: cleanText(row?.player_name, "Unknown player", 80),
    teams: cleanText(rowTeams(row), "", 48),
    metricValue: formatMetric(row?.[sortBy], metric.kind),
  }));
  return Object.freeze({
    width: RANKING_CARD_WIDTH,
    height: RANKING_CARD_HEIGHT,
    eyebrow: `NBA PLAYER VALUE · ${isExperiment ? "EXPERIMENT" : "ORIGINAL"}`,
    title: season === "All Seasons" ? "Career top 10" : `${cleanText(season, "Current")} top 10`,
    sourceName: cleanText(sourceName, isExperiment ? "My experiment" : "Original", 80),
    phase: cleanText(phase, "Full season", 48),
    timeMode: cleanText(timeMode, "", 48),
    metricKey: sortBy,
    metricLabel: metric.label,
    directionLabel: sortDirection === "asc" ? "LOW TO HIGH" : "HIGH TO LOW",
    isExperiment: Boolean(isExperiment),
    siteLabel: cleanText(siteLabel, "VALUE CONTRIBUTED", 80).toUpperCase(),
    rows: Object.freeze(cardRows.map(Object.freeze)),
  });
}

export function rankingCardAltText(model) {
  const names = model.rows.map((row) => `${row.rank}. ${row.playerName}, ${row.metricValue}`).join("; ");
  return `${model.title} from ${model.sourceName}, ranked by ${model.metricLabel}: ${names}.`;
}

function slug(value) {
  return String(value || "ranking")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase()
    .slice(0, 64) || "ranking";
}

export function rankingCardFileName(model) {
  return `value-contributed-${slug(model.title)}-${slug(model.sourceName)}-${slug(model.metricLabel)}.png`;
}

function roundedRectangle(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function fittedText(context, text, maximumWidth) {
  const value = String(text || "");
  if (context.measureText(value).width <= maximumWidth) return value;
  let end = value.length;
  while (end > 1 && context.measureText(`${value.slice(0, end)}…`).width > maximumWidth) end -= 1;
  return `${value.slice(0, end).trimEnd()}…`;
}

function drawTrackedText(context, text, x, y, tracking) {
  let cursor = x;
  for (const character of String(text)) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
}

export async function renderRankingCardPng(model, { documentImpl = globalThis.document } = {}) {
  if (!documentImpl?.createElement) throw new Error("This browser cannot create a ranking card.");
  if (documentImpl.fonts?.ready) await documentImpl.fonts.ready;
  const canvas = documentImpl.createElement("canvas");
  canvas.width = RANKING_CARD_WIDTH;
  canvas.height = RANKING_CARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot render a ranking card.");

  context.fillStyle = "#f4f1e7";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#10251f";
  context.fillRect(0, 0, canvas.width, 238);
  context.fillStyle = "#c8ff35";
  context.fillRect(0, 0, 18, canvas.height);

  context.textBaseline = "alphabetic";
  context.fillStyle = "#c8ff35";
  context.font = '700 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  drawTrackedText(context, model.eyebrow, 72, 70, 2.7);

  context.fillStyle = "#fffef8";
  context.font = '500 64px Georgia, "Times New Roman", serif';
  context.fillText(fittedText(context, model.title, 680), 72, 153);
  context.font = '600 23px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillStyle = "#d8e2dc";
  context.fillText(fittedText(context, model.sourceName, 680), 74, 199);

  roundedRectangle(context, 820, 61, 188, 54, 27);
  context.fillStyle = model.isExperiment ? "#c8ff35" : "#e7eee9";
  context.fill();
  context.fillStyle = "#10251f";
  context.font = '800 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = "center";
  context.fillText(model.isExperiment ? "EXPERIMENT" : "ORIGINAL", 914, 95);

  context.textAlign = "left";
  context.fillStyle = "#52635d";
  context.font = '700 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  drawTrackedText(context, `${model.phase} · ${model.timeMode}`.toUpperCase(), 72, 286, 1.1);
  context.fillStyle = "#1d302a";
  context.font = '700 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = "right";
  context.fillText(model.metricLabel, 1008, 284);
  context.fillStyle = "#718078";
  context.font = '700 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText(model.directionLabel, 1008, 307);

  const rowTop = 330;
  const rowHeight = 86;
  model.rows.forEach((row, index) => {
    const y = rowTop + index * rowHeight;
    roundedRectangle(context, 54, y, 972, 72, 14);
    context.fillStyle = index % 2 === 0 ? "#fffdf7" : "#ebe8de";
    context.fill();

    roundedRectangle(context, 72, y + 12, 48, 48, 24);
    context.fillStyle = "#10251f";
    context.fill();
    context.fillStyle = "#c8ff35";
    context.font = '800 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.textAlign = "center";
    context.fillText(String(row.rank), 96, y + 44);

    context.textAlign = "left";
    context.fillStyle = "#10251f";
    context.font = '700 27px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.fillText(fittedText(context, row.playerName, 540), 146, y + 34);
    context.fillStyle = "#69766f";
    context.font = '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    drawTrackedText(context, fittedText(context, row.teams.toUpperCase(), 430), 146, y + 57, 1.3);

    context.fillStyle = "#10251f";
    context.font = '700 30px Georgia, "Times New Roman", serif';
    context.textAlign = "right";
    context.fillText(row.metricValue, 1002, y + 45);
  });

  context.textAlign = "left";
  context.fillStyle = "#10251f";
  context.fillRect(54, 1203, 972, 2);
  context.font = '800 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  drawTrackedText(context, model.siteLabel, 58, 1254, 1.8);
  context.fillStyle = "#65736c";
  context.font = '500 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = "right";
  context.fillText(
    model.isExperiment ? "CALCULATED LOCALLY · IMAGE ONLY" : "ORIGINAL PLAYER VALUE RANKINGS",
    1022,
    1254,
  );
  context.textAlign = "left";
  context.fillStyle = "#718078";
  context.font = '500 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.fillText("Generated privately in your browser. No ranking data was uploaded.", 58, 1293);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode the ranking card as PNG."));
    }, "image/png");
  });
}
