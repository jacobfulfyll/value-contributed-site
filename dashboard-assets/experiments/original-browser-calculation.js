import { BrowserExperimentError, ENGINE_VERSION, RESULT_SCHEMA_VERSION, RESPONSIBILITY_ADAPTER_VERSION } from "./protocol.js";
import { bitIdentical, exactClose, fsum, nextAfter } from "./binary64.js";
import { canonicalSha256 } from "./hash.js";

export const ORIGINAL_BROWSER_CALCULATION_VERSION = `${ENGINE_VERSION}:calculation-v2`;
export const ORIGINAL_BROWSER_PARITY_TOLERANCE = 5e-12;
export const CONTEXT_FACTOR_ORDER = Object.freeze([
  "general_offense",
  "general_defense",
  "teammate_offense",
  "teammate_defense",
  "opponent_offense",
  "opponent_defense",
]);
const OFFENSE_FACTORS = new Set(["general_offense", "teammate_offense", "opponent_defense"]);
const DEFENSE_FACTORS = new Set(["general_defense", "teammate_defense", "opponent_offense"]);
const SIDES = Object.freeze(["offense", "defense", "other"]);
const AMOUNT_ORDER = Object.freeze(["raw_vc", ...CONTEXT_FACTOR_ORDER]);
const SHAPLEY_DENOMINATOR = 720;
const FACTORIAL = Object.freeze([1, 1, 2, 6, 24, 120, 720]);
const OFFICIAL_RAW_PROFILE_SHA256 = "b1ac1071bb7e15013425d753bd6406b0e453d7fc952ae24661fcda0a126b8237";
const OFFICIAL_DEFENSE_PROFILE_SLUGS = Object.freeze({
  1: "original",
  3: "original-defense-context-3x",
  5: "original-defense-context-5x",
});
const SEASON_TYPES = new Set(["Regular Season", "PlayIn", "Playoffs"]);

function calculationError(code, message, details) {
  return new BrowserExperimentError(code, message, details);
}

function finite(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw calculationError("nonfinite_calculation", `${path} must be finite.`);
  return number;
}

function integer(value, path) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw calculationError("invalid_integer", `${path} must be a safe integer.`);
  return number;
}

function positiveInteger(value, path) {
  const number = integer(value, path);
  if (number <= 0) throw calculationError("invalid_integer", `${path} must be a positive safe integer.`);
  return number;
}

function identity(...values) {
  return values.join("\u001f");
}

function popcount(value) {
  let bits = value;
  let count = 0;
  while (bits) {
    bits &= bits - 1;
    count += 1;
  }
  return count;
}

function signAwareAdjust(value, multiplier) {
  const signed = finite(value, "signed value");
  const factor = finite(multiplier, "context multiplier");
  if (factor <= 0) throw calculationError("invalid_context_multiplier", "A context multiplier must be positive.");
  const result = signed > 0 ? signed * factor : signed < 0 ? signed / factor : 0;
  if (!Number.isFinite(result) || (result !== 0 && Math.sign(result) !== Math.sign(signed))) {
    throw calculationError("invalid_context_adjustment", "Sign-aware adjustment became invalid.");
  }
  return result;
}

function positiveOnlyClose(signedValues) {
  const playerIds = Object.keys(signedValues).map(Number).sort((left, right) => left - right);
  if (!playerIds.length) throw calculationError("empty_team", "Positive close requires players.");
  const floored = Object.fromEntries(playerIds.map((playerId) => [playerId, Math.max(finite(signedValues[playerId], "signed total"), 0)]));
  const positiveTotal = fsum(playerIds.map((playerId) => floored[playerId]));
  if (!(positiveTotal > 0)) throw calculationError("all_nonpositive_team", "Positive close has no positive player.");
  const shares = Object.fromEntries(playerIds.map((playerId) => [playerId, floored[playerId] / positiveTotal]));
  const recipient = playerIds
    .filter((playerId) => floored[playerId] > 0)
    .sort((left, right) => floored[right] - floored[left] || left - right)[0];
  shares[recipient] = 1 - fsum(playerIds.filter((playerId) => playerId !== recipient).map((playerId) => shares[playerId]));
  for (let step = 0; step < 8; step += 1) {
    const closed = fsum(playerIds.map((playerId) => shares[playerId]));
    if (bitIdentical(closed, 1)) break;
    shares[recipient] = nextAfter(shares[recipient], closed < 1 ? Infinity : -Infinity);
  }
  if (!bitIdentical(fsum(playerIds.map((playerId) => shares[playerId])), 1)) {
    throw calculationError("team_close_failed", "Positive shares did not close exactly.");
  }
  return { floored, positiveTotal, shares };
}

function offCourtReliability(possessionsOff, reliabilityK) {
  if (possessionsOff === 0) return 0;
  if (reliabilityK === 0) return 1;
  return possessionsOff / (possessionsOff + reliabilityK);
}

function expectedPoints(row, side, on, teammateCoefficient, opponentCoefficient) {
  const suffix = on ? "on" : "off";
  const neutral = finite(row[`${side}_neutral_expected_${suffix}`], `${side} neutral expected ${suffix}`);
  const teammate = finite(
    row[`${side === "offense" ? "teammate_offense" : "teammate_defense"}_effect_${suffix}`],
    `${side} teammate effect ${suffix}`,
  );
  const opponent = finite(
    row[`${side === "offense" ? "opponent_defense" : "opponent_offense"}_effect_${suffix}`],
    `${side} opponent effect ${suffix}`,
  );
  return side === "offense"
    ? fsum([neutral, teammateCoefficient * teammate, -opponentCoefficient * opponent])
    : fsum([neutral, -teammateCoefficient * teammate, opponentCoefficient * opponent]);
}

function sideSignal(row, side, teammateCoefficient, opponentCoefficient, config, timeMode) {
  const on = integer(row[`${side}_possessions_on`], `${side} possessions on`);
  const off = integer(row[`${side}_possessions_off`], `${side} possessions off`);
  const total = on + off;
  if (total <= 0) throw calculationError("missing_context_exposure", `${side} exposure is empty.`);
  const lambda = finite(config[`lambda_${side}`], `${side} lambda`);
  const k = finite(config[`reliability_k_${side}`], `${side} K`);
  const gamma = finite(config[`exposure_power_${side}`], `${side} exposure power`);
  const scale = finite(config.residual_scale[timeMode][side], `${side} residual scale`);
  const exposure = on / total;
  const reliability = offCourtReliability(off, k);
  const residual = (isOn) => {
    const count = isOn ? on : off;
    if (count === 0) return null;
    const suffix = isOn ? "on" : "off";
    const actual = finite(row[`${side}_actual_points_${suffix}`], `${side} actual ${suffix}`) / count;
    const expected = expectedPoints(row, side, isOn, teammateCoefficient, opponentCoefficient) / count;
    return side === "offense" ? actual - expected : expected - actual;
  };
  const residualOn = residual(true);
  const residualOff = residual(false);
  if (on === 0) return { rawSignal: 0, unit: 0 };
  const offTerm = residualOff === null ? 0 : lambda * reliability * residualOff;
  const rawSignal = (exposure ** gamma) * (residualOn - offTerm);
  const unit = Math.asinh(rawSignal / scale);
  if (!Number.isFinite(rawSignal) || !Number.isFinite(unit)) {
    throw calculationError("invalid_context_signal", `${side} context signal became nonfinite.`);
  }
  return { rawSignal, unit };
}

function sideFactorLogs(row, side, config, timeMode) {
  const teammateKey = side === "offense" ? "teammate_offense" : "teammate_defense";
  const opponentKey = side === "offense" ? "opponent_defense" : "opponent_offense";
  const states = {
    neutral: sideSignal(row, side, 0, 0, config, timeMode),
    teammate: sideSignal(row, side, config[`${teammateKey}_coefficient`], 0, config, timeMode),
    opponent: sideSignal(row, side, 0, config[`${opponentKey}_coefficient`], config, timeMode),
    full: sideSignal(
      row,
      side,
      config[`${teammateKey}_coefficient`],
      config[`${opponentKey}_coefficient`],
      config,
      timeMode,
    ),
  };
  const u0 = states.neutral.unit;
  const teammate = 0.5 * fsum([states.teammate.unit - u0, states.full.unit - states.opponent.unit]);
  const opponent = 0.5 * fsum([states.opponent.unit - u0, states.full.unit - states.teammate.unit]);
  return {
    general: config[`general_${side}_coefficient`] * u0,
    teammate,
    opponent,
  };
}

function playerFactors(row, config, timeMode) {
  const offense = sideFactorLogs(row, "offense", config, timeMode);
  const defense = sideFactorLogs(row, "defense", config, timeMode);
  const logs = {
    general_offense: offense.general,
    general_defense: defense.general,
    teammate_offense: offense.teammate,
    teammate_defense: defense.teammate,
    opponent_offense: defense.opponent,
    opponent_defense: offense.opponent,
  };
  const multipliers = Object.fromEntries(CONTEXT_FACTOR_ORDER.map((factor) => [factor, Math.exp(logs[factor])]));
  if (Object.values(multipliers).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw calculationError("context_multiplier_overflow", "A context multiplier became invalid.");
  }
  return {
    logs,
    multipliers,
    combinedOffense: Math.exp(fsum(CONTEXT_FACTOR_ORDER.filter((factor) => OFFENSE_FACTORS.has(factor)).map((factor) => logs[factor]))),
    combinedDefense: Math.exp(fsum(CONTEXT_FACTOR_ORDER.filter((factor) => DEFENSE_FACTORS.has(factor)).map((factor) => logs[factor]))),
  };
}

function stateValues(players, mask) {
  const signed = {};
  const adjusted = {};
  for (const player of players) {
    const offenseLog = fsum(CONTEXT_FACTOR_ORDER
      .filter((factor, index) => (mask & (1 << index)) && OFFENSE_FACTORS.has(factor))
      .map((factor) => player.factors.logs[factor]));
    const defenseLog = fsum(CONTEXT_FACTOR_ORDER
      .filter((factor, index) => (mask & (1 << index)) && DEFENSE_FACTORS.has(factor))
      .map((factor) => player.factors.logs[factor]));
    const offense = signAwareAdjust(player.raw.offense, Math.exp(offenseLog));
    const defense = signAwareAdjust(player.raw.defense, Math.exp(defenseLog));
    const other = player.raw.other;
    const total = fsum([offense, defense, other]);
    signed[player.player_id] = total;
    adjusted[player.player_id] = { offense, defense, other, total };
  }
  const close = positiveOnlyClose(signed);
  return { shares: close.shares, adjusted, positives: close.floored };
}

function contextAmounts(row) {
  return { raw_vc: row.raw_vc, ...row.context_components };
}

function replaceContextAmounts(row, values, closeKey, before) {
  const contextComponents = Object.fromEntries(CONTEXT_FACTOR_ORDER.map((factor) => [factor, values[factor]]));
  return {
    ...row,
    raw_vc: values.raw_vc,
    context_components: contextComponents,
    total_context: fsum(CONTEXT_FACTOR_ORDER.map((factor) => contextComponents[factor])),
    final_value_contributed: fsum(AMOUNT_ORDER.map((key) => values[key])),
    context_display_close: {
      close_key: closeKey,
      close_adjustment: values[closeKey] - before,
    },
  };
}

function closeTeamDisplay(rows) {
  const teamTotal = fsum(rows.map((row) => row.final_value_contributed));
  if (bitIdentical(teamTotal, 1)) return rows;
  const factorCandidates = rows.flatMap((row) => CONTEXT_FACTOR_ORDER.map((factor) => [
    Math.abs(row.context_components[factor]), row.player_id, factor,
  ])).sort((left, right) => left[0] - right[0] || left[1] - right[1]
    || CONTEXT_FACTOR_ORDER.indexOf(left[2]) - CONTEXT_FACTOR_ORDER.indexOf(right[2]));
  const rawCandidates = rows.map((row) => [Math.abs(row.raw_vc), row.player_id, "raw_vc"])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  for (const [, playerId, closeKey] of [...factorCandidates, ...rawCandidates]) {
    const selected = rows.find((row) => row.player_id === playerId);
    const amounts = contextAmounts(selected);
    const before = amounts[closeKey];
    const arithmetic = before + (1 - teamTotal);
    let lower = arithmetic;
    let upper = arithmetic;
    for (let step = 0; step <= 4096; step += 1) {
      const candidates = step === 0 ? [arithmetic] : [
        lower = nextAfter(lower, -Infinity),
        upper = nextAfter(upper, Infinity),
      ];
      for (const candidate of candidates) {
        amounts[closeKey] = candidate;
        const playerTotal = fsum(AMOUNT_ORDER.map((key) => amounts[key]));
        const total = fsum(rows.map((row) => row.player_id === playerId ? playerTotal : row.final_value_contributed));
        if (!bitIdentical(total, 1)) continue;
        const updated = replaceContextAmounts(selected, amounts, closeKey, before);
        return rows.map((row) => row.player_id === playerId ? updated : row);
      }
    }
  }
  throw calculationError("context_display_close_failed", "Team context display could not close exactly.");
}

function preserveFlooredEligibility(rows) {
  let output = rows.map((row) => row);
  for (let index = 0; index < output.length; index += 1) {
    const row = output[index];
    if (row.positive_total !== 0 || bitIdentical(row.final_value_contributed, 0)) continue;
    const amounts = contextAmounts(row);
    const candidates = [...AMOUNT_ORDER].sort((left, right) =>
      Math.abs(amounts[left]) - Math.abs(amounts[right]) || AMOUNT_ORDER.indexOf(left) - AMOUNT_ORDER.indexOf(right));
    let closed = null;
    for (const closeKey of candidates) {
      try {
        closed = exactClose(amounts, 0, AMOUNT_ORDER, closeKey, 4096);
        break;
      } catch {
        // Try the next disclosed amount cell.
      }
    }
    if (!closed) throw calculationError("floored_display_close_failed", `Player ${row.player_id} cannot return to exact zero.`);
    output[index] = replaceContextAmounts(row, closed.values, closed.close_key, amounts[closed.close_key]);
  }
  let teamTotal = fsum(output.map((row) => row.final_value_contributed));
  if (!bitIdentical(teamTotal, 1)) {
    const recipients = output.filter((row) => row.positive_total > 0)
      .sort((left, right) => right.final_value_contributed - left.final_value_contributed || left.player_id - right.player_id);
    let selectedUpdate = null;
    for (const selected of recipients) {
      const amounts = contextAmounts(selected);
      const keys = [...AMOUNT_ORDER].sort((left, right) =>
        Math.abs(amounts[left]) - Math.abs(amounts[right]) || AMOUNT_ORDER.indexOf(left) - AMOUNT_ORDER.indexOf(right));
      for (const closeKey of keys) {
        const before = amounts[closeKey];
        const arithmetic = before + (1 - teamTotal);
        let lower = arithmetic;
        let upper = arithmetic;
        for (let step = 0; step <= 4096; step += 1) {
          const values = step === 0 ? [arithmetic] : [
            lower = nextAfter(lower, -Infinity),
            upper = nextAfter(upper, Infinity),
          ];
          for (const candidate of values) {
            amounts[closeKey] = candidate;
            const playerTotal = fsum(AMOUNT_ORDER.map((key) => amounts[key]));
            if (playerTotal <= 0) continue;
            const closedTeam = fsum(output.map((row) =>
              row.player_id === selected.player_id ? playerTotal : row.final_value_contributed));
            if (!bitIdentical(closedTeam, 1)) continue;
            selectedUpdate = replaceContextAmounts(selected, amounts, closeKey, before);
            break;
          }
          if (selectedUpdate) break;
        }
        if (selectedUpdate) break;
      }
      if (selectedUpdate) break;
    }
    if (!selectedUpdate) throw calculationError("eligible_context_close_failed", "Eligible context display cannot close exactly.");
    output = output.map((row) => row.player_id === selectedUpdate.player_id ? selectedUpdate : row);
    teamTotal = fsum(output.map((row) => row.final_value_contributed));
  }
  if (!bitIdentical(teamTotal, 1)
      || output.some((row) => (row.positive_total > 0) !== (row.final_value_contributed > 0))) {
    throw calculationError("context_eligibility_changed", "Context display close changed positive eligibility.");
  }
  return output;
}

function decomposeTeam(players) {
  const states = new Map();
  let full = null;
  for (let mask = 0; mask < 64; mask += 1) {
    const state = stateValues(players, mask);
    states.set(mask, state.shares);
    if (mask === 63) full = state;
  }
  const rows = [];
  for (const player of players) {
    const components = {};
    for (let factorIndex = 0; factorIndex < CONTEXT_FACTOR_ORDER.length; factorIndex += 1) {
      const factor = CONTEXT_FACTOR_ORDER[factorIndex];
      const bit = 1 << factorIndex;
      const marginals = [];
      for (let coalition = 0; coalition < 64; coalition += 1) {
        if (coalition & bit) continue;
        const size = popcount(coalition);
        const weight = FACTORIAL[size] * FACTORIAL[6 - size - 1] / SHAPLEY_DENOMINATOR;
        marginals.push(weight * (states.get(coalition | bit)[player.player_id] - states.get(coalition)[player.player_id]));
      }
      components[factor] = fsum(marginals);
    }
    const rawVc = states.get(0)[player.player_id];
    const final = fsum([rawVc, ...CONTEXT_FACTOR_ORDER.map((factor) => components[factor])]);
    const adjusted = full.adjusted[player.player_id];
    rows.push({
      ...player,
      raw_vc: rawVc,
      context_components: components,
      total_context: fsum(CONTEXT_FACTOR_ORDER.map((factor) => components[factor])),
      adjusted_offense: adjusted.offense,
      adjusted_defense: adjusted.defense,
      adjusted_other: adjusted.other,
      signed_adjusted_total: adjusted.total,
      positive_total: full.positives[player.player_id],
      final_value_contributed: final,
      context_display_close: { close_key: "none", close_adjustment: 0 },
    });
  }
  return preserveFlooredEligibility(closeTeamDisplay(rows));
}

function componentEvidence(rows, componentOrder) {
  const evidence = {};
  for (const row of rows) {
    evidence[row.player_id] = {};
    for (const side of SIDES) {
      const rawSide = row.raw[side];
      const adjustedSide = row[`adjusted_${side}`];
      const scale = side === "other" || rawSide === 0 ? 1 : adjustedSide / rawSide;
      if (!(scale > 0) || !Number.isFinite(scale) || (rawSide === 0 && adjustedSide !== 0)) {
        throw calculationError("responsibility_scale_invalid", `Player ${row.player_id} ${side} scale is invalid.`);
      }
      const scaled = Object.fromEntries((componentOrder[side] || [])
        .filter((key) => Object.hasOwn(row.raw_components[side], key))
        .map((key) => [key, row.raw_components[side][key] * scale]));
      const values = Object.values(scaled);
      const positive = fsum(values.map((value) => Math.max(value, 0)));
      const negative = fsum(values.map((value) => Math.max(-value, 0)));
      evidence[row.player_id][side] = {
        scaled,
        positive,
        negative,
        gross: fsum([positive, negative]),
      };
    }
  }
  return evidence;
}

function responsibilitySide(rows, evidence, side) {
  const eligible = rows.filter((row) => row.final_value_contributed > 0);
  const positiveTotal = fsum(rows.map((row) => evidence[row.player_id][side].positive));
  const negativePool = fsum(rows.map((row) => evidence[row.player_id][side].negative));
  const flooredPool = fsum(rows.filter((row) => row.final_value_contributed === 0)
    .map((row) => evidence[row.player_id][side].positive));
  const merit = Object.fromEntries(eligible.map((row) => [
    row.player_id,
    Math.max(evidence[row.player_id][side].positive - evidence[row.player_id][side].negative, 0),
  ]));
  const primaryTotal = fsum(Object.values(merit));
  const fallback = Object.fromEntries(eligible.map((row) => [row.player_id, evidence[row.player_id][side].positive]));
  const fallbackTotal = fsum(Object.values(fallback));
  let weights = {};
  if (negativePool > 0 || flooredPool > 0) {
    if (primaryTotal > 0) weights = Object.fromEntries(eligible.map((row) => [row.player_id, merit[row.player_id] / primaryTotal]));
    else if (fallbackTotal > 0) weights = Object.fromEntries(eligible.map((row) => [row.player_id, fallback[row.player_id] / fallbackTotal]));
    else throw calculationError("responsibility_recipient_missing", `The ${side} side has unavailable activity without support.`);
  }
  const absorbedNegative = Object.fromEntries(rows.map((row) => [row.player_id, negativePool * (weights[row.player_id] || 0)]));
  const absorbedFloored = Object.fromEntries(rows.map((row) => [row.player_id, flooredPool * (weights[row.player_id] || 0)]));
  const bases = Object.fromEntries(rows.map((row) => [
    row.player_id,
    row.final_value_contributed > 0
      ? fsum([evidence[row.player_id][side].positive, absorbedNegative[row.player_id], absorbedFloored[row.player_id]])
      : 0,
  ]));
  return { bases, positiveTotal, negativePool, flooredPool };
}

function responsibilityDisplayClose(formula, target) {
  const keys = [...SIDES].sort((left, right) => Math.abs(formula[left]) - Math.abs(formula[right])
    || SIDES.indexOf(left) - SIDES.indexOf(right));
  for (const closeKey of keys) {
    try {
      const closed = exactClose(formula, target, SIDES, closeKey, 4096);
      if (Object.values(closed.values).some((value) => value < 0)) continue;
      return closed;
    } catch {
      // Try the next side.
    }
  }
  throw calculationError("responsibility_display_close_failed", "Responsibility cannot close exactly.");
}

function allocateResponsibility(rows, componentOrder) {
  const evidence = componentEvidence(rows, componentOrder);
  const sideResults = Object.fromEntries(SIDES.map((side) => [side, responsibilitySide(rows, evidence, side)]));
  return rows.map((row) => {
    const basis = Object.fromEntries(SIDES.map((side) => [side, sideResults[side].bases[row.player_id]]));
    const basisTotal = fsum(SIDES.map((side) => basis[side]));
    let formula = { offense: 0, defense: 0, other: 0 };
    if (row.final_value_contributed > 0) {
      if (basisTotal === 0) throw calculationError("responsibility_evidence_missing", `Player ${row.player_id} has no responsibility evidence.`);
      formula = Object.fromEntries(SIDES.map((side) => [
        side,
        row.final_value_contributed * (basis[side] / basisTotal),
      ]));
    }
    const closed = responsibilityDisplayClose(formula, row.final_value_contributed);
    return {
      ...row,
      responsibility_formula: formula,
      responsibility: closed.values,
      responsibility_display_close: {
        close_key: closed.close_key,
        observed_sum: closed.observed_sum,
        post_close_value: closed.post_close_value,
        post_close_sum: closed.post_close_sum,
        direction: closed.direction,
        ulp_steps: closed.ulp_steps,
      },
      responsibility_component_evidence: Object.fromEntries(SIDES.map((side) => [side, evidence[row.player_id][side].scaled])),
      responsibility_basis: basis,
    };
  });
}

function evaluateExpression(row, coefficients, derived) {
  const operands = row.operands.map((value) => finite(value, "basis operand"));
  const lookup = (key, derivedOnly = false) => {
    const source = derivedOnly ? derived : Object.hasOwn(coefficients, key) ? coefficients : derived;
    if (!Object.hasOwn(source, key)) throw calculationError("unknown_basis_coefficient", `Unknown coefficient ${key}.`);
    return finite(source[key], `coefficient ${key}`);
  };
  if (row.operation === "constant") return fsum(operands);
  let multiplier;
  if (row.operation === "coefficient_times_operand") multiplier = lookup(row.coefficient_keys[0]);
  else if (row.operation === "derived_remainder_times_operand") multiplier = lookup(row.coefficient_keys[0], true);
  else if (row.operation === "coefficient_product_times_operand") {
    multiplier = row.coefficient_keys.reduce((product, key) => product * lookup(key), 1);
  } else {
    throw calculationError("unknown_basis_operation", `Unknown basis operation ${row.operation}.`);
  }
  // Each operand is one retained allocation term. Apply the coefficient before
  // the canonical sum so browser rounding matches the frozen action-level
  // calculation even when a component nearly cancels to zero.
  return fsum(operands.map((operand) => multiplier * operand));
}

export function evaluateCoefficientBasis(rows, configuration) {
  const coefficients = configuration.expanded_raw.effective_leaves;
  const derived = configuration.expanded_raw.derived_values;
  const groups = new Map();
  for (const row of rows) {
    const key = identity(row.game_id, row.time_mode, row.team_id, row.player_id, row.side, row.component_key);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(evaluateExpression(row, coefficients, derived));
  }
  return new Map([...groups].map(([key, values]) => [key, fsum(values)]));
}

function componentOrder(metadata) {
  const result = { offense: [], defense: [], other: [] };
  for (const side of SIDES) {
    result[side] = metadata.filter((row) => row.side === side)
      .sort((left, right) => left.component_ordinal - right.component_ordinal)
      .map((row) => row.component_key);
  }
  return result;
}

function rawPlayer(player, basis, order) {
  const components = { offense: {}, defense: {}, other: {} };
  for (const side of SIDES) {
    for (const component of order[side]) {
      const key = identity(player.game_id, player.time_mode, player.team_id, player.player_id, side, component);
      if (basis.has(key)) components[side][component] = basis.get(key);
    }
  }
  for (const dfg of ["DFG_miss", "DFG_make"]) {
    if (order.defense.includes(dfg) && !Object.hasOwn(components.defense, dfg)) components.defense[dfg] = 0;
  }
  const raw = Object.fromEntries(SIDES.map((side) => [
    side,
    fsum(order[side].map((component) => components[side][component] || 0)),
  ]));
  return { ...player, raw, raw_components: components, raw_total: fsum(SIDES.map((side) => raw[side])) };
}

function teamKey(row) {
  return identity(row.game_id, row.time_mode, row.team_id);
}

function verifyTeamOutput(rows) {
  if (!bitIdentical(fsum(rows.map((row) => row.final_value_contributed)), 1)) {
    throw calculationError("team_close_failed", "Final VC does not close exactly to one.");
  }
  for (const row of rows) {
    if (!bitIdentical(
      fsum([row.raw_vc, ...CONTEXT_FACTOR_ORDER.map((factor) => row.context_components[factor])]),
      row.final_value_contributed,
    )) throw calculationError("context_identity_failed", `Player ${row.player_id} Raw plus six does not close.`);
    if (!bitIdentical(fsum(SIDES.map((side) => row.responsibility[side])), row.final_value_contributed)) {
      throw calculationError("responsibility_identity_failed", `Player ${row.player_id} responsibility does not close.`);
    }
  }
}

export function calculateOriginalBrowserTeams({ players, contextOperands, coefficientBasis, responsibilityMetadata, configuration }) {
  const order = componentOrder(responsibilityMetadata);
  const basis = evaluateCoefficientBasis(coefficientBasis, configuration);
  const contextByPlayer = new Map(contextOperands.map((row) => [identity(row.game_id, row.time_mode, row.player_id), row]));
  const rawPlayers = players.map((player) => rawPlayer(player, basis, order));
  const teams = new Map();
  for (const player of rawPlayers) {
    const context = contextByPlayer.get(identity(player.game_id, player.time_mode, player.player_id));
    if (!context || Number(context.team_id) !== Number(player.team_id)) {
      throw calculationError("context_roster_mismatch", `Context is missing for player ${player.player_id}.`);
    }
    const enriched = {
      ...player,
      opponent_id: integer(context.opponent_id, "opponent_id"),
      factors: playerFactors(context, configuration.expanded_context, player.time_mode),
    };
    const key = teamKey(player);
    if (!teams.has(key)) teams.set(key, []);
    teams.get(key).push(enriched);
  }
  const output = [];
  for (const [key, teamPlayers] of [...teams].sort(([left], [right]) => left.localeCompare(right))) {
    const ordered = teamPlayers.sort((left, right) => left.player_id - right.player_id);
    const responsible = allocateResponsibility(decomposeTeam(ordered), order);
    verifyTeamOutput(responsible);
    output.push(...responsible);
  }
  return output;
}

function approximate(left, right, tolerance = ORIGINAL_BROWSER_PARITY_TOLERANCE) {
  return Math.abs(left - right) <= tolerance;
}

function officialProfileSlug(configuration) {
  if (configuration?.expanded_raw?.source_expanded_sha256 !== OFFICIAL_RAW_PROFILE_SHA256) {
    return null;
  }
  const context = configuration.expanded_context;
  if (!context || context.config_version !== "value-contributed-full-lineup-context-config-v1-2026-08-29") {
    return null;
  }
  const defenseMultiplier = context.general_defense_coefficient;
  const slug = OFFICIAL_DEFENSE_PROFILE_SLUGS[defenseMultiplier];
  if (!slug
      || context.teammate_defense_coefficient !== defenseMultiplier
      || context.opponent_offense_coefficient !== defenseMultiplier
      || context.general_offense_coefficient !== 1
      || context.teammate_offense_coefficient !== 1
      || context.opponent_defense_coefficient !== 1
      || context.lambda_offense !== 1
      || context.lambda_defense !== 1
      || context.reliability_k_offense !== 0
      || context.reliability_k_defense !== 0
      || context.exposure_power_offense !== 2
      || context.exposure_power_defense !== 2
      || context.residual_scale?.all_minutes?.offense !== 1.129206215388943
      || context.residual_scale?.all_minutes?.defense !== 1.129206215388943
      || context.residual_scale?.competitive?.offense !== 1.1271115884403284
      || context.residual_scale?.competitive?.defense !== 1.1271115884403284) {
    return null;
  }
  return slug;
}

export function verifyOfficialParity(rows, officialOutputs, configuration) {
  const slug = officialProfileSlug(configuration);
  if (!slug) return { checked: false, slug: null, max_absolute_residual: 0 };
  const expected = new Map(officialOutputs.filter((row) => row.slug === slug)
    .map((row) => [identity(row.game_id, row.time_mode, row.player_id), row]));
  if (expected.size !== rows.length) {
    throw calculationError("official_parity_coverage", `Official ${slug} output coverage differs from browser rows.`);
  }
  let maximum = 0;
  for (const row of rows) {
    const target = expected.get(identity(row.game_id, row.time_mode, row.player_id));
    if (!target) throw calculationError("official_parity_coverage", `Official ${slug} is missing player ${row.player_id}.`);
    const pairs = [
      ["raw_vc", row.raw_vc, target.raw_vc],
      ...CONTEXT_FACTOR_ORDER.map((factor, index) => [
        `context_components.${factor}`,
        row.context_components[factor],
        target.six_context_components[index],
      ]),
      ["final_value_contributed", row.final_value_contributed, target.final_value_contributed],
      ["responsibility.offense", row.responsibility.offense, target.offense_responsibility],
      ["responsibility.defense", row.responsibility.defense, target.defense_responsibility],
      ["responsibility.other", row.responsibility.other, target.other_responsibility],
    ];
    for (const [field, actual, wanted] of pairs) {
      const residual = Math.abs(actual - wanted);
      maximum = Math.max(maximum, residual);
      if (!approximate(actual, wanted)) {
        throw calculationError("official_parity_failed", `Browser ${slug} differs at ${row.game_id}/${row.time_mode}/${row.player_id}.`, {
          actual,
          expected: wanted,
          field,
          residual,
          tolerance: ORIGINAL_BROWSER_PARITY_TOLERANCE,
        });
      }
    }
  }
  return { checked: true, slug, max_absolute_residual: maximum };
}

export async function finalizeBrowserResultRows(rows, games, configuration, responsibilityPolicySha256) {
  const gamesById = new Map(games.map((game) => [game.game_id, game]));
  const bodies = [];
  for (const row of rows) {
    const game = gamesById.get(row.game_id);
    if (!game) throw calculationError("game_metadata_missing", `Game metadata is missing for ${row.game_id}.`);
    const secondsPlayed = integer(row.seconds_played, "seconds_played");
    if (secondsPlayed < 0) {
      throw calculationError("invalid_activity", "seconds_played cannot be negative.");
    }
    const teamId = positiveInteger(row.team_id, "team_id");
    const opponentId = positiveInteger(row.opponent_id, "opponent_id");
    const playerId = positiveInteger(row.player_id, "player_id");
    const canonicalPlayerId = positiveInteger(row.canonical_player_id, "canonical_player_id");
    const homeTeamId = positiveInteger(game.home_team_id, "home_team_id");
    const awayTeamId = positiveInteger(game.away_team_id, "away_team_id");
    if (homeTeamId === awayTeamId) {
      throw calculationError("invalid_game_teams", "A game cannot use the same home and away team.");
    }
    if (!SEASON_TYPES.has(game.season_type)) {
      throw calculationError(
        "invalid_season_type",
        "season_type must be Regular Season, PlayIn, or Playoffs.",
      );
    }
    const location = teamId === homeTeamId
      ? "home"
      : teamId === awayTeamId
        ? "away"
        : null;
    if (location === null) {
      throw calculationError("team_schedule_mismatch", `Team ${teamId} is not scheduled in ${row.game_id}.`);
    }
    const scheduledOpponentId = location === "home" ? awayTeamId : homeTeamId;
    if (opponentId !== scheduledOpponentId) {
      throw calculationError(
        "opponent_schedule_mismatch",
        `Opponent ${opponentId} is not scheduled against team ${teamId} in ${row.game_id}.`,
      );
    }
    const body = {
      schema_version: RESULT_SCHEMA_VERSION,
      engine_version: ENGINE_VERSION,
      configuration_receipt: configuration.configuration_receipt,
      game_id: row.game_id,
      game_date: game.game_date,
      season_end_year: game.season_end_year,
      season_type: game.season_type,
      time_mode: row.time_mode,
      team_id: teamId,
      opponent_id: opponentId,
      player_id: playerId,
      player_name: row.player_name,
      canonical_player_id: canonicalPlayerId,
      win_loss: Boolean(row.win_loss),
      seconds_played: secondsPlayed,
      location,
      raw_components: row.raw_components,
      raw_offense: row.raw.offense,
      raw_defense: row.raw.defense,
      raw_other: row.raw.other,
      raw_total: row.raw_total,
      raw_vc: row.raw_vc,
      context_components: row.context_components,
      offense_context: fsum(CONTEXT_FACTOR_ORDER.filter((factor) => OFFENSE_FACTORS.has(factor)).map((factor) => row.context_components[factor])),
      defense_context: fsum(CONTEXT_FACTOR_ORDER.filter((factor) => DEFENSE_FACTORS.has(factor)).map((factor) => row.context_components[factor])),
      total_context: row.total_context,
      factor_logs: row.factors.logs,
      factor_multipliers: row.factors.multipliers,
      combined_offense_multiplier: row.factors.combinedOffense,
      combined_defense_multiplier: row.factors.combinedDefense,
      adjusted_offense: row.adjusted_offense,
      adjusted_defense: row.adjusted_defense,
      adjusted_other: row.adjusted_other,
      signed_adjusted_total: row.signed_adjusted_total,
      positive_total: row.positive_total,
      final_value_contributed: row.final_value_contributed,
      responsibility_formula: row.responsibility_formula,
      responsibility: row.responsibility,
      responsibility_display_close: row.responsibility_display_close,
      responsibility_component_evidence: row.responsibility_component_evidence,
      responsibility_basis: row.responsibility_basis,
      responsibility_adapter_version: RESPONSIBILITY_ADAPTER_VERSION,
      responsibility_policy_sha256: responsibilityPolicySha256,
      context_display_close: row.context_display_close,
    };
    bodies.push(body);
  }
  // Validate the complete batch before hashing any row. Persistence only sees
  // the resolved result of this function, so an invalid identity or season
  // type cannot acquire a v2 hash or reach IndexedDB.
  return Promise.all(bodies.map(async (body) => ({
    ...body,
    row_hash: await canonicalSha256({ kind: "browser-player-game-v2", value: body }),
  })));
}
