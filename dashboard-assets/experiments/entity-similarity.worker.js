import {
  buildTeamSimilarityArtifact,
  projectPlayerSimilarity,
  projectTeamSimilarity,
} from "./entity-projections.js";

const projectors = Object.freeze({
  player_similarity: projectPlayerSimilarity,
  team_similarity: projectTeamSimilarity,
  team_similarity_artifact: buildTeamSimilarityArtifact,
});

self.addEventListener("message", (event) => {
  const { request_id: requestId, panel, rows, options, configuration } = event.data ?? {};
  try {
    const projector = projectors[panel];
    if (!projector) throw new Error(`Unsupported similarity panel ${panel}.`);
    const payload = projector(rows, options, configuration);
    self.postMessage({ request_id: requestId, ok: true, payload });
  } catch (caught) {
    self.postMessage({
      request_id: requestId,
      ok: false,
      error: {
        name: caught?.name ?? "Error",
        code: caught?.code ?? "similarity_failed",
        message: caught?.message ?? String(caught),
        details: caught?.details,
      },
    });
  }
});
