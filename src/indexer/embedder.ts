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

// Docker Model Runner GGUF embedding backends can reject inputs above their
// physical batch size even when the model advertises a larger context. Keep
// chunks conservative for laptop-scale local models and split again if a
// provider reports an oversized input.
const MAX_CHUNK_CHARS = 1000;
const MIN_RETRY_CHUNK_CHARS = 160;
const CHUNK_OVERLAP_CHARS = 120;
const MAX_EMBEDDING_CONCURRENCY = 8;
const embeddingCache = new Map<string, number[]>();

interface EmbeddingResult {
  embedding: number[];
  fallback: boolean;
}

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

function estimateEmbeddingTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function maxChunkChars(): number {
  return Math.max(MIN_RETRY_CHUNK_CHARS, Math.min(MAX_CHUNK_CHARS, CONFIG.embedding.maxInputTokens * 3));
}

function chunkText(text: string): string[] {
  const chunkChars = maxChunkChars();
  if (text.length <= chunkChars) {
    return [text.trim()].filter(Boolean);
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkChars, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(0, end - Math.min(CHUNK_OVERLAP_CHARS, Math.floor(chunkChars / 4)));
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
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

async function embedSingleChunk(text: string, signal?: AbortSignal): Promise<number[]> {
  const estimatedTokens = estimateEmbeddingTokens(text);
  if (estimatedTokens > CONFIG.embedding.maxInputTokens) {
    throw new Error(
      `Embedding input is too large for configured budget (${estimatedTokens} > ${CONFIG.embedding.maxInputTokens} tokens)`,
    );
  }
  if (CONFIG.embedding.provider === "openai") {
    return embedOpenAiChunk(text, signal);
  }
  return embedOllamaChunk(text, signal);
}

function isInputTooLargeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /too large|context length|maximum context|max tokens|physical batch size/i.test(message);
}

function isTransientEmbeddingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /fetch failed|network|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|HTTP 429|\(429\)|HTTP 500|\(500\)|HTTP 502|\(502\)|HTTP 503|\(503\)|HTTP 504|\(504\)/i.test(
    message,
  );
}

function isFallbackEligibleEmbeddingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (/dimension|non-finite|did not include a vector|did not include data\[0\]\.embedding/i.test(message)) {
    return false;
  }
  return isInputTooLargeError(err) || isTransientEmbeddingError(err);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedSingleChunkWithRetry(text: string, signal?: AbortSignal): Promise<number[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= CONFIG.embedding.maxRetries; attempt++) {
    throwIfAborted(signal);
    try {
      return await embedSingleChunk(text, signal);
    } catch (err) {
      throwIfAborted(signal);
      if (isInputTooLargeError(err) || !isTransientEmbeddingError(err) || attempt >= CONFIG.embedding.maxRetries) {
        throw err;
      }
      lastError = err;
      const delay = 250 * 2 ** attempt;
      logger.warn(`Embedding request failed; retrying in ${delay}ms (${attempt + 1}/${CONFIG.embedding.maxRetries})`);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function embedChunkAdaptive(text: string, signal?: AbortSignal): Promise<number[]> {
  try {
    return await embedSingleChunkWithRetry(text, signal);
  } catch (err) {
    throwIfAborted(signal);
    if (!isInputTooLargeError(err) || text.length <= MIN_RETRY_CHUNK_CHARS) {
      throw err;
    }

    const midpoint = Math.ceil(text.length / 2);
    const splitAt = Math.max(text.lastIndexOf("\n", midpoint), text.lastIndexOf(" ", midpoint));
    const split = splitAt > MIN_RETRY_CHUNK_CHARS ? splitAt : midpoint;
    const left = text.slice(0, split).trim();
    const right = text.slice(split).trim();
    if (!left || !right) throw err;

    logger.warn(`Embedding input was too large; retrying as ${left.length}/${right.length} character chunks`);
    const vectors = [await embedChunkAdaptive(left, signal), await embedChunkAdaptive(right, signal)];
    return validateEmbedding(averageVectors(vectors), "Adaptive pooled");
  }
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

function deterministicFallbackEmbedding(text: string): number[] {
  const vector = new Array(CONFIG.qdrant.vectorSize).fill(0);
  let digest = createHash("sha256").update(`${CONFIG.embedding.model}:${text}`).digest();
  for (let i = 0; i < CONFIG.qdrant.vectorSize; i++) {
    if (i % digest.length === 0) {
      digest = createHash("sha256").update(`${CONFIG.embedding.model}:${i}:${text}`).digest();
    }
    vector[i] = digest[i % digest.length] / 127.5 - 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
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
  if (chunks.length === 0) {
    return deterministicFallbackEmbedding(text);
  }

  let embedding: number[];
  if (chunks.length === 1) {
    embedding = await embedChunkAdaptive(chunks[0], signal);
  } else {
    // Embed each chunk and mean-pool the vectors
    const chunkVectors: number[][] = [];
    for (const chunk of chunks) {
      chunkVectors.push(await embedChunkAdaptive(chunk, signal));
    }
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

async function generateEmbeddingForIndex(text: string, index: number, signal?: AbortSignal): Promise<EmbeddingResult> {
  try {
    return { embedding: await generateEmbedding(text, signal), fallback: false };
  } catch (err) {
    throwIfAborted(signal);
    if (!CONFIG.embedding.fallbackOnFailure || !isFallbackEligibleEmbeddingError(err)) {
      throw err;
    }
    logger.warn(`Embedding failed for item ${index}; using deterministic fallback vector: ${err}`);
    return { embedding: deterministicFallbackEmbedding(text), fallback: true };
  }
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
  const concurrency = Math.max(1, Math.min(CONFIG.embedding.concurrency, MAX_EMBEDDING_CONCURRENCY));
  const embeddings = new Array<number[]>(texts.length);
  let nextIndex = 0;
  let completed = 0;
  let fallbackCount = 0;
  let successCount = 0;

  async function worker(): Promise<void> {
    while (true) {
      throwIfAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= texts.length) return;

      const result = await generateEmbeddingForIndex(texts[index], index, signal);
      embeddings[index] = result.embedding;
      if (result.fallback) {
        fallbackCount += 1;
      } else {
        successCount += 1;
      }
      completed += 1;
      if (completed === texts.length || completed % 25 === 0) {
        logger.info(`Generated embeddings for ${completed} of ${texts.length} items`);
      }
    }
  }

  logger.info(`Generating embeddings for ${texts.length} items with concurrency ${concurrency}`);
  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, () => worker()));
  const allowedFallbacks = Math.max(3, Math.floor(texts.length * CONFIG.embedding.maxFallbackRatio));
  if (fallbackCount > 0) {
    logger.warn(`Used deterministic fallback embeddings for ${fallbackCount} of ${texts.length} items`);
  }
  if (fallbackCount > allowedFallbacks || (successCount === 0 && fallbackCount > 0)) {
    throw new Error(
      `Embedding backend failed for too many items (${fallbackCount}/${texts.length}); check the embedding model endpoint and input limits`,
    );
  }
  return embeddings;
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
