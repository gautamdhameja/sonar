import { CONFIG } from "../config";
import { searchMeilisearch } from "../indexer/meilisearch-indexer";
import { searchQdrant } from "../indexer/qdrant-indexer";
import { generateEmbedding } from "../indexer/embedder";
import { logger } from "../utils/logger";

export interface RetrievedUnit {
  unitId: string;
  rrfScore: number;
  keywordRank: number | null;
  semanticRank: number | null;
  isVendored: boolean;
}

export async function hybridSearch(query: string, projectId: string): Promise<RetrievedUnit[]> {
  const keywordResults = await searchMeilisearch(query, CONFIG.retriever.keywordTopK, projectId);
  const semanticResults = CONFIG.qdrant.enabled
    ? await searchQdrant(await generateEmbedding(query), CONFIG.retriever.semanticTopK, projectId)
    : [];

  const k = CONFIG.retriever.rrf_k;
  const vendoredPenalty = CONFIG.retriever.vendoredPenalty;

  // Build maps of unitId -> 1-based rank for each result set
  const keywordRanks = new Map<string, number>();
  for (const [index, result] of keywordResults.entries()) {
    keywordRanks.set(result.unitId, index + 1);
  }

  const semanticRanks = new Map<string, number>();
  for (const [index, result] of semanticResults.entries()) {
    semanticRanks.set(result.unitId, index + 1);
  }

  // Track vendored status from either result set
  const vendoredMap = new Map<string, boolean>();
  for (const r of keywordResults) vendoredMap.set(r.unitId, r.isVendored);
  for (const r of semanticResults) vendoredMap.set(r.unitId, r.isVendored);

  // Collect all unique unitIds
  const allIds = new Set<string>([...keywordRanks.keys(), ...semanticRanks.keys()]);

  // Calculate RRF score for each
  const fused: RetrievedUnit[] = [];
  for (const unitId of allIds) {
    const kwRank = keywordRanks.get(unitId) ?? null;
    const semRank = semanticRanks.get(unitId) ?? null;
    const isVendored = vendoredMap.get(unitId) ?? false;

    let rrfScore = 0;
    if (kwRank !== null) rrfScore += 1 / (k + kwRank);
    if (semRank !== null) rrfScore += 1 / (k + semRank);

    // Demote vendored results
    if (isVendored) {
      rrfScore *= vendoredPenalty;
    }

    fused.push({ unitId, rrfScore, keywordRank: kwRank, semanticRank: semRank, isVendored });
  }

  // Sort descending by RRF score
  fused.sort((a, b) => b.rrfScore - a.rrfScore);

  // Two-tier selection: prioritize project code, backfill with vendored
  const targetCount = CONFIG.retriever.fusedTopK;
  const projectResults = fused.filter((r) => !r.isVendored);
  const vendoredResults = fused.filter((r) => r.isVendored);

  const results: RetrievedUnit[] = [];
  results.push(...projectResults.slice(0, targetCount));
  if (results.length < targetCount) {
    results.push(...vendoredResults.slice(0, targetCount - results.length));
  }

  // Re-sort the combined results by score
  results.sort((a, b) => b.rrfScore - a.rrfScore);

  const vendoredCount = results.filter((r) => r.isVendored).length;
  logger.info(
    `Hybrid search: ${keywordResults.length} keyword hits, ${semanticResults.length} semantic hits, ` +
      `${results.length} fused results (${vendoredCount} vendored)`,
  );

  return results;
}

export async function safeHybridSearch(query: string, projectId: string): Promise<RetrievedUnit[]> {
  try {
    return await hybridSearch(query, projectId);
  } catch (err) {
    logger.warn(
      `Hybrid search unavailable; continuing with local retrieval: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
