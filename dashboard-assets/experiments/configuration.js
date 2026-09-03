import { BrowserExperimentError, CONFIGURATION_SCHEMA_VERSION, ENGINE_VERSION, RESPONSIBILITY_ADAPTER_VERSION, TIME_MODES, sortedUniqueSeasons } from "./protocol.js";
import { sha256Hex } from "./hash.js";
import { fsum } from "./binary64.js";

const RAW_EXPANDED_FORMAT = "value-contributed-v7-lab-expanded-v1";
const CONFIGURATION_FORMAT = "value-contributed-original-experiment-config-v1";
const CONTEXT_CONFIG_VERSION = "value-contributed-full-lineup-context-config-v1-2026-08-29";
const FACTOR_ORDER = Object.freeze([
  "general_offense",
  "general_defense",
  "teammate_offense",
  "teammate_defense",
  "opponent_offense",
  "opponent_defense",
]);
const SIDES = Object.freeze(["offense", "defense"]);
const FROZEN_RATING_INFLUENCE = Object.freeze({
  "lab.rating_influence.game_on_off_offense": 1,
  "lab.rating_influence.game_on_off_defense": 1,
  "lab.rating_influence.opponent_defensive_lineup_on_offense": 1,
  "lab.rating_influence.opponent_offensive_lineup_on_defense": 1,
  "lab.rating_influence.team_responsibility_balance": 1,
});
const RESIDUAL_SCALE = Object.freeze({
  all_minutes: Object.freeze({ offense: 1.129206215388943, defense: 1.129206215388943 }),
  competitive: Object.freeze({ offense: 1.1271115884403284, defense: 1.1271115884403284 }),
});

function configurationError(code, message, details) {
  return new BrowserExperimentError(code, message, details);
}

function plainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw configurationError("invalid_configuration", `${path} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw configurationError("invalid_configuration", `${path} contains an unsafe key.`);
    }
  }
  return value;
}

function exactKeys(value, allowed, path) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw configurationError("invalid_configuration", `${path} contains unknown fields: ${unexpected.sort().join(", ")}.`);
  }
}

function boundedNumber(value, path, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw configurationError(
      "configuration_bound_violation",
      `${path} must be a finite number in [${minimum}, ${maximum}].`,
    );
  }
  return value;
}

function normalizedName(value) {
  if (typeof value !== "string") {
    throw configurationError("invalid_configuration", "Experiment name must be text.");
  }
  const name = value.trim().replace(/\s+/gu, " ");
  if (!name || name.length > 80) {
    throw configurationError("invalid_configuration", "Experiment name must contain 1–80 characters.");
  }
  return name;
}

function float64Hex(value) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function typedValue(value, path, integerPaths) {
  if (value === null) return ["null"];
  if (typeof value === "boolean") return ["bool", value];
  if (typeof value === "string") return ["str", value];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a nonfinite number.`);
    if (integerPaths(path, value)) {
      if (!Number.isSafeInteger(value)) throw new TypeError(`${path} is not a safe integer.`);
      return ["int", String(value)];
    }
    return ["float64", float64Hex(value)];
  }
  if (Array.isArray(value)) {
    return ["array", value.map((child, index) => typedValue(child, `${path}[${index}]`, integerPaths))];
  }
  plainObject(value, path);
  return [
    "object",
    Object.keys(value).sort().map((key) => [key, typedValue(value[key], `${path}.${key}`, integerPaths)]),
  ];
}

async function typedContentSha256(value, formatName, integerPaths = () => false, cryptoImpl = globalThis.crypto) {
  const body = {
    format: formatName,
    value: typedValue(value, "$", integerPaths),
  };
  return sha256Hex(JSON.stringify(body), cryptoImpl);
}

function typedSemanticEqual(left, right, integerPaths = () => false) {
  return JSON.stringify(typedValue(left, "$", integerPaths))
    === JSON.stringify(typedValue(right, "$", integerPaths));
}

function rawCatalog(catalog) {
  const root = plainObject(catalog, "catalog");
  if (root.schema_version !== "value-contributed-original-browser-catalog-v1"
      || root.engine_version !== ENGINE_VERSION
      || !Array.isArray(root.groups)
      || !Array.isArray(root.raw_fields)) {
    throw configurationError("invalid_catalog", "The verified coefficient catalog is incompatible with this engine.");
  }
  const groups = root.groups.map((group) => plainObject(group, "catalog.groups[]"));
  const groupKeys = groups.map((group) => String(group.key));
  if (groupKeys.length !== 6 || new Set(groupKeys).size !== groupKeys.length) {
    throw configurationError("invalid_catalog", "The catalog must expose exactly six unique Basic groups.");
  }
  const editable = root.raw_fields.filter((field) => field.classification === "editable_leaf");
  if (editable.length !== 68 || Number(root.editable_raw_field_count) !== 68) {
    throw configurationError("invalid_catalog", "The catalog must expose exactly 68 editable raw coefficients.");
  }
  const editableKeys = new Set(editable.map((field) => field.key));
  if (editableKeys.size !== editable.length || editable.some((field) => !groupKeys.includes(field.group))) {
    throw configurationError("invalid_catalog", "Editable coefficient identities or Basic groups drifted.");
  }
  return { root, groups, groupKeys, editable, editableKeys };
}

function expandRaw(draftRaw, catalog) {
  const raw = plainObject(draftRaw || {}, "raw");
  exactKeys(raw, new Set(["parent_multipliers", "overrides"]), "raw");
  const parentsInput = plainObject(raw.parent_multipliers || {}, "raw.parent_multipliers");
  const overridesInput = plainObject(raw.overrides || {}, "raw.overrides");
  const { root, groups, groupKeys, editable, editableKeys } = rawCatalog(catalog);
  exactKeys(parentsInput, new Set(groupKeys), "raw.parent_multipliers");
  exactKeys(overridesInput, editableKeys, "raw.overrides");

  const parents = Object.fromEntries(groups.map((group) => [
    group.key,
    boundedNumber(parentsInput[group.key] ?? 1, `raw.parent_multipliers.${group.key}`, 0, 5),
  ]));
  const overrides = Object.fromEntries(Object.keys(overridesInput).sort().map((key) => [
    key,
    boundedNumber(overridesInput[key], `raw.overrides.${key}`, 0, 1),
  ]));
  const effective = {};
  for (const field of [...editable].sort((left, right) => left.key.localeCompare(right.key))) {
    const inherited = Number(field.baseline) * parents[field.group];
    effective[field.key] = boundedNumber(
      Object.hasOwn(overrides, field.key) ? overrides[field.key] : inherited,
      `raw.effective.${field.key}`,
      0,
      1,
    );
  }

  const derived = {};
  const totals = {};
  const templateRemainders = root.raw_fields
    .filter((field) => field.classification === "derived_read_only"
      && field.derivation === "1 - sum(editable role coefficients)")
    .sort((left, right) => left.key.localeCompare(right.key));
  for (const field of templateRemainders) {
    const templateKey = field.key.slice(0, -".policy_remainder".length);
    const roles = editable.filter((candidate) =>
      Array.isArray(candidate.dependent_templates)
      && candidate.dependent_templates.includes(templateKey));
    if (!roles.length) {
      throw configurationError("invalid_catalog", `Template ${templateKey} has no editable roles.`);
    }
    const total = fsum(roles.map((role) => effective[role.key]));
    if (total > 1 + 1e-12) {
      throw configurationError("template_closure_failed", `${templateKey} allocates ${total}, above 1.`);
    }
    totals[templateKey] = total;
    derived[field.key] = Math.max(0, 1 - total);
  }

  const pressure = "v6.blocks_and_turnovers.pressure_defense.five_player_total_coefficient";
  derived["v6.blocks_and_turnovers.pressure_defense.per_player_coefficient"] = effective[pressure] / 5;

  const drawerKey = "v6.retained_fouls.fouled_player_share.away_from_play";
  const drawer = effective[drawerKey];
  for (const field of root.raw_fields.filter((candidate) =>
    candidate.classification === "derived_read_only"
    && candidate.key.startsWith("v6.retained_fouls.fouled_player_share.")
    && candidate.key !== drawerKey)) {
    derived[field.key] = drawer;
  }
  derived["v6.retained_fouls.shooter_share_when_distinct"] = 1 - drawer;

  const retained = "v6.retained_fouls.oreb_completion.positive_templates";
  const retainedOreb = effective[`${retained}.same_or_unknown_drawer.oreb_pool`];
  const nonOreb = 1 - retainedOreb;
  Object.assign(derived, {
    [`${retained}.same_or_unknown_drawer.retained_ft_shooter`]: nonOreb,
    [`${retained}.same_or_unknown_drawer.policy_remainder`]: 0,
    [`${retained}.distinct_drawer.foul_drawer`]: nonOreb * drawer,
    [`${retained}.distinct_drawer.retained_ft_shooter`]: nonOreb * (1 - drawer),
    [`${retained}.distinct_drawer.oreb_pool`]: retainedOreb,
    [`${retained}.distinct_drawer.policy_remainder`]: 0,
  });
  totals[`${retained}.same_or_unknown_drawer`] = 1;
  totals[`${retained}.distinct_drawer`] = 1;

  const turnover = effective["v7.negative_actions.turnover_accountability_coefficient"];
  derived["v7.negative_actions.turnover_scope.identified_actor_coefficient"] = turnover;
  derived["v7.negative_actions.turnover_scope.team_coded_exact_five_total_coefficient"] = turnover;
  derived["v7.negative_actions.turnover_scope.team_coded_per_player_coefficient"] = turnover / 5;
  const near = effective["v7.defended_field_goals.location_coefficients.near_rim"];
  const atRimBonus = effective["v7.defended_field_goals.location_coefficients.at_rim_bonus"];
  if (near + atRimBonus > 1 + 1e-12) {
    throw configurationError("template_closure_failed", "Near-rim coefficient plus at-rim bonus must be at most 1.");
  }
  derived["v7.defended_field_goals.at_rim_total"] = near + atRimBonus;

  return {
    catalogVersion: root.raw_catalog_version,
    rawContractVersion: root.raw_contract_version,
    parents,
    overrides,
    effective: Object.fromEntries(Object.entries(effective).sort(([left], [right]) => left.localeCompare(right))),
    derived: Object.fromEntries(Object.entries(derived).sort(([left], [right]) => left.localeCompare(right))),
    totals: Object.fromEntries(Object.entries(totals).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function expandContext(draftContext) {
  const context = plainObject(draftContext || {}, "context");
  exactKeys(context, new Set(["magnifiers", "reliability_k", "lambda"]), "context");
  const magnifiersInput = plainObject(context.magnifiers || {}, "context.magnifiers");
  const reliabilityInput = plainObject(context.reliability_k || {}, "context.reliability_k");
  const lambdaInput = plainObject(context.lambda || {}, "context.lambda");
  exactKeys(magnifiersInput, new Set(FACTOR_ORDER), "context.magnifiers");
  exactKeys(reliabilityInput, new Set(SIDES), "context.reliability_k");
  exactKeys(lambdaInput, new Set(SIDES), "context.lambda");
  const magnifiers = Object.fromEntries(FACTOR_ORDER.map((factor) => [
    factor,
    boundedNumber(magnifiersInput[factor] ?? 1, `context.magnifiers.${factor}`, 0, 5),
  ]));
  const reliability = Object.fromEntries(SIDES.map((side) => [
    side,
    boundedNumber(reliabilityInput[side] ?? 0, `context.reliability_k.${side}`, 0, 500),
  ]));
  const lambda = Object.fromEntries(SIDES.map((side) => [
    side,
    boundedNumber(lambdaInput[side] ?? 1, `context.lambda.${side}`, 0, 2),
  ]));
  const expanded = {
    config_version: CONTEXT_CONFIG_VERSION,
    general_offense_coefficient: magnifiers.general_offense,
    general_defense_coefficient: magnifiers.general_defense,
    teammate_offense_coefficient: magnifiers.teammate_offense,
    teammate_defense_coefficient: magnifiers.teammate_defense,
    opponent_offense_coefficient: magnifiers.opponent_offense,
    opponent_defense_coefficient: magnifiers.opponent_defense,
    lambda_offense: lambda.offense,
    lambda_defense: lambda.defense,
    reliability_k_offense: reliability.offense,
    reliability_k_defense: reliability.defense,
    exposure_power_offense: 2,
    exposure_power_defense: 2,
    residual_scale: structuredClone(RESIDUAL_SCALE),
  };
  return { magnifiers, reliability, lambda, expanded };
}

export async function expandOriginalExperimentConfiguration(draft, catalog, cryptoImpl = globalThis.crypto) {
  const root = plainObject(draft, "configuration");
  exactKeys(root, new Set([
    "schema_version", "name", "selected_seasons", "raw", "context",
    "engine_version", "time_modes", "expanded_raw", "expanded_context",
    "responsibility_adapter_version", "configuration_receipt",
  ]), "configuration");
  if ((root.schema_version ?? CONFIGURATION_SCHEMA_VERSION) !== CONFIGURATION_SCHEMA_VERSION
      || (root.engine_version ?? ENGINE_VERSION) !== ENGINE_VERSION) {
    throw configurationError("invalid_configuration", "Configuration schema or engine version drifted.");
  }
  if (root.time_modes && (root.time_modes.length !== TIME_MODES.length
      || root.time_modes.some((mode, index) => mode !== TIME_MODES[index]))) {
    throw configurationError("invalid_configuration", "Configuration time modes drifted.");
  }
  const name = normalizedName(root.name ?? "Untitled Experiment");
  const selectedSeasons = sortedUniqueSeasons(root.selected_seasons ?? [2026]);
  const raw = expandRaw(root.raw || {}, catalog);
  const context = expandContext(root.context || {});

  const rawExpansionIdentity = {
    catalog_version: raw.catalogVersion,
    contract_version: raw.rawContractVersion,
    parents: raw.parents,
    overrides: raw.overrides,
    ratings: FROZEN_RATING_INFLUENCE,
    effective: raw.effective,
    derived: raw.derived,
  };
  const expandedSha256 = await typedContentSha256(
    rawExpansionIdentity,
    RAW_EXPANDED_FORMAT,
    () => false,
    cryptoImpl,
  );
  const expandedRaw = {
    catalog_version: raw.catalogVersion,
    raw_contract_version: raw.rawContractVersion,
    parent_multipliers: raw.parents,
    overrides: raw.overrides,
    effective_leaves: raw.effective,
    derived_values: raw.derived,
    template_totals: raw.totals,
    source_expanded_sha256: expandedSha256,
  };
  const semantic = {
    schema_version: CONFIGURATION_SCHEMA_VERSION,
    engine_version: ENGINE_VERSION,
    selected_seasons: selectedSeasons,
    time_modes: [...TIME_MODES],
    raw: expandedRaw,
    context: context.expanded,
    responsibility_adapter_version: RESPONSIBILITY_ADAPTER_VERSION,
  };
  const configurationReceipt = await typedContentSha256(
    semantic,
    CONFIGURATION_FORMAT,
    (path, value) => /^\$\.selected_seasons\[\d+\]$/u.test(path) && Number.isInteger(value),
    cryptoImpl,
  );
  if (root.expanded_raw && !typedSemanticEqual(root.expanded_raw, expandedRaw)) {
    throw configurationError("invalid_configuration", "Expanded raw values do not match the editable draft.");
  }
  if (root.expanded_context && !typedSemanticEqual(root.expanded_context, context.expanded)) {
    throw configurationError("invalid_configuration", "Expanded context values do not match the editable draft.");
  }
  if (root.responsibility_adapter_version
      && root.responsibility_adapter_version !== RESPONSIBILITY_ADAPTER_VERSION) {
    throw configurationError("invalid_configuration", "Responsibility adapter version drifted.");
  }
  if (root.configuration_receipt && root.configuration_receipt !== configurationReceipt) {
    throw configurationError("configuration_receipt_mismatch", "Configuration receipt does not match its expanded values.");
  }
  return {
    schema_version: CONFIGURATION_SCHEMA_VERSION,
    name,
    selected_seasons: selectedSeasons,
    raw: { parent_multipliers: raw.parents, overrides: raw.overrides },
    context: {
      magnifiers: context.magnifiers,
      reliability_k: context.reliability,
      lambda: context.lambda,
    },
    engine_version: ENGINE_VERSION,
    time_modes: [...TIME_MODES],
    expanded_raw: expandedRaw,
    expanded_context: context.expanded,
    responsibility_adapter_version: RESPONSIBILITY_ADAPTER_VERSION,
    configuration_receipt: configurationReceipt,
  };
}

export const ORIGINAL_CONTEXT_FACTOR_ORDER = FACTOR_ORDER;
export { typedContentSha256 };
