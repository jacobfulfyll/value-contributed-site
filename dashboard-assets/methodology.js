const elements = {
  policyName: document.querySelector("#policy-name"),
  error: document.querySelector("#methodology-error"),
  actionGroups: document.querySelector("#action-groups"),
  madeTemplates: document.querySelector("#shot-share-body"),
  defendedShotRates: document.querySelector("#dfg-rate-body"),
  factorPolicy: document.querySelector("#factor-policy"),
  weightSearch: document.querySelector("#weight-search"),
  weightReference: document.querySelector("#weight-reference-body"),
  referenceCount: document.querySelector("#reference-count"),
};

let referenceRows = [];

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function decimal(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(Number(value));
}

function percent(value) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function renderActionGroups(groups) {
  elements.actionGroups.replaceChildren();

  groups.forEach((group) => {
    const section = node("section", "action-group");
    section.append(node("h3", "", group.title));
    section.append(node("p", "action-group-summary", group.summary));

    const grid = node("div", "action-card-grid");
    group.actions.forEach((action) => {
      const card = node("article", `action-card action-${action.effect}`);
      const heading = node("div", "action-card-heading");
      heading.append(node("h4", "", action.label));
      heading.append(node("span", "action-value", decimal(action.value)));
      card.append(heading);
      card.append(node("p", "action-basis", `× ${action.basis}`));
      card.append(node("p", "action-explanation", action.explanation));
      const footer = node("div", "action-card-footer");
      footer.append(node("span", `effect-label ${action.effect}-pill`, action.effect));
      footer.append(node("code", "action-key", action.key));
      card.append(footer);
      grid.append(card);
    });

    section.append(grid);
    elements.actionGroups.append(section);
  });
}

function renderRateRows(target, rows, valueKey) {
  target.replaceChildren();
  rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(node("td", "", row.label));
    tableRow.append(node("td", "numeric rate-value-cell", percent(row[valueKey])));
    target.append(tableRow);
  });
}

function renderMadeTemplates(rows) {
  elements.madeTemplates.replaceChildren();
  rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(node("td", "", row.label));
    tableRow.append(node("td", "numeric rate-value-cell", percent(row.scorer)));
    tableRow.append(node("td", "numeric rate-value-cell", percent(row.passer)));
    tableRow.append(node("td", "numeric rate-value-cell", percent(row.oreb)));
    tableRow.append(node("td", "numeric rate-value-cell", percent(row.remainder)));
    elements.madeTemplates.append(tableRow);
  });
}

function renderFactorPolicy(policy) {
  const facts = [
    ["Missed two accountability", percent(policy.missed_two)],
    ["Missed three accountability", percent(policy.missed_three)],
    ["Regular FT shortfall", percent(policy.regular_free_throw_shortfall)],
    ["Turnover accountability", percent(policy.turnover_accountability)],
  ];

  elements.factorPolicy.replaceChildren();
  facts.forEach(([label, value]) => {
    const item = node("div", "factor-card");
    item.append(node("span", "", label));
    item.append(node("strong", "", value));
    elements.factorPolicy.append(item);
  });
}

function renderReference() {
  const query = elements.weightSearch.value.trim().toLocaleLowerCase();
  const visible = query
    ? referenceRows.filter((row) =>
        `${row.key} ${row.note}`.toLocaleLowerCase().includes(query),
      )
    : referenceRows;

  elements.weightReference.replaceChildren();
  visible.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(node("td", "component-key-cell", row.key));
    tableRow.append(node("td", "numeric rate-value-cell", decimal(row.weight)));
    tableRow.append(node("td", "component-note-cell", row.note || "—"));
    elements.weightReference.append(tableRow);
  });

  elements.referenceCount.textContent =
    `${visible.length} of ${referenceRows.length} component weights shown`;
}

async function loadMethodology() {
  try {
    const response = await fetch("/api/methodology", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("The current scoring policy could not be loaded.");
    }
    const payload = await response.json();

    elements.policyName.textContent = "Value Contributed methodology";
    renderActionGroups(payload.action_groups);
    renderMadeTemplates(payload.made_outcome_templates);
    renderRateRows(elements.defendedShotRates, payload.defended_shot_rates, "rate");
    renderFactorPolicy(payload.v7_negative_coefficients);
    referenceRows = payload.component_reference;
    renderReference();
  } catch (error) {
    elements.actionGroups.replaceChildren();
    elements.error.textContent = error.message;
    elements.error.hidden = false;
  }
}

elements.weightSearch.addEventListener("input", renderReference);
loadMethodology();
