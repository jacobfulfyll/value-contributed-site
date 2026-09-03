import { asUint8Array, canonicalJson, sha256Hex, timingSafeEqualText, verifySha256 } from "./hash.js";
import {
  BrowserExperimentError,
  MANIFEST_RECEIPT_FORMAT,
  SEASON_PACKAGE_RECEIPT_FORMAT,
  assertPackageManifest,
} from "./protocol.js";

async function responseBytes(response, label) {
  if (!response?.ok) {
    throw new BrowserExperimentError(
      "package_download_failed",
      `${label} returned HTTP ${response?.status || "unknown"}.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchVerifiedManifest({
  url,
  expectedSha256,
  fetchImpl,
  cryptoImpl = globalThis.crypto,
  signal,
} = {}) {
  if (typeof url !== "string" || !url) {
    throw new BrowserExperimentError("manifest_url_required", "A release manifest URL is required.");
  }
  const response = await fetchImpl(url, { method: "GET", cache: "no-store", signal });
  const bytes = await responseBytes(response, "Package manifest");
  await verifySha256(bytes, expectedSha256, cryptoImpl);
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new BrowserExperimentError("manifest_json_invalid", "The verified package manifest is not valid UTF-8 JSON.", {
      cause: cause.message,
    });
  }
  assertPackageManifest(manifest);
  await verifyManifestReceipts(manifest, cryptoImpl);
  return { manifest, bytes };
}

async function domainSeparatedReceipt(value, formatName, cryptoImpl) {
  return sha256Hex(`${formatName}\n${canonicalJson(value)}`, cryptoImpl);
}

export async function verifyManifestReceipts(manifest, cryptoImpl = globalThis.crypto) {
  for (const season of manifest.seasons) {
    const { package_receipt: expected, ...receiptPayload } = season;
    const actual = await domainSeparatedReceipt(receiptPayload, SEASON_PACKAGE_RECEIPT_FORMAT, cryptoImpl);
    if (!timingSafeEqualText(actual, expected)) {
      throw new BrowserExperimentError(
        "season_package_receipt_mismatch",
        `Season ${season.season_end_year} package receipt does not match its manifest content.`,
        { expected, actual },
      );
    }
  }
  const { content_sha256: expected, ...receiptPayload } = manifest;
  const actual = await domainSeparatedReceipt(receiptPayload, MANIFEST_RECEIPT_FORMAT, cryptoImpl);
  if (!timingSafeEqualText(actual, expected)) {
    throw new BrowserExperimentError(
      "manifest_content_receipt_mismatch",
      "The package manifest content receipt does not match.",
      { expected, actual },
    );
  }
  return true;
}

export function assertContentAddressedShard(descriptor) {
  const decodedUrl = decodeURIComponent(String(descriptor.url || "")).toLowerCase();
  if (!decodedUrl.includes(descriptor.sha256)) {
    throw new BrowserExperimentError(
      "shard_url_not_content_addressed",
      `The ${descriptor.kind} shard URL does not contain its SHA-256 identity.`,
    );
  }
  return true;
}

export async function getVerifiedShard({
  store,
  releaseId,
  seasonEndYear,
  descriptor,
  fetchImpl,
  cryptoImpl = globalThis.crypto,
  signal,
} = {}) {
  assertContentAddressedShard(descriptor);
  const cached = await store.getPackage(releaseId, seasonEndYear, descriptor);
  if (cached) {
    const cachedBytes = asUint8Array(cached.bytes);
    try {
      if (cachedBytes.byteLength !== descriptor.byte_count) {
        throw new BrowserExperimentError("shard_byte_count_mismatch", "Cached shard byte count does not match the manifest.");
      }
      await verifySha256(cachedBytes, descriptor.sha256, cryptoImpl);
      return { descriptor, bytes: cachedBytes, source: "indexeddb" };
    } catch {
      await store.deletePackage(releaseId, seasonEndYear, descriptor);
    }
  }
  const response = await fetchImpl(descriptor.url, { method: "GET", cache: "force-cache", signal });
  const bytes = await responseBytes(response, `${descriptor.kind} shard for ${seasonEndYear}`);
  if (bytes.byteLength !== descriptor.byte_count) {
    throw new BrowserExperimentError(
      "shard_byte_count_mismatch",
      `${descriptor.kind} for ${seasonEndYear} expected ${descriptor.byte_count} bytes and received ${bytes.byteLength}.`,
    );
  }
  await verifySha256(bytes, descriptor.sha256, cryptoImpl);
  await store.putPackage({ releaseId, seasonEndYear, descriptor, bytes });
  return { descriptor, bytes, source: "network" };
}

export async function getVerifiedSeasonShards({
  store,
  manifest,
  season,
  fetchImpl,
  cryptoImpl = globalThis.crypto,
  signal,
  onVerified = () => {},
} = {}) {
  const packages = new Map();
  for (const descriptor of season.shards) {
    signal?.throwIfAborted?.();
    const verified = await getVerifiedShard({
      store,
      releaseId: manifest.release_id,
      seasonEndYear: season.season_end_year,
      descriptor,
      fetchImpl,
      cryptoImpl,
      signal,
    });
    packages.set(descriptor.kind, verified);
    onVerified({
      seasonEndYear: season.season_end_year,
      kind: descriptor.kind,
      sha256: descriptor.sha256,
      byteCount: descriptor.byte_count,
      rowCount: descriptor.row_count,
      source: verified.source,
    });
  }
  return packages;
}

export async function getVerifiedCatalog({
  store,
  manifest,
  fetchImpl,
  cryptoImpl = globalThis.crypto,
  signal,
} = {}) {
  const descriptor = {
    kind: "catalog",
    schema_version: manifest.catalog.schema_version,
    format: "json",
    compression: "none",
    url: manifest.catalog.url,
    byte_count: manifest.catalog.bytes,
    row_count: 1,
    sha256: manifest.catalog.sha256,
    source_receipt: manifest.content_sha256,
  };
  return getVerifiedShard({
    store,
    releaseId: manifest.release_id,
    seasonEndYear: 0,
    descriptor,
    fetchImpl,
    cryptoImpl,
    signal,
  });
}
