import { canonicalSha256 } from "./hash.js";
import { ALL_SEASONS, BrowserExperimentError, sortedUniqueSeasons } from "./protocol.js";

export const STORAGE_REVIEW_VERSION = "value-contributed-original-storage-review-v1";
export const MINIMUM_STORAGE_HEADROOM_BYTES = 50 * 1024 * 1024;
export const STORAGE_HEADROOM_RATIO = 0.15;

export function isPhoneEnvironment({
  userAgent = globalThis.navigator?.userAgent || "",
  userAgentData = globalThis.navigator?.userAgentData,
} = {}) {
  if (typeof userAgentData?.mobile === "boolean") return userAgentData.mobile;
  const normalized = String(userAgent);
  return /iPhone|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/iu.test(normalized)
    || (/Android/iu.test(normalized) && /Mobile/iu.test(normalized));
}

export function experimentCreationGuard(environment = {}) {
  const phone = isPhoneEnvironment(environment);
  return Object.freeze({
    creationAllowed: !phone,
    phone,
    officialRankingsAllowed: true,
    sharedSnapshotsAllowed: true,
    reason: phone ? "desktop_required" : null,
    message: phone
      ? "Creating experiments requires a desktop browser. Official rankings and shareable ranking cards remain available on this phone."
      : null,
  });
}

function assertEstimate(estimate, label) {
  const keys = ["download_bytes", "storage_bytes", "runtime_seconds_low", "runtime_seconds_high"];
  if (!estimate || keys.some((key) => !Number.isInteger(estimate[key]) || estimate[key] < 0)) {
    throw new BrowserExperimentError("invalid_manifest_estimate", `${label} has an invalid package estimate.`);
  }
  return estimate;
}

export function selectionEstimate(manifest, selectedSeasons) {
  const seasons = sortedUniqueSeasons(selectedSeasons);
  const allSeasons = seasons.length === ALL_SEASONS.length
    && seasons.every((season, index) => season === ALL_SEASONS[index]);
  if (allSeasons) return { ...assertEstimate(manifest.all_seasons_estimate, "All Seasons") };
  const byYear = new Map((manifest.seasons || []).map((season) => [season.season_end_year, season]));
  return seasons.reduce((total, year) => {
    const season = byYear.get(year);
    if (!season) throw new BrowserExperimentError("season_unavailable", `Season ${year} is absent from this release.`);
    const estimate = assertEstimate(season.estimate, `Season ${year}`);
    for (const key of Object.keys(total)) total[key] += estimate[key];
    return total;
  }, { download_bytes: 0, storage_bytes: 0, runtime_seconds_low: 0, runtime_seconds_high: 0 });
}

export async function assessRunCapacity({
  manifest,
  manifestSha256,
  selectedSeasons,
  storageManager = globalThis.navigator?.storage,
  environment = {},
  cryptoImpl = globalThis.crypto,
} = {}) {
  const seasons = sortedUniqueSeasons(selectedSeasons);
  const estimate = selectionEstimate(manifest, seasons);
  const allSeasons = seasons.length === ALL_SEASONS.length
    && seasons.every((season, index) => season === ALL_SEASONS[index]);
  const guard = experimentCreationGuard(environment);
  let storage = null;
  try {
    storage = await storageManager?.estimate?.();
  } catch {
    storage = null;
  }
  const quotaBytes = Number.isFinite(storage?.quota) ? Math.floor(storage.quota) : null;
  const usageBytes = Number.isFinite(storage?.usage) ? Math.floor(storage.usage) : null;
  const availableBytes = quotaBytes != null && usageBytes != null ? Math.max(0, quotaBytes - usageBytes) : null;
  const headroomBytes = Math.max(
    MINIMUM_STORAGE_HEADROOM_BYTES,
    Math.ceil(estimate.storage_bytes * STORAGE_HEADROOM_RATIO),
  );
  const requiredAvailableBytes = estimate.storage_bytes + headroomBytes;
  const storageKnown = availableBytes != null;
  const storageSufficient = storageKnown && availableBytes >= requiredAvailableBytes;
  const reviewBasis = {
    schema_version: STORAGE_REVIEW_VERSION,
    release_id: manifest.release_id,
    manifest_sha256: manifestSha256,
    selected_seasons: seasons,
    estimate,
    quota_bytes: quotaBytes,
    usage_bytes: usageBytes,
    available_bytes: availableBytes,
    headroom_bytes: headroomBytes,
    required_available_bytes: requiredAvailableBytes,
    all_seasons: allSeasons,
    desktop_creation_allowed: guard.creationAllowed,
    storage_known: storageKnown,
    storage_sufficient: storageSufficient,
  };
  return Object.freeze({
    ...reviewBasis,
    creation_allowed: guard.creationAllowed && storageSufficient,
    block_reason: !guard.creationAllowed
      ? guard.reason
      : (!storageKnown ? "storage_estimate_unavailable" : (!storageSufficient ? "insufficient_storage" : null)),
    review_receipt: await canonicalSha256(reviewBasis, cryptoImpl),
  });
}

export function assertRunConfirmation(review, confirmation) {
  if (!review?.creation_allowed) {
    throw new BrowserExperimentError(
      review?.block_reason || "run_not_allowed",
      review?.block_reason === "insufficient_storage"
        ? "Available browser storage is below the selected package requirement and safety headroom."
        : "This browser cannot create the selected experiment.",
    );
  }
  if (!confirmation || confirmation.confirmed !== true
      || confirmation.review_receipt !== review.review_receipt) {
    throw new BrowserExperimentError("confirmation_required", "Confirm the reviewed scope, storage, and runtime estimate.");
  }
  if (review.all_seasons && confirmation.all_seasons_confirmed !== true) {
    throw new BrowserExperimentError(
      "all_seasons_confirmation_required",
      "All Seasons requires a separate confirmation of its download, storage, and runtime estimate.",
    );
  }
  return true;
}
