import { BrowserExperimentError } from "./protocol.js";

export const ALLOWED_NETWORK_METHODS = Object.freeze(["GET", "HEAD"]);

function requestMethod(input, init = {}) {
  const inputMethod = typeof Request !== "undefined" && input instanceof Request ? input.method : undefined;
  return String(init.method || inputMethod || "GET").toUpperCase();
}

export function assertReadOnlyRequest(input, init = {}) {
  const method = requestMethod(input, init);
  if (!ALLOWED_NETWORK_METHODS.includes(method)) {
    throw new BrowserExperimentError(
      "network_write_forbidden",
      `Browser experiments prohibit network ${method} requests.`,
      { method },
    );
  }
  if (init.body != null) {
    throw new BrowserExperimentError("network_body_forbidden", "Read-only package requests cannot include a body.");
  }
  return method;
}

export function createNetworkAudit() {
  const entries = [];
  return {
    record(entry) { entries.push(Object.freeze({ ...entry })); },
    snapshot() {
      return Object.freeze({
        requestCount: entries.length,
        writeAttempts: entries.filter((entry) => !ALLOWED_NETWORK_METHODS.includes(entry.method)).length,
        entries: entries.map((entry) => ({ ...entry })),
      });
    },
    clear() { entries.length = 0; },
  };
}

export function createReadOnlyFetch(fetchImpl = globalThis.fetch, { audit = createNetworkAudit() } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  const readOnlyFetch = async (input, init = {}) => {
    const method = requestMethod(input, init);
    try {
      assertReadOnlyRequest(input, init);
    } catch (error) {
      audit.record({ method, url: String(input?.url || input), allowed: false, at: new Date().toISOString() });
      throw error;
    }
    audit.record({ method, url: String(input?.url || input), allowed: true, at: new Date().toISOString() });
    return fetchImpl(input, {
      ...init,
      method,
      body: undefined,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  };
  readOnlyFetch.audit = audit;
  return readOnlyFetch;
}

export function assertZeroNetworkWrites(auditSnapshot) {
  if (!auditSnapshot || auditSnapshot.writeAttempts !== 0
      || auditSnapshot.entries?.some((entry) => !ALLOWED_NETWORK_METHODS.includes(entry.method))) {
    throw new BrowserExperimentError("network_write_detected", "An experiment attempted a network write.");
  }
  return true;
}
