const elements = {
  policyName: document.querySelector("#policy-name"),
  error: document.querySelector("#methodology-error"),
  profiles: document.querySelector("#official-profiles"),
  contextPolicy: document.querySelector("#context-policy"),
  actionGroups: document.querySelector("#action-groups"),
  shotShares: document.querySelector("#shot-share-body"),
  defendedShotRates: document.querySelector("#dfg-rate-body"),
  blockRates: document.querySelector("#block-rate-body"),
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

function renderProfiles(rows) {
  elements.profiles.replaceChildren();
  rows.forEach((row) => {
    const card = node("article", "official-profile-card");
    card.append(node("h3", "", row.name));
    card.append(node("p", "profile-receipt", `Config ${row.configuration_receipt.slice(0, 12)}…`));
    const facts = node("dl", "profile-facts");
    const pairs = [
      ["General D", `${decimal(row.context_magnifiers.general_defense)}×`],
      ["Teammate D", `${decimal(row.context_magnifiers.teammate_defense)}×`],
      ["Opponent O", `${decimal(row.context_magnifiers.opponent_offense)}×`],
      ["Offense context", "1.00×"],
      ["K · O / D", `${decimal(row.reliability_k.offense)} / ${decimal(row.reliability_k.defense)}`],
      ["λ · O / D", `${decimal(row.lambda.offense)} / ${decimal(row.lambda.defense)}`],
    ];
    pairs.forEach(([label, value]) => {
      facts.append(node("dt", "", label));
      facts.append(node("dd", "", value));
    });
    card.append(facts);
    elements.profiles.append(card);
  });
}

function renderContextPolicy(policy) {
  const facts = [
    ["Context factors", String(policy.factor_order.length)],
    ["Shapley coalitions", String(policy.coalition_count)],
    ["Sign-aware adjustment", policy.sign_aware ? "Required" : "No"],
    ["Collapsed groups", "Raw · Offense · Defense"],
  ];
  elements.contextPolicy.replaceChildren();
  facts.forEach(([label, value]) => {
    const item = node("div", "factor-card");
    item.append(node("span", "", label));
    item.append(node("strong", "", value));
    elements.contextPolicy.append(item);
  });
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

function renderShotShares(rows) {
  elements.shotShares.replaceChildren();
  rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(node("td", "", row.label));
    tableRow.append(node("td", "numeric rate-value-cell", percent(row.shooter)));
    tableRow.append(node("td", "numeric rate-value-cell", percent(row.assister)));
    elements.shotShares.append(tableRow);
  });
}

function renderReference() {
  const query = elements.weightSearch.value.trim().toLocaleLowerCase();
  const visible = query
    ? referenceRows.filter((row) => `${row.key} ${row.note}`.toLocaleLowerCase().includes(query))
    : referenceRows;
  elements.weightReference.replaceChildren();
  visible.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(node("td", "component-key-cell", row.key));
    tableRow.append(node("td", "numeric rate-value-cell", decimal(row.weight)));
    tableRow.append(node("td", "component-note-cell", row.note || "—"));
    elements.weightReference.append(tableRow);
  });
  elements.referenceCount.textContent = `${visible.length} of ${referenceRows.length} component weights shown`;
}

async function loadMethodology() {
  try {
    const response = await fetch("/api/methodology", { cache: "no-store" });
    if (!response.ok) throw new Error("The official methodology could not be loaded.");
    const payload = await response.json();
    if (payload.schema_version !== "value-contributed-original-public-methodology-v1") {
      throw new Error("The methodology contract is incompatible with this page.");
    }
    elements.policyName.textContent = `Original · release ${payload.release_id.slice(0, 8)}`;
    renderProfiles(payload.official_rankings);
    renderContextPolicy(payload.context_policy);
    renderActionGroups(payload.action_reference.action_groups);
    renderShotShares(payload.action_reference.shot_shares);
    renderRateRows(elements.defendedShotRates, payload.action_reference.defended_shot_rates, "rate");
    renderRateRows(elements.blockRates, payload.action_reference.block_rates, "rate");
    referenceRows = payload.action_reference.raw_component_weights;
    renderReference();
  } catch (error) {
    elements.actionGroups.replaceChildren();
    elements.error.textContent = error.message;
    elements.error.hidden = false;
  }
}

elements.weightSearch.addEventListener("input", renderReference);
loadMethodology();
