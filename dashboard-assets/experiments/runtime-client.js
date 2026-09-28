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
import {
  TEAM_SIMILARITY_ARTIFACT_SCHEMA_VERSION,
  buildPlayerRankIndex,
  buildTeamSimilarityArtifact,
  projectLocalEntityPanel,
} from "./entity-projections.js";

export { expandOriginalExperimentConfiguration } from "./configuration.js";

const RESULT_QUERY_CACHE_LIMIT = 32;
const PLAYER_RANK_AGGREGATE_PANEL = "entity:player_ranks";
const TEAM_SIMILARITY_AGGREGATE_PANEL = "entity:team_similarity_artifact";

const ENTITY_PANELS = new Set([
  "players", "teams", "player_landscape", "player_profile", "player_games", "player_game_anatomy", "player_similarity",
  "team_profile", "team_games", "team_similarity", "season_story",
]);

function canonicalEntityCacheValue(value) {
  if (Array.isArray(value)) return value.map(canonicalEntityCacheValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalEntityCacheValue(value[key]),
    ]));
  }
  return value;
}

function entityCacheKey(panel, filters, configuration) {
  const receipt = configuration.configurationReceipt
    ?? configuration.configuration_receipt
    ?? configuration.configuration?.configuration_receipt;
  const displayIdentity = `${configuration.name ?? ""}:${configuration.updatedAt ?? configuration.updated_at ?? ""}`;
  return `entity-v2:${receipt}:${displayIdentity}:${panel}:${JSON.stringify(canonicalEntityCacheValue(filters))}`;
}

function playerRankCacheKey(filters, configuration) {
  const configurationReceipt = configuration.configurationReceipt
    ?? configuration.configuration_receipt
    ?? configuration.configuration?.configuration_receipt;
  const resultReceipt = configuration.experimentReceipt
    ?? configuration.experiment_receipt
    ?? configuration.aggregateReceipt
    ?? configuration.aggregate_receipt;
  const selection = resultSelection(filters);
  const schedule = filters.schedule ?? filters.phase ?? "All";
  const metric = filters.metric ?? "vc";
  return [
    "entity-player-ranks-v1",
    configurationReceipt,
    resultReceipt,
    selectedSeasons(configuration).join(","),
    selection.timeMode,
    schedule,
    metric,
  ].join(":");
}

function teamSimilarityArtifactCacheKey(filters, configuration) {
  const configurationReceipt = configuration.configurationReceipt
    ?? configuration.configuration_receipt
    ?? configuration.configuration?.configuration_receipt;
  const resultReceipt = configuration.experimentReceipt
    ?? configuration.experiment_receipt
    ?? configuration.aggregateReceipt
    ?? configuration.aggregate_receipt;
  return [
    TEAM_SIMILARITY_ARTIFACT_SCHEMA_VERSION,
    configurationReceipt,
    resultReceipt,
    selectedSeasons(configuration).join(","),
    resultSelection(filters).timeMode,
  ].join(":");
}

function entityPanelSeasons(panel, filters, configuration) {
  const available = selectedSeasons(configuration);
  if (!["player_landscape", "player_games", "player_game_anatomy", "player_similarity", "team_games", "season_story"].includes(panel)) return available;
  const selection = resultSelection(filters);
  if (panel === "player_similarity" && String(filters.mode ?? "career").toLowerCase() === "career") {
    return available;
  }
  return selection.seasonEndYears ?? available;
}

function normalizedManifestAuthority(value) {
  if (value === null || value === undefined) return null;
  const url = String(value.url || "");
  const sha256 = String(value.sha256 || "");
  const releaseId = String(value.releaseId || "");
  if (!url || !/^[0-9a-f]{64}$/.test(sha256) || !releaseId) {
    throw new BrowserExperimentError(
      "invalid_manifest_authority",
      "The local package authority must pin one URL, checksum, and release.",
    );
  }
  return Object.freeze({ url, sha256, releaseId });
}

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

function attachWorkerErrorListener(worker, listener) {
  if (typeof worker.addEventListener === "function") worker.addEventListener("error", listener);
  else worker.onerror = listener;
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
  if (Array.isArray(season)) {
    const years = season.map((value) => resultSelection({ ...filters, season: value }).seasonEndYears?.[0])
      .filter((value) => value !== undefined);
    return { seasonEndYears: sortedUniqueSeasons(years), requestedSeason: null, timeMode };
  }
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
    selection.playerId ?? "all-players",
    selection.teamId ?? "all-teams",
    selection.allowEmpty === true ? "allow-empty" : "require-nonempty",
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

function assertPlayerGameBatch(rows, experimentId, seasons, timeMode, { allowEmpty = false } = {}) {
  if (!Array.isArray(rows) || (!allowEmpty && rows.length === 0)) {
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
    manifestAuthority = null,
    entitySimilarityClient = null,
    workerFactory = null,
  } = {}) {
    this.store = store;
    this.worker = worker;
    this.workerFactory = workerFactory;
    this.fetchImpl = createReadOnlyFetch(fetchImpl);
    this.cryptoImpl = cryptoImpl;
    this.storageManager = storageManager;
    this.environment = environment;
    this.eventTarget = eventTarget;
    this.manifestAuthority = normalizedManifestAuthority(manifestAuthority);
    this.entitySimilarityClient = entitySimilarityClient;
    this.listeners = new Set();
    this.resultQueries = new Map();
    this.teamSimilarityArtifactBuilds = new Map();
    this.teamSimilarityWarmups = new Map();
    this.backgroundFailures = [];
    this.closed = false;
    this.activeExperimentId = null;
    this.pendingResumeExperimentId = null;
    this.workerRecovery = null;
    this.bindWorker(worker);
  }

  bindWorker(worker) {
    attachWorkerListener(worker, (event) => this.receive(event.data));
    attachWorkerErrorListener(worker, (event) => {
      event?.preventDefault?.();
      void this.recoverWorkerFailure(event);
    });
  }

  async replaceWorkerAndResume(experimentId) {
    if (this.closed) return;
    if (!this.workerFactory) {
      setTimeout(() => this.resume(experimentId), 0);
      return;
    }
    this.pendingResumeExperimentId = experimentId;
    this.worker.terminate?.();
    this.worker = this.workerFactory();
    this.bindWorker(this.worker);
  }

  async recoverWorkerFailure(event) {
    const experimentId = this.activeExperimentId;
    if (!experimentId || this.closed || this.workerRecovery) return;
    this.workerRecovery = (async () => {
      const error = {
        code: "worker_interrupted",
        message: "The calculation worker stopped. Completed season checkpoints were kept and the run is resuming in a fresh worker.",
        details: { message: event?.message ?? null },
      };
      const progress = await this.store.failExperiment(experimentId, error);
      this.receive(workerEnvelope(WorkerEvent.STATE, {
        experimentId,
        status: "recovering",
        progress,
      }));
      await this.replaceWorkerAndResume(experimentId);
    })().finally(() => { this.workerRecovery = null; });
    return this.workerRecovery;
  }

  assertManifestAuthority(manifestUrl, manifestSha256, releaseId = null) {
    const authority = this.manifestAuthority;
    if (!authority) return;
    if (
      manifestUrl !== authority.url
      || manifestSha256 !== authority.sha256
      || (releaseId !== null && releaseId !== authority.releaseId)
    ) {
      throw new BrowserExperimentError(
        "untrusted_manifest",
        "The requested package is not the receipt-bound local release.",
      );
    }
  }

  receive(message) {
    if (
      message?.experimentId
      && [WorkerEvent.COMPLETE, WorkerEvent.CANCELLED, WorkerEvent.ERROR].includes(message.type)
    ) {
      this.clearResultQueries(message.experimentId);
      this.activeExperimentId = null;
    }
    for (const listener of this.listeners) listener(message);
    if (this.eventTarget?.dispatchEvent && message?.type) {
      this.eventTarget.dispatchEvent(customEvent(`vc-experiment:${message.type}`, message));
    }
    if (message?.type === WorkerEvent.COMPLETE && message.experimentId) {
      // Publication is already durable and COMPLETE has already reached every
      // subscriber. Warm the expensive all-pairs artifacts on the dedicated
      // similarity worker without extending or endangering completion.
      this.scheduleTeamSimilarityWarmup(message.experimentId);
    }
    if (message?.type === WorkerEvent.RECYCLE && message.experimentId) {
      void this.replaceWorkerAndResume(message.experimentId);
    }
    if (message?.type === WorkerEvent.READY && this.pendingResumeExperimentId) {
      const experimentId = this.pendingResumeExperimentId;
      this.pendingResumeExperimentId = null;
      this.resume(experimentId);
    }
  }

  reportBackgroundFailure(experimentId, operation, caught) {
    if (this.closed) return;
    const failure = Object.freeze({
      type: "background-error",
      experimentId,
      operation,
      error: Object.freeze({
        name: caught?.name ?? "Error",
        code: caught?.code ?? "background_task_failed",
        message: caught?.message ?? String(caught),
      }),
    });
    this.backgroundFailures.push(failure);
    if (this.backgroundFailures.length > 20) this.backgroundFailures.shift();
    try {
      this.eventTarget?.dispatchEvent?.(customEvent("vc-experiment:background-error", failure));
    } catch (_ignored) {
      // Reporting must never turn an optional warmup into an application error.
    }
  }

  backgroundFailureSnapshot() {
    return this.backgroundFailures.map((failure) => ({
      ...failure,
      error: { ...failure.error },
    }));
  }

  scheduleTeamSimilarityWarmup(experimentId) {
    if (this.closed || !this.entitySimilarityClient) return Promise.resolve([]);
    if (this.teamSimilarityWarmups.has(experimentId)) {
      return this.teamSimilarityWarmups.get(experimentId);
    }
    const pending = Promise.resolve()
      .then(() => this.warmTeamSimilarityArtifacts(experimentId))
      .catch((caught) => {
        this.reportBackgroundFailure(experimentId, "team_similarity_artifact_warmup", caught);
        return [];
      })
      .finally(() => {
        if (this.teamSimilarityWarmups.get(experimentId) === pending) {
          this.teamSimilarityWarmups.delete(experimentId);
        }
      });
    this.teamSimilarityWarmups.set(experimentId, pending);
    return pending;
  }

  async waitForTeamSimilarityWarmup(experimentId) {
    return this.teamSimilarityWarmups.get(experimentId) ?? [];
  }

  async warmTeamSimilarityArtifacts(experimentId) {
    const configuration = assertProjectionConfiguration(
      await this.store.getConfiguration(experimentId),
      experimentId,
    );
    if (configuration.stale === true || configuration.requiresRerun === true) return [];
    const configuredModes = configuration.timeModes
      ?? configuration.time_modes
      ?? configuration.configuration?.time_modes;
    const modes = Array.isArray(configuredModes)
      ? TIME_MODES.filter((mode) => configuredModes.includes(mode))
      : [...TIME_MODES];
    return Promise.all(modes.map((timeMode) => this.ensureTeamSimilarityArtifact(
      experimentId,
      configuration,
      timeMode,
      { useCache: true },
    )));
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

  queryPlayerGameRows(experimentId, selection, configuration, { cache = true } = {}) {
    if (typeof this.store.queryPlayerGameResults !== "function") {
      throw projectionError(
        "player_game_reader_unavailable",
        "The browser-local player-game reader is unavailable.",
      );
    }
    const key = projectionCacheKey(experimentId, selection, configuration);
    if (cache && this.resultQueries.has(key)) {
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
          playerId: selection.playerId ?? null,
          teamId: selection.teamId ?? null,
        })
      : Promise.all(seasons.map((seasonEndYear) => this.queryPlayerGameRows(
          experimentId,
          {
            ...selection,
            seasonEndYears: [seasonEndYear],
            allowEmpty: selection.allowEmpty === true
              || selection.playerId !== undefined
              || selection.teamId !== undefined,
          },
          configuration,
          { cache },
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
        assertPlayerGameBatch(result.rows, experimentId, seasons, selection.timeMode, {
          allowEmpty: selection.allowEmpty === true,
        });
        return result;
      })
      .catch((error) => {
        if (cache && this.resultQueries.get(key) === pending) this.resultQueries.delete(key);
        throw error;
      });
    if (cache) {
      this.resultQueries.set(key, pending);
      while (this.resultQueries.size > RESULT_QUERY_CACHE_LIMIT) {
        this.resultQueries.delete(this.resultQueries.keys().next().value);
      }
    }
    return pending;
  }

  async queryPlayerRankIndex(experimentId, filters, configuration, {
    signal = null,
    useCache = true,
  } = {}) {
    const cacheKey = playerRankCacheKey(filters, configuration);
    if (useCache && typeof this.store.queryAggregates === "function") {
      try {
        const cached = await this.store.queryAggregates(experimentId, {
          panel: PLAYER_RANK_AGGREGATE_PANEL,
          filters: { cache_key: cacheKey },
          limit: 1,
          offset: 0,
        });
        const payload = cached.rows[0]?.payload;
        if (payload) return payload;
      } catch (caught) {
        if (caught?.code !== "aggregate_panel_unavailable") throw caught;
      }
    }
    throwIfAborted(signal);
    const selection = resultSelection(filters);
    const seasons = selectedSeasons(configuration);
    const result = await this.queryPlayerGameRows(experimentId, {
      seasonEndYears: seasons,
      requestedSeason: null,
      timeMode: selection.timeMode,
    }, configuration, { cache: false });
    throwIfAborted(signal);
    const payload = buildPlayerRankIndex(result.rows, filters);
    if (useCache && typeof this.store.putPublishedAggregates === "function") {
      await this.store.putPublishedAggregates(experimentId, 0, [{
        aggregate_key: cacheKey,
        panel: PLAYER_RANK_AGGREGATE_PANEL,
        dimensions: { cache_key: cacheKey },
        measures: {},
        payload,
      }]);
    }
    return payload;
  }

  ensureTeamSimilarityArtifact(experimentId, configuration, timeMode, {
    signal = null,
    useCache = true,
  } = {}) {
    const filters = { time_mode: timeMode };
    const cacheKey = teamSimilarityArtifactCacheKey(filters, configuration);
    const pendingKey = `${experimentId}\u001f${cacheKey}`;
    if (useCache && this.teamSimilarityArtifactBuilds.has(pendingKey)) {
      return this.teamSimilarityArtifactBuilds.get(pendingKey);
    }
    const pending = (async () => {
      if (useCache && typeof this.store.queryAggregates === "function") {
        try {
          const cached = await this.store.queryAggregates(experimentId, {
            panel: TEAM_SIMILARITY_AGGREGATE_PANEL,
            filters: { cache_key: cacheKey },
            limit: 1,
            offset: 0,
          });
          const payload = cached.rows[0]?.payload;
          if (payload) return payload;
        } catch (caught) {
          if (caught?.code !== "aggregate_panel_unavailable") throw caught;
        }
      }
      throwIfAborted(signal);
      const modes = timeMode === "all_minutes"
        ? ["all_minutes"]
        : [timeMode, "all_minutes"];
      const batches = await Promise.all(modes.map((requestedMode) => this.queryPlayerGameRows(
        experimentId,
        {
          seasonEndYears: selectedSeasons(configuration),
          requestedSeason: null,
          timeMode: requestedMode,
        },
        configuration,
      )));
      throwIfAborted(signal);
      const rows = batches.flatMap((batch) => batch.rows);
      const artifact = this.entitySimilarityClient
        ? await this.entitySimilarityClient.project(
          "team_similarity_artifact",
          rows,
          { time_mode: timeMode },
          configuration,
          { signal },
        )
        : buildTeamSimilarityArtifact(rows, { time_mode: timeMode }, configuration);
      throwIfAborted(signal);
      if (useCache && typeof this.store.putPublishedAggregates === "function") {
        await this.store.putPublishedAggregates(experimentId, 0, [{
          aggregate_key: cacheKey,
          panel: TEAM_SIMILARITY_AGGREGATE_PANEL,
          dimensions: { cache_key: cacheKey },
          measures: {
            team_seasons: artifact.fingerprints?.length ?? 0,
            pair_count: artifact.pair_count ?? 0,
          },
          payload: artifact,
        }]);
      }
      return artifact;
    })().finally(() => {
      if (useCache && this.teamSimilarityArtifactBuilds.get(pendingKey) === pending) {
        this.teamSimilarityArtifactBuilds.delete(pendingKey);
      }
    });
    if (useCache) this.teamSimilarityArtifactBuilds.set(pendingKey, pending);
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
    manifestUrl,
    manifestSha256,
    selectedSeasons,
    configuration = null,
  }) {
    if (typeof manifestUrl !== "string" || !manifestUrl.trim()) {
      throw new BrowserExperimentError(
        "local_manifest_required",
        "A checksum-bound local V9 package manifest is required.",
      );
    }
    this.assertManifestAuthority(manifestUrl, manifestSha256);
    const seasons = sortedUniqueSeasons(selectedSeasons);
    const { manifest } = await fetchVerifiedManifest({
      url: manifestUrl,
      expectedSha256: manifestSha256,
      fetchImpl: this.fetchImpl,
      cryptoImpl: this.cryptoImpl,
    });
    this.assertManifestAuthority(
      manifestUrl,
      manifestSha256,
      manifest.release_id,
    );
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
    this.assertManifestAuthority(
      manifestUrl,
      manifestSha256,
      reviewed ? input.manifest.release_id : null,
    );
    const confirmation = input.confirmation || confirmationOptions.confirmation || (reviewed ? {
      confirmed: confirmationOptions.confirmed === true,
      all_seasons_confirmed: confirmationOptions.allSeasonsConfirmed === true,
      review_receipt: input.review.review_receipt,
    } : undefined);
    assertConfiguration(configuration);
    this.activeExperimentId = experimentId;
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
    this.activeExperimentId = experimentId;
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
    this.assertManifestAuthority(
      this.manifestAuthority?.url,
      this.manifestAuthority?.sha256,
      currentReleaseId,
    );
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
    if (configuration.stale === true || configuration.requiresRerun === true) {
      throw projectionError(
        "stale_release_read_only",
        "Rerun this experiment under the receipt-bound local release before viewing it.",
      );
    }
    this.assertManifestAuthority(
      configuration.manifestUrl,
      configuration.manifestSha256,
      configuration.releaseId,
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

  async queryEntity(experimentId, {
    panel,
    filters = {},
    signal = null,
    useCache = true,
  } = {}) {
    throwIfAborted(signal);
    if (!ENTITY_PANELS.has(panel)) {
      throw projectionError("unsupported_entity_panel", `Unsupported entity panel ${panel}.`);
    }
    const configuration = assertProjectionConfiguration(
      await this.store.getConfiguration(experimentId),
      experimentId,
    );
    if (configuration.stale === true || configuration.requiresRerun === true) {
      throw projectionError(
        "stale_release_read_only",
        "Rerun this experiment under the receipt-bound local release before viewing it.",
      );
    }
    this.assertManifestAuthority(
      configuration.manifestUrl,
      configuration.manifestSha256,
      configuration.releaseId,
    );
    const cacheKey = entityCacheKey(panel, filters, configuration);
    if (useCache && typeof this.store.queryAggregates === "function") {
      try {
        const cached = await this.store.queryAggregates(experimentId, {
          panel: `entity:${panel}`,
          filters: { cache_key: cacheKey },
          limit: 1,
          offset: 0,
        });
        const payload = cached.rows[0]?.payload;
        if (payload) return payload;
      } catch (caught) {
        if (caught?.code !== "aggregate_panel_unavailable") throw caught;
      }
    }
    throwIfAborted(signal);
    const seasons = entityPanelSeasons(panel, filters, configuration);
    const requestedMode = resultSelection(filters).timeMode;
    const teamSimilarityArtifact = panel === "team_similarity"
      ? await this.ensureTeamSimilarityArtifact(
        experimentId,
        configuration,
        requestedMode,
        { signal, useCache },
      )
      : null;
    throwIfAborted(signal);
    const modes = requestedMode === "all_minutes" ? ["all_minutes"] : [requestedMode, "all_minutes"];
    const playerRanks = panel === "player_profile"
      ? await this.queryPlayerRankIndex(experimentId, filters, configuration, { signal, useCache })
      : null;
    throwIfAborted(signal);
    const entitySelection = ["player_profile", "player_games", "player_game_anatomy"].includes(panel)
      ? { playerId: Number(filters.player_id) }
      : panel.startsWith("team_") && panel !== "team_similarity"
        ? { teamId: Number(filters.team_id) }
        : {};
    const batches = teamSimilarityArtifact ? [] : await Promise.all(modes.map((timeMode) =>
      this.queryPlayerGameRows(
        experimentId,
        { seasonEndYears: seasons, requestedSeason: null, timeMode, ...entitySelection },
        configuration,
      )));
    throwIfAborted(signal);
    const rows = batches.flatMap((batch) => batch.rows);
    const projectionFilters = {
      ...filters,
      ...(playerRanks ? { player_ranks: playerRanks } : {}),
      ...(teamSimilarityArtifact ? { similarity_artifact: teamSimilarityArtifact } : {}),
    };
    const payload = ["player_similarity", "team_similarity"].includes(panel)
      && this.entitySimilarityClient
      ? await this.entitySimilarityClient.project(panel, rows, projectionFilters, configuration, { signal })
      : projectLocalEntityPanel(panel, rows, projectionFilters, configuration);
    throwIfAborted(signal);
    if (useCache && typeof this.store.putPublishedAggregates === "function") {
      await this.store.putPublishedAggregates(experimentId, seasons.length === 1 ? seasons[0] : 0, [{
        aggregate_key: cacheKey,
        panel: `entity:${panel}`,
        dimensions: { cache_key: cacheKey },
        measures: {},
        payload,
      }]);
    }
    return payload;
  }

  networkAudit() {
    return this.fetchImpl.audit.snapshot();
  }

  close() {
    this.closed = true;
    this.worker.terminate?.();
    this.store.close?.();
    this.entitySimilarityClient?.close?.();
    this.listeners.clear();
    this.resultQueries.clear();
    this.teamSimilarityArtifactBuilds.clear();
    this.teamSimilarityWarmups.clear();
  }
}

export async function createOriginalExperimentClient({
  store,
  worker,
  workerUrl = new URL("./original-experiment.worker.js?v=20260904-experiment-progress-v1", import.meta.url),
  indexedDB,
  keyRange,
  WorkerImpl = globalThis.Worker,
  ...dependencies
} = {}) {
  const resolvedStore = store || await openOriginalExperimentDatabase({ indexedDB, keyRange });
  let resolvedWorker = worker;
  const workerFactory = typeof WorkerImpl === "function"
    ? () => new WorkerImpl(workerUrl, { type: "module", name: "value-contributed-original-experiment" })
    : null;
  if (!resolvedWorker) {
    if (typeof WorkerImpl !== "function") {
      throw new BrowserExperimentError("web_worker_unavailable", "A dedicated Web Worker is required.");
    }
    resolvedWorker = workerFactory();
  }
  return new OriginalExperimentClient({
    store: resolvedStore,
    worker: resolvedWorker,
    workerFactory: worker ? null : workerFactory,
    ...dependencies,
  });
}
