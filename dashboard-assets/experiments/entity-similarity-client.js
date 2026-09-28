import { BrowserExperimentError } from "./protocol.js";

function abortError() {
  const error = new Error("The entity similarity request was cancelled.");
  error.name = "AbortError";
  return error;
}

export class EntitySimilarityWorkerClient {
  constructor({
    worker = null,
    WorkerImpl = globalThis.Worker,
    workerUrl = new URL("./entity-similarity.worker.js", import.meta.url),
  } = {}) {
    if (!worker && typeof WorkerImpl !== "function") {
      throw new BrowserExperimentError(
        "similarity_worker_unavailable",
        "Player and team similarity require a Web Worker.",
      );
    }
    this.WorkerImpl = WorkerImpl;
    this.workerUrl = workerUrl;
    this.ownsWorker = !worker;
    this.worker = worker ?? this.createWorker();
    this.sequence = 0;
    this.pending = new Map();
    this.attachListener();
  }

  createWorker() {
    return new this.WorkerImpl(this.workerUrl, {
      type: "module",
      name: "value-contributed-entity-similarity",
    });
  }

  attachListener() {
    const listener = (event) => this.receive(event.data);
    if (typeof this.worker.addEventListener === "function") {
      this.worker.addEventListener("message", listener);
    } else {
      this.worker.onmessage = listener;
    }
  }

  cancelWork(abortedRequestId) {
    this.worker.terminate?.();
    for (const [requestId, request] of this.pending.entries()) {
      request.cleanup();
      request.reject(requestId === abortedRequestId
        ? abortError()
        : new BrowserExperimentError(
          "similarity_worker_restarted",
          "Similarity was cancelled because its source or filters changed.",
        ));
    }
    this.pending.clear();
    if (this.ownsWorker) {
      this.worker = this.createWorker();
      this.attachListener();
    }
  }

  receive(message) {
    const request = this.pending.get(message?.request_id);
    if (!request) return;
    this.pending.delete(message.request_id);
    request.cleanup();
    if (message.ok) {
      request.resolve(message.payload);
      return;
    }
    const failure = new BrowserExperimentError(
      message.error?.code ?? "similarity_failed",
      message.error?.message ?? "Similarity calculation failed.",
      message.error?.details,
    );
    request.reject(failure);
  }

  project(panel, rows, options, configuration, { signal = null } = {}) {
    if (!["player_similarity", "team_similarity", "team_similarity_artifact"].includes(panel)) {
      return Promise.reject(new BrowserExperimentError(
        "unsupported_similarity_panel",
        `Unsupported similarity panel ${panel}.`,
      ));
    }
    if (signal?.aborted) return Promise.reject(abortError());
    const requestId = `entity-similarity-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.has(requestId)) return;
        this.cancelWork(requestId);
      };
      signal?.addEventListener?.("abort", onAbort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener?.("abort", onAbort),
      });
      this.worker.postMessage({
        request_id: requestId,
        panel,
        rows,
        options,
        configuration,
      });
    });
  }

  close() {
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(new BrowserExperimentError("similarity_worker_closed", "Similarity worker closed."));
    }
    this.pending.clear();
    this.worker.terminate?.();
  }
}
