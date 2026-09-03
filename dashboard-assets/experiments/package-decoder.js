import {
  BrowserExperimentError,
  GOVERNED_MANIFEST_POLICY_RECEIPTS,
  SEASON_PACKAGE_SCHEMA_VERSION,
} from "./protocol.js";

const TYPED_JSON_ENCODING = "value-contributed-original-typed-json-v1";
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const MILLISECONDS_PER_DAY = 86_400_000;
const FACTOR_ORDER_METADATA = JSON.stringify([
  "general_offense",
  "general_defense",
  "teammate_offense",
  "teammate_defense",
  "opponent_offense",
  "opponent_defense",
]);
const INT64_BROWSER_CONVERSION = "reject_abs_gt_9007199254740991_before_number_conversion";
// Exact browser mirror of original_package.TABLE_SCHEMAS. The independently
// governed fingerprints below bind each kind to these names, logical types,
// and non-nullable Arrow fields.
const PHYSICAL_SCHEMAS = Object.freeze({
  games: Object.freeze([
    ["game_id", "utf8"],
    ["game_date", "date32"],
    ["season_end_year", "int16"],
    ["season_type", "utf8"],
    ["home_team_id", "int64"],
    ["away_team_id", "int64"],
    ["schedule_ordinal", "int32"],
  ]),
  players: Object.freeze([
    ["player_id", "int64"],
    ["player_name", "utf8"],
    ["canonical_player_id", "int64"],
    ["team_id", "int64"],
    ["game_id", "utf8"],
    ["time_mode", "utf8"],
    ["win_loss", "bool"],
    ["seconds_played", "int32"],
  ]),
  coefficient_basis: Object.freeze([
    ["game_id", "utf8"],
    ["time_mode", "utf8"],
    ["team_id", "int64"],
    ["player_id", "int64"],
    ["side", "utf8"],
    ["component_key", "utf8"],
    ["basis_expression_id", "utf8"],
    ["operation", "utf8"],
    ["coefficient_keys", "list<utf8>"],
    ["operands", "list<float64>"],
    ["canonical_sum_ordinal", "int32"],
  ]),
  context_operands: Object.freeze([
    ["game_id", "utf8"],
    ["time_mode", "utf8"],
    ["team_id", "int64"],
    ["opponent_id", "int64"],
    ["player_id", "int64"],
    ["offense_possessions_on", "int32"],
    ["offense_possessions_off", "int32"],
    ["offense_actual_points_on", "float64"],
    ["offense_actual_points_off", "float64"],
    ["offense_neutral_expected_on", "float64"],
    ["offense_neutral_expected_off", "float64"],
    ["teammate_offense_effect_on", "float64"],
    ["teammate_offense_effect_off", "float64"],
    ["opponent_defense_effect_on", "float64"],
    ["opponent_defense_effect_off", "float64"],
    ["defense_possessions_on", "int32"],
    ["defense_possessions_off", "int32"],
    ["defense_actual_points_on", "float64"],
    ["defense_actual_points_off", "float64"],
    ["defense_neutral_expected_on", "float64"],
    ["defense_neutral_expected_off", "float64"],
    ["teammate_defense_effect_on", "float64"],
    ["teammate_defense_effect_off", "float64"],
    ["opponent_offense_effect_on", "float64"],
    ["opponent_offense_effect_off", "float64"],
  ]),
  responsibility_metadata: Object.freeze([
    ["component_key", "utf8"],
    ["side", "utf8"],
    ["component_ordinal", "int32"],
    ["negative_transfer_eligible", "bool"],
    ["floored_positive_transfer_eligible", "bool"],
    ["policy_sha256", "utf8"],
  ]),
  official_outputs: Object.freeze([
    ["slug", "utf8"],
    ["game_id", "utf8"],
    ["time_mode", "utf8"],
    ["team_id", "int64"],
    ["player_id", "int64"],
    ["raw_vc", "float64"],
    ["six_context_components", "fixed-list<float64,6>"],
    ["final_value_contributed", "float64"],
    ["offense_responsibility", "float64"],
    ["defense_responsibility", "float64"],
    ["other_responsibility", "float64"],
    ["row_hash", "utf8"],
  ]),
});
const ARROW_TYPE_NAMES = Object.freeze({
  utf8: "Utf8",
  bool: "Bool",
  int16: "Int16",
  int32: "Int32",
  int64: "Int64",
  float64: "Float64",
  date32: "Date32<DAY>",
  "list<utf8>": "List<Utf8>",
  "list<float64>": "List<Float64>",
  "fixed-list<float64,6>": "FixedSizeList[6]<Float64>",
});
const ARROW_NESTED_TYPE_CONTRACTS = Object.freeze({
  "list<utf8>": Object.freeze({ childType: "Utf8" }),
  "list<float64>": Object.freeze({ childType: "Float64" }),
  "fixed-list<float64,6>": Object.freeze({ childType: "Float64", listSize: 6 }),
});

function schemaMismatch(message) {
  throw new BrowserExperimentError("package_schema_mismatch", message);
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function governedSchema(kind) {
  if (typeof kind !== "string" || !Object.hasOwn(PHYSICAL_SCHEMAS, kind)) {
    schemaMismatch(`Unknown package shard kind ${String(kind)}.`);
  }
  return PHYSICAL_SCHEMAS[kind];
}

function expectedMetadata(kind) {
  const fingerprint = GOVERNED_MANIFEST_POLICY_RECEIPTS[`package_physical_schema.${kind}`];
  if (typeof fingerprint !== "string") schemaMismatch(`${kind} has no governed physical-schema fingerprint.`);
  return {
    value_contributed_schema_version: SEASON_PACKAGE_SCHEMA_VERSION,
    value_contributed_shard_kind: kind,
    value_contributed_factor_order: FACTOR_ORDER_METADATA,
    value_contributed_int64_browser_conversion: INT64_BROWSER_CONVERSION,
    value_contributed_physical_schema_sha256: fingerprint,
  };
}

function assertExactMetadata(value, kind) {
  const expected = expectedMetadata(kind);
  if (!hasExactKeys(value, Object.keys(expected))
      || Object.entries(expected).some(([key, wanted]) => value[key] !== wanted)) {
    schemaMismatch(`${kind} physical-schema metadata drifted.`);
  }
}

function canonicalDate(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    schemaMismatch(`${path} must be a canonical date32 string.`);
  }
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) {
    schemaMismatch(`${path} must be a canonical date32 string.`);
  }
  return value;
}

function normalizeLogicalValue(value, logicalType, path) {
  if (logicalType === "utf8") {
    if (typeof value !== "string" || value.length === 0) schemaMismatch(`${path} must be nonempty UTF-8 text.`);
    return value;
  }
  if (logicalType === "bool") {
    if (typeof value !== "boolean") schemaMismatch(`${path} must be boolean.`);
    return value;
  }
  if (logicalType === "int16" || logicalType === "int32" || logicalType === "int64") {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) schemaMismatch(`${path} must be a safe integer.`);
    const [minimum, maximum] = logicalType === "int16"
      ? [-(2 ** 15), (2 ** 15) - 1]
      : logicalType === "int32"
        ? [-(2 ** 31), (2 ** 31) - 1]
        : [-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER];
    if (value < minimum || value > maximum) schemaMismatch(`${path} exceeds ${logicalType}.`);
    return value;
  }
  if (logicalType === "float64") {
    if (typeof value !== "number" || !Number.isFinite(value)) schemaMismatch(`${path} must be finite float64.`);
    return value;
  }
  if (logicalType === "date32") return canonicalDate(value, path);
  if (logicalType === "list<utf8>" || logicalType === "list<float64>"
      || logicalType === "fixed-list<float64,6>") {
    if (!Array.isArray(value)) schemaMismatch(`${path} must be an array.`);
    if (logicalType === "fixed-list<float64,6>" && value.length !== 6) {
      schemaMismatch(`${path} must contain exactly six values.`);
    }
    const itemType = logicalType === "list<utf8>" ? "utf8" : "float64";
    return value.map((child, index) => normalizeLogicalValue(child, itemType, `${path}[${index}]`));
  }
  schemaMismatch(`${path} uses unsupported logical type ${logicalType}.`);
}

function normalizeDecodedRow(values, schema, kind, rowIndex) {
  if (!Array.isArray(values) || values.length !== schema.length) {
    schemaMismatch(`${kind} row ${rowIndex} has the wrong width.`);
  }
  return Object.fromEntries(schema.map(([name, logicalType], columnIndex) => [
    name,
    normalizeLogicalValue(values[columnIndex], logicalType, `${kind}[${rowIndex}].${name}`),
  ]));
}

async function decompress(bytes, compression) {
  if (compression === "none") return bytes;
  if (compression !== "gzip") {
    throw new BrowserExperimentError(
      "unsupported_package_compression",
      `The verified ${compression} package cannot be decompressed by this release.`,
    );
  }
  if (typeof DecompressionStream !== "function") {
    throw new BrowserExperimentError(
      "decompression_unavailable",
      "This browser does not expose the required gzip DecompressionStream API.",
    );
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (cause) {
    throw new BrowserExperimentError("package_decompression_failed", "A verified package could not be decompressed.", {
      cause: cause?.message,
    });
  }
}

function safeNumber(value, path) {
  if (typeof value === "bigint") {
    if (value > BigInt(MAX_SAFE_INTEGER) || value < BigInt(-MAX_SAFE_INTEGER)) {
      throw new BrowserExperimentError("unsafe_int64", `${path} exceeds Number.MAX_SAFE_INTEGER.`);
    }
    return Number(value);
  }
  return value;
}

function normalizeArrowValue(value, path) {
  if (typeof value === "bigint") return safeNumber(value, path);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map((child, index) => normalizeArrowValue(child, `${path}[${index}]`));
  if (ArrayBuffer.isView(value)) return Array.from(value, (child, index) => normalizeArrowValue(child, `${path}[${index}]`));
  if (value && typeof value === "object") {
    if (typeof value.toArray === "function") {
      return Array.from(value.toArray(), (child, index) => normalizeArrowValue(child, `${path}[${index}]`));
    }
    const source = typeof value.toJSON === "function" ? value.toJSON() : value;
    return Object.fromEntries(Object.entries(source).map(([key, child]) => [key, normalizeArrowValue(child, `${path}.${key}`)]));
  }
  return value;
}

function normalizeArrowFieldValue(value, field, path) {
  const normalized = normalizeArrowValue(value, path);
  if (!String(field?.type || "").startsWith("Date32<")) return normalized;
  if (typeof normalized !== "number" || !Number.isSafeInteger(normalized)
      || normalized % MILLISECONDS_PER_DAY !== 0) {
    throw new BrowserExperimentError(
      "package_schema_mismatch",
      `${path} is not a canonical Arrow Date32 value.`,
    );
  }
  const instant = new Date(normalized);
  if (!Number.isFinite(instant.getTime())) {
    throw new BrowserExperimentError(
      "package_schema_mismatch",
      `${path} is outside the supported Arrow Date32 range.`,
    );
  }
  return instant.toISOString().slice(0, 10);
}

function decodeTypedJson(raw, descriptor) {
  const schema = governedSchema(descriptor.kind);
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (cause) {
    throw new BrowserExperimentError("package_json_invalid", `${descriptor.kind} is not valid typed JSON.`, {
      cause: cause?.message,
    });
  }
  if (!hasExactKeys(envelope, ["columns", "encoding", "kind", "metadata", "rows", "schema_version"])
      || envelope.encoding !== TYPED_JSON_ENCODING
      || envelope.schema_version !== SEASON_PACKAGE_SCHEMA_VERSION
      || envelope.kind !== descriptor.kind
      || !Array.isArray(envelope.columns)
      || !Array.isArray(envelope.rows)) {
    throw new BrowserExperimentError("package_schema_mismatch", `${descriptor.kind} typed JSON metadata drifted.`);
  }
  if (envelope.columns.length !== schema.length
      || schema.some(([name, logicalType], index) => {
        const column = envelope.columns[index];
        return !hasExactKeys(column, ["name", "type"])
          || column.name !== name
          || column.type !== logicalType;
      })) {
    schemaMismatch(`${descriptor.kind} typed JSON columns or types drifted.`);
  }
  assertExactMetadata(envelope.metadata, descriptor.kind);
  return envelope.rows.map((values, rowIndex) => normalizeDecodedRow(values, schema, descriptor.kind, rowIndex));
}

function arrowMetadataText(value, path) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(value);
    } catch (cause) {
      schemaMismatch(`${path} is not UTF-8 Arrow metadata: ${cause?.message || "decode failed"}.`);
    }
  }
  schemaMismatch(`${path} is not text Arrow metadata.`);
}

function assertArrowMetadata(metadata, kind) {
  if (!metadata || typeof metadata.entries !== "function") {
    schemaMismatch(`${kind} Arrow metadata is absent.`);
  }
  const entries = [...metadata.entries()];
  if (entries.length === 0) schemaMismatch(`${kind} Arrow metadata is absent.`);
  // A null-prototype accumulator makes metadata keys data-only. In
  // particular, an unexpected `__proto__` entry must remain visible to the
  // exact-key comparison instead of invoking Object.prototype's setter.
  const normalized = Object.create(null);
  for (const [rawKey, rawValue] of entries) {
    const key = arrowMetadataText(rawKey, `${kind} Arrow metadata key`);
    if (Object.hasOwn(normalized, key)) schemaMismatch(`${kind} Arrow metadata contains duplicate keys.`);
    normalized[key] = arrowMetadataText(rawValue, `${kind} Arrow metadata.${key}`);
  }
  assertExactMetadata(normalized, kind);
}

function hasNoArrowMetadata(metadata) {
  return metadata && typeof metadata.entries === "function" && [...metadata.entries()].length === 0;
}

function arrowFieldMatches(field, expectedName, logicalType) {
  if (field?.name !== expectedName
      || field?.nullable !== false
      || String(field?.type || "") !== ARROW_TYPE_NAMES[logicalType]) {
    return false;
  }
  const nested = ARROW_NESTED_TYPE_CONTRACTS[logicalType];
  if (!nested) return true;

  // Arrow JS's List.toString() omits its child field name, nullability, and
  // metadata. PyArrow includes those properties in DataType equality, so
  // mirror the production pa.list_(...) / pa.list_(..., 6) type recursively.
  const children = field.type?.children;
  if (!Array.isArray(children) || children.length !== 1) return false;
  const child = children[0];
  if (child?.name !== "item"
      || child?.nullable !== true
      || !hasNoArrowMetadata(child?.metadata)
      || String(child?.type || "") !== nested.childType) {
    return false;
  }
  return nested.listSize === undefined || field.type?.listSize === nested.listSize;
}

async function decodeArrow(raw, descriptor) {
  const schema = governedSchema(descriptor.kind);
  let tableFromIPC;
  try {
    ({ tableFromIPC } = await import("./vendor/apache-arrow.mjs"));
  } catch (cause) {
    throw new BrowserExperimentError(
      "arrow_decoder_unavailable",
      "The locally bundled Apache Arrow decoder is unavailable.",
      { cause: cause?.message },
    );
  }
  let table;
  try {
    table = tableFromIPC(raw);
  } catch (cause) {
    throw new BrowserExperimentError("package_arrow_invalid", `${descriptor.kind} is not valid Arrow IPC.`, {
      cause: cause?.message,
    });
  }
  const fields = table.schema?.fields;
  assertArrowMetadata(table.schema?.metadata, descriptor.kind);
  if (!Array.isArray(fields) || fields.length !== schema.length
      || schema.some(([name, logicalType], index) => {
        return !arrowFieldMatches(fields[index], name, logicalType);
      })) {
    schemaMismatch(`${descriptor.kind} Arrow columns, types, or nullability drifted.`);
  }
  const rows = [];
  let index = 0;
  for (const rawRow of table) {
    const source = typeof rawRow?.toJSON === "function" ? rawRow.toJSON() : rawRow;
    const values = fields.map((field) => normalizeArrowFieldValue(
      source[field.name] ?? rawRow[field.name],
      field,
      `${descriptor.kind}[${index}].${field.name}`,
    ));
    rows.push(normalizeDecodedRow(values, schema, descriptor.kind, index));
    index += 1;
  }
  return rows;
}

export async function decodeVerifiedPackage(verifiedPackage) {
  const { descriptor } = verifiedPackage || {};
  if (!descriptor || descriptor.schema_version !== SEASON_PACKAGE_SCHEMA_VERSION) {
    throw new BrowserExperimentError("package_schema_mismatch", "Verified package descriptor is incompatible.");
  }
  governedSchema(descriptor.kind);
  const compressed = verifiedPackage.bytes instanceof Uint8Array
    ? verifiedPackage.bytes
    : new Uint8Array(verifiedPackage.bytes);
  const raw = await decompress(compressed, descriptor.compression);
  const rows = descriptor.format === "json"
    ? decodeTypedJson(raw, descriptor)
    : descriptor.format === "arrow-ipc-stream"
      ? await decodeArrow(raw, descriptor)
      : (() => { throw new BrowserExperimentError("package_format_unsupported", `Unsupported ${descriptor.format} package.`); })();
  if (rows.length !== descriptor.row_count) {
    throw new BrowserExperimentError(
      "package_row_count_mismatch",
      `${descriptor.kind} decoded ${rows.length} rows; the manifest requires ${descriptor.row_count}.`,
    );
  }
  return rows;
}

export async function decodeVerifiedSeasonPackages(packages) {
  const required = [
    "games",
    "players",
    "coefficient_basis",
    "context_operands",
    "responsibility_metadata",
    "official_outputs",
  ];
  if (!(packages instanceof Map) || required.some((kind) => !packages.has(kind))) {
    throw new BrowserExperimentError("package_set_incomplete", "The verified season is missing a required shard.");
  }
  const decoded = {};
  for (const kind of required) decoded[kind] = await decodeVerifiedPackage(packages.get(kind));
  return decoded;
}

export async function decodeVerifiedCatalog(catalog) {
  const bytes = catalog?.bytes instanceof Uint8Array ? catalog.bytes : new Uint8Array(catalog?.bytes || []);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new BrowserExperimentError("catalog_json_invalid", "The verified catalog is not valid UTF-8 JSON.", {
      cause: cause?.message,
    });
  }
}
