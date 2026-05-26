import { CodeUnit } from "../parser/types";
import { indexToMeilisearch } from "./meilisearch-indexer";
import { indexToQdrant } from "./qdrant-indexer";
import { generateEmbeddings } from "./embedder";
import { buildContextualEmbeddingTexts } from "./contextual-text";
import { logger } from "../utils/logger";

export { ScoredResult } from "./types";
export { searchMeilisearch } from "./meilisearch-indexer";
export { searchQdrant } from "./qdrant-indexer";

export async function indexRepository(units: CodeUnit[], projectId: string): Promise<void> {
  const totalStart = Date.now();

  // Step 1: Meilisearch keyword index
  let start = Date.now();
  await indexToMeilisearch(units, projectId);
  logger.info(`Meilisearch indexing: ${((Date.now() - start) / 1000).toFixed(1)}s`);

  // Step 2: Generate embeddings
  start = Date.now();
  const texts = buildContextualEmbeddingTexts(units);
  const embeddings = await generateEmbeddings(texts);
  logger.info(`Embedding generation: ${((Date.now() - start) / 1000).toFixed(1)}s`);

  // Step 3: Qdrant vector index
  start = Date.now();
  const qdrantData = units.map((unit) => ({
    unitId: unit.id,
    name: unit.name,
    filePath: unit.filePath,
    kind: unit.kind,
    isVendored: unit.isVendored,
  }));
  await indexToQdrant(qdrantData, embeddings, projectId);
  logger.info(`Qdrant indexing: ${((Date.now() - start) / 1000).toFixed(1)}s`);

  logger.info(`Indexing complete in ${((Date.now() - totalStart) / 1000).toFixed(1)}s`);
}
