import { canonicalSha256, isSha256 } from "./hash.js";
import { createReadOnlyFetch, assertZeroNetworkWrites } from "./network-policy.js";
import {
  BrowserExperimentError,
  KernelEvent,
  TIME_MODES,
  WorkerCommand,
  WorkerEvent,
  assertConfiguration,
  assertTimeModes,
  assertWorkerCommand,
  serializeError,
  sortedUniqueSeasons,
  workerEnvelope,
} from "./protocol.js";
import { assessRunCapacity, assertRunConfirmation } from "./storage-guard.js";
import { fetchVerifiedManifest, getVerifiedCatalog, getVerifiedSeasonShards } from "./verified-packages.js";

function abortError(error) {
  return error?.name === "AbortError" || error?.code === "experiment_cancelled";
}

function yieldToWorkerEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertKernel(calculator) {
  if (!calculator || typeof calculator.calculateSeason !== "function") {
    throw new TypeError("The browser package calculator must expose calculateSeason().");
  }
  return calculator;
}

function assertKernelEvent(event, seasonEndYear) {
  if (!event || typeof event !== "object" || !Object.values(KernelEvent).includes(event.type)) {
    throw new BrowserExperimentError("invalid_kernel_event", `Calculator emitted an invalid event for ${seasonEndYear}.`);
  }
  return event;
}

function assertSeasonCompletion(event, seasonEndYear, modeCounts) {
  if (event.type !== KernelEvent.SEASON_COMPLETE || event.seasonEndYear !== seasonEndYear) {
    throw new BrowserExperimentError("season_completion_missing", `Calculator did not complete season ${seasonEndYear}.`);
  }
  assertTimeModes(event.timeModes, "calculator completion time modes");
  if (TIME_MODES.some((mode) => modeCounts[mode] < 1)) {
    throw new BrowserExperimentError("time_mode_rows_missing", `Season ${seasonEndYear} is missing a required time mode.`);
  }
  for (const field of ["seasonReceipt", "aggregateReceipt"]) {
    if (!isSha256(event[field])) {
      throw new BrowserExperimentError("invalid_season_receipt", `${field} is invalid for season ${seasonEndYear}.`);
    }
  }
  return event;
}

export class OriginalExperimentWorkerRuntime {
  constructor({
    store,
    calculator,
    fetchImpl = globalThis.fetch,
    postMessage = () => {},
    cryptoImpl = globalThis.crypto,
    storageManager = globalThis.navigator?.storage,
    environment = {},
    seasonBatchSize = Number.POSITIVE_INFINITY,
  } = {}) {
    if (!store) throw new TypeError("An experiment store is required.");
    this.store = store;
    this.calculator = assertKernel(calculator);
    this.fetchImpl = createReadOnlyFetch(fetchImpl);
    this.postMessage = postMessage;
    this.cryptoImpl = cryptoImpl;
    this.storageManager = storageManager;
    this.environment = environment;
    this.seasonBatchSize = Number.isFinite(Number(seasonBatchSize))
      ? Math.max(1, Math.floor(Number(seasonBatchSize)))
      : Number.POSITIVE_INFINITY;
    this.active = null;
  }

  emit(type, payload = {}) {
    this.postMessage(workerEnvelope(type, payload));
  }

  async initialize() {
    const recoveredExperimentIds = await this.store.recoverInterruptedExperiments();
    this.emit(WorkerEvent.READY, { recoveredExperimentIds });
    return recoveredExperimentIds;
  }

  async handleMessage(rawMessage) {
    let message;
    try {
      message = assertWorkerCommand(rawMessage);
      if (message.type === WorkerCommand.CANCEL) return await this.cancel(message.experimentId);
      if (message.type === WorkerCommand.STATUS) {
        const progress = message.experimentId ? await this.store.getProgress(message.experimentId) : null;
        this.emit(WorkerEvent.STATE, { experimentId: message.experimentId || null, progress });
        return progress;
      }
      if (this.active) {
        throw new BrowserExperimentError("worker_busy", `Experiment ${this.active.experimentId} is already running.`);
      }
      const controller = new AbortController();
      this.active = { experimentId: message.experimentId, controller };
      const task = message.type === WorkerCommand.START
        ? this.start(message, controller.signal)
        : this.resume(message, controller.signal);
      try {
        return await task;
      } finally {
        if (this.active?.experimentId === message.experimentId) this.active = null;
      }
    } catch (error) {
      const experimentId = message?.experimentId || rawMessage?.experimentId || null;
      if (experimentId && abortError(error)) {
        const progress = await this.store.getProgress(experimentId);
        const cancelled = progress ? await this.store.cancelExperiment(experimentId) : { status: "cancelled" };
        this.emit(WorkerEvent.CANCELLED, { experimentId, progress: cancelled });
        return cancelled;
      }
      this.emit(WorkerEvent.ERROR, { experimentId, error: serializeError(error) });
      return null;
    }
  }

  async start(message, signal) {
    const configuration = assertConfiguration(message.configuration);
    const selectedSeasons = sortedUniqueSeasons(message.selectedSeasons);
    if (configuration.selected_seasons.length !== selectedSeasons.length
        || configuration.selected_seasons.some((season, index) => season !== selectedSeasons[index])) {
      throw new BrowserExperimentError("configuration_scope_mismatch", "Configuration seasons do not match the selected package scope.");
    }
    const { manifest } = await fetchVerifiedManifest({
      url: message.manifestUrl,
      expectedSha256: message.manifestSha256,
      fetchImpl: this.fetchImpl,
      cryptoImpl: this.cryptoImpl,
      signal,
    });
    await this.store.markStaleReleases(manifest.release_id);
    const review = await assessRunCapacity({
      manifest,
      manifestSha256: message.manifestSha256,
      selectedSeasons,
      storageManager: this.storageManager,
      environment: this.environment,
      cryptoImpl: this.cryptoImpl,
    });
    signal.throwIfAborted();
    assertRunConfirmation(review, message.confirmation);
    await this.store.createExperiment({
      experimentId: message.experimentId,
      name: configuration.name,
      releaseId: manifest.release_id,
      manifestUrl: message.manifestUrl,
      manifestSha256: message.manifestSha256,
      engineVersion: manifest.engine_version,
      configuration,
      configurationReceipt: configuration.configuration_receipt,
      selectedSeasons,
      timeModes: [...TIME_MODES],
    });
    return this.run(message.experimentId, manifest, configuration, signal);
  }

  async resume(message, signal) {
    const configurationRecord = await this.store.getConfiguration(message.experimentId);
    const progress = await this.store.getProgress(message.experimentId);
    if (!configurationRecord || !progress) {
      throw new BrowserExperimentError("experiment_not_found", `Experiment ${message.experimentId} was not found.`);
    }
    if (configurationRecord.stale || configurationRecord.requiresRerun) {
      throw new BrowserExperimentError(
        "stale_release_read_only",
        "This experiment must be explicitly rerun as a new experiment under the current manifest.",
      );
    }
    if (progress.status === "complete") {
      this.emit(WorkerEvent.COMPLETE, { experimentId: message.experimentId, progress, alreadyComplete: true });
      return progress;
    }
    if (progress.currentSeason != null && !progress.completedSeasons.includes(progress.currentSeason)) {
      await this.store.clearSeasonPartial(message.experimentId, progress.currentSeason);
      await this.store.updateProgress(message.experimentId, { currentSeason: null, status: "interrupted" });
    }
    const { manifest } = await fetchVerifiedManifest({
      url: configurationRecord.manifestUrl,
      expectedSha256: configurationRecord.manifestSha256,
      fetchImpl: this.fetchImpl,
      cryptoImpl: this.cryptoImpl,
      signal,
    });
    if (manifest.release_id !== configurationRecord.releaseId) {
      await this.store.markStaleReleases(manifest.release_id);
      throw new BrowserExperimentError("stale_release_read_only", "The stored experiment belongs to a different release.");
    }
    return this.run(message.experimentId, manifest, configurationRecord.configuration, signal);
  }

  async run(experimentId, manifest, configuration, signal) {
    await this.store.beginRun(experimentId);
    try {
      const progress = await this.store.getProgress(experimentId);
      const completed = new Set(progress.completedSeasons);
      const selectedSeasonDescriptors = progress.selectedSeasons.map((seasonEndYear) => {
        const season = manifest.seasons.find((candidate) => candidate.season_end_year === seasonEndYear);
        if (!season) throw new BrowserExperimentError("season_unavailable", `Season ${seasonEndYear} is absent.`);
        return season;
      });
      const totalGames = selectedSeasonDescriptors.reduce((sum, season) => sum + season.game_count, 0);
      let completedGames = selectedSeasonDescriptors
        .filter((season) => completed.has(season.season_end_year))
        .reduce((sum, season) => sum + season.game_count, 0);
      let seasonsProcessedThisPass = 0;
      const runProgress = (stage, season = null, patch = {}) => ({
        stage,
        completedGames,
        totalGames,
        currentGameId: null,
        seasonEndYear: season?.season_end_year ?? null,
        seasonCompletedGames: season && completed.has(season.season_end_year)
          ? season.game_count
          : 0,
        seasonTotalGames: season?.game_count ?? null,
        ...patch,
      });
      this.emit(WorkerEvent.STATE, {
        experimentId,
        status: "running",
        runProgress: runProgress("preparing"),
      });
      const catalog = await getVerifiedCatalog({
        store: this.store,
        manifest,
        fetchImpl: this.fetchImpl,
        cryptoImpl: this.cryptoImpl,
        signal,
      });
      this.emit(WorkerEvent.SHARD_VERIFIED, {
        experimentId,
        seasonEndYear: null,
        kind: "catalog",
        sha256: catalog.descriptor.sha256,
        byteCount: catalog.descriptor.byte_count,
        rowCount: 1,
        source: catalog.source,
        runProgress: runProgress("catalog-verified"),
      });
      for (const season of selectedSeasonDescriptors) {
        const seasonEndYear = season.season_end_year;
        signal.throwIfAborted();
        if (completed.has(seasonEndYear)) continue;
        await this.store.clearSeasonPartial(experimentId, seasonEndYear);
        await this.store.beginSeason(experimentId, seasonEndYear);
        this.emit(WorkerEvent.SEASON_STARTED, {
          experimentId,
          seasonEndYear,
          runProgress: runProgress("verifying-packages", season),
        });
        const packages = await getVerifiedSeasonShards({
          store: this.store,
          manifest,
          season,
          fetchImpl: this.fetchImpl,
          cryptoImpl: this.cryptoImpl,
          signal,
          onVerified: (details) => this.emit(WorkerEvent.SHARD_VERIFIED, {
            experimentId,
            ...details,
            runProgress: runProgress("verifying-packages", season),
          }),
        });
        let completion;
        try {
          completion = await this.calculateSeason({
            experimentId,
            manifest,
            season,
            configuration,
            catalog,
            packages,
            signal,
            completedGamesBeforeSeason: completedGames,
            totalGames,
          });
        } finally {
          packages.clear();
        }
        this.emit(WorkerEvent.STATE, {
          experimentId,
          seasonEndYear,
          status: "running",
          runProgress: runProgress("checkpointing", season, {
            completedGames: completedGames + season.game_count,
            seasonCompletedGames: season.game_count,
          }),
        });
        const receipt = await this.store.checkpointSeason(experimentId, seasonEndYear, {
          seasonReceipt: completion.seasonReceipt,
          aggregateReceipt: completion.aggregateReceipt,
          resultRowCount: completion.resultRowCount,
          aggregateRowCount: completion.aggregateRowCount,
          timeModes: [...TIME_MODES],
          packageReceipt: season.package_receipt,
        });
        completedGames += season.game_count;
        completed.add(seasonEndYear);
        this.emit(WorkerEvent.SEASON_CHECKPOINT, {
          experimentId,
          seasonEndYear,
          completedSeasons: [...completed].sort((a, b) => a - b),
          receipt,
          runProgress: runProgress("season-complete", season, {
            seasonCompletedGames: season.game_count,
          }),
        });
        seasonsProcessedThisPass += 1;
        await yieldToWorkerEventLoop();
        const hasRemaining = selectedSeasonDescriptors.some((candidate) => !completed.has(candidate.season_end_year));
        if (hasRemaining && seasonsProcessedThisPass >= this.seasonBatchSize) {
          const progress = await this.store.updateProgress(experimentId, {
            status: "interrupted",
            currentSeason: null,
            error: null,
          });
          this.emit(WorkerEvent.RECYCLE, {
            experimentId,
            progress,
            runProgress: runProgress("reclaiming-memory"),
          });
          return progress;
        }
      }
      const orderedReceipts = (await this.store.listReceipts(experimentId))
        .sort((left, right) => left.seasonEndYear - right.seasonEndYear)
        .map((receipt) => ({
          seasonEndYear: receipt.seasonEndYear,
          seasonReceipt: receipt.seasonReceipt,
          aggregateReceipt: receipt.aggregateReceipt,
        }));
      // Native IndexedDB does not expose its receipt map; its publication guard
      // remains authoritative, while these browser receipts bind the selected
      // configuration and release to the ordered season checkpoints seen here.
      const publicationBasis = {
        engineVersion: manifest.engine_version,
        releaseId: manifest.release_id,
        configurationReceipt: configuration.configuration_receipt,
        selectedSeasons: progress.selectedSeasons,
        orderedSeasonReceipts: orderedReceipts,
      };
      const aggregateReceipt = await canonicalSha256(
        { ...publicationBasis, kind: "aggregate" },
        this.cryptoImpl,
      );
      const experimentReceipt = await canonicalSha256(
        { ...publicationBasis, kind: "experiment" },
        this.cryptoImpl,
      );
      assertZeroNetworkWrites(this.fetchImpl.audit.snapshot());
      const publication = await this.store.publishExperiment(experimentId, { aggregateReceipt, experimentReceipt });
      this.emit(WorkerEvent.COMPLETE, {
        experimentId,
        publication,
        runProgress: runProgress("complete", null, { completedGames: totalGames }),
      });
      return publication;
    } catch (error) {
      if (abortError(error) || signal.aborted) {
        const progress = await this.store.cancelExperiment(experimentId);
        this.emit(WorkerEvent.CANCELLED, { experimentId, progress });
        return progress;
      }
      await this.store.failExperiment(experimentId, serializeError(error));
      throw error;
    }
  }

  async calculateSeason({
    experimentId,
    manifest,
    season,
    configuration,
    catalog,
    packages,
    signal,
    completedGamesBeforeSeason = 0,
    totalGames = season.game_count,
  }) {
    const stream = this.calculator.calculateSeason({ manifest, season, configuration, catalog, packages, signal });
    if (!stream?.[Symbol.asyncIterator]) {
      throw new BrowserExperimentError("invalid_calculator_kernel", "calculateSeason() must return an async event stream.");
    }
    const modeCounts = Object.fromEntries(TIME_MODES.map((mode) => [mode, 0]));
    let resultRowCount = 0;
    let aggregateRowCount = 0;
    let completion = null;
    let seasonCompletedGames = 0;
    let currentGameId = null;
    for await (const rawEvent of stream) {
      signal.throwIfAborted();
      const event = assertKernelEvent(rawEvent, season.season_end_year);
      if (completion) throw new BrowserExperimentError("kernel_event_after_completion", "Calculator emitted data after completion.");
      if (event.type === KernelEvent.PLAYER_GAME_RESULTS) {
        if (!Array.isArray(event.rows) || event.rows.length === 0) continue;
        for (const row of event.rows) {
          if (row.season_end_year !== season.season_end_year || !TIME_MODES.includes(row.time_mode)) {
            throw new BrowserExperimentError("kernel_result_scope_mismatch", "Calculator emitted a result outside its season/time-mode scope.");
          }
          modeCounts[row.time_mode] += 1;
        }
        resultRowCount += await this.store.putPlayerGameResults(experimentId, season.season_end_year, event.rows);
      } else if (event.type === KernelEvent.AGGREGATES) {
        if (!Array.isArray(event.rows) || event.rows.length === 0) continue;
        aggregateRowCount += await this.store.putAggregates(experimentId, season.season_end_year, event.rows);
      } else if (event.type === KernelEvent.PROGRESS) {
        if (event.progress?.stage === "games") {
          seasonCompletedGames = Number(event.progress.completed);
          currentGameId = event.progress.currentGameId || null;
        }
        const stage = event.progress?.stage === "games"
          ? "calculating-games"
          : event.progress?.stage === "player-game-results"
            ? "saving-results"
            : "preparing-calculation";
        this.emit(WorkerEvent.STATE, {
          experimentId,
          seasonEndYear: season.season_end_year,
          status: "running",
          calculationProgress: event.progress,
          runProgress: {
            stage,
            completedGames: completedGamesBeforeSeason + seasonCompletedGames,
            totalGames,
            currentGameId,
            seasonEndYear: season.season_end_year,
            seasonCompletedGames,
            seasonTotalGames: season.game_count,
          },
        });
      } else if (event.type === KernelEvent.SEASON_COMPLETE) {
        completion = event;
      }
    }
    const checked = assertSeasonCompletion(completion, season.season_end_year, modeCounts);
    if (checked.resultRowCount !== resultRowCount || checked.aggregateRowCount !== aggregateRowCount) {
      throw new BrowserExperimentError("kernel_row_count_mismatch", "Calculator completion counts do not match persisted batches.");
    }
    return checked;
  }

  async cancel(experimentId) {
    if (this.active?.experimentId === experimentId) {
      this.active.controller.abort(new DOMException("Experiment cancelled.", "AbortError"));
      this.emit(WorkerEvent.STATE, { experimentId, status: "cancelling" });
      return { status: "cancelling" };
    }
    const progress = await this.store.cancelExperiment(experimentId);
    this.emit(WorkerEvent.CANCELLED, { experimentId, progress });
    return progress;
  }
}
