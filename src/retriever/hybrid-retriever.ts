import { logger } from "../utils/logger";

export interface RetrievedUnit {
  unitId: string;
  rrfScore: number;
  keywordRank: number | null;
  semanticRank: number | null;
  isVendored: boolean;
}

export async function hybridSearch(query: string, projectId: string): Promise<RetrievedUnit[]> {
  logger.debug(`External hybrid search is disabled for local-only runtime (${projectId}): ${query}`);
  return [];
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
