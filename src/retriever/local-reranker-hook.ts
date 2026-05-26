import { CONFIG } from "../config";
import { RetrievedUnit } from "./hybrid-retriever";
import { RetrievalDiagnostic } from "./reranker";

export interface LocalRerankerHookResult {
  results: RetrievedUnit[];
  diagnostics: RetrievalDiagnostic[];
  enabled: boolean;
  reason: string;
}

export async function applyOptionalLocalReranker(
  results: RetrievedUnit[],
  diagnostics: RetrievalDiagnostic[],
): Promise<LocalRerankerHookResult> {
  if (!CONFIG.retriever.localReranker.enabled) {
    return {
      results,
      diagnostics,
      enabled: false,
      reason: "SONAR_LOCAL_RERANKER_ENABLED is false",
    };
  }

  // Placeholder integration point for a future local cross-encoder or LLM reranker.
  // Keep behavior deterministic until a concrete local reranker backend is configured.
  return {
    results: results.slice(0, CONFIG.retriever.localReranker.topK),
    diagnostics: diagnostics.slice(0, CONFIG.retriever.localReranker.topK),
    enabled: true,
    reason: "local reranker hook enabled; no model backend configured, deterministic ranking preserved",
  };
}
