import { BrowserExperimentError, ENGINE_VERSION, KernelEvent, TIME_MODES } from "./protocol.js";
import { canonicalSha256 } from "./hash.js";
import { expandOriginalExperimentConfiguration } from "./configuration.js";
import { decodeVerifiedCatalog, decodeVerifiedSeasonPackages } from "./package-decoder.js";
import {
  ORIGINAL_BROWSER_CALCULATION_VERSION,
  calculateOriginalBrowserTeams,
  finalizeBrowserResultRows,
  verifyOfficialParity,
} from "./original-browser-calculation.js";

export const PACKAGE_CALCULATOR_KERNEL_VERSION = `${ENGINE_VERSION}:kernel-v1`;
const RESULT_BATCH_SIZE = 1_000;

function abortCheckpoint(signal) {
  signal?.throwIfAborted?.();
}

function strictConfigurationIdentity(left, right) {
  if (left.configuration_receipt !== right.configuration_receipt
      || left.expanded_raw.source_expanded_sha256 !== right.expanded_raw.source_expanded_sha256) {
    throw new BrowserExperimentError(
      "configuration_receipt_mismatch",
      "The stored configuration does not match the verified catalog expansion.",
    );
  }
}

function seasonAuditAggregate(season, configuration, rows, parity) {
  const teams = new Set(rows.map((row) => `${row.game_id}:${row.time_mode}:${row.team_id}`));
  return {
    aggregate_key: `${season.season_end_year}:calculation-audit`,
    panel: "calculation-audit",
    time_mode: "both",
    dimensions: {
      season_end_year: season.season_end_year,
      configuration_receipt: configuration.configuration_receipt,
    },
    measures: {
      game_count: season.game_count,
      player_game_mode_count: rows.length,
      team_game_mode_count: teams.size,
      official_parity_checked: parity.checked,
      official_parity_max_absolute_residual: parity.max_absolute_residual,
    },
  };
}

export function createOriginalPackageCalculator() {
  return Object.freeze({
    version: PACKAGE_CALCULATOR_KERNEL_VERSION,
    calculationVersion: ORIGINAL_BROWSER_CALCULATION_VERSION,
    async *calculateSeason({ manifest, season, configuration, catalog, packages, signal }) {
      abortCheckpoint(signal);
      const decodedCatalog = await decodeVerifiedCatalog(catalog);
      const expanded = await expandOriginalExperimentConfiguration(configuration, decodedCatalog);
      strictConfigurationIdentity(expanded, configuration);
      abortCheckpoint(signal);
      const decoded = await decodeVerifiedSeasonPackages(packages);
      if (decoded.games.length !== season.game_count) {
        throw new BrowserExperimentError(
          "season_game_coverage_mismatch",
          `Season ${season.season_end_year} package game count drifted.`,
        );
      }
      yield {
        type: KernelEvent.PROGRESS,
        progress: { stage: "packages-decoded", completed: 0, total: decoded.players.length },
      };
      abortCheckpoint(signal);
      const calculated = calculateOriginalBrowserTeams({
        players: decoded.players,
        contextOperands: decoded.context_operands,
        coefficientBasis: decoded.coefficient_basis,
        responsibilityMetadata: decoded.responsibility_metadata,
        configuration: expanded,
      });
      const parity = verifyOfficialParity(calculated, decoded.official_outputs, expanded);
      const rows = await finalizeBrowserResultRows(
        calculated,
        decoded.games,
        expanded,
        manifest.responsibility.policy_sha256,
      );
      if (rows.length !== season.player_game_mode_count
          || TIME_MODES.some((mode) => !rows.some((row) => row.time_mode === mode))) {
        throw new BrowserExperimentError(
          "season_player_coverage_mismatch",
          `Season ${season.season_end_year} browser result coverage drifted.`,
        );
      }
      for (let start = 0; start < rows.length; start += RESULT_BATCH_SIZE) {
        abortCheckpoint(signal);
        const batch = rows.slice(start, start + RESULT_BATCH_SIZE);
        yield { type: KernelEvent.PLAYER_GAME_RESULTS, rows: batch };
        yield {
          type: KernelEvent.PROGRESS,
          progress: {
            stage: "player-game-results",
            completed: Math.min(start + batch.length, rows.length),
            total: rows.length,
          },
        };
      }
      const aggregates = [seasonAuditAggregate(season, expanded, rows, parity)];
      yield { type: KernelEvent.AGGREGATES, rows: aggregates };
      const seasonReceipt = await canonicalSha256({
        kind: "original-browser-season-result-v2",
        calculation_version: ORIGINAL_BROWSER_CALCULATION_VERSION,
        package_receipt: season.package_receipt,
        configuration_receipt: expanded.configuration_receipt,
        season_end_year: season.season_end_year,
        row_hashes: rows.map((row) => row.row_hash),
      });
      const aggregateReceipt = await canonicalSha256({
        kind: "original-browser-season-aggregates-v1",
        configuration_receipt: expanded.configuration_receipt,
        season_end_year: season.season_end_year,
        aggregates,
      });
      yield {
        type: KernelEvent.SEASON_COMPLETE,
        seasonEndYear: season.season_end_year,
        timeModes: [...TIME_MODES],
        resultRowCount: rows.length,
        aggregateRowCount: aggregates.length,
        seasonReceipt,
        aggregateReceipt,
      };
    },
  });
}
