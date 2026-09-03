export function fsum(values) {
  const partials = [];
  for (const raw of values) {
    let x = Number(raw);
    if (!Number.isFinite(x)) throw new RangeError("fsum requires finite binary64 values.");
    let index = 0;
    for (const partial of partials) {
      let y = partial;
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const high = x + y;
      const low = y - (high - x);
      if (low !== 0) {
        partials[index] = low;
        index += 1;
      }
      x = high;
    }
    partials.length = index;
    if (x !== 0) partials.push(x);
  }
  let high = 0;
  if (partials.length) {
    let count = partials.length;
    high = partials[--count];
    let low = 0;
    while (count > 0) {
      const x = high;
      const y = partials[--count];
      high = x + y;
      const rounded = high - x;
      low = y - rounded;
      if (low !== 0) break;
    }
    if (count > 0
        && ((low < 0 && partials[count - 1] < 0)
          || (low > 0 && partials[count - 1] > 0))) {
      const doubled = low * 2;
      const candidate = high + doubled;
      if (doubled === candidate - high) high = candidate;
    }
  }
  if (!Number.isFinite(high)) throw new RangeError("fsum overflowed.");
  return high;
}

const NEXT_BUFFER = new ArrayBuffer(8);
const NEXT_VIEW = new DataView(NEXT_BUFFER);

function bits(value) {
  NEXT_VIEW.setFloat64(0, value, false);
  return NEXT_VIEW.getBigUint64(0, false);
}

function fromBits(value) {
  NEXT_VIEW.setBigUint64(0, value, false);
  return NEXT_VIEW.getFloat64(0, false);
}

export function bitIdentical(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return bits(left) === bits(right);
}

export function nextAfter(value, toward) {
  if (Number.isNaN(value) || Number.isNaN(toward)) return Number.NaN;
  if (value === toward) return toward;
  if (value === 0) return toward > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  if (!Number.isFinite(value)) return value > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
  let encoded = bits(value);
  if ((toward > value) === (value > 0)) encoded += 1n;
  else encoded -= 1n;
  return fromBits(encoded);
}

export function exactClose(values, target, canonicalOrder, closeKey, maxUlpSteps = 4096) {
  const normalized = Object.fromEntries(canonicalOrder.map((key) => [key, Number(values[key])]));
  const observed = fsum(canonicalOrder.map((key) => normalized[key]));
  const residual = target - observed;
  const before = normalized[closeKey];
  const arithmetic = before + residual;
  const candidateSum = (candidate) => {
    normalized[closeKey] = candidate;
    return fsum(canonicalOrder.map((key) => normalized[key]));
  };
  let selected = arithmetic;
  let total = candidateSum(selected);
  let direction = "arithmetic_residual";
  let ulpSteps = 0;
  if (!bitIdentical(total, target)) {
    let lower = arithmetic;
    let upper = arithmetic;
    let found = false;
    for (let distance = 1; distance <= maxUlpSteps; distance += 1) {
      lower = nextAfter(lower, -Infinity);
      total = candidateSum(lower);
      if (bitIdentical(total, target)) {
        selected = lower;
        direction = "toward_negative_infinity";
        ulpSteps = distance;
        found = true;
        break;
      }
      upper = nextAfter(upper, Infinity);
      total = candidateSum(upper);
      if (bitIdentical(total, target)) {
        selected = upper;
        direction = "toward_positive_infinity";
        ulpSteps = distance;
        found = true;
        break;
      }
    }
    if (!found) throw new RangeError("Exact binary64 close did not reach its target.");
  }
  normalized[closeKey] = selected;
  const postCloseSum = fsum(canonicalOrder.map((key) => normalized[key]));
  if (!bitIdentical(postCloseSum, target)) throw new RangeError("Exact binary64 close is not bit-identical.");
  return {
    values: normalized,
    close_key: closeKey,
    target,
    observed_sum: observed,
    pre_close_value: before,
    arithmetic_residual: residual,
    arithmetic_candidate: arithmetic,
    post_close_value: selected,
    post_close_sum: postCloseSum,
    direction,
    ulp_steps: ulpSteps,
  };
}
