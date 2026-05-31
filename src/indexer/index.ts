import { CodeUnit } from "../parser/types";
import { deleteMeilisearchIndex, indexToMeilisearch } from "./meilisearch-indexer";
import { deleteQdrantCollection, indexToQdrant } from "./qdrant-indexer";
import { generateEmbeddings } from "./embedder";
import { buildContextualEmbeddingTexts } from "./contextual-text";
import { logger } from "../utils/logger";
import { throwIfAborted } from "../utils/abort";

export { ScoredResult } from "./types";
export { searchMeilisearch } from "./meilisearch-indexer";
export { searchQdrant } from "./qdrant-indexer";

export async function indexRepository(units: CodeUnit[], projectId: string, signal?: AbortSignal): Promise<void> {
  const totalStart = Date.now();

  // Step 1: Meilisearch keyword index
  let start = Date.now();
  throwIfAborted(signal);
  await indexToMeilisearch(units, projectId, signal);
  logger.info(`Meilisearch indexing: ${((Date.now() - start) / 1000).toFixed(1)}s`);

  // Step 2: Generate embeddings
  start = Date.now();
  throwIfAborted(signal);
  const texts = buildContextualEmbeddingTexts(units);
  const embeddings = await generateEmbeddings(texts, signal);
  logger.info(`Embedding generation: ${((Date.now() - start) / 1000).toFixed(1)}s`);

  // Step 3: Qdrant vector index
  start = Date.now();
  throwIfAborted(signal);
  const qdrantData = units.map((unit) => ({
    unitId: unit.id,
    name: unit.name,
    filePath: unit.filePath,
    kind: unit.kind,
    isVendored: unit.isVendored,
  }));
  await indexToQdrant(qdrantData, embeddings, projectId, signal);
  logger.info(`Qdrant indexing: ${((Date.now() - start) / 1000).toFixed(1)}s`);

  logger.info(`Indexing complete in ${((Date.now() - totalStart) / 1000).toFixed(1)}s`);
}

export async function deleteProjectIndexes(projectId: string): Promise<void> {
  const results = await Promise.allSettled([deleteMeilisearchIndex(projectId), deleteQdrantCollection(projectId)]);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn(`Unable to clean external index for project ${projectId}: ${String(result.reason)}`);
    }
  }
}
