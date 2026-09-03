import { isSha256 } from "./hash.js";

export const ENGINE_VERSION = "value-contributed-original-browser-engine-v1-2026-08-30";
export const CONFIGURATION_SCHEMA_VERSION = "value-contributed-original-experiment-config-v1";
export const MANIFEST_SCHEMA_VERSION = "value-contributed-original-package-manifest-v2";
export const SEASON_PACKAGE_SCHEMA_VERSION = "value-contributed-original-season-package-v2";
export const SEASON_PACKAGE_RECEIPT_FORMAT = "value-contributed-original-season-package-receipt-v2";
export const MANIFEST_RECEIPT_FORMAT = "value-contributed-original-package-manifest-receipt-v2";
export const RESULT_SCHEMA_VERSION = "value-contributed-original-player-game-result-v2";
export const RESPONSIBILITY_ADAPTER_VERSION = "value-contributed-original-v8-responsibility-adapter-v1";
export const WORKER_PROTOCOL_VERSION = "value-contributed-original-worker-protocol-v2";
export const TIME_MODES = Object.freeze(["all_minutes", "competitive"]);
export const ALL_SEASONS = Object.freeze(Array.from({ length: 13 }, (_, index) => 2014 + index));

// Mirrors original_package.physical_schema_policy_receipts() and
// original_interface_custody.interface_policy_receipts(). A browser manifest
// may carry additional policy receipts, but these governed bindings are exact.
export const GOVERNED_MANIFEST_POLICY_RECEIPTS = Object.freeze({
  "original_interface_custody": "09efac4773418d8babb63ad171f9d2b8cb3a98750ce838cb59c2fd21944bd313",
  "original_interface_schema.browser_player_result_v2": "91a57c1534c3a37253baaf105647d3e680fc783c3a849cf70adad718bcd4a504",
  "original_interface_schema.configuration_v1": "633491ba175a7266f5f7e3f206f9a7cdca2a7225d56a21857bfd84034cdcd845",
  "original_interface_schema.official_player_result_v1": "713b1b2cb7a2cd4567b074458c2092f87f8be28036eda4c306f3dbd5a24a318f",
  "original_interface_schema.package_manifest_v1": "97e7c2d386873435c2cd79c29e1c71040022d53202ad8b86bf586009ed21f6ba",
  "original_interface_schema.package_manifest_v2": "328a0218b0d43d8d2e73e42bd01c19db53f9c8a380662805f8b9d1014baeb668",
  "original_interface_schema.public_release_receipt_v1": "f54ac904964e1019d1f4920889c219dbce630798798a6121c14cc379d6aae1c3",
  "original_interface_schema.public_release_receipt_v2": "08eae7880a8bb7f7931d75b66e39d61cd8eae8f64f34755506bf6f02177b9f64",
  "original_interface_successor.json": "668f3f46da17840bee1e5ecf2b0052cb92e5853aa30b0d0bc184318e95969f6d",
  "original_interface_successor.markdown": "ea5b71c5d564cb9b725d69bc0aae5fe18876e58692eb825d1bd670dc57055529",
  "package_physical_schema.catalog": "45eb676d8c781e29cf6b74eec7e08630b0a85c14ca0654e0850f4ad3a12e1cf9",
  "package_physical_schema.coefficient_basis": "003359431d4bbcbfe4726f09f535f51990ef308f6c2d0fbf7a63674a13c36a9d",
  "package_physical_schema.context_operands": "8912c21d066942d5056a9a3f75c6f8e821f4d60bdb0037f914dda43a84d3a7f4",
  "package_physical_schema.games": "d4051ed0f3a11c46e2c01af52ac62388b9fe3dadaa97596b3dc17c97cef3abfa",
  "package_physical_schema.official_outputs": "b86dcaeae4cea281d261909ef744835e2081883dfd01ab3d50c810373fbaa82b",
  "package_physical_schema.players": "ebdccf3ea4f49d2269d623dc0795a43405d9131c0c5af33e41754c67f52a9e9e",
  "package_physical_schema.responsibility_metadata": "56d8db678d8fc4df9ceaf28d63a4a391715029ff9a16c1d00ea2bd25ab30a8ce",
});

const MANIFEST_KEYS = Object.freeze([
  "schema_version", "release_id", "engine_version", "policy_receipts", "parent_receipts",
  "catalog", "component_order", "responsibility", "seasons", "all_seasons_estimate",
  "content_sha256",
]);
const RESPONSIBILITY_KEYS = Object.freeze(["adapter_version", "policy_sha256", "metadata_sha256"]);

export const WorkerCommand = Object.freeze({
  START: "start",
  RESUME: "resume",
  CANCEL: "cancel",
  STATUS: "status",
});

export const WorkerEvent = Object.freeze({
  READY: "ready",
  STATE: "state",
  SEASON_STARTED: "season-started",
  SHARD_VERIFIED: "shard-verified",
  SEASON_CHECKPOINT: "season-checkpoint",
  COMPLETE: "complete",
  CANCELLED: "cancelled",
  ERROR: "error",
});

export const KernelEvent = Object.freeze({
  PLAYER_GAME_RESULTS: "player-game-results",
  AGGREGATES: "aggregates",
  PROGRESS: "progress",
  SEASON_COMPLETE: "season-complete",
});

export class BrowserExperimentError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "BrowserExperimentError";
    this.code = code;
    this.details = details;
  }
}

export function sortedUniqueSeasons(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BrowserExperimentError("invalid_seasons", "Select at least one season.");
  }
  const seasons = [...new Set(value.map(Number))].sort((left, right) => left - right);
  if (seasons.length !== value.length || seasons.some((season) => !ALL_SEASONS.includes(season))) {
    throw new BrowserExperimentError("invalid_seasons", "Seasons must be unique integers from 2014 through 2026.");
  }
  return seasons;
}

export function assertTimeModes(value, label = "time modes") {
  if (!Array.isArray(value) || value.length !== TIME_MODES.length
      || value.some((mode, index) => mode !== TIME_MODES[index])) {
    throw new BrowserExperimentError(
      "invalid_time_modes",
      `${label} must contain all_minutes and competitive in canonical order.`,
    );
  }
  return TIME_MODES;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isReceiptMapping(value, { required = null } = {}) {
  if (!isObject(value) || Object.keys(value).length === 0
      || Object.entries(value).some(([key, receipt]) => key.length === 0 || !isSha256(receipt))) {
    return false;
  }
  return required === null
    || Object.entries(required).every(([key, receipt]) => value[key] === receipt);
}

function hasValidResponsibilityBinding(value) {
  return hasExactKeys(value, RESPONSIBILITY_KEYS)
    && value.adapter_version === RESPONSIBILITY_ADAPTER_VERSION
    && isSha256(value.policy_sha256)
    && isSha256(value.metadata_sha256);
}

function assertShard(shard, seasonEndYear) {
  const kinds = new Set([
    "games", "players", "coefficient_basis", "context_operands",
    "responsibility_metadata", "official_outputs",
  ]);
  if (!shard || typeof shard !== "object" || !kinds.has(shard.kind)) {
    throw new BrowserExperimentError("invalid_manifest", `Season ${seasonEndYear} has an invalid shard kind.`);
  }
  if (shard.schema_version !== SEASON_PACKAGE_SCHEMA_VERSION
      || !["arrow-ipc-stream", "json"].includes(shard.format)
      || !["br", "gzip", "none"].includes(shard.compression)
      || typeof shard.url !== "string" || shard.url.length === 0
      || !Number.isInteger(shard.byte_count) || shard.byte_count < 1
      || !Number.isInteger(shard.row_count) || shard.row_count < 0
      || !isSha256(shard.sha256) || !isSha256(shard.source_receipt)) {
    throw new BrowserExperimentError("invalid_manifest", `Season ${seasonEndYear} has an invalid ${shard.kind} shard.`);
  }
}

export function assertPackageManifest(manifest) {
  if (!hasExactKeys(manifest, MANIFEST_KEYS)
      || manifest.schema_version !== MANIFEST_SCHEMA_VERSION
      || manifest.engine_version !== ENGINE_VERSION
      || typeof manifest.release_id !== "string"
      || !isSha256(manifest.content_sha256)
      || !isReceiptMapping(manifest.policy_receipts, { required: GOVERNED_MANIFEST_POLICY_RECEIPTS })
      || !isReceiptMapping(manifest.parent_receipts)
      || !hasValidResponsibilityBinding(manifest.responsibility)
      || !manifest.catalog || manifest.catalog.schema_version !== "value-contributed-original-browser-catalog-v1"
      || !isSha256(manifest.catalog.sha256)
      || typeof manifest.catalog.url !== "string" || manifest.catalog.url.length === 0
      || !Number.isInteger(manifest.catalog.bytes) || manifest.catalog.bytes < 1
      || !manifest.all_seasons_estimate
      || ["download_bytes", "storage_bytes", "runtime_seconds_low", "runtime_seconds_high"]
        .some((key) => !Number.isInteger(manifest.all_seasons_estimate[key])
          || manifest.all_seasons_estimate[key] < 0)
      || !Array.isArray(manifest.seasons)) {
    throw new BrowserExperimentError("invalid_manifest", "The package manifest does not match the governed v2 contract.");
  }
  const seasonYears = manifest.seasons.map((season) => season.season_end_year);
  const canonicalYears = sortedUniqueSeasons(seasonYears);
  if (canonicalYears.length !== ALL_SEASONS.length
      || canonicalYears.some((season, index) => season !== ALL_SEASONS[index])) {
    throw new BrowserExperimentError("invalid_manifest", "The package manifest must cover seasons 2014 through 2026.");
  }
  for (const season of manifest.seasons) {
    if (!Number.isInteger(season.game_count) || season.game_count < 1
        || !Number.isInteger(season.player_game_mode_count) || season.player_game_mode_count < 1
        || !isSha256(season.selected_games_sha256)
        || typeof season.operand_build_id !== "string"
        || !isSha256(season.operand_receipt)
        || !isSha256(season.package_receipt)
        || !Array.isArray(season.shards) || season.shards.length < 6) {
      throw new BrowserExperimentError("invalid_manifest", `Season ${season.season_end_year} is incomplete.`);
    }
    season.shards.forEach((shard) => assertShard(shard, season.season_end_year));
    const kinds = new Set(season.shards.map((shard) => shard.kind));
    if (kinds.size !== season.shards.length) {
      throw new BrowserExperimentError("invalid_manifest", `Season ${season.season_end_year} repeats a shard kind.`);
    }
  }
  return manifest;
}

export function assertConfiguration(configuration) {
  if (!configuration || typeof configuration !== "object"
      || configuration.schema_version !== CONFIGURATION_SCHEMA_VERSION
      || configuration.engine_version !== ENGINE_VERSION
      || configuration.responsibility_adapter_version !== RESPONSIBILITY_ADAPTER_VERSION
      || !isSha256(configuration.configuration_receipt)) {
    throw new BrowserExperimentError("invalid_configuration", "Configuration does not match the frozen v1 contract.");
  }
  sortedUniqueSeasons(configuration.selected_seasons);
  assertTimeModes(configuration.time_modes, "configuration.time_modes");
  return configuration;
}

export function workerEnvelope(type, payload = {}) {
  return { protocolVersion: WORKER_PROTOCOL_VERSION, type, ...payload };
}

export function assertWorkerCommand(message) {
  if (!message || typeof message !== "object" || message.protocolVersion !== WORKER_PROTOCOL_VERSION
      || !Object.values(WorkerCommand).includes(message.type)) {
    throw new BrowserExperimentError("invalid_worker_command", "Unsupported experiment worker command.");
  }
  if (message.type !== WorkerCommand.STATUS
      && (typeof message.experimentId !== "string" || message.experimentId.length === 0)) {
    throw new BrowserExperimentError("invalid_worker_command", "Worker command requires an experimentId.");
  }
  return message;
}

export function serializeError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || "experiment_error",
    message: error?.message || String(error),
    details: error?.details,
  };
}
