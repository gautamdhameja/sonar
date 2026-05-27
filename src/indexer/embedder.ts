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
import { throwIfAborted, withTimeout } from "../utils/abort";

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
    baseUrl: CONFIG.embedding.baseUrl,
    model: CONFIG.embedding.model,
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

function validateEmbedding(vector: unknown, source: string): number[] {
  if (!Array.isArray(vector)) {
    throw new Error(`${source} embedding response did not include a vector`);
  }
  if (vector.length !== CONFIG.qdrant.vectorSize) {
    throw new Error(
      `${source} embedding dimension ${vector.length} did not match expected ${CONFIG.qdrant.vectorSize}`,
    );
  }
  if (!vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`${source} embedding response included non-finite values`);
  }
  return vector;
}

async function embedSingleChunk(text: string, signal?: AbortSignal): Promise<number[]> {
  if (CONFIG.embedding.provider === "openai") {
    return embedOpenAiChunk(text, signal);
  }
  return embedOllamaChunk(text, signal);
}

async function embedOllamaChunk(text: string, signal?: AbortSignal): Promise<number[]> {
  const response = await withTimeout(signal, 60_000, (timeoutSignal) =>
    fetch(`${CONFIG.ollama.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: CONFIG.ollama.embeddingModel, input: text }),
      signal: timeoutSignal,
    }),
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embedding failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { embeddings?: unknown[] };
  return validateEmbedding(data.embeddings?.[0], "Ollama");
}

async function embedOpenAiChunk(text: string, signal?: AbortSignal): Promise<number[]> {
  const response = await withTimeout(signal, 60_000, (timeoutSignal) =>
    fetch(`${CONFIG.embedding.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.embedding.apiKey}`,
      },
      body: JSON.stringify({ model: CONFIG.embedding.model, input: text }),
      signal: timeoutSignal,
    }),
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI-compatible embedding failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("OpenAI-compatible embedding response did not include data[0].embedding");
  }
  return validateEmbedding(embedding, "OpenAI-compatible");
}

export async function generateEmbedding(text: string, signal?: AbortSignal): Promise<number[]> {
  throwIfAborted(signal);
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
    embedding = await embedSingleChunk(chunks[0], signal);
  } else {
    // Embed each chunk and mean-pool the vectors
    const chunkVectors = await Promise.all(chunks.map((chunk) => embedSingleChunk(chunk, signal)));
    embedding = validateEmbedding(averageVectors(chunkVectors), "Pooled");
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

export async function generateEmbeddings(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  const batchSize = 10;
  const totalBatches = Math.ceil(texts.length / batchSize);
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < totalBatches; i++) {
    throwIfAborted(signal);
    logger.info(`Generating embeddings: batch ${i + 1} of ${totalBatches}`);

    const batch = texts.slice(i * batchSize, (i + 1) * batchSize);
    const embeddings = await Promise.all(
      batch.map(async (text, j) => {
        try {
          return await generateEmbedding(text, signal);
        } catch (err) {
          throwIfAborted(signal);
          logger.error(`Embedding failed for item ${i * batchSize + j}: ${err}`);
          throw err;
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
