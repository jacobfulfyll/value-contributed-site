const textEncoder = new TextEncoder();

export function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") return textEncoder.encode(value);
  throw new TypeError("Expected bytes, an ArrayBuffer, or a string.");
}

export function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error("Web Crypto SHA-256 is unavailable.");
  const bytes = asUint8Array(value);
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqualText(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function verifySha256(value, expected, cryptoImpl = globalThis.crypto) {
  if (!isSha256(expected)) throw new TypeError("Expected a lowercase SHA-256 value.");
  const actual = await sha256Hex(value, cryptoImpl);
  if (!timingSafeEqualText(actual, expected)) {
    const error = new Error(`SHA-256 mismatch: expected ${expected}, received ${actual}.`);
    error.name = "IntegrityError";
    error.code = "sha256_mismatch";
    error.expected = expected;
    error.actual = actual;
    throw error;
  }
  return actual;
}

function assertCanonicalValue(value, path, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers.`);
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains a value that JSON cannot represent.`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonicalValue(item, `${path}[${index}]`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain plain objects only.`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new TypeError(`${path} contains an unsafe key.`);
      }
      assertCanonicalValue(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

export function canonicalJson(value) {
  assertCanonicalValue(value, "$", new Set());
  const serialize = (item) => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(serialize).join(",")}]`;
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(item[key])}`)
      .join(",")}}`;
  };
  return serialize(value);
}

export async function canonicalSha256(value, cryptoImpl = globalThis.crypto) {
  return sha256Hex(canonicalJson(value), cryptoImpl);
}

export function bytesToBase64Url(value) {
  const bytes = asUint8Array(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new TypeError("Invalid base64url payload.");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  } catch (cause) {
    throw new TypeError("Invalid base64url payload.", { cause });
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
