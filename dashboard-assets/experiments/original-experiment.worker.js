import { createOriginalPackageCalculator } from "./calculator-kernel.js";
import { openOriginalExperimentDatabase } from "./indexeddb-store.js";
import { serializeError, workerEnvelope, WorkerEvent } from "./protocol.js";
import { OriginalExperimentWorkerRuntime } from "./worker-runtime.js";

export async function installOriginalExperimentWorker(scope = globalThis, dependencies = {}) {
  try {
    const store = dependencies.store || await openOriginalExperimentDatabase();
    const runtime = new OriginalExperimentWorkerRuntime({
      store,
      calculator: dependencies.calculator || createOriginalPackageCalculator(),
      fetchImpl: dependencies.fetchImpl || scope.fetch.bind(scope),
      postMessage: (message) => scope.postMessage(message),
      cryptoImpl: dependencies.cryptoImpl || scope.crypto,
      storageManager: dependencies.storageManager || scope.navigator?.storage,
      environment: dependencies.environment || {
        userAgent: scope.navigator?.userAgent,
        userAgentData: scope.navigator?.userAgentData,
      },
    });
    scope.addEventListener("message", (event) => { void runtime.handleMessage(event.data); });
    await runtime.initialize();
    return runtime;
  } catch (error) {
    scope.postMessage(workerEnvelope(WorkerEvent.ERROR, { experimentId: null, error: serializeError(error) }));
    throw error;
  }
}

const isDedicatedWorker = typeof document === "undefined"
  && typeof globalThis.postMessage === "function"
  && typeof globalThis.addEventListener === "function";

if (isDedicatedWorker) void installOriginalExperimentWorker(globalThis);
