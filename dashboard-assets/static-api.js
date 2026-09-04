(function staticApiModule(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.window === root) {
    root.ValueContributedStaticApi = api;
    if (!root.__VC_STATIC_API_NO_AUTO_INSTALL__) {
      try {
        api.installStaticApi({ root });
      } catch (error) {
        root.__VC_STATIC_API_INSTALL_ERROR__ = error;
      }
    }
  }
})(typeof globalThis === "undefined" ? this : globalThis, function buildStaticApi(root) {
  "use strict";

  const MANIFEST_SCHEMA =
    "value-contributed-original-public-projection-manifest-v1";
  const SNAPSHOT_SCHEMA = "value-contributed-original-public-projection-v1";
  const ENGINE_VERSION =
    "value-contributed-original-browser-engine-v1-2026-08-30";
  const DEFAULT_MANIFEST_URL =
    "./data/original-public-projection-manifest.json";
  const DEFAULT_METHODOLOGY_URL = "./data/methodology.json";
  const OFFICIAL_SLUGS = Object.freeze([
    "original",
  ]);
  const OFFICIAL_NAMES = Object.freeze({
    original: "Original",
  });
  const ROUTED_PANELS = Object.freeze([
    "rankings",
    "top_games",
    "high_value_records",
    "season_leaders",
    "rolling_graphs",
    "postseason_lift",
    "player_details",
  ]);
  const RECEIPT_KEYS = Object.freeze([
    ...ROUTED_PANELS,
    "responsibility",
    "context",
  ]);
  const TIME_MODES = Object.freeze(["all_minutes", "competitive"]);
  const PHASES = Object.freeze([
    "All",
    "Regular Season",
    "PlayIn",
    "Playoffs",
    "Postseason",
  ]);
  const ROLLING_WINDOWS = Object.freeze([1, 3, 5]);
  const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
  const MAX_METHODOLOGY_BYTES = 16 * 1024 * 1024;
  const MAX_COMPRESSED_BYTES = 128 * 1024 * 1024;
  const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
  const SHA_RE = /^[0-9a-f]{64}$/;
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  class StaticApiError extends Error {
    constructor(code, message, status = 503) {
      super(message);
      this.name = "StaticApiError";
      this.code = code;
      this.status = status;
    }
  }

  function fail(code, message, status = 503) {
    throw new StaticApiError(code, message, status);
  }

  function compareCodePoints(left, right) {
    const a = Array.from(left, (value) => value.codePointAt(0));
    const b = Array.from(right, (value) => value.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  }

  function sortedKeys(value) {
    return Object.keys(value).sort(compareCodePoints);
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function exactKeys(value, expected, label) {
    if (!isObject(value)) fail("malformed_projection", `${label} must be an object.`);
    const actual = sortedKeys(value);
    const wanted = [...expected].sort(compareCodePoints);
    if (
      actual.length !== wanted.length ||
      actual.some((key, index) => key !== wanted[index])
    ) {
      fail("malformed_projection", `${label} fields differ from the frozen contract.`);
    }
  }

  function requireString(value, label, { nonempty = true } = {}) {
    if (typeof value !== "string" || (nonempty && value.length === 0)) {
      fail("malformed_projection", `${label} must be a string.`);
    }
    return value;
  }

  function requireSha(value, label) {
    if (typeof value !== "string" || !SHA_RE.test(value)) {
      fail("malformed_projection", `${label} must be a lowercase SHA-256.`);
    }
    return value;
  }

  function requireUuid(value, label) {
    if (typeof value !== "string" || !UUID_RE.test(value)) {
      fail("malformed_projection", `${label} must be a canonical UUID.`);
    }
    return value;
  }

  function requireInteger(value, label, minimum, maximum) {
    if (
      !Number.isSafeInteger(value) ||
      value < minimum ||
      (maximum !== undefined && value > maximum)
    ) {
      fail("malformed_projection", `${label} is outside its integer contract.`);
    }
    return value;
  }

  function requireSeason(value, label, { allowAll = true } = {}) {
    requireString(value, label);
    if (allowAll && value === "All Seasons") return value;
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match || String((Number(match[1]) + 1) % 100).padStart(2, "0") !== match[2]) {
      fail("invalid_static_api_query", `${label} is not a canonical NBA season.`, 422);
    }
    return value;
  }

  function requireEnum(value, choices, label, status = 422) {
    if (!choices.includes(value)) {
      fail("invalid_static_api_query", `${label} is unsupported.`, status);
    }
    return value;
  }

  function utf8(value) {
    return new TextEncoder().encode(value);
  }

  function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    fail("invalid_bytes", "Expected a byte buffer.");
  }

  function bytesEqual(left, right) {
    const a = bytesOf(left);
    const b = bytesOf(right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function hex(bytes) {
    return Array.from(bytesOf(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function cryptoProvider(override) {
    const provider = override || root?.crypto;
    if (!provider?.subtle?.digest) {
      fail("crypto_unavailable", "Web Crypto SHA-256 is unavailable in this browser.");
    }
    return provider;
  }

  async function sha256Hex(value, override) {
    const digest = await cryptoProvider(override).subtle.digest("SHA-256", bytesOf(value));
    return hex(new Uint8Array(digest));
  }

  function float64Hex(value) {
    if (!Number.isFinite(value)) fail("nonfinite_json", "JSON numbers must be finite.");
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, false);
    return hex(bytes);
  }

  function typedObject(entries) {
    return [
      "object",
      [...entries]
        .sort((left, right) => compareCodePoints(left[0], right[0]))
        .map(([key, value]) => [key, value]),
    ];
  }

  function typedValue(value, path = "$") {
    if (value === null) return ["null"];
    if (typeof value === "boolean") return ["bool", value];
    if (typeof value === "string") return ["str", value];
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("nonfinite_json", `${path} is nonfinite.`);
      if (Number.isSafeInteger(value)) return ["int", String(value)];
      return ["float64", float64Hex(value)];
    }
    if (Array.isArray(value)) {
      return ["array", value.map((item, index) => typedValue(item, `${path}[${index}]`))];
    }
    if (isObject(value)) {
      return typedObject(
        sortedKeys(value).map((key) => [key, typedValue(value[key], `${path}.${key}`)]),
      );
    }
    fail("unsupported_json", `${path} contains an unsupported JSON value.`);
  }

  function typedMember(typed, key) {
    if (!Array.isArray(typed) || typed[0] !== "object") return undefined;
    return typed[1].find((entry) => entry[0] === key)?.[1];
  }

  function typedWithoutMember(typed, key) {
    if (!Array.isArray(typed) || typed[0] !== "object") {
      fail("malformed_projection", "Typed JSON root must be an object.");
    }
    return ["object", typed[1].filter((entry) => entry[0] !== key)];
  }

  async function contentSha256FromTyped(typed, formatName, cryptoOverride) {
    const body = JSON.stringify({ format: formatName, value: typed });
    return sha256Hex(utf8(body), cryptoOverride);
  }

  async function contentSha256(value, formatName, cryptoOverride) {
    return contentSha256FromTyped(typedValue(value), formatName, cryptoOverride);
  }

  async function contentSha256CanonicalJson(raw, formatName, cryptoOverride) {
    const parsed = parseStrictCanonicalJson(raw, "Receipt JSON");
    return contentSha256FromTyped(parsed.typed, formatName, cryptoOverride);
  }

  function canonicalJson(value) {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("nonfinite_json", "JSON numbers must be finite.");
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (isObject(value)) {
      return `{${sortedKeys(value)
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
        .join(",")}}`;
    }
    fail("unsupported_json", "A value cannot be serialized as strict JSON.");
  }

  function canonicalJsonBytes(value) {
    return utf8(`${canonicalJson(value)}\n`);
  }

  class StrictJsonParser {
    constructor(text, label) {
      this.text = text;
      this.label = label;
      this.index = 0;
    }

    error(message) {
      fail("malformed_json", `${this.label} ${message}`);
    }

    parse() {
      const node = this.value();
      if (this.index !== this.text.length) this.error("contains trailing data.");
      return node;
    }

    value() {
      const character = this.text[this.index];
      if (character === "{") return this.object();
      if (character === "[") return this.array();
      if (character === '"') {
        const value = this.string();
        return { value, typed: ["str", value] };
      }
      if (character === "t" && this.consume("true")) return { value: true, typed: ["bool", true] };
      if (character === "f" && this.consume("false")) return { value: false, typed: ["bool", false] };
      if (character === "n" && this.consume("null")) return { value: null, typed: ["null"] };
      if (character === "-" || (character >= "0" && character <= "9")) return this.number();
      this.error("contains whitespace or an invalid token.");
    }

    consume(token) {
      if (this.text.slice(this.index, this.index + token.length) !== token) return false;
      this.index += token.length;
      return true;
    }

    string() {
      const start = this.index;
      this.index += 1;
      let escaped = false;
      while (this.index < this.text.length) {
        const code = this.text.charCodeAt(this.index);
        const character = this.text[this.index];
        if (!escaped && character === '"') {
          this.index += 1;
          const token = this.text.slice(start, this.index);
          let value;
          try {
            value = JSON.parse(token);
          } catch (_error) {
            this.error("contains an invalid JSON string.");
          }
          if (JSON.stringify(value) !== token) {
            this.error("contains a noncanonical JSON string escape.");
          }
          for (let offset = 0; offset < value.length; offset += 1) {
            const unit = value.charCodeAt(offset);
            if (unit >= 0xd800 && unit <= 0xdbff) {
              const next = value.charCodeAt(offset + 1);
              if (!(next >= 0xdc00 && next <= 0xdfff)) this.error("contains an unpaired surrogate.");
              offset += 1;
            } else if (unit >= 0xdc00 && unit <= 0xdfff) {
              this.error("contains an unpaired surrogate.");
            }
          }
          return value;
        }
        if (!escaped && code < 0x20) this.error("contains an unescaped control character.");
        if (!escaped && character === "\\") escaped = true;
        else escaped = false;
        this.index += 1;
      }
      this.error("contains an unterminated string.");
    }

    number() {
      const remainder = this.text.slice(this.index);
      const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remainder);
      if (!match) this.error("contains an invalid number.");
      const token = match[0];
      this.index += token.length;
      const value = Number(token);
      if (!Number.isFinite(value)) this.error("contains a nonfinite number.");
      const float = token.includes(".") || token.includes("e") || token.includes("E");
      if (!float) {
        if (token === "-0") this.error("contains a noncanonical integer.");
        let exact;
        try {
          exact = BigInt(token);
        } catch (_error) {
          this.error("contains an invalid integer.");
        }
        if (exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < BigInt(Number.MIN_SAFE_INTEGER)) {
          this.error("contains an integer unsafe for browser conversion.");
        }
        return { value, typed: ["int", token] };
      }
      return { value, typed: ["float64", float64Hex(value)] };
    }

    array() {
      this.index += 1;
      const values = [];
      const typed = [];
      if (this.text[this.index] === "]") {
        this.index += 1;
        return { value: values, typed: ["array", typed] };
      }
      while (true) {
        const node = this.value();
        values.push(node.value);
        typed.push(node.typed);
        if (this.text[this.index] === "]") {
          this.index += 1;
          return { value: values, typed: ["array", typed] };
        }
        if (this.text[this.index] !== ",") this.error("contains an invalid array separator.");
        this.index += 1;
      }
    }

    object() {
      this.index += 1;
      const entries = [];
      let previous = null;
      if (this.text[this.index] === "}") {
        this.index += 1;
        return { value: {}, typed: ["object", entries] };
      }
      while (true) {
        if (this.text[this.index] !== '"') this.error("contains a non-string object key.");
        const key = this.string();
        if (previous !== null && compareCodePoints(previous, key) >= 0) {
          this.error("contains duplicate or non-canonically ordered object keys.");
        }
        previous = key;
        if (this.text[this.index] !== ":") this.error("contains an invalid object separator.");
        this.index += 1;
        const node = this.value();
        entries.push([key, node]);
        if (this.text[this.index] === "}") {
          this.index += 1;
          const value = Object.fromEntries(entries.map(([entryKey, entry]) => [entryKey, entry.value]));
          return {
            value,
            typed: ["object", entries.map(([entryKey, entry]) => [entryKey, entry.typed])],
          };
        }
        if (this.text[this.index] !== ",") this.error("contains an invalid object delimiter.");
        this.index += 1;
      }
    }
  }

  function parseStrictCanonicalJson(raw, label = "JSON") {
    const bytes = bytesOf(raw);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_error) {
      fail("malformed_json", `${label} is not strict UTF-8.`);
    }
    if (!text.endsWith("\n") || text.length < 2) {
      fail("malformed_json", `${label} must end with one canonical newline.`);
    }
    const body = text.slice(0, -1);
    if (body.endsWith("\n") || body.startsWith("\ufeff")) {
      fail("malformed_json", `${label} has noncanonical framing.`);
    }
    return new StrictJsonParser(body, label).parse();
  }

  function validateScope(panel, scope, typedScope = typedValue(scope)) {
    const fields = {
      rankings: ["garbage_time_mode", "breakdown_mode", "season", "phase"],
      top_games: ["garbage_time_mode", "season", "phase", "outcome"],
      high_value_records: ["garbage_time_mode"],
      season_leaders: ["garbage_time_mode", "phase"],
      rolling_graphs: ["garbage_time_mode", "phase", "window_years"],
      postseason_lift: ["garbage_time_mode", "window_years"],
      player_details: ["garbage_time_mode", "player_id"],
    }[panel];
    if (!fields) fail("malformed_projection", `Projection panel ${panel} is unsupported.`);
    exactKeys(scope, fields, `${panel} scope`);
    requireEnum(scope.garbage_time_mode, TIME_MODES, `${panel} time mode`);
    if (panel === "rankings") {
      requireEnum(scope.breakdown_mode, ["vc", "wc"], "ranking breakdown");
      requireEnum(scope.phase, PHASES, "ranking phase");
      requireSeason(scope.season, "ranking season");
    } else if (panel === "top_games") {
      requireSeason(scope.season, "top-game season");
      requireEnum(scope.phase, ["All", "Regular Season", "Playoffs", "Postseason"], "top-game phase");
      requireEnum(scope.outcome, ["Both", "Wins", "Losses"], "top-game outcome");
    } else if (panel === "season_leaders") {
      requireEnum(scope.phase, ["All", "Regular Season", "Postseason"], "season-leader phase");
    } else if (panel === "rolling_graphs") {
      requireEnum(scope.phase, ["All", "Regular Season", "Postseason"], "rolling phase");
      requireEnum(scope.window_years, ROLLING_WINDOWS, "rolling window");
    } else if (panel === "postseason_lift") {
      requireEnum(scope.window_years, ROLLING_WINDOWS, "postseason-lift window");
    } else if (panel === "player_details") {
      if (typeof scope.player_id !== "string" || !/^[1-9][0-9]*$/.test(scope.player_id)) {
        fail("malformed_projection", "Player-detail player_id must be a positive decimal string.");
      }
    }
    return { value: { ...scope }, typed: typedScope };
  }

  function scopeKey(panel, slug, scope) {
    return `${panel}\n${slug}\n${canonicalJson(scope)}`;
  }

  function descriptorIdentity(descriptor) {
    return [descriptor.panel, descriptor.slug, canonicalJson(descriptor.scope)];
  }

  function compareIdentity(left, right) {
    for (let index = 0; index < 3; index += 1) {
      const compared = compareCodePoints(left[index], right[index]);
      if (compared) return compared;
    }
    return 0;
  }

  function descriptorTypedScope(objectsTyped, index) {
    const rows = objectsTyped?.[0] === "array" ? objectsTyped[1] : [];
    return typedMember(rows[index], "scope");
  }

  async function validateProjectionManifest(value, options = {}) {
    const cryptoOverride = options.crypto;
    const manifestTyped = options.typed || typedValue(value);
    exactKeys(
      value,
      [
        "schema_version",
        "release_id",
        "engine_version",
        "official_release_receipt",
        "official_slugs",
        "source_runs",
        "panel_receipts",
        "objects",
        "content_sha256",
      ],
      "projection manifest",
    );
    if (value.schema_version !== MANIFEST_SCHEMA) fail("manifest_schema_mismatch", "Projection manifest schema is unsupported.");
    if (value.engine_version !== ENGINE_VERSION) fail("manifest_engine_mismatch", "Projection manifest engine is unsupported.");
    requireUuid(value.release_id, "projection release_id");
    requireSha(value.official_release_receipt, "official release receipt");
    requireSha(value.content_sha256, "projection manifest content receipt");
    if (
      !Array.isArray(value.official_slugs) ||
      value.official_slugs.length !== OFFICIAL_SLUGS.length ||
      value.official_slugs.some((slug, index) => slug !== OFFICIAL_SLUGS[index])
    ) {
      fail("official_slug_mismatch", "Projection manifest does not contain only the public Original baseline.");
    }

    exactKeys(value.source_runs, OFFICIAL_SLUGS, "projection source_runs");
    for (const slug of OFFICIAL_SLUGS) {
      const source = value.source_runs[slug];
      exactKeys(source, ["run_id", "configuration_receipt", "calculation_receipt"], `${slug} source run`);
      requireUuid(source.run_id, `${slug} source run_id`);
      requireSha(source.configuration_receipt, `${slug} configuration receipt`);
      requireSha(source.calculation_receipt, `${slug} calculation receipt`);
    }
    exactKeys(value.panel_receipts, RECEIPT_KEYS, "projection panel_receipts");
    for (const key of RECEIPT_KEYS) requireSha(value.panel_receipts[key], `${key} panel receipt`);
    if (!Array.isArray(value.objects) || value.objects.length === 0) {
      fail("projection_catalog_empty", "Projection manifest object catalog is empty.");
    }

    const objectArrayTyped = typedMember(manifestTyped, "objects");
    const descriptors = [];
    const identities = new Set();
    const coverage = new Map();
    let expectedOrigin = null;
    let previousIdentity = null;
    for (let index = 0; index < value.objects.length; index += 1) {
      const row = value.objects[index];
      exactKeys(
        row,
        [
          "panel",
          "slug",
          "scope",
          "schema_version",
          "format",
          "compression",
          "url",
          "byte_count",
          "uncompressed_byte_count",
          "row_count",
          "sha256",
          "json_sha256",
          "source_receipt",
        ],
        `projection object ${index}`,
      );
      requireEnum(row.panel, ROUTED_PANELS, "projection panel");
      requireEnum(row.slug, OFFICIAL_SLUGS, "projection slug");
      const scope = validateScope(row.panel, row.scope, descriptorTypedScope(objectArrayTyped, index));
      if (
        row.schema_version !== SNAPSHOT_SCHEMA ||
        row.format !== "json" ||
        row.compression !== "gzip"
      ) {
        fail("projection_encoding_mismatch", "Projection object encoding contract drifted.");
      }
      requireInteger(row.byte_count, "projection byte_count", 1, MAX_COMPRESSED_BYTES);
      requireInteger(row.uncompressed_byte_count, "projection uncompressed_byte_count", 1, MAX_UNCOMPRESSED_BYTES);
      requireInteger(row.row_count, "projection row_count", 0, Number.MAX_SAFE_INTEGER);
      requireSha(row.sha256, "projection compressed SHA-256");
      requireSha(row.json_sha256, "projection JSON SHA-256");
      requireSha(row.source_receipt, "projection source receipt");
      let url;
      try {
        url = new URL(row.url);
      } catch (_error) {
        fail("projection_url_invalid", "Projection object URL is invalid.");
      }
      const expectedTail = `/sha256/${row.sha256}/`;
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.includes(expectedTail) ||
        !url.pathname.endsWith(".json.gz")
      ) {
        fail("projection_url_invalid", "Projection object URL is not an exact content-addressed HTTPS gzip URL.");
      }
      if (expectedOrigin === null) expectedOrigin = url.origin;
      if (url.origin !== expectedOrigin) fail("projection_origin_mismatch", "Projection objects must share one immutable R2 origin.");
      const identity = descriptorIdentity(row);
      if (previousIdentity && compareIdentity(previousIdentity, identity) >= 0) {
        fail("projection_catalog_order", "Projection object catalog is duplicated or not canonically ordered.");
      }
      previousIdentity = identity;
      const key = scopeKey(row.panel, row.slug, row.scope);
      if (identities.has(key)) fail("projection_catalog_duplicate", "Projection object identity is duplicated.");
      identities.add(key);
      coverage.set(`${row.panel}\n${row.slug}`, (coverage.get(`${row.panel}\n${row.slug}`) || 0) + 1);
      descriptors.push({ ...row, scope: scope.value, _scopeTyped: scope.typed });
    }
    for (const panel of ROUTED_PANELS) {
      for (const slug of OFFICIAL_SLUGS) {
        if (!coverage.get(`${panel}\n${slug}`)) {
          fail("projection_catalog_incomplete", `Projection catalog lacks ${panel} for ${slug}.`);
        }
      }
    }

    for (const panel of ROUTED_PANELS) {
      const selected = descriptors.filter((row) => row.panel === panel);
      const receiptTyped = [
        "array",
        selected.map((row) =>
          typedObject([
            ["slug", ["str", row.slug]],
            ["scope", row._scopeTyped],
            ["source_receipt", ["str", row.source_receipt]],
          ]),
        ),
      ];
      const expected = await contentSha256FromTyped(
        receiptTyped,
        `${SNAPSHOT_SCHEMA}:${panel}:catalog`,
        cryptoOverride,
      );
      if (expected !== value.panel_receipts[panel]) {
        fail("panel_receipt_mismatch", `${panel} panel receipt differs from its object catalog.`);
      }
    }
    const expectedContent = await contentSha256FromTyped(
      typedWithoutMember(manifestTyped, "content_sha256"),
      MANIFEST_SCHEMA,
      cryptoOverride,
    );
    if (expectedContent !== value.content_sha256) {
      fail("manifest_content_receipt_mismatch", "Projection manifest domain receipt differs.");
    }

    const index = new Map(descriptors.map((row) => [scopeKey(row.panel, row.slug, row.scope), row]));
    return Object.freeze({
      ...value,
      official_slugs: Object.freeze([...value.official_slugs]),
      source_runs: Object.freeze(Object.fromEntries(OFFICIAL_SLUGS.map((slug) => [slug, Object.freeze({ ...value.source_runs[slug] })]))),
      panel_receipts: Object.freeze({ ...value.panel_receipts }),
      objects: Object.freeze(descriptors.map((row) => Object.freeze(row))),
      _index: index,
      _origin: expectedOrigin,
    });
  }

  function logicalRowCount(panel, payload) {
    if (["rankings", "top_games", "season_leaders"].includes(panel)) {
      if (!Array.isArray(payload.rows)) fail("malformed_snapshot", `${panel} snapshot lacks rows.`);
      return payload.rows.length;
    }
    if (panel === "high_value_records") {
      exactKeys(payload.phases, ["All", "Regular Season", "Playoffs", "Postseason"], "high-value phases");
      return ["All", "Regular Season", "Playoffs", "Postseason"].reduce((total, phase) => {
        const row = payload.phases[phase];
        exactKeys(row, ["total_players", "rows"], `high-value ${phase}`);
        if (!Array.isArray(row.rows) || row.total_players !== row.rows.length) {
          fail("malformed_snapshot", `High-value ${phase} row count differs.`);
        }
        return total + row.rows.length;
      }, 0);
    }
    if (["rolling_graphs", "postseason_lift"].includes(panel)) {
      if (!Array.isArray(payload.players)) fail("malformed_snapshot", `${panel} snapshot lacks players.`);
      return payload.players.length;
    }
    if (panel === "player_details") {
      if (!Array.isArray(payload.games)) fail("malformed_snapshot", "Player-detail snapshot lacks games.");
      return payload.games.length;
    }
    fail("malformed_snapshot", "Snapshot panel is unsupported.");
  }

  function validateCommonSnapshot(payload, descriptor, manifest) {
    if (!isObject(payload)) fail("malformed_snapshot", "Projection snapshot root must be an object.");
    const source = manifest.source_runs[descriptor.slug];
    if (
      payload.release_id !== manifest.release_id ||
      payload.run_id !== source.run_id ||
      payload.configuration_receipt !== source.configuration_receipt ||
      payload.calculation_receipt !== source.calculation_receipt ||
      payload.stat_version !== descriptor.slug
    ) {
      fail("snapshot_identity_mismatch", "Projection snapshot release/run/configuration identity differs.");
    }
    if (payload.schema_version !== undefined && payload.schema_version !== SNAPSHOT_SCHEMA) {
      fail("snapshot_schema_mismatch", "Projection snapshot schema is unsupported.");
    }
    if (payload.source_receipt !== undefined) requireSha(payload.source_receipt, "snapshot source receipt");
  }

  function validateMirroredScope(payload, descriptor) {
    const scope = descriptor.scope;
    const mirrors = {
      rankings: ["garbage_time_mode", "breakdown_mode", "season", "phase"],
      top_games: ["garbage_time_mode", "season", "phase", "outcome"],
      high_value_records: ["garbage_time_mode"],
      season_leaders: ["garbage_time_mode", "phase"],
      rolling_graphs: ["garbage_time_mode", "phase", "window_years"],
      postseason_lift: ["garbage_time_mode", "window_years"],
      player_details: ["garbage_time_mode", "player_id"],
    }[descriptor.panel];
    for (const field of mirrors) {
      if (payload[field] !== undefined && String(payload[field]) !== String(scope[field])) {
        fail("snapshot_scope_mismatch", `Projection snapshot ${field} differs from its descriptor.`);
      }
    }
  }

  function gameOrderKey(row) {
    return [String(row.game_date), String(row.game_id), String(row.team_id ?? "")];
  }

  function compareGameOrder(left, right) {
    if (left[0] !== right[0]) return left[0] > right[0] ? -1 : 1;
    if (left[1] !== right[1]) return left[1] > right[1] ? -1 : 1;
    return compareCodePoints(left[2], right[2]);
  }

  function validatePlayerMaster(payload, descriptor) {
    exactKeys(
      payload,
      [
        "schema_version",
        "release_id",
        "run_id",
        "configuration_receipt",
        "calculation_receipt",
        "stat_version",
        "player_id",
        "player_name",
        "garbage_time_mode",
        "games",
        "source_receipt",
      ],
      "player-detail master",
    );
    if (payload.schema_version !== SNAPSHOT_SCHEMA) fail("snapshot_schema_mismatch", "Player-detail schema is unsupported.");
    if (
      typeof payload.player_id !== "string" ||
      !/^[1-9][0-9]*$/.test(payload.player_id) ||
      payload.player_id !== descriptor.scope.player_id
    ) {
      fail("player_identity_mismatch", "Player-detail identity differs from its descriptor.");
    }
    requireString(payload.player_name, "player-detail player_name");
    requireSha(payload.source_receipt, "player-detail source receipt");
    let previous = null;
    for (const game of payload.games) {
      if (!isObject(game)) fail("malformed_snapshot", "Player-detail game must be an object.");
      if (game.player_id !== descriptor.scope.player_id) fail("player_identity_mismatch", "Player-detail game identity differs.");
      if (game.player_name !== undefined && game.player_name !== payload.player_name) {
        fail("player_identity_mismatch", "Player-detail game player_name differs.");
      }
      const rowModes = [game.garbage_time_mode, game.time_mode].filter(
        (value) => value !== undefined,
      );
      if (
        rowModes.length === 0 ||
        rowModes.some((value) => value !== descriptor.scope.garbage_time_mode)
      ) {
        fail("player_mode_mismatch", "Player-detail game time mode differs.");
      }
      const identities = {
        release_id: payload.release_id,
        run_id: payload.run_id,
        configuration_receipt: payload.configuration_receipt,
        calculation_receipt: payload.calculation_receipt,
        stat_version: payload.stat_version,
      };
      for (const [field, expected] of Object.entries(identities)) {
        if (game[field] !== undefined && game[field] !== expected) {
          fail("player_identity_mismatch", `Player-detail game ${field} differs.`);
        }
      }
      if (typeof game.game_id !== "string" || !game.game_id) fail("malformed_snapshot", "Player-detail game_id is invalid.");
      if (typeof game.game_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(game.game_date)) fail("malformed_snapshot", "Player-detail game_date is invalid.");
      requireSeason(game.season, "player-detail season", { allowAll: false });
      requireEnum(game.season_type, ["Regular Season", "PlayIn", "Playoffs"], "player-detail season_type");
      if (typeof game.win_loss !== "boolean") fail("malformed_snapshot", "Player-detail win_loss must be boolean.");
      const order = gameOrderKey(game);
      if (previous && compareGameOrder(previous, order) > 0) fail("player_game_order", "Player-detail games are not chronologically descending.");
      previous = order;
    }
  }

  async function defaultGunzip(value) {
    if (typeof DecompressionStream !== "function") {
      fail("gzip_unavailable", "This browser cannot decode verified gzip snapshots.");
    }
    const stream = new Blob([bytesOf(value)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function abortIfNeeded(signal) {
    if (!signal?.aborted) return;
    if (typeof DOMException === "function") throw new DOMException("The operation was aborted.", "AbortError");
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    throw error;
  }

  function resolveReleaseConfiguration(environment = root) {
    const release = environment?.__VC_ORIGINAL_RELEASE__ || {};
    const document = environment?.document;
    const meta = (name) => document?.querySelector?.(`meta[name='${name}']`)?.content?.trim() || null;
    return {
      manifestUrl:
        release.projectionManifestUrl ||
        release.projection_manifest_url ||
        meta("original-projection-manifest-url") ||
        DEFAULT_MANIFEST_URL,
      manifestSha256:
        release.projectionManifestSha256 ||
        release.projection_manifest_sha256 ||
        meta("original-projection-manifest-sha256") ||
        null,
      methodologyUrl:
        release.methodologyUrl ||
        release.methodology_url ||
        meta("original-methodology-url") ||
        DEFAULT_METHODOLOGY_URL,
      methodologySha256:
        release.methodologySha256 ||
        release.methodology_sha256 ||
        meta("original-methodology-sha256") ||
        null,
    };
  }

  class ProjectionRepository {
    constructor(options = {}) {
      if (typeof options.fetch !== "function") fail("fetch_unavailable", "A native GET fetch implementation is required.");
      this.fetch = options.fetch;
      this.crypto = options.crypto;
      this.gunzip = options.gunzip || defaultGunzip;
      this.manifestUrl = options.manifestUrl || DEFAULT_MANIFEST_URL;
      this.manifestSha256 = options.manifestSha256 || null;
      this.methodologyUrl = options.methodologyUrl || DEFAULT_METHODOLOGY_URL;
      this.methodologySha256 = options.methodologySha256 || null;
      this.baseUrl = options.baseUrl || root?.location?.href || "https://static.invalid/";
      this.manifestPromise = null;
      this.methodologyPromise = null;
      this.snapshotPromises = new Map();
    }

    async manifest() {
      if (!this.manifestPromise) {
        this.manifestPromise = this.loadManifest().catch((error) => {
          this.manifestPromise = null;
          throw error;
        });
      }
      return this.manifestPromise;
    }

    async loadManifest() {
      requireSha(this.manifestSha256, "trusted projection manifest artifact SHA-256");
      let url;
      try {
        url = new URL(this.manifestUrl, this.baseUrl).href;
      } catch (_error) {
        fail("manifest_url_invalid", "Projection manifest URL is invalid.");
      }
      const response = await this.fetch(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (!response?.ok) fail("manifest_fetch_failed", `Projection manifest GET failed (${response?.status || "network"}).`);
      const raw = new Uint8Array(await response.arrayBuffer());
      if (raw.length < 2 || raw.length > MAX_MANIFEST_BYTES) fail("manifest_size_invalid", "Projection manifest byte size is invalid.");
      if ((await sha256Hex(raw, this.crypto)) !== this.manifestSha256) {
        fail("manifest_artifact_mismatch", "Projection manifest artifact SHA-256 differs from the trusted release pin.");
      }
      const parsed = parseStrictCanonicalJson(raw, "Projection manifest");
      if (!bytesEqual(canonicalJsonBytes(parsed.value), raw)) {
        fail("manifest_noncanonical", "Projection manifest bytes are not canonical JSON.");
      }
      return validateProjectionManifest(parsed.value, { typed: parsed.typed, crypto: this.crypto });
    }

    async methodology() {
      if (!this.methodologyPromise) {
        this.methodologyPromise = this.loadMethodology().catch((error) => {
          this.methodologyPromise = null;
          throw error;
        });
      }
      return clone(await this.methodologyPromise);
    }

    async loadMethodology() {
      requireSha(this.methodologySha256, "trusted methodology artifact SHA-256");
      let url;
      try {
        url = new URL(this.methodologyUrl, this.baseUrl).href;
      } catch (_error) {
        fail("methodology_url_invalid", "Methodology snapshot URL is invalid.");
      }
      const response = await this.fetch(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (!response?.ok) fail("methodology_fetch_failed", `Methodology snapshot GET failed (${response?.status || "network"}).`);
      const raw = new Uint8Array(await response.arrayBuffer());
      if (raw.length < 2 || raw.length > MAX_METHODOLOGY_BYTES) {
        fail("methodology_size_invalid", "Methodology snapshot byte size is invalid.");
      }
      if ((await sha256Hex(raw, this.crypto)) !== this.methodologySha256) {
        fail("methodology_artifact_mismatch", "Methodology snapshot SHA-256 differs from the trusted Pages pin.");
      }
      const parsed = parseStrictCanonicalJson(raw, "Methodology snapshot");
      if (!isObject(parsed.value)) {
        fail("methodology_noncanonical", "Methodology snapshot must be a canonical JSON object.");
      }
      return parsed.value;
    }

    async descriptor(panel, slug, scope) {
      const manifest = await this.manifest();
      requireEnum(slug, OFFICIAL_SLUGS, "stat_version");
      const normalized = validateScope(panel, scope).value;
      const descriptor = manifest._index.get(scopeKey(panel, slug, normalized));
      if (!descriptor) fail("projection_scope_missing", "No verified projection exists for the requested official scope.", 404);
      return { manifest, descriptor };
    }

    async snapshot(panel, slug, scope, signal) {
      abortIfNeeded(signal);
      const { manifest, descriptor } = await this.descriptor(panel, slug, scope);
      let pending = this.snapshotPromises.get(descriptor.sha256);
      if (!pending) {
        pending = this.loadSnapshot(manifest, descriptor).catch((error) => {
          this.snapshotPromises.delete(descriptor.sha256);
          throw error;
        });
        this.snapshotPromises.set(descriptor.sha256, pending);
      }
      const value = await pending;
      abortIfNeeded(signal);
      return clone(value);
    }

    async loadSnapshot(manifest, descriptor) {
      const response = await this.fetch(descriptor.url, {
        method: "GET",
        credentials: "omit",
        cache: "force-cache",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (!response?.ok) fail("projection_fetch_failed", `Projection object GET failed (${response?.status || "network"}).`);
      const compressed = new Uint8Array(await response.arrayBuffer());
      if (compressed.length !== descriptor.byte_count) fail("projection_byte_count_mismatch", "Projection compressed byte count differs.");
      if ((await sha256Hex(compressed, this.crypto)) !== descriptor.sha256) {
        fail("projection_sha_mismatch", "Projection compressed SHA-256 differs.");
      }
      let raw;
      try {
        raw = bytesOf(await this.gunzip(compressed));
      } catch (error) {
        if (error instanceof StaticApiError) throw error;
        fail("projection_gzip_invalid", "Projection gzip stream is invalid.");
      }
      if (raw.length !== descriptor.uncompressed_byte_count) fail("projection_json_size_mismatch", "Projection decompressed byte count differs.");
      if ((await sha256Hex(raw, this.crypto)) !== descriptor.json_sha256) {
        fail("projection_json_sha_mismatch", "Projection decompressed JSON SHA-256 differs.");
      }
      const parsed = parseStrictCanonicalJson(raw, "Projection snapshot");
      validateCommonSnapshot(parsed.value, descriptor, manifest);
      validateMirroredScope(parsed.value, descriptor);
      if (descriptor.panel === "player_details") validatePlayerMaster(parsed.value, descriptor);
      if (logicalRowCount(descriptor.panel, parsed.value) !== descriptor.row_count) {
        fail("projection_row_count_mismatch", "Projection decoded row count differs.");
      }
      const sourceTyped = typedObject([
        ["panel", ["str", descriptor.panel]],
        ["slug", ["str", descriptor.slug]],
        ["scope", descriptor._scopeTyped],
        ["payload", parsed.typed],
      ]);
      const receipt = await contentSha256FromTyped(sourceTyped, SNAPSHOT_SCHEMA, this.crypto);
      if (receipt !== descriptor.source_receipt) {
        fail("projection_source_receipt_mismatch", "Projection semantic source receipt differs.");
      }
      return parsed.value;
    }
  }

  function queryValue(params, key, fallback) {
    const value = params.get(key);
    return value === null || value === "" ? fallback : value;
  }

  function queryInteger(params, key, fallback, minimum, maximum) {
    const raw = queryValue(params, key, String(fallback));
    if (!/^[0-9]+$/.test(raw)) fail("invalid_static_api_query", `${key} must be an integer.`, 422);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      fail("invalid_static_api_query", `${key} is outside its supported range.`, 422);
    }
    return value;
  }

  function scalarCompare(left, right) {
    if (left === right) return 0;
    if (left === null || left === undefined || Number.isNaN(left)) return 1;
    if (right === null || right === undefined || Number.isNaN(right)) return -1;
    if (typeof left === "string" || typeof right === "string") {
      return String(left).localeCompare(String(right), undefined, { sensitivity: "base", numeric: true });
    }
    return left < right ? -1 : 1;
  }

  function sortRows(rows, key, direction) {
    const factor = direction === "asc" ? 1 : -1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const primary = scalarCompare(left.row[key], right.row[key]);
        if (primary) return primary * factor;
        const leftId = String(left.row.player_id ?? "");
        const rightId = String(right.row.player_id ?? "");
        let identity;
        if (/^[0-9]+$/.test(leftId) && /^[0-9]+$/.test(rightId)) {
          const a = BigInt(leftId);
          const b = BigInt(rightId);
          identity = a === b ? 0 : a < b ? -1 : 1;
        } else {
          identity = scalarCompare(leftId, rightId);
        }
        return identity || left.index - right.index;
      })
      .map(({ row }) => row);
  }

  function numeric(row, key) {
    const value = row[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail("malformed_snapshot", `Player-detail ${key} must be finite.`);
    }
    return value;
  }

  function playerContextPayload(master, request) {
    let games = master.games.filter((game) => {
      if (request.season !== "All Seasons" && game.season !== request.season) return false;
      if (request.phase === "Postseason" && !["PlayIn", "Playoffs"].includes(game.season_type)) return false;
      if (request.phase !== "All" && request.phase !== "Postseason" && game.season_type !== request.phase) return false;
      if (request.breakdown_mode === "wc" && game.win_loss !== true) return false;
      return true;
    });
    const keys = [
      "final_value_contributed",
      "raw_no_context_contribution",
      "offense_context",
      "defense_context",
      "general_offense_context",
      "general_defense_context",
      "teammate_offense_context",
      "teammate_defense_context",
      "opponent_offense_context",
      "opponent_defense_context",
    ];
    const sums = Object.fromEntries(keys.map((key) => [key, 0]));
    for (const game of games) for (const key of keys) sums[key] += numeric(game, key);
    const finalValue = sums.final_value_contributed;
    const pct = (value) => (finalValue === 0 ? null : (100 * value) / finalValue);
    const summary = {
      game_count: games.length,
      final_value: finalValue,
      raw_no_context_value: sums.raw_no_context_contribution,
      teammate_context_value: sums.offense_context,
      opponent_context_value: sums.defense_context,
      offense_context_value: sums.offense_context,
      defense_context_value: sums.defense_context,
      general_offense_context_value: sums.general_offense_context,
      general_defense_context_value: sums.general_defense_context,
      teammate_offense_context_value: sums.teammate_offense_context,
      teammate_defense_context_value: sums.teammate_defense_context,
      opponent_offense_context_value: sums.opponent_offense_context,
      opponent_defense_context_value: sums.opponent_defense_context,
      raw_no_context_pct: pct(sums.raw_no_context_contribution),
      teammate_context_pct: pct(sums.offense_context),
      opponent_context_pct: pct(sums.defense_context),
    };
    const totalGames = games.length;
    const start = (request.page - 1) * request.per_page;
    games = games.slice(start, start + request.per_page);
    return {
      release_id: master.release_id,
      run_id: master.run_id,
      configuration_receipt: master.configuration_receipt,
      calculation_receipt: master.calculation_receipt,
      stat_version: master.stat_version,
      player_id: String(master.player_id),
      season: request.season,
      phase: request.phase,
      garbage_time_mode: request.garbage_time_mode,
      breakdown_mode: request.breakdown_mode,
      summary,
      pagination: {
        page: request.page,
        per_page: request.per_page,
        total_games: totalGames,
        total_pages: totalGames ? Math.ceil(totalGames / request.per_page) : 0,
      },
      games,
    };
  }

  function optionsPayload(manifest) {
    const rankingObjects = manifest.objects.filter((row) => row.panel === "rankings");
    const seasons = [...new Set(rankingObjects.map((row) => row.scope.season))];
    const exact = seasons
      .filter((season) => season !== "All Seasons")
      .sort((left, right) => Number(right.slice(0, 4)) - Number(left.slice(0, 4)));
    const original = manifest.source_runs.original;
    const coverage = [];
    const seen = new Set();
    for (const row of rankingObjects.filter((item) => item.slug === "original")) {
      const { season, phase } = row.scope;
      if (season === "All Seasons" || ["All", "Postseason"].includes(phase)) continue;
      const key = `${season}\n${phase}`;
      if (seen.has(key)) continue;
      seen.add(key);
      coverage.push({ season_end_year: Number(season.slice(0, 4)) + 1, season, season_type: phase });
    }
    coverage.sort((left, right) => right.season_end_year - left.season_end_year || compareCodePoints(left.season_type, right.season_type));
    return {
      run: {
        run_id: original.run_id,
        source_run_id: manifest.release_id,
        status: "complete",
        selected_game_count: 16795,
        default_policy: "original",
        finished_at: null,
        local_only: false,
        content_sha256: original.calculation_receipt,
        configuration_receipt: original.configuration_receipt,
      },
      release_id: manifest.release_id,
      release_receipt: manifest.official_release_receipt,
      engine_version: manifest.engine_version,
      seasons: ["All Seasons", ...exact],
      default_season: exact[0] || "All Seasons",
      default_garbage_time_mode: "competitive",
      default_stat_version: "original",
      stat_versions: OFFICIAL_SLUGS.map((slug) => ({
        value: slug,
        label: OFFICIAL_NAMES[slug],
        run_id: manifest.source_runs[slug].run_id,
        configuration_receipt: manifest.source_runs[slug].configuration_receipt,
      })),
      garbage_time_modes: [
        { value: "competitive", label: "Exclude garbage time" },
        { value: "all_minutes", label: "Include garbage time" },
      ],
      phases: [...PHASES],
      coverage,
      certification_status: "official_release_complete",
    };
  }

  function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  function errorResponse(error) {
    const normalized = error instanceof StaticApiError
      ? error
      : new StaticApiError("static_api_failure", "Verified static rankings are unavailable.", 503);
    return jsonResponse({ detail: normalized.message, code: normalized.code }, normalized.status);
  }

  function requestParts(input, init, baseUrl) {
    const source = input instanceof Request ? input : null;
    const method = String(init?.method || source?.method || "GET").toUpperCase();
    const body = init && Object.prototype.hasOwnProperty.call(init, "body") ? init.body : source?.body;
    const signal = init?.signal || source?.signal;
    let url;
    try {
      url = new URL(source?.url || String(input), baseUrl);
    } catch (_error) {
      fail("invalid_request_url", "Static API request URL is invalid.", 400);
    }
    return { method, body, signal, url };
  }

  async function routeApi(repository, url, signal) {
    const params = url.searchParams;
    const slug = queryValue(params, "stat_version", "original");
    if (params.has("experiment_id") || slug.startsWith("experiment:")) {
      fail("local_experiment_network_blocked", "Browser-local experiments never use the network API.", 409);
    }
    if (url.pathname === "/api/methodology") return repository.methodology();
    requireEnum(slug, OFFICIAL_SLUGS, "stat_version");
    if (url.pathname === "/api/rankings/options") return optionsPayload(await repository.manifest());
    const mode = requireEnum(queryValue(params, "garbage_time_mode", "competitive"), TIME_MODES, "garbage_time_mode");
    if (url.pathname === "/api/rankings") {
      const season = queryValue(params, "season", null);
      if (!season) fail("invalid_static_api_query", "season is required.", 422);
      requireSeason(season, "season");
      const phase = requireEnum(queryValue(params, "phase", "All"), PHASES, "phase");
      const breakdown = requireEnum(queryValue(params, "breakdown_mode", "vc"), ["vc", "wc"], "breakdown_mode");
      const metric = requireEnum(queryValue(params, "metric", "value_contributed"), ["value_contributed", "wins_contributed"], "metric");
      const sorts = [
        "selected_metric", "value_contributed", "wins_contributed", "losses_contributed",
        "value_per_win", "value_per_game", "value_per_game_rank", "value_per_loss",
        "win_loss_difference", "postseason_value_per_game_difference", "postseason_rank_change",
        "games_played", "wins", "losses", "offense_value", "defense_value", "other_value",
        "side_context_raw_value", "offense_context_value", "defense_context_value",
        "general_offense_context_value", "general_defense_context_value",
        "teammate_offense_context_value", "opponent_offense_context_value",
        "teammate_defense_context_value", "opponent_defense_context_value",
      ];
      const requestedSort = requireEnum(queryValue(params, "sort_by", "wins_contributed"), sorts, "sort_by");
      const direction = requireEnum(queryValue(params, "sort_direction", "desc"), ["asc", "desc"], "sort_direction");
      // The visible dashboard still tops out at 250 rows. Its custom-range
      // aggregator requests each complete season snapshot before applying the
      // user-facing limit, and an NBA season remains comfortably below 1,000.
      const limit = queryInteger(params, "limit", 25, 1, 1000);
      const search = queryValue(params, "search", "").trim().toLocaleLowerCase();
      if (search.length > 80) fail("invalid_static_api_query", "search is too long.", 422);
      const payload = await repository.snapshot("rankings", slug, {
        garbage_time_mode: mode, breakdown_mode: breakdown, season, phase,
      }, signal);
      const sort = requestedSort === "selected_metric" ? metric : requestedSort;
      let rows = sortRows(payload.rows, sort, direction).map((row, index) => ({ ...row, rank: index + 1 }));
      if (search) rows = rows.filter((row) => String(row.player_name || "").toLocaleLowerCase().includes(search));
      rows = rows.slice(0, limit);
      return {
        ...payload, season, phase, metric, garbage_time_mode: mode, stat_version: slug,
        breakdown_mode: breakdown, sort_by: requestedSort, sort_direction: direction, rows,
      };
    }
    if (url.pathname === "/api/rankings/top-games") {
      const season = queryValue(params, "season", "All Seasons");
      requireSeason(season, "season");
      const phase = requireEnum(queryValue(params, "phase", "All"), ["All", "Regular Season", "Playoffs", "Postseason"], "phase");
      const outcome = requireEnum(queryValue(params, "outcome", "Both"), ["Both", "Wins", "Losses"], "outcome");
      const limit = queryInteger(params, "limit", 25, 1, 250);
      const payload = await repository.snapshot("top_games", slug, { garbage_time_mode: mode, season, phase, outcome }, signal);
      return { ...payload, season, phase, outcome, garbage_time_mode: mode, stat_version: slug, rows: payload.rows.slice(0, limit) };
    }
    if (url.pathname === "/api/rankings/high-value-records") {
      const phase = requireEnum(queryValue(params, "phase", "All"), ["All", "Regular Season", "Playoffs", "Postseason"], "phase");
      const sort = requireEnum(queryValue(params, "sort_by", "games_played"), ["games_played", "wins", "value_contributed", "wins_contributed", "winning_percentage"], "sort_by");
      const direction = requireEnum(queryValue(params, "sort_direction", "desc"), ["asc", "desc"], "sort_direction");
      const payload = await repository.snapshot("high_value_records", slug, { garbage_time_mode: mode }, signal);
      const { phases, ...common } = payload;
      const selected = phases[phase];
      const rows = sortRows(selected.rows, sort, direction).map((row, index) => ({
        ...row,
        rank: index + 1,
      }));
      return { ...common, phase, garbage_time_mode: mode, stat_version: slug, sort_by: sort, sort_direction: direction, total_players: rows.length, rows };
    }
    if (url.pathname === "/api/rankings/season-wins-leaders") {
      const phase = requireEnum(queryValue(params, "phase", "All"), ["All", "Regular Season", "Postseason"], "phase");
      const limit = queryInteger(params, "limit", 15, 10, 15);
      const payload = await repository.snapshot("season_leaders", slug, { garbage_time_mode: mode, phase }, signal);
      return { ...payload, phase, garbage_time_mode: mode, stat_version: slug, limit, rows: payload.rows.slice(0, limit) };
    }
    if (url.pathname === "/api/rankings/rolling-trends") {
      const phase = requireEnum(queryValue(params, "phase", "All"), ["All", "Regular Season", "Postseason"], "phase");
      const windowYears = queryInteger(params, "window_years", 3, 1, 5);
      requireEnum(windowYears, ROLLING_WINDOWS, "window_years");
      return repository.snapshot("rolling_graphs", slug, { garbage_time_mode: mode, phase, window_years: windowYears }, signal);
    }
    if (url.pathname === "/api/rankings/postseason-lift-trends") {
      const windowYears = queryInteger(params, "window_years", 3, 1, 5);
      requireEnum(windowYears, ROLLING_WINDOWS, "window_years");
      return repository.snapshot("postseason_lift", slug, { garbage_time_mode: mode, window_years: windowYears }, signal);
    }
    if (url.pathname === "/api/rankings/player-context") {
      const playerId = queryValue(params, "player_id", "");
      if (!/^[1-9][0-9]*$/.test(playerId)) fail("invalid_static_api_query", "player_id must be positive.", 422);
      const season = queryValue(params, "season", null);
      if (!season) fail("invalid_static_api_query", "season is required.", 422);
      requireSeason(season, "season");
      const phase = requireEnum(queryValue(params, "phase", "All"), PHASES, "phase");
      const breakdown = requireEnum(queryValue(params, "breakdown_mode", "vc"), ["vc", "wc"], "breakdown_mode");
      const page = queryInteger(params, "page", 1, 1, Number.MAX_SAFE_INTEGER);
      const perPage = queryInteger(params, "per_page", 20, 1, 50);
      const payload = await repository.snapshot("player_details", slug, { garbage_time_mode: mode, player_id: playerId }, signal);
      if (String(payload.player_id) !== playerId) fail("player_identity_mismatch", "Requested player differs from the verified player master.");
      return playerContextPayload(payload, { season, phase, garbage_time_mode: mode, breakdown_mode: breakdown, page, per_page: perPage });
    }
    fail("static_api_route_missing", "This API route is not present in the verified static release.", 404);
  }

  function createStaticFetch(options = {}) {
    const nativeFetch = options.fetch;
    if (typeof nativeFetch !== "function") fail("fetch_unavailable", "A native fetch implementation is required.");
    const baseUrl = options.baseUrl || root?.location?.href || "https://static.invalid/";
    const repository = options.repository || new ProjectionRepository({ ...options, fetch: nativeFetch, baseUrl });
    const wrapped = async function staticFetch(input, init) {
      let request;
      try {
        request = requestParts(input, init, baseUrl);
      } catch (error) {
        return errorResponse(error);
      }
      if (request.method !== "GET" || request.body !== null && request.body !== undefined) {
        return errorResponse(new StaticApiError("network_write_blocked", "The public static application permits network GET reads only.", 405));
      }
      if (
        request.url.searchParams.has("experiment_id") ||
        String(request.url.searchParams.get("stat_version") || "").startsWith("experiment:")
      ) {
        return errorResponse(new StaticApiError("local_experiment_network_blocked", "Browser-local experiments never use network fetch.", 409));
      }
      if (request.url.pathname.startsWith("/api/")) {
        try {
          abortIfNeeded(request.signal);
          return jsonResponse(await routeApi(repository, request.url, request.signal));
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          return errorResponse(error);
        }
      }
      return nativeFetch(input, init);
    };
    wrapped.repository = repository;
    return wrapped;
  }

  function installStaticApi(options = {}) {
    const environment = options.root || root;
    if (!environment || typeof environment.fetch !== "function") {
      fail("fetch_unavailable", "Static API installation requires window.fetch.");
    }
    if (environment.__VC_STATIC_API_INSTALLATION__) return environment.__VC_STATIC_API_INSTALLATION__;
    const nativeFetch = environment.fetch.bind(environment);
    const release = resolveReleaseConfiguration(environment);
    const fetch = createStaticFetch({
      ...options,
      fetch: nativeFetch,
      baseUrl: environment.location?.href,
      manifestUrl: options.manifestUrl || release.manifestUrl,
      manifestSha256: options.manifestSha256 || release.manifestSha256,
      methodologyUrl: options.methodologyUrl || release.methodologyUrl,
      methodologySha256: options.methodologySha256 || release.methodologySha256,
    });
    environment.fetch = fetch;
    const installation = Object.freeze({ fetch, repository: fetch.repository, nativeFetch });
    environment.__VC_STATIC_API_INSTALLATION__ = installation;
    return installation;
  }

  return Object.freeze({
    MANIFEST_SCHEMA,
    SNAPSHOT_SCHEMA,
    ENGINE_VERSION,
    DEFAULT_MANIFEST_URL,
    DEFAULT_METHODOLOGY_URL,
    OFFICIAL_SLUGS,
    OFFICIAL_NAMES,
    ROUTED_PANELS,
    RECEIPT_KEYS,
    StaticApiError,
    ProjectionRepository,
    canonicalJson,
    canonicalJsonBytes,
    contentSha256,
    contentSha256CanonicalJson,
    parseStrictCanonicalJson,
    validateProjectionManifest,
    resolveReleaseConfiguration,
    createStaticFetch,
    installStaticApi,
  });
});
