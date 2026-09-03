import { canonicalJson } from "./hash.js";
import { BrowserExperimentError, TIME_MODES, assertTimeModes, sortedUniqueSeasons } from "./protocol.js";

export const EXPERIMENT_DATABASE_NAME = "value-contributed-original-experiments";
export const EXPERIMENT_DATABASE_VERSION = 4;
export const EXPERIMENT_STORE_NAMES = Object.freeze({
  PACKAGES: "packages",
  CONFIGURATIONS: "configurations",
  PROGRESS: "progress",
  RESULTS: "player_game_results",
  AGGREGATES: "aggregates",
  RECEIPTS: "receipts",
});

const STORE_DEFINITIONS = Object.freeze({
  [EXPERIMENT_STORE_NAMES.PACKAGES]: { keyPath: "key", introduced: 1 },
  [EXPERIMENT_STORE_NAMES.CONFIGURATIONS]: { keyPath: "experimentId", introduced: 1 },
  [EXPERIMENT_STORE_NAMES.PROGRESS]: { keyPath: "experimentId", introduced: 1 },
  [EXPERIMENT_STORE_NAMES.RESULTS]: { keyPath: "key", introduced: 1 },
  [EXPERIMENT_STORE_NAMES.AGGREGATES]: { keyPath: "key", introduced: 2 },
  [EXPERIMENT_STORE_NAMES.RECEIPTS]: { keyPath: "key", introduced: 2 },
});

const INDEX_DEFINITIONS = Object.freeze({
  [EXPERIMENT_STORE_NAMES.PACKAGES]: [
    ["by_release_season", ["releaseId", "seasonEndYear"], { unique: false }],
    ["by_release", "releaseId", { unique: false }],
  ],
  [EXPERIMENT_STORE_NAMES.CONFIGURATIONS]: [
    ["by_release", "releaseId", { unique: false }],
    ["by_published", "published", { unique: false }],
  ],
  [EXPERIMENT_STORE_NAMES.PROGRESS]: [
    ["by_status", "status", { unique: false }],
  ],
  [EXPERIMENT_STORE_NAMES.RESULTS]: [
    ["by_experiment", "experimentId", { unique: false }],
    ["by_experiment_season", ["experimentId", "seasonEndYear"], { unique: false }],
    ["by_experiment_season_mode", ["experimentId", "seasonEndYear", "timeMode"], { unique: false }],
  ],
  [EXPERIMENT_STORE_NAMES.AGGREGATES]: [
    ["by_experiment", "experimentId", { unique: false }],
    ["by_experiment_season", ["experimentId", "seasonEndYear"], { unique: false }],
    ["by_experiment_panel", ["experimentId", "panel"], { unique: false }],
  ],
  [EXPERIMENT_STORE_NAMES.RECEIPTS]: [
    ["by_experiment", "experimentId", { unique: false }],
    ["by_experiment_season", ["experimentId", "seasonEndYear"], { unique: true }],
  ],
});

function contains(collection, name) {
  return typeof collection?.contains === "function"
    ? collection.contains(name)
    : Array.from(collection || []).includes(name);
}

const V4_INCOMPATIBLE_RESULT_ERROR = Object.freeze({
  code: "incompatible_stored_result_schema",
  message: "Stored experiment results use an incompatible row-hash contract and must be rerun.",
});

function updateEveryRecord(store, transform) {
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    cursor.update(transform(cursor.value));
    cursor.continue();
  };
}

function invalidatePreV4Results(transaction) {
  updateEveryRecord(
    transaction.objectStore(EXPERIMENT_STORE_NAMES.CONFIGURATIONS),
    (configuration) => ({
      ...configuration,
      stale: true,
      published: false,
      requiresRerun: true,
    }),
  );
  updateEveryRecord(
    transaction.objectStore(EXPERIMENT_STORE_NAMES.PROGRESS),
    (progress) => ({
      ...progress,
      status: "interrupted",
      stale: true,
      published: false,
      requiresRerun: true,
      error: { ...V4_INCOMPATIBLE_RESULT_ERROR },
    }),
  );
  for (const storeName of [
    EXPERIMENT_STORE_NAMES.RESULTS,
    EXPERIMENT_STORE_NAMES.AGGREGATES,
    EXPERIMENT_STORE_NAMES.RECEIPTS,
    EXPERIMENT_STORE_NAMES.PACKAGES,
  ]) {
    transaction.objectStore(storeName).clear();
  }
}

export function upgradeOriginalExperimentDatabase(database, transaction, oldVersion) {
  for (const [name, definition] of Object.entries(STORE_DEFINITIONS)) {
    if (oldVersion < definition.introduced && !contains(database.objectStoreNames, name)) {
      database.createObjectStore(name, { keyPath: definition.keyPath });
    }
  }
  for (const [storeName, indexes] of Object.entries(INDEX_DEFINITIONS)) {
    const store = transaction.objectStore(storeName);
    for (const [indexName, keyPath, options] of indexes) {
      if (!contains(store.indexNames, indexName)) store.createIndex(indexName, keyPath, options);
    }
  }
  if (oldVersion < 4) invalidatePreV4Results(transaction);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

function updateByIndex(store, indexName, query, transform) {
  return new Promise((resolve, reject) => {
    const request = store.index(indexName).openCursor(query);
    request.onerror = () => reject(request.error || new Error("IndexedDB cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.update(transform(cursor.value));
      cursor.continue();
    };
  });
}

export async function openOriginalExperimentDatabase({
  indexedDB = globalThis.indexedDB,
  keyRange = globalThis.IDBKeyRange,
  name = EXPERIMENT_DATABASE_NAME,
} = {}) {
  if (!indexedDB?.open || !keyRange?.only) {
    throw new BrowserExperimentError("indexeddb_unavailable", "IndexedDB is required for browser-local experiments.");
  }
  const connect = async () => {
    const request = indexedDB.open(name, EXPERIMENT_DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      upgradeOriginalExperimentDatabase(request.result, request.transaction, event.oldVersion || 0);
    };
    return requestResult(request);
  };
  const database = await connect();
  return new OriginalExperimentStore(database, { keyRange, reconnect: connect });
}

function packageKey(releaseId, seasonEndYear, kind, sha256) {
  return `${releaseId}:${seasonEndYear}:${kind}:${sha256}`;
}

function resultKey(experimentId, seasonEndYear, row) {
  const identity = row.row_hash || [row.time_mode, row.game_id, row.team_id, row.player_id].join(":");
  return `${experimentId}:${seasonEndYear}:${identity}`;
}

function completeResultScope(rows, { seasons, timeMode }) {
  const scoped = rows.filter((row) =>
    (seasons === null || seasons.has(row.seasonEndYear))
    && (timeMode === null || row.timeMode === timeMode));
  if (scoped.some((row) => row.partial !== false)) {
    throw new BrowserExperimentError(
      "incomplete_result_scope",
      "A published Rankings query contains uncheckpointed player-game results.",
    );
  }
  return scoped;
}

function aggregateKey(experimentId, seasonEndYear, row) {
  const identity = row.aggregate_key || row.row_hash || canonicalJson([
    row.panel, row.time_mode ?? null, row.dimensions ?? {}, row.scope ?? null,
  ]);
  return `${experimentId}:${seasonEndYear}:${identity}`;
}

function receiptKey(experimentId, seasonEndYear) {
  return `${experimentId}:${seasonEndYear}`;
}

function nowIso(now) {
  return (now ? now() : new Date()).toISOString();
}

async function deleteByIndex(store, indexName, query) {
  await new Promise((resolve, reject) => {
    const request = store.index(indexName).openCursor(query);
    request.onerror = () => reject(request.error || new Error("IndexedDB cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });
}

export class OriginalExperimentStore {
  constructor(database, { keyRange = globalThis.IDBKeyRange, now, reconnect = null } = {}) {
    this.database = null;
    this.keyRange = keyRange;
    this.now = now;
    this.reconnect = reconnect;
    this.reconnectPromise = null;
    this.closed = false;
    this.setDatabase(database);
  }

  setDatabase(database) {
    this.database = database;
    database.onclose = () => {
      if (this.database === database) this.database = null;
    };
    database.onversionchange = () => {
      database.close();
      if (this.database === database) this.database = null;
    };
  }

  async ensureDatabase() {
    if (this.closed) {
      throw new BrowserExperimentError("indexeddb_store_closed", "The browser-local experiment store is closed.");
    }
    if (this.database) return this.database;
    if (typeof this.reconnect !== "function") {
      throw new BrowserExperimentError("indexeddb_connection_closed", "The browser-local database connection is closed.");
    }
    if (!this.reconnectPromise) {
      this.reconnectPromise = this.reconnect()
        .then((database) => {
          if (this.closed) {
            database.close();
            throw new BrowserExperimentError("indexeddb_store_closed", "The browser-local experiment store is closed.");
          }
          this.setDatabase(database);
          return database;
        })
        .finally(() => {
          this.reconnectPromise = null;
        });
    }
    return this.reconnectPromise;
  }

  async openTransaction(storeNames, mode) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const database = await this.ensureDatabase();
      try {
        return database.transaction(storeNames, mode);
      } catch (error) {
        const connectionClosing = error?.name === "InvalidStateError"
          || /database connection is (?:closed|closing)|connection is (?:closed|closing)/i.test(error?.message || "");
        if (!connectionClosing || attempt > 0 || typeof this.reconnect !== "function") throw error;
        if (this.database === database) this.database = null;
        database.close();
      }
    }
    throw new BrowserExperimentError("indexeddb_connection_closed", "The browser-local database connection is closed.");
  }

  close() {
    this.closed = true;
    const database = this.database;
    this.database = null;
    database?.close();
  }

  async get(storeName, key) {
    const transaction = await this.openTransaction(storeName, "readonly");
    const value = await requestResult(transaction.objectStore(storeName).get(key));
    await transactionComplete(transaction);
    return value || null;
  }

  async put(storeName, value) {
    const transaction = await this.openTransaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionComplete(transaction);
    return value;
  }

  async list(storeName) {
    const transaction = await this.openTransaction(storeName, "readonly");
    const values = await requestResult(transaction.objectStore(storeName).getAll());
    await transactionComplete(transaction);
    return values;
  }

  async putPackage({ releaseId, seasonEndYear, descriptor, bytes }) {
    const value = {
      key: packageKey(releaseId, seasonEndYear, descriptor.kind, descriptor.sha256),
      releaseId,
      seasonEndYear,
      kind: descriptor.kind,
      sha256: descriptor.sha256,
      byteCount: descriptor.byte_count,
      rowCount: descriptor.row_count,
      sourceReceipt: descriptor.source_receipt,
      schemaVersion: descriptor.schema_version,
      format: descriptor.format,
      compression: descriptor.compression,
      url: descriptor.url,
      verifiedAt: nowIso(this.now),
      bytes: bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes,
    };
    return this.put(EXPERIMENT_STORE_NAMES.PACKAGES, value);
  }

  getPackage(releaseId, seasonEndYear, descriptor) {
    return this.get(
      EXPERIMENT_STORE_NAMES.PACKAGES,
      packageKey(releaseId, seasonEndYear, descriptor.kind, descriptor.sha256),
    );
  }

  async deletePackage(releaseId, seasonEndYear, descriptor) {
    const transaction = await this.openTransaction(EXPERIMENT_STORE_NAMES.PACKAGES, "readwrite");
    transaction.objectStore(EXPERIMENT_STORE_NAMES.PACKAGES)
      .delete(packageKey(releaseId, seasonEndYear, descriptor.kind, descriptor.sha256));
    await transactionComplete(transaction);
  }

  async createExperiment(record) {
    const seasons = sortedUniqueSeasons(record.selectedSeasons);
    assertTimeModes(record.timeModes);
    const timestamp = nowIso(this.now);
    const configuration = {
      ...record,
      selectedSeasons: seasons,
      timeModes: [...TIME_MODES],
      published: false,
      stale: false,
      requiresRerun: false,
      createdAt: record.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const progress = {
      experimentId: record.experimentId,
      releaseId: record.releaseId,
      status: "draft",
      selectedSeasons: seasons,
      completedSeasons: [],
      currentSeason: null,
      seasonStates: {},
      published: false,
      stale: false,
      requiresRerun: false,
      error: null,
      updatedAt: timestamp,
    };
    const transaction = await this.openTransaction(
      [EXPERIMENT_STORE_NAMES.CONFIGURATIONS, EXPERIMENT_STORE_NAMES.PROGRESS],
      "readwrite",
    );
    const existing = await requestResult(
      transaction.objectStore(EXPERIMENT_STORE_NAMES.CONFIGURATIONS).get(record.experimentId),
    );
    if (existing) {
      transaction.abort();
      throw new BrowserExperimentError("experiment_exists", `Experiment ${record.experimentId} already exists.`);
    }
    transaction.objectStore(EXPERIMENT_STORE_NAMES.CONFIGURATIONS).add(configuration);
    transaction.objectStore(EXPERIMENT_STORE_NAMES.PROGRESS).add(progress);
    await transactionComplete(transaction);
    return { configuration, progress };
  }

  getConfiguration(experimentId) {
    return this.get(EXPERIMENT_STORE_NAMES.CONFIGURATIONS, experimentId);
  }

  getProgress(experimentId) {
    return this.get(EXPERIMENT_STORE_NAMES.PROGRESS, experimentId);
  }

  async listReceipts(experimentId) {
    const transaction = await this.openTransaction(EXPERIMENT_STORE_NAMES.RECEIPTS, "readonly");
    const receipts = await requestResult(
      transaction.objectStore(EXPERIMENT_STORE_NAMES.RECEIPTS)
        .index("by_experiment")
        .getAll(this.keyRange.only(experimentId)),
    );
    await transactionComplete(transaction);
    return receipts.sort((left, right) => left.seasonEndYear - right.seasonEndYear);
  }

  async updateProgress(experimentId, patch) {
    const current = await this.getProgress(experimentId);
    if (!current) throw new BrowserExperimentError("experiment_not_found", `Experiment ${experimentId} was not found.`);
    const updated = { ...current, ...patch, experimentId, updatedAt: nowIso(this.now) };
    return this.put(EXPERIMENT_STORE_NAMES.PROGRESS, updated);
  }

  async beginRun(experimentId) {
    const configuration = await this.getConfiguration(experimentId);
    if (!configuration) throw new BrowserExperimentError("experiment_not_found", `Experiment ${experimentId} was not found.`);
    if (configuration.stale || configuration.requiresRerun) {
      throw new BrowserExperimentError("stale_release_read_only", "This experiment is read-only until rerun under the current manifest.");
    }
    return this.updateProgress(experimentId, { status: "running", error: null, published: false });
  }

  async beginSeason(experimentId, seasonEndYear) {
    const progress = await this.getProgress(experimentId);
    if (!progress || !progress.selectedSeasons.includes(seasonEndYear)) {
      throw new BrowserExperimentError("season_not_selected", `Season ${seasonEndYear} is not selected.`);
    }
    const seasonStates = {
      ...progress.seasonStates,
      [seasonEndYear]: { status: "running", startedAt: nowIso(this.now) },
    };
    return this.updateProgress(experimentId, { currentSeason: seasonEndYear, seasonStates });
  }

  async putPlayerGameResults(experimentId, seasonEndYear, rows) {
    if (!Array.isArray(rows)) throw new TypeError("Player-game results must be an array.");
    const transaction = await this.openTransaction(EXPERIMENT_STORE_NAMES.RESULTS, "readwrite");
    const store = transaction.objectStore(EXPERIMENT_STORE_NAMES.RESULTS);
    for (const row of rows) {
      if (!TIME_MODES.includes(row.time_mode)) {
        transaction.abort();
        throw new BrowserExperimentError("invalid_result_time_mode", "A result row has an invalid time mode.");
      }
      store.put({
        ...row,
        key: resultKey(experimentId, seasonEndYear, row),
        experimentId,
        seasonEndYear,
        timeMode: row.time_mode,
        partial: true,
      });
    }
    await transactionComplete(transaction);
    return rows.length;
  }

  async putAggregates(experimentId, seasonEndYear, rows) {
    if (!Array.isArray(rows)) throw new TypeError("Aggregates must be an array.");
    const transaction = await this.openTransaction(EXPERIMENT_STORE_NAMES.AGGREGATES, "readwrite");
    const store = transaction.objectStore(EXPERIMENT_STORE_NAMES.AGGREGATES);
    for (const row of rows) {
      if (typeof row.panel !== "string" || row.panel.length === 0) {
        transaction.abort();
        throw new BrowserExperimentError("invalid_aggregate", "An aggregate row is missing its panel.");
      }
      store.put({
        ...row,
        key: aggregateKey(experimentId, seasonEndYear, row),
        experimentId,
        seasonEndYear,
        partial: true,
      });
    }
    await transactionComplete(transaction);
    return rows.length;
  }

  async checkpointSeason(experimentId, seasonEndYear, seasonReceipt) {
    assertTimeModes(seasonReceipt.timeModes, "season receipt time modes");
    const transaction = await this.openTransaction(
      [
        EXPERIMENT_STORE_NAMES.PROGRESS,
        EXPERIMENT_STORE_NAMES.RESULTS,
        EXPERIMENT_STORE_NAMES.AGGREGATES,
        EXPERIMENT_STORE_NAMES.RECEIPTS,
      ],
      "readwrite",
    );
    const progressStore = transaction.objectStore(EXPERIMENT_STORE_NAMES.PROGRESS);
    const progress = await requestResult(progressStore.get(experimentId));
    if (!progress || progress.currentSeason !== seasonEndYear) {
      transaction.abort();
      throw new BrowserExperimentError("checkpoint_order_error", `Season ${seasonEndYear} is not the active season.`);
    }
    const completedSeasons = [...new Set([...progress.completedSeasons, seasonEndYear])].sort((a, b) => a - b);
    const timestamp = nowIso(this.now);
    const receipt = {
      ...seasonReceipt,
      key: receiptKey(experimentId, seasonEndYear),
      experimentId,
      seasonEndYear,
      status: "complete",
      timeModes: [...TIME_MODES],
      completedAt: timestamp,
    };
    const seasonQuery = this.keyRange.only([experimentId, seasonEndYear]);
    await Promise.all([
      updateByIndex(
        transaction.objectStore(EXPERIMENT_STORE_NAMES.RESULTS),
        "by_experiment_season",
        seasonQuery,
        (row) => ({ ...row, partial: false }),
      ),
      updateByIndex(
        transaction.objectStore(EXPERIMENT_STORE_NAMES.AGGREGATES),
        "by_experiment_season",
        seasonQuery,
        (row) => ({ ...row, partial: false }),
      ),
    ]);
    transaction.objectStore(EXPERIMENT_STORE_NAMES.RECEIPTS).put(receipt);
    progressStore.put({
      ...progress,
      completedSeasons,
      currentSeason: null,
      seasonStates: {
        ...progress.seasonStates,
        [seasonEndYear]: { status: "complete", completedAt: timestamp, receipt: receipt.seasonReceipt },
      },
      updatedAt: timestamp,
    });
    await transactionComplete(transaction);
    return receipt;
  }

  async clearSeasonPartial(experimentId, seasonEndYear) {
    const transaction = await this.openTransaction(
      [EXPERIMENT_STORE_NAMES.RESULTS, EXPERIMENT_STORE_NAMES.AGGREGATES, EXPERIMENT_STORE_NAMES.RECEIPTS],
      "readwrite",
    );
    const query = this.keyRange.only([experimentId, seasonEndYear]);
    await deleteByIndex(transaction.objectStore(EXPERIMENT_STORE_NAMES.RESULTS), "by_experiment_season", query);
    await deleteByIndex(transaction.objectStore(EXPERIMENT_STORE_NAMES.AGGREGATES), "by_experiment_season", query);
    transaction.objectStore(EXPERIMENT_STORE_NAMES.RECEIPTS).delete(receiptKey(experimentId, seasonEndYear));
    await transactionComplete(transaction);
  }

  async cancelExperiment(experimentId) {
    const progress = await this.getProgress(experimentId);
    if (!progress) throw new BrowserExperimentError("experiment_not_found", `Experiment ${experimentId} was not found.`);
    if (progress.status === "complete") return progress;
    if (progress.currentSeason != null && !progress.completedSeasons.includes(progress.currentSeason)) {
      await this.clearSeasonPartial(experimentId, progress.currentSeason);
    }
    const seasonStates = { ...progress.seasonStates };
    if (progress.currentSeason != null) {
      seasonStates[progress.currentSeason] = { status: "cancelled", cancelledAt: nowIso(this.now) };
    }
    return this.updateProgress(experimentId, {
      status: "cancelled",
      currentSeason: null,
      seasonStates,
      published: false,
      error: null,
    });
  }

  async failExperiment(experimentId, error) {
    const progress = await this.getProgress(experimentId);
    if (!progress) return null;
    if (progress.currentSeason != null && !progress.completedSeasons.includes(progress.currentSeason)) {
      await this.clearSeasonPartial(experimentId, progress.currentSeason);
    }
    return this.updateProgress(experimentId, {
      status: "interrupted",
      currentSeason: null,
      published: false,
      error,
    });
  }

  async publishExperiment(experimentId, publication) {
    const transaction = await this.openTransaction(
      [EXPERIMENT_STORE_NAMES.CONFIGURATIONS, EXPERIMENT_STORE_NAMES.PROGRESS, EXPERIMENT_STORE_NAMES.RECEIPTS],
      "readwrite",
    );
    const configurationStore = transaction.objectStore(EXPERIMENT_STORE_NAMES.CONFIGURATIONS);
    const progressStore = transaction.objectStore(EXPERIMENT_STORE_NAMES.PROGRESS);
    const receiptStore = transaction.objectStore(EXPERIMENT_STORE_NAMES.RECEIPTS);
    const [configuration, progress, receipts] = await Promise.all([
      requestResult(configurationStore.get(experimentId)),
      requestResult(progressStore.get(experimentId)),
      requestResult(receiptStore.index("by_experiment").getAll(this.keyRange.only(experimentId))),
    ]);
    const receiptSeasons = new Set(
      receipts.filter((receipt) => receipt.status === "complete"
        && receipt.timeModes?.every((mode, index) => mode === TIME_MODES[index]))
        .map((receipt) => receipt.seasonEndYear),
    );
    const complete = configuration && progress
      && configuration.requiresRerun !== true
      && progress.selectedSeasons.length === receiptSeasons.size
      && progress.selectedSeasons.every((season) => receiptSeasons.has(season));
    if (!complete) {
      transaction.abort();
      throw new BrowserExperimentError(
        "publication_incomplete",
        "An experiment cannot appear in Rankings until every selected season passes in both time modes.",
      );
    }
    const timestamp = nowIso(this.now);
    const updatedConfiguration = {
      ...configuration,
      published: true,
      stale: false,
      aggregateReceipt: publication.aggregateReceipt,
      experimentReceipt: publication.experimentReceipt,
      publishedAt: timestamp,
      updatedAt: timestamp,
    };
    const updatedProgress = {
      ...progress,
      status: "complete",
      published: true,
      stale: false,
      currentSeason: null,
      error: null,
      aggregateReceipt: publication.aggregateReceipt,
      experimentReceipt: publication.experimentReceipt,
      completedAt: timestamp,
      updatedAt: timestamp,
    };
    configurationStore.put(updatedConfiguration);
    progressStore.put(updatedProgress);
    await transactionComplete(transaction);
    return { configuration: updatedConfiguration, progress: updatedProgress, receipts };
  }

  async listExperiments({ publishedOnly = false } = {}) {
    const configurations = await this.list(EXPERIMENT_STORE_NAMES.CONFIGURATIONS);
    const progressRows = await this.list(EXPERIMENT_STORE_NAMES.PROGRESS);
    const progressById = new Map(progressRows.map((row) => [row.experimentId, row]));
    return configurations
      .filter((configuration) => !publishedOnly || configuration.published === true)
      .map((configuration) => ({ ...configuration, progress: progressById.get(configuration.experimentId) || null }))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  async renameExperiment(experimentId, name) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName || normalizedName.length > 80) {
      throw new BrowserExperimentError("invalid_name", "Experiment names must contain 1 to 80 characters.");
    }
    const configuration = await this.getConfiguration(experimentId);
    if (!configuration) throw new BrowserExperimentError("experiment_not_found", `Experiment ${experimentId} was not found.`);
    if (configuration.stale || configuration.requiresRerun) {
      throw new BrowserExperimentError("stale_release_read_only", "A stale-release experiment cannot be renamed.");
    }
    const updated = { ...configuration, name: normalizedName, updatedAt: nowIso(this.now) };
    await this.put(EXPERIMENT_STORE_NAMES.CONFIGURATIONS, updated);
    return updated;
  }

  async markStaleReleases(currentReleaseId) {
    const configurations = await this.list(EXPERIMENT_STORE_NAMES.CONFIGURATIONS);
    const changed = [];
    for (const configuration of configurations) {
      const stale = configuration.requiresRerun === true
        || configuration.releaseId !== currentReleaseId;
      if (configuration.stale === stale) continue;
      const progress = await this.getProgress(configuration.experimentId);
      const updatedConfiguration = { ...configuration, stale, updatedAt: nowIso(this.now) };
      await this.put(EXPERIMENT_STORE_NAMES.CONFIGURATIONS, updatedConfiguration);
      if (progress) await this.updateProgress(configuration.experimentId, { stale });
      changed.push(configuration.experimentId);
    }
    return changed;
  }

  async recoverInterruptedExperiments() {
    const progresses = await this.list(EXPERIMENT_STORE_NAMES.PROGRESS);
    const recovered = [];
    for (const progress of progresses.filter((row) => row.status === "running")) {
      if (progress.currentSeason != null && !progress.completedSeasons.includes(progress.currentSeason)) {
        await this.clearSeasonPartial(progress.experimentId, progress.currentSeason);
      }
      await this.updateProgress(progress.experimentId, {
        status: "interrupted",
        currentSeason: null,
        published: false,
        error: { code: "worker_interrupted", message: "The worker stopped before its season checkpoint." },
      });
      recovered.push(progress.experimentId);
    }
    return recovered;
  }

  async deleteExperiment(experimentId) {
    const transaction = await this.openTransaction(
      [
        EXPERIMENT_STORE_NAMES.CONFIGURATIONS, EXPERIMENT_STORE_NAMES.PROGRESS,
        EXPERIMENT_STORE_NAMES.RESULTS, EXPERIMENT_STORE_NAMES.AGGREGATES,
        EXPERIMENT_STORE_NAMES.RECEIPTS,
      ],
      "readwrite",
    );
    transaction.objectStore(EXPERIMENT_STORE_NAMES.CONFIGURATIONS).delete(experimentId);
    transaction.objectStore(EXPERIMENT_STORE_NAMES.PROGRESS).delete(experimentId);
    const query = this.keyRange.only(experimentId);
    await Promise.all([
      deleteByIndex(transaction.objectStore(EXPERIMENT_STORE_NAMES.RESULTS), "by_experiment", query),
      deleteByIndex(transaction.objectStore(EXPERIMENT_STORE_NAMES.AGGREGATES), "by_experiment", query),
      deleteByIndex(transaction.objectStore(EXPERIMENT_STORE_NAMES.RECEIPTS), "by_experiment", query),
    ]);
    await transactionComplete(transaction);
    return true;
  }

  async queryAggregates(experimentId, { panel, filters = {}, sort, limit = 100, offset = 0 } = {}) {
    const configuration = await this.getConfiguration(experimentId);
    if (!configuration?.published) {
      throw new BrowserExperimentError("experiment_not_published", "Only complete experiments can be queried in Rankings.");
    }
    const transaction = await this.openTransaction(EXPERIMENT_STORE_NAMES.AGGREGATES, "readonly");
    const store = transaction.objectStore(EXPERIMENT_STORE_NAMES.AGGREGATES);
    const source = panel
      ? store.index("by_experiment_panel").getAll(this.keyRange.only([experimentId, panel]))
      : store.index("by_experiment").getAll(this.keyRange.only(experimentId));
    let rows = await requestResult(source);
    await transactionComplete(transaction);
    rows = rows.filter((row) => Object.entries(filters).every(([key, expected]) => {
      const actual = row.dimensions?.[key] ?? row[key];
      return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
    }));
    if (panel && rows.length === 0) {
      throw new BrowserExperimentError("aggregate_panel_unavailable", `No local aggregate exists for panel ${panel}.`);
    }
    const sortKey = sort?.key;
    if (sortKey) {
      const direction = sort.direction === "asc" ? 1 : -1;
      rows.sort((left, right) => {
        const leftValue = left.measures?.[sortKey] ?? left.sortKeys?.[sortKey] ?? left[sortKey];
        const rightValue = right.measures?.[sortKey] ?? right.sortKeys?.[sortKey] ?? right[sortKey];
        if (leftValue === rightValue) return String(left.key).localeCompare(String(right.key));
        return (leftValue < rightValue ? -1 : 1) * direction;
      });
    }
    const total = rows.length;
    return { rows: rows.slice(offset, offset + limit), total, configuration };
  }

  async queryPlayerGameResults(experimentId, {
    seasonEndYears = null,
    timeMode = null,
  } = {}) {
    const configuration = await this.getConfiguration(experimentId);
    if (!configuration?.published) {
      throw new BrowserExperimentError("experiment_not_published", "Only complete experiments can be queried in Rankings.");
    }
    if (timeMode !== null && !TIME_MODES.includes(timeMode)) {
      throw new BrowserExperimentError("invalid_result_time_mode", `Unsupported result time mode ${timeMode}.`);
    }
    const seasons = seasonEndYears === null
      ? null
      : new Set(sortedUniqueSeasons(seasonEndYears));
    const transaction = await this.openTransaction(EXPERIMENT_STORE_NAMES.RESULTS, "readonly");
    const store = transaction.objectStore(EXPERIMENT_STORE_NAMES.RESULTS);
    let source;
    if (seasons?.size === 1) {
      const [seasonEndYear] = seasons;
      source = timeMode === null
        ? store.index("by_experiment_season").getAll(this.keyRange.only([experimentId, seasonEndYear]))
        : store.index("by_experiment_season_mode").getAll(
          this.keyRange.only([experimentId, seasonEndYear, timeMode]),
        );
    } else {
      source = store.index("by_experiment").getAll(this.keyRange.only(experimentId));
    }
    const rows = await requestResult(source);
    await transactionComplete(transaction);
    return {
      rows: completeResultScope(rows, { seasons, timeMode }),
      configuration,
    };
  }
}

export class MemoryExperimentStore {
  constructor({ now } = {}) {
    this.now = now;
    this.packages = new Map();
    this.configurations = new Map();
    this.progress = new Map();
    this.results = new Map();
    this.aggregates = new Map();
    this.receipts = new Map();
  }

  close() {}

  async putPackage({ releaseId, seasonEndYear, descriptor, bytes }) {
    const key = packageKey(releaseId, seasonEndYear, descriptor.kind, descriptor.sha256);
    const record = { key, releaseId, seasonEndYear, kind: descriptor.kind, sha256: descriptor.sha256,
      byteCount: descriptor.byte_count, rowCount: descriptor.row_count, sourceReceipt: descriptor.source_receipt,
      schemaVersion: descriptor.schema_version, format: descriptor.format, compression: descriptor.compression,
      url: descriptor.url, verifiedAt: nowIso(this.now), bytes: bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0) };
    this.packages.set(key, record);
    return structuredClone(record);
  }

  async getPackage(releaseId, seasonEndYear, descriptor) {
    return structuredClone(this.packages.get(packageKey(releaseId, seasonEndYear, descriptor.kind, descriptor.sha256)) || null);
  }

  async deletePackage(releaseId, seasonEndYear, descriptor) {
    this.packages.delete(packageKey(releaseId, seasonEndYear, descriptor.kind, descriptor.sha256));
  }

  async createExperiment(record) {
    if (this.configurations.has(record.experimentId)) throw new BrowserExperimentError("experiment_exists", "Experiment already exists.");
    const timestamp = nowIso(this.now);
    const configuration = { ...structuredClone(record), selectedSeasons: sortedUniqueSeasons(record.selectedSeasons),
      timeModes: [...assertTimeModes(record.timeModes)], published: false, stale: false, requiresRerun: false,
      createdAt: record.createdAt || timestamp, updatedAt: timestamp };
    const progress = { experimentId: record.experimentId, releaseId: record.releaseId, status: "draft",
      selectedSeasons: [...configuration.selectedSeasons], completedSeasons: [], currentSeason: null,
      seasonStates: {}, published: false, stale: false, requiresRerun: false, error: null, updatedAt: timestamp };
    this.configurations.set(record.experimentId, configuration);
    this.progress.set(record.experimentId, progress);
    return structuredClone({ configuration, progress });
  }

  async getConfiguration(id) { return structuredClone(this.configurations.get(id) || null); }
  async getProgress(id) { return structuredClone(this.progress.get(id) || null); }
  async listReceipts(id) {
    return structuredClone([...this.receipts.values()]
      .filter((row) => row.experimentId === id)
      .sort((left, right) => left.seasonEndYear - right.seasonEndYear));
  }

  async updateProgress(id, patch) {
    const current = this.progress.get(id);
    if (!current) throw new BrowserExperimentError("experiment_not_found", "Experiment was not found.");
    const updated = { ...current, ...structuredClone(patch), experimentId: id, updatedAt: nowIso(this.now) };
    this.progress.set(id, updated);
    return structuredClone(updated);
  }

  async beginRun(id) {
    const config = this.configurations.get(id);
    if (!config) throw new BrowserExperimentError("experiment_not_found", "Experiment was not found.");
    if (config.stale || config.requiresRerun) {
      throw new BrowserExperimentError("stale_release_read_only", "Stale experiment is read-only.");
    }
    return this.updateProgress(id, { status: "running", published: false, error: null });
  }

  async beginSeason(id, season) {
    const progress = this.progress.get(id);
    const states = { ...progress.seasonStates, [season]: { status: "running", startedAt: nowIso(this.now) } };
    return this.updateProgress(id, { currentSeason: season, seasonStates: states });
  }

  async putPlayerGameResults(id, season, rows) {
    rows.forEach((row) => {
      if (!TIME_MODES.includes(row.time_mode)) throw new BrowserExperimentError("invalid_result_time_mode", "Invalid time mode.");
      const key = resultKey(id, season, row);
      this.results.set(key, { ...structuredClone(row), key, experimentId: id, seasonEndYear: season,
        timeMode: row.time_mode, partial: true });
    });
    return rows.length;
  }

  async putAggregates(id, season, rows) {
    rows.forEach((row) => {
      if (!row.panel) throw new BrowserExperimentError("invalid_aggregate", "Aggregate panel is required.");
      const key = aggregateKey(id, season, row);
      this.aggregates.set(key, { ...structuredClone(row), key, experimentId: id, seasonEndYear: season, partial: true });
    });
    return rows.length;
  }

  async checkpointSeason(id, season, receiptValue) {
    assertTimeModes(receiptValue.timeModes);
    const progress = this.progress.get(id);
    if (progress.currentSeason !== season) throw new BrowserExperimentError("checkpoint_order_error", "Wrong active season.");
    const receipt = { ...structuredClone(receiptValue), key: receiptKey(id, season), experimentId: id,
      seasonEndYear: season, status: "complete", timeModes: [...TIME_MODES], completedAt: nowIso(this.now) };
    for (const [key, row] of this.results) {
      if (row.experimentId === id && row.seasonEndYear === season) {
        this.results.set(key, { ...row, partial: false });
      }
    }
    for (const [key, row] of this.aggregates) {
      if (row.experimentId === id && row.seasonEndYear === season) {
        this.aggregates.set(key, { ...row, partial: false });
      }
    }
    this.receipts.set(receipt.key, receipt);
    await this.updateProgress(id, { completedSeasons: [...new Set([...progress.completedSeasons, season])].sort(),
      currentSeason: null, seasonStates: { ...progress.seasonStates,
        [season]: { status: "complete", completedAt: nowIso(this.now), receipt: receipt.seasonReceipt } } });
    return structuredClone(receipt);
  }

  async clearSeasonPartial(id, season) {
    for (const [key, row] of this.results) if (row.experimentId === id && row.seasonEndYear === season) this.results.delete(key);
    for (const [key, row] of this.aggregates) if (row.experimentId === id && row.seasonEndYear === season) this.aggregates.delete(key);
    this.receipts.delete(receiptKey(id, season));
  }

  async cancelExperiment(id) {
    const progress = this.progress.get(id);
    if (progress?.status === "complete") return structuredClone(progress);
    if (progress.currentSeason != null && !progress.completedSeasons.includes(progress.currentSeason)) {
      await this.clearSeasonPartial(id, progress.currentSeason);
    }
    return this.updateProgress(id, { status: "cancelled", currentSeason: null, published: false, error: null });
  }

  async failExperiment(id, error) {
    const progress = this.progress.get(id);
    if (!progress) return null;
    if (progress.currentSeason != null && !progress.completedSeasons.includes(progress.currentSeason)) {
      await this.clearSeasonPartial(id, progress.currentSeason);
    }
    return this.updateProgress(id, { status: "interrupted", currentSeason: null, published: false, error });
  }

  async publishExperiment(id, publication) {
    const config = this.configurations.get(id);
    const progress = this.progress.get(id);
    const receipts = [...this.receipts.values()].filter((row) => row.experimentId === id && row.status === "complete");
    if (!config || config.requiresRerun === true || progress.selectedSeasons.length !== receipts.length
      || !progress.selectedSeasons.every((season) => receipts.some((receipt) => receipt.seasonEndYear === season))) {
      throw new BrowserExperimentError("publication_incomplete", "Every selected season must pass.");
    }
    const timestamp = nowIso(this.now);
    const updatedConfig = { ...config, ...publication, published: true, stale: false, publishedAt: timestamp, updatedAt: timestamp };
    this.configurations.set(id, updatedConfig);
    await this.updateProgress(id, { ...publication, status: "complete", published: true, stale: false,
      currentSeason: null, error: null, completedAt: timestamp });
    return { configuration: structuredClone(updatedConfig), progress: await this.getProgress(id), receipts: structuredClone(receipts) };
  }

  async listExperiments({ publishedOnly = false } = {}) {
    return [...this.configurations.values()]
      .filter((row) => !publishedOnly || row.published)
      .map((row) => ({ ...structuredClone(row), progress: structuredClone(this.progress.get(row.experimentId) || null) }));
  }

  async renameExperiment(id, name) {
    const config = this.configurations.get(id);
    if (!config || config.stale || config.requiresRerun) {
      throw new BrowserExperimentError(config ? "stale_release_read_only" : "experiment_not_found", "Cannot rename experiment.");
    }
    const normalized = String(name).trim();
    if (!normalized || normalized.length > 80) throw new BrowserExperimentError("invalid_name", "Invalid name.");
    const updated = { ...config, name: normalized, updatedAt: nowIso(this.now) };
    this.configurations.set(id, updated);
    return structuredClone(updated);
  }

  async markStaleReleases(currentReleaseId) {
    const changed = [];
    for (const [id, config] of this.configurations) {
      const stale = config.requiresRerun === true || config.releaseId !== currentReleaseId;
      if (stale === config.stale) continue;
      this.configurations.set(id, { ...config, stale });
      await this.updateProgress(id, { stale });
      changed.push(id);
    }
    return changed;
  }

  async recoverInterruptedExperiments() {
    const recovered = [];
    for (const progress of [...this.progress.values()]) {
      if (progress.status !== "running") continue;
      if (progress.currentSeason != null) await this.clearSeasonPartial(progress.experimentId, progress.currentSeason);
      await this.updateProgress(progress.experimentId, { status: "interrupted", currentSeason: null, published: false });
      recovered.push(progress.experimentId);
    }
    return recovered;
  }

  async deleteExperiment(id) {
    this.configurations.delete(id); this.progress.delete(id);
    for (const [key, row] of this.results) if (row.experimentId === id) this.results.delete(key);
    for (const [key, row] of this.aggregates) if (row.experimentId === id) this.aggregates.delete(key);
    for (const [key, row] of this.receipts) if (row.experimentId === id) this.receipts.delete(key);
    return true;
  }

  async queryAggregates(id, { panel, filters = {}, sort, limit = 100, offset = 0 } = {}) {
    const config = this.configurations.get(id);
    if (!config?.published) throw new BrowserExperimentError("experiment_not_published", "Not published.");
    let rows = [...this.aggregates.values()].filter((row) => row.experimentId === id && (!panel || row.panel === panel));
    rows = rows.filter((row) => Object.entries(filters).every(([key, expected]) => {
      const actual = row.dimensions?.[key] ?? row[key];
      return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
    }));
    if (panel && !rows.length) throw new BrowserExperimentError("aggregate_panel_unavailable", "Panel unavailable.");
    if (sort?.key) {
      const direction = sort.direction === "asc" ? 1 : -1;
      rows.sort((a, b) => ((a.measures?.[sort.key] ?? a[sort.key]) - (b.measures?.[sort.key] ?? b[sort.key])) * direction);
    }
    return { rows: structuredClone(rows.slice(offset, offset + limit)), total: rows.length, configuration: structuredClone(config) };
  }

  async queryPlayerGameResults(id, { seasonEndYears = null, timeMode = null } = {}) {
    const config = this.configurations.get(id);
    if (!config?.published) throw new BrowserExperimentError("experiment_not_published", "Not published.");
    if (timeMode !== null && !TIME_MODES.includes(timeMode)) {
      throw new BrowserExperimentError("invalid_result_time_mode", `Unsupported result time mode ${timeMode}.`);
    }
    const seasons = seasonEndYears === null ? null : new Set(sortedUniqueSeasons(seasonEndYears));
    const rows = [...this.results.values()].filter((row) => row.experimentId === id);
    return {
      rows: structuredClone(completeResultScope(rows, { seasons, timeMode })),
      configuration: structuredClone(config),
    };
  }
}
