import { CONFIG } from "../config";
import { CodeUnit } from "../parser/types";
import { createHash } from "crypto";
import {
  buildEmbeddingCacheKey,
  countPersistentEmbeddingCache,
  readEmbeddingCache,
  writeEmbeddingCache,
} from "./embedding-cache";
import { logger } from "../utils/logger";

// nomic-embed-text has 8192 token context. Code averages ~2-3 chars/token,
// so 4000 chars ≈ 1300-2000 tokens — safe margin for all code types.
const MAX_CHUNK_CHARS = 4000;
const CHUNK_OVERLAP_CHARS = 400;
const embeddingCache = new Map<string, number[]>();

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function cacheParts(text: string) {
  return {
    provider: CONFIG.embedding.provider,
    baseUrl: CONFIG.ollama.baseUrl,
    model: CONFIG.ollama.embeddingModel,
    vectorSize: CONFIG.qdrant.vectorSize,
    contentHash: contentHash(text),
  };
}

function chunkText(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + MAX_CHUNK_CHARS, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }
  return chunks;
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      avg[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    avg[i] /= vectors.length;
  }
  return avg;
}

async function embedSingleChunk(text: string): Promise<number[]> {
  const response = await fetch(`${CONFIG.ollama.baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CONFIG.ollama.embeddingModel, input: text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embedding failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { embeddings: number[][] };
  return data.embeddings[0];
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const parts = cacheParts(text);
  const key = buildEmbeddingCacheKey(parts);
  const cached = embeddingCache.get(key);
  if (cached) return cached;

  const persistentCached = readEmbeddingCache(key, CONFIG.qdrant.vectorSize);
  if (persistentCached) {
    embeddingCache.set(key, persistentCached);
    return persistentCached;
  }

  const chunks = chunkText(text);

  let embedding: number[];
  if (chunks.length === 1) {
    embedding = await embedSingleChunk(chunks[0]);
  } else {
    // Embed each chunk and mean-pool the vectors
    const chunkVectors = await Promise.all(chunks.map(embedSingleChunk));
    embedding = averageVectors(chunkVectors);
  }

  embeddingCache.set(key, embedding);
  writeEmbeddingCache({
    ...parts,
    cacheKey: key,
    embedding,
  });
  return embedding;
}

export function getEmbeddingCacheSize(): number {
  return embeddingCache.size;
}

export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

export function getPersistentEmbeddingCacheSize(): number {
  return countPersistentEmbeddingCache();
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const batchSize = 10;
  const totalBatches = Math.ceil(texts.length / batchSize);
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < totalBatches; i++) {
    logger.info(`Generating embeddings: batch ${i + 1} of ${totalBatches}`);

    const batch = texts.slice(i * batchSize, (i + 1) * batchSize);
    const embeddings = await Promise.all(
      batch.map(async (text, j) => {
        try {
          return await generateEmbedding(text);
        } catch (err) {
          logger.warn(`Embedding failed for item ${i * batchSize + j}, using zero vector: ${err}`);
          return new Array(CONFIG.qdrant.vectorSize).fill(0);
        }
      }),
    );
    allEmbeddings.push(...embeddings);

    if (i < totalBatches - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return allEmbeddings;
}

export function buildEmbeddingText(unit: CodeUnit): string {
  // Kept for tests and external callers. Repository indexing uses contextual
  // embedding text from contextual-text.ts.
  const parts: string[] = [];
  if (unit.docstring) parts.push(unit.docstring);
  parts.push(`${unit.kind} ${unit.name}`);
  parts.push(unit.code);
  return parts.join("\n");
}
