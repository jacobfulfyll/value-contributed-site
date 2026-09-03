import { openOriginalExperimentDatabase } from "./indexeddb-store.js";
import { createReadOnlyFetch } from "./network-policy.js";
import {
  BrowserExperimentError,
  TIME_MODES,
  WorkerCommand,
  WorkerEvent,
  assertConfiguration,
  sortedUniqueSeasons,
  workerEnvelope,
} from "./protocol.js";
import { assessRunCapacity } from "./storage-guard.js";
import { fetchVerifiedManifest } from "./verified-packages.js";
import { projectLocalDashboardPanel } from "./local-projections.js";

export { expandOriginalExperimentConfiguration } from "./configuration.js";

const RESULT_QUERY_CACHE_LIMIT = 32;

function randomId(cryptoImpl = globalThis.crypto) {
  const value = cryptoImpl?.randomUUID?.();
  if (!value) throw new BrowserExperimentError("uuid_unavailable", "Web Crypto randomUUID() is required.");
  return value;
}

function customEvent(name, detail) {
  if (typeof CustomEvent === "function") return new CustomEvent(name, { detail });
  const event = new Event(name);
  Object.defineProperty(event, "detail", { value: detail });
  return event;
}

function attachWorkerListener(worker, listener) {
  if (typeof worker.addEventListener === "function") worker.addEventListener("message", listener);
  else worker.onmessage = listener;
}

function projectionError(code, message) {
  return new BrowserExperimentError(code, message);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  const error = new Error("The local dashboard request was aborted.");
  error.name = "AbortError";
  throw error;
}

function resultSelection(filters) {
  if (filters === null || typeof filters !== "object" || Array.isArray(filters)) {
    throw projectionError("invalid_projection_filter", "Local dashboard filters must be an object.");
  }
  const snakeMode = filters.garbage_time_mode;
  const directMode = filters.time_mode;
  if (snakeMode !== undefined && directMode !== undefined && snakeMode !== directMode) {
    throw projectionError(
      "invalid_projection_filter",
      "time_mode and garbage_time_mode disagree.",
    );
  }
  const timeMode = directMode ?? snakeMode ?? "competitive";
  if (!TIME_MODES.includes(timeMode)) {
    throw projectionError("invalid_result_time_mode", `Unsupported result time mode ${timeMode}.`);
  }
  const season = filters.season;
  if (season === undefined || season === "All Seasons") {
    return { seasonEndYears: null, requestedSeason: null, timeMode };
  }
  if (/^\d{4}$/.test(String(season))) {
    const seasonEndYear = Number(season);
    if (seasonEndYear >= 2014 && seasonEndYear <= 2026) {
      return { seasonEndYears: [seasonEndYear], requestedSeason: seasonEndYear, timeMode };
    }
  }
  const label = /^(\d{4})-(\d{2})$/.exec(String(season));
  if (label) {
    const seasonEndYear = Number(label[1]) + 1;
    if (
      seasonEndYear >= 2014
      && seasonEndYear <= 2026
      && String(seasonEndYear).slice(-2).padStart(2, "0") === label[2]
    ) {
      return { seasonEndYears: [seasonEndYear], requestedSeason: seasonEndYear, timeMode };
    }
  }
  throw projectionError(
    "invalid_projection_filter",
    "season must be All Seasons, a season end year, or YYYY-YY.",
  );
}

function selectedSeasons(configuration) {
  const source = configuration?.selectedSeasons
    ?? configuration?.selected_seasons
    ?? configuration?.configuration?.selected_seasons;
  if (!Array.isArray(source) || source.length === 0) {
    throw projectionError(
      "invalid_experiment_seasons",
      "The published experiment does not identify its selected seasons.",
    );
  }
  return sortedUniqueSeasons(source);
}

function projectionCacheKey(experimentId, selection, configuration) {
  const seasons = selection.seasonEndYears?.join(",") ?? "all";
  const receipt = configuration.configurationReceipt
    ?? configuration.configuration_receipt
    ?? configuration.configuration?.configuration_receipt;
  const selected = selectedSeasons(configuration).join(",");
  return [
    experimentId,
    configuration.releaseId ?? configuration.release_id,
    receipt,
    selected,
    selection.timeMode,
    seasons,
  ].join("\u001f");
}

function assertProjectionConfiguration(configuration, experimentId, expected = null) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    throw projectionError(
      "projection_configuration_missing",
      "The selected browser-local experiment has no stored configuration.",
    );
  }
  if (configuration.experimentId !== experimentId) {
    throw projectionError(
      "projection_experiment_mismatch",
      "Stored player-game rows do not belong to the selected experiment.",
    );
  }
  if (configuration.published !== true) {
    throw projectionError(
      "experiment_not_published",
      "Only complete experiments can be queried in Rankings.",
    );
  }
  selectedSeasons(configuration);
  if (expected) {
    const actualReceipt = configuration.configurationReceipt
      ?? configuration.configuration_receipt
      ?? configuration.configuration?.configuration_receipt;
    const expectedReceipt = expected.configurationReceipt
      ?? expected.configuration_receipt
      ?? expected.configuration?.configuration_receipt;
    if (
      configuration.releaseId !== expected.releaseId
      || actualReceipt !== expectedReceipt
    ) {
      throw projectionError(
        "projection_configuration_changed",
        "The local experiment configuration changed while its results were being read.",
      );
    }
  }
  return configuration;
}

function assertPlayerGameBatch(rows, experimentId, seasons, timeMode) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw projectionError(
      "projection_results_missing",
      "A selected season is missing its complete browser-local player-game results.",
    );
  }
  const allowedSeasons = new Set(seasons);
  for (const row of rows) {
    if (
      row?.experimentId !== experimentId
      || row.partial !== false
      || row.seasonEndYear !== row.season_end_year
      || !allowedSeasons.has(row.seasonEndYear)
      || row.timeMode !== timeMode
      || row.time_mode !== timeMode
    ) {
      throw projectionError(
        "projection_result_scope_mismatch",
        "Stored player-game results escaped their published experiment, season, or time-mode scope.",
      );
    }
  }
  return rows;
}

export class OriginalExperimentClient {
  constructor({
    store,
    worker,
    fetchImpl = globalThis.fetch,
    cryptoImpl = globalThis.crypto,
    storageManager = globalThis.navigator?.storage,
    environment = {},
    eventTarget = globalThis.window,
  } = {}) {
    this.store = store;
    this.worker = worker;
    this.fetchImpl = createReadOnlyFetch(fetchImpl);
    this.cryptoImpl = cryptoImpl;
    this.storageManager = storageManager;
    this.environment = environment;
    this.eventTarget = eventTarget;
    this.listeners = new Set();
    this.resultQueries = new Map();
    attachWorkerListener(worker, (event) => this.receive(event.data));
  }

  receive(message) {
    if (
      message?.experimentId
      && [WorkerEvent.COMPLETE, WorkerEvent.CANCELLED, WorkerEvent.ERROR].includes(message.type)
    ) {
      this.clearResultQueries(message.experimentId);
    }
    for (const listener of this.listeners) listener(message);
    if (this.eventTarget?.dispatchEvent && message?.type) {
      this.eventTarget.dispatchEvent(customEvent(`vc-experiment:${message.type}`, message));
    }
  }

  clearResultQueries(experimentId = null) {
    if (experimentId === null) {
      this.resultQueries.clear();
      return;
    }
    const prefix = `${experimentId}\u001f`;
    for (const key of this.resultQueries.keys()) {
      if (key.startsWith(prefix)) this.resultQueries.delete(key);
    }
  }

  queryPlayerGameRows(experimentId, selection, configuration) {
    if (typeof this.store.queryPlayerGameResults !== "function") {
      throw projectionError(
        "player_game_reader_unavailable",
        "The browser-local player-game reader is unavailable.",
      );
    }
    const key = projectionCacheKey(experimentId, selection, configuration);
    if (this.resultQueries.has(key)) {
      const cached = this.resultQueries.get(key);
      this.resultQueries.delete(key);
      this.resultQueries.set(key, cached);
      return cached;
    }
    const seasons = selection.seasonEndYears ?? selectedSeasons(configuration);
    const pending = (seasons.length === 1
      ? this.store.queryPlayerGameResults(experimentId, {
          seasonEndYears: seasons,
          timeMode: selection.timeMode,
        })
      : Promise.all(seasons.map((seasonEndYear) => this.queryPlayerGameRows(
          experimentId,
          { ...selection, seasonEndYears: [seasonEndYear] },
          configuration,
        ))).then((batches) => {
          for (const batch of batches) {
            assertProjectionConfiguration(batch.configuration, experimentId, configuration);
          }
          return {
            rows: batches.flatMap((batch) => batch.rows),
            configuration: batches[0]?.configuration ?? configuration,
          };
        }))
      .then((result) => {
        assertProjectionConfiguration(result.configuration, experimentId, configuration);
        assertPlayerGameBatch(result.rows, experimentId, seasons, selection.timeMode);
        return result;
      })
      .catch((error) => {
        if (this.resultQueries.get(key) === pending) this.resultQueries.delete(key);
        throw error;
      });
    this.resultQueries.set(key, pending);
    while (this.resultQueries.size > RESULT_QUERY_CACHE_LIMIT) {
      this.resultQueries.delete(this.resultQueries.keys().next().value);
    }
    return pending;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Experiment subscriber must be a function.");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  post(type, payload = {}) {
    this.worker.postMessage(workerEnvelope(type, payload));
  }

  async reviewRun({
    manifestUrl = "./data/original-package-manifest.json",
    manifestSha256,
    selectedSeasons,
    configuration = null,
  }) {
    const seasons = sortedUniqueSeasons(selectedSeasons);
    const { manifest } = await fetchVerifiedManifest({
      url: manifestUrl,
      expectedSha256: manifestSha256,
      fetchImpl: this.fetchImpl,
      cryptoImpl: this.cryptoImpl,
    });
    const review = await assessRunCapacity({
      manifest,
      manifestSha256,
      selectedSeasons: seasons,
      storageManager: this.storageManager,
      environment: this.environment,
      cryptoImpl: this.cryptoImpl,
    });
    await this.store.markStaleReleases(manifest.release_id);
    return Object.freeze({
      manifest,
      review,
      manifestUrl,
      manifestSha256,
      selectedSeasons: seasons,
      configuration,
    });
  }

  start(input = {}, confirmationOptions = {}) {
    const reviewed = input.review && input.manifest;
    const {
      experimentId = confirmationOptions.experimentId || randomId(this.cryptoImpl),
      configuration = confirmationOptions.configuration || input.configuration,
      manifestUrl = input.manifestUrl,
      manifestSha256 = input.manifestSha256,
      selectedSeasons = input.selectedSeasons || configuration?.selected_seasons,
    } = input;
    const confirmation = input.confirmation || confirmationOptions.confirmation || (reviewed ? {
      confirmed: confirmationOptions.confirmed === true,
      all_seasons_confirmed: confirmationOptions.allSeasonsConfirmed === true,
      review_receipt: input.review.review_receipt,
    } : undefined);
    assertConfiguration(configuration);
    this.post(WorkerCommand.START, {
      experimentId,
      configuration,
      manifestUrl,
      manifestSha256,
      selectedSeasons: sortedUniqueSeasons(selectedSeasons),
      confirmation,
    });
    return experimentId;
  }

  resume(experimentId) {
    this.post(WorkerCommand.RESUME, { experimentId });
  }

  cancel(experimentId) {
    this.post(WorkerCommand.CANCEL, { experimentId });
  }

  requestStatus(experimentId = null) {
    this.post(WorkerCommand.STATUS, { experimentId });
  }

  async listPublished() {
    return this.store.listExperiments({ publishedOnly: true });
  }

  async listAll() {
    return this.store.listExperiments({ publishedOnly: false });
  }

  async getExperiment(experimentId) {
    const [configuration, progress, receipts] = await Promise.all([
      this.store.getConfiguration(experimentId),
      this.store.getProgress(experimentId),
      this.store.listReceipts(experimentId),
    ]);
    if (!configuration) return null;
    return { ...configuration, progress, receipts };
  }

  async rename(experimentId, name) {
    const renamed = await this.store.renameExperiment(experimentId, name);
    this.clearResultQueries(experimentId);
    return renamed;
  }

  async clone(experimentId, { experimentId: newExperimentId = randomId(this.cryptoImpl), name } = {}) {
    const source = await this.getExperiment(experimentId);
    if (!source) throw new BrowserExperimentError("experiment_not_found", `Experiment ${experimentId} was not found.`);
    if (source.stale || source.requiresRerun) {
      throw new BrowserExperimentError(
        "stale_release_read_only",
        "Use rerun() to reproduce a stale experiment under the current manifest.",
      );
    }
    await this.store.createExperiment({
      experimentId: newExperimentId,
      name: String(name || `${source.name} copy`).slice(0, 80),
      releaseId: source.releaseId,
      manifestUrl: source.manifestUrl,
      manifestSha256: source.manifestSha256,
      engineVersion: source.engineVersion,
      configuration: source.configuration,
      configurationReceipt: source.configurationReceipt,
      selectedSeasons: source.selectedSeasons,
      timeModes: [...TIME_MODES],
      clonedFrom: experimentId,
    });
    this.receive(workerEnvelope(WorkerEvent.STATE, { experimentId: newExperimentId, status: "draft", clonedFrom: experimentId }));
    return this.getExperiment(newExperimentId);
  }

  async rerun(experimentId, {
    experimentId: newExperimentId = randomId(this.cryptoImpl),
    name,
    configuration,
    manifestUrl,
    manifestSha256,
    confirmation,
  } = {}) {
    const source = await this.getExperiment(experimentId);
    if (!source) throw new BrowserExperimentError("experiment_not_found", `Experiment ${experimentId} was not found.`);
    const nextConfiguration = configuration || source.configuration;
    this.start({
      experimentId: newExperimentId,
      configuration: nextConfiguration,
      manifestUrl,
      manifestSha256,
      selectedSeasons: nextConfiguration.selected_seasons,
      confirmation,
    });
    this.receive(workerEnvelope(WorkerEvent.STATE, {
      experimentId: newExperimentId,
      status: "queued",
      rerunFrom: experimentId,
      name: name || source.name,
    }));
    return newExperimentId;
  }

  async delete(experimentId) {
    const progress = await this.store.getProgress(experimentId);
    if (progress?.status === "running") {
      throw new BrowserExperimentError("experiment_running", "Cancel the experiment before deleting it.");
    }
    const deleted = await this.store.deleteExperiment(experimentId);
    this.clearResultQueries(experimentId);
    this.receive(workerEnvelope(WorkerEvent.STATE, { experimentId, status: "deleted" }));
    return deleted;
  }

  markStaleReleases(currentReleaseId) {
    this.clearResultQueries();
    return this.store.markStaleReleases(currentReleaseId);
  }

  async queryRankings(experimentId, {
    panel,
    filters = {},
    sort = null,
    limit = 100,
    offset = 0,
    signal = null,
  } = {}) {
    throwIfAborted(signal);
    const selection = resultSelection(filters);
    if (typeof this.store.getConfiguration !== "function") {
      throw projectionError(
        "projection_configuration_reader_unavailable",
        "The browser-local configuration reader is unavailable.",
      );
    }
    const configuration = assertProjectionConfiguration(
      await this.store.getConfiguration(experimentId),
      experimentId,
    );
    throwIfAborted(signal);
    const seasons = selectedSeasons(configuration);
    if (selection.requestedSeason !== null && !seasons.includes(selection.requestedSeason)) {
      throw projectionError(
        "experiment_season_unavailable",
        `Season ${selection.requestedSeason} was not selected for this experiment.`,
      );
    }
    const result = await this.queryPlayerGameRows(experimentId, selection, configuration);
    throwIfAborted(signal);
    assertProjectionConfiguration(result.configuration, experimentId, configuration);
    const projection = projectLocalDashboardPanel(panel, result.rows, {
      filters,
      sort,
      limit,
      offset,
      configuration: result.configuration,
    });
    throwIfAborted(signal);
    const payload = projection.metadata?.panel_payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw projectionError(
        "projection_payload_missing",
        `Local panel ${panel} did not produce a complete dashboard payload.`,
      );
    }
    return {
      ...projection,
      metadata: {
        ...projection.metadata,
        experiment_id: experimentId,
        experiment_name: result.configuration.name,
        panel_payload: payload,
      },
      experiment: result.configuration,
      stale: result.configuration.stale === true || result.configuration.requiresRerun === true,
      receipt: projection.metadata.receipt,
    };
  }

  async getAggregateSnapshot(experimentId, { panel, filters = {} } = {}) {
    return this.queryRankings(experimentId, {
      panel,
      filters,
      sort: null,
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
    });
  }

  networkAudit() {
    return this.fetchImpl.audit.snapshot();
  }

  close() {
    this.worker.terminate?.();
    this.store.close?.();
    this.listeners.clear();
    this.resultQueries.clear();
  }
}

export async function createOriginalExperimentClient({
  store,
  worker,
  workerUrl = new URL("./original-experiment.worker.js", import.meta.url),
  indexedDB,
  keyRange,
  WorkerImpl = globalThis.Worker,
  ...dependencies
} = {}) {
  const resolvedStore = store || await openOriginalExperimentDatabase({ indexedDB, keyRange });
  let resolvedWorker = worker;
  if (!resolvedWorker) {
    if (typeof WorkerImpl !== "function") {
      throw new BrowserExperimentError("web_worker_unavailable", "A dedicated Web Worker is required.");
    }
    resolvedWorker = new WorkerImpl(workerUrl, { type: "module", name: "value-contributed-original-experiment" });
  }
  return new OriginalExperimentClient({ store: resolvedStore, worker: resolvedWorker, ...dependencies });
}
