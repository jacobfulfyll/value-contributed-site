const CONTRACT = "value-contributed-v11-public-methodology-v1";

const elements = {
  policyName: document.querySelector("#policy-name"),
  policyCoverage: document.querySelector("#policy-coverage"),
  summary: document.querySelector("#page-summary"),
  error: document.querySelector("#methodology-error"),
  definitions: document.querySelector("#definition-list"),
  exampleIntro: document.querySelector("#example-intro"),
  exampleTeams: document.querySelector("#example-teams"),
  exampleNote: document.querySelector("#example-note"),
  steps: document.querySelector("#pipeline-steps"),
  principles: document.querySelector("#principle-grid"),
  offenseEvidence: document.querySelector("#offense-evidence"),
  defenseEvidence: document.querySelector("#defense-evidence"),
  evidenceExcluded: document.querySelector("#evidence-excluded"),
  madeShotNote: document.querySelector("#made-shot-note"),
  madeShots: document.querySelector("#made-shot-body"),
  assistedNote: document.querySelector("#assisted-note"),
  assistedSplits: document.querySelector("#assisted-split-body"),
  defendedNote: document.querySelector("#defended-note"),
  defendedShots: document.querySelector("#defended-shot-body"),
  possessionNote: document.querySelector("#possession-note"),
  possessionPlays: document.querySelector("#possession-body"),
  constants: document.querySelector("#constant-groups"),
  validationNote: document.querySelector("#validation-note"),
  validation: document.querySelector("#validation-grid"),
  experimentsCopy: document.querySelector("#experiments-copy"),
  experimentsLink: document.querySelector("#experiments-link"),
  limits: document.querySelector("#limit-grid"),
  earlier: document.querySelector("#earlier-grid"),
  provenance: document.querySelector("#provenance-list"),
};

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function cell(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function share(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number(value));
}

function percent(value, places = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: places,
  }).format(Number(value));
}

function decimal(value, places = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(Number(value));
}

function signed(value, places = 1) {
  const number = Number(value);
  const text = decimal(Math.abs(number), places);
  if (number > 0) return `+${text}`;
  if (number < 0) return `−${text}`;
  return text;
}

function integer(value) {
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function longDate(value) {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function renderDefinitions(rows) {
  elements.definitions.replaceChildren();
  rows.forEach((row) => {
    elements.definitions.append(node("dt", "", row.term));
    elements.definitions.append(node("dd", "", row.meaning));
  });
}

function renderSteps(rows) {
  elements.steps.replaceChildren();
  rows.forEach((row) => {
    const item = node("li");
    item.append(node("span", "", String(row.ordinal)));
    const body = node("div");
    body.append(node("strong", "", row.title));
    body.append(node("p", "", row.body));
    item.append(body);
    elements.steps.append(item);
  });
}

function renderCards(target, rows) {
  target.replaceChildren();
  rows.forEach((row) => {
    const card = node("div");
    card.append(node("strong", "", row.title));
    card.append(node("p", "", row.body));
    target.append(card);
  });
}

function renderExample(example) {
  if (!example) {
    elements.exampleIntro.textContent =
      "The worked example needs the calculated seasons, which are not available right now. Everything else on this page still applies.";
    elements.exampleTeams.replaceChildren();
    elements.exampleNote.textContent = "";
    return;
  }
  const [first, second] = example.teams;
  const phase = example.season_type === "Regular Season" ? "regular-season game" : "playoff game";
  elements.exampleIntro.textContent =
    `This is a real ${phase}: ${first.team} against ${second.team} on ${longDate(example.game_date)}, ` +
    `in the ${example.season} season. Each roster below adds up to exactly 1. ` +
    `${first.team} won, so ${first.team}’s shares are also Wins Contributed; ${second.team}’s are not.`;
  elements.exampleTeams.replaceChildren();
  example.teams.forEach((team) => {
    const block = node("section", "example-team");
    const heading = node("h3");
    heading.append(node("strong", "", team.team));
    heading.append(document.createTextNode(" "));
    heading.append(
      node("span", "example-team-result", `${team.won ? "won" : "lost"} · defense was ${percent(team.defense_share)} of this team’s value`),
    );
    block.append(heading);
    const wrap = node("div", "method-table-wrap");
    const table = node("table", "method-table example-table");
    const caption = node(
      "caption",
      "visually-hidden",
      `${team.team} player shares, ${example.time_mode_label}`,
    );
    table.append(caption);
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    [
      ["Player", "col"],
      ["Min", "col"],
      ["Offense", "col"],
      ["Defense", "col"],
      ["Share", "col"],
      ["Defensive evidence", "col"],
    ].forEach(([label]) => {
      const th = cell("th", "", label);
      th.scope = "col";
      headRow.append(th);
    });
    head.append(headRow);
    table.append(head);
    const body = document.createElement("tbody");
    team.players.forEach((player) => {
      const row = document.createElement("tr");
      row.append(cell("td", "", player.player_name));
      row.append(cell("td", "numeric", decimal(player.minutes, 1)));
      row.append(cell("td", "numeric", share(player.offense)));
      row.append(cell("td", "numeric", share(player.defense)));
      row.append(cell("td", "numeric example-total-cell", share(player.value_contributed)));
      row.append(
        cell(
          "td",
          player.defensive_evidence < 0 ? "numeric evidence-negative" : "numeric",
          signed(player.defensive_evidence),
        ),
      );
      body.append(row);
    });
    table.append(body);
    const foot = document.createElement("tfoot");
    const footRow = document.createElement("tr");
    const label = cell("th", "", `${team.team} total`);
    label.scope = "row";
    footRow.append(label);
    footRow.append(cell("td", "", ""));
    footRow.append(cell("td", "", ""));
    footRow.append(cell("td", "", ""));
    footRow.append(cell("td", "numeric example-total-cell", share(team.total)));
    footRow.append(cell("td", "", ""));
    foot.append(footRow);
    table.append(foot);
    wrap.append(table);
    block.append(wrap);
    elements.exampleTeams.append(block);
  });
  elements.exampleNote.textContent =
    (example.selection_note ? `${example.selection_note} ` : "") +
    "Minutes are the competitive minutes the calculation uses, so blowout time is left out. " +
    "Defensive evidence is what a player’s defense was worth before it was turned into a share: " +
    "above zero he did better than an average defender would have, below zero worse. " +
    "A player at the bottom of his team’s defense can be given nothing on that side, but never less than nothing. " +
    "How much of a team’s value went to defense is decided team by team and game by game, so it can sit well " +
    "above or below the league’s usual share.";
}

function renderEvidence(categories) {
  const fill = (target, rows) => {
    target.replaceChildren();
    rows.forEach((row) => target.append(node("li", "", row.label)));
  };
  fill(elements.offenseEvidence, categories.offense);
  fill(
    elements.defenseEvidence,
    categories.defense.filter((row) => row.counted),
  );
  elements.evidenceExcluded.textContent = categories.excluded_note;
}

function renderMadeShots(section) {
  elements.madeShotNote.textContent = section.note;
  elements.madeShots.replaceChildren();
  section.rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(cell("td", "", row.label));
    tableRow.append(
      cell(
        "td",
        "",
        row.parts.map((part) => `${part.who} ${percent(part.share)}`).join(" · "),
      ),
    );
    elements.madeShots.append(tableRow);
  });
}

function renderAssistedSplits(section) {
  elements.assistedNote.textContent = section.note;
  elements.assistedSplits.replaceChildren();
  section.rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(cell("td", "", row.label));
    tableRow.append(cell("td", "numeric rate-value-cell", percent(row.shooter)));
    tableRow.append(cell("td", "numeric rate-value-cell", percent(row.passer)));
    elements.assistedSplits.append(tableRow);
  });
}

function renderDefendedShots(section) {
  elements.defendedNote.textContent = section.note;
  elements.defendedShots.replaceChildren();
  section.rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(cell("td", "", row.label));
    tableRow.append(cell("td", "numeric rate-value-cell", decimal(row.weight, 2)));
    elements.defendedShots.append(tableRow);
  });
}

function renderPossessionPlays(section) {
  elements.possessionNote.textContent = section.note;
  elements.possessionPlays.replaceChildren();
  section.rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(cell("td", "", row.label));
    tableRow.append(cell("td", "", row.who));
    tableRow.append(
      cell(
        "td",
        row.effect === "penalty" ? "numeric rate-value-cell evidence-negative" : "numeric rate-value-cell",
        signed(row.value, 2),
      ),
    );
    elements.possessionPlays.append(tableRow);
  });
}

function renderConstants(rows) {
  elements.constants.replaceChildren();
  const groups = [];
  rows.forEach((row) => {
    const existing = groups.find((group) => group.title === row.group);
    if (existing) existing.rows.push(row);
    else groups.push({ title: row.group, rows: [row] });
  });
  groups.forEach((group) => {
    const section = node("section", "constant-group");
    section.append(node("h3", "", group.title));
    const wrap = node("div", "method-table-wrap");
    const table = node("table", "method-table constant-table");
    table.append(node("caption", "visually-hidden", `${group.title} settings`));
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Setting", "Value", "What it does"].forEach((label) => {
      const th = cell("th", "", label);
      th.scope = "col";
      headRow.append(th);
    });
    head.append(headRow);
    table.append(head);
    const body = document.createElement("tbody");
    group.rows.forEach((row) => {
      const tableRow = document.createElement("tr");
      tableRow.append(cell("td", "", row.label));
      tableRow.append(cell("td", "numeric rate-value-cell", row.display));
      tableRow.append(cell("td", "component-note-cell", row.meaning));
      body.append(tableRow);
    });
    table.append(body);
    wrap.append(table);
    section.append(wrap);
    elements.constants.append(section);
  });
}

function renderProvenance(payload, extras) {
  const facts = [
    ["Calculation", payload.stat.label],
    ["Engine version", payload.engine_version],
    ["Settings chosen on", payload.provenance.constants_calibrated_on],
    ["Methodology receipt", `${payload.policy_receipt.slice(0, 12)}…`],
  ];
  extras.forEach(([label, value]) => facts.push([label, value]));
  elements.provenance.replaceChildren();
  facts.forEach(([label, value]) => {
    elements.provenance.append(node("dt", "", label));
    elements.provenance.append(node("dd", "", value));
  });
}

function renderCoverage(payload) {
  elements.policyName.textContent = payload.stat.label;
  const coverage = payload.coverage;
  elements.policyCoverage.textContent = coverage
    ? `${coverage.season_count} seasons · ${integer(coverage.game_count)} games · ${coverage.first_season} to ${coverage.latest_season}`
    : "The current calculation";
}

async function loadEarlierVersionReceipts() {
  const extras = [];
  const sources = [
    ["V10 configuration", "/api/v10/methodology", (body) => body.configuration_receipt],
    ["V9 release", "/api/methodology", (body) => body.release_id],
  ];
  for (const [label, url, pick] of sources) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const body = await response.json();
      const value = pick(body);
      if (value) extras.push([label, `${String(value).slice(0, 12)}…`]);
    } catch (error) {
      // An earlier version's endpoint is optional; the page does not need it.
    }
  }
  return extras;
}

async function loadMethodology() {
  let payload;
  try {
    const response = await fetch("/api/v11/methodology", { cache: "no-store" });
    if (!response.ok) throw new Error("The methodology could not be loaded.");
    payload = await response.json();
    if (payload.schema_version !== CONTRACT) {
      throw new Error("The methodology contract is incompatible with this page.");
    }
  } catch (error) {
    elements.error.textContent = globalThis.ValueContributedPageNotice.readableError(error);
    elements.error.hidden = false;
    return;
  }

  elements.summary.textContent = payload.summary;
  renderCoverage(payload);
  renderDefinitions(payload.definitions);
  renderExample(payload.worked_example);
  renderSteps(payload.pipeline);
  renderCards(elements.principles, payload.principles);
  renderEvidence(payload.action_values.evidence_categories);
  renderMadeShots(payload.action_values.made_shots);
  renderAssistedSplits(payload.action_values.assisted_splits);
  renderDefendedShots(payload.action_values.defended_shots);
  renderPossessionPlays(payload.action_values.possession_plays);
  renderConstants(payload.constants);
  elements.validationNote.textContent = payload.validation.note;
  renderCards(elements.validation, payload.validation.facts);
  // The pointer at the Experiments page is drawn only when the payload carries
  // one. With the site-wide switch off the section is not in this page at all,
  // and the payload has no `experiments` block to put in it.
  if (payload.experiments && elements.experimentsCopy && elements.experimentsLink) {
    elements.experimentsCopy.textContent = payload.experiments.body;
    elements.experimentsLink.href = payload.experiments.href;
  } else {
    document.querySelector("#experiments")?.remove();
    document.querySelector('.methodology-nav a[href="#experiments"]')?.remove();
  }
  renderCards(elements.limits, payload.limits);
  renderCards(
    elements.earlier,
    payload.earlier_versions.map((row) => ({ title: row.label, body: row.body })),
  );
  renderProvenance(payload, await loadEarlierVersionReceipts());
}

// This page describes V11. When the site also lists V12 it says so, and says
// that V12 has no page like this one yet, rather than leaving a reader who
// came from V12 to take V11's settings for V12's. V13 gets the same note.
async function noteNewerStatistic() {
  const note = document.querySelector("#methodology-v12-note");
  const v13Note = document.querySelector("#methodology-v13-note");
  if (!note && !v13Note) return;
  try {
    const response = await fetch("/api/sources", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const v12 = (payload.sources ?? []).find((row) => row.id === "v12");
    if (note && v12) {
      note.textContent = "This page describes V11. "
        + `${v12.description ?? "V12 is also listed on this site."} `
        + "V12 does not have a page like this one yet.";
      note.hidden = false;
    }
    const v13 = (payload.sources ?? []).find((row) => row.id === "v13");
    if (v13Note && v13) {
      v13Note.textContent = "This page describes V11. "
        + `${v13.description ?? "V13 is also listed on this site."} `
        + "V13 does not have a page like this one yet.";
      v13Note.hidden = false;
    }
  } catch {
    // The note is a courtesy; the page reads the same without it.
  }
}

loadMethodology();
noteNewerStatistic();
