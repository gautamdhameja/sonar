import { getDatabase } from "../db/schema";
import Database from "better-sqlite3";

export interface EmbeddingCacheKeyParts {
  provider: string;
  baseUrl: string;
  model: string;
  vectorSize: number;
  contentHash: string;
}

export interface EmbeddingCacheEntry extends EmbeddingCacheKeyParts {
  cacheKey: string;
  embedding: number[];
}

interface EmbeddingCacheRow {
  cache_key: string;
  provider: string;
  base_url: string;
  model: string;
  vector_size: number;
  content_hash: string;
  embedding_json: string;
}

let cacheDb: Database.Database | null = null;

function db(): Database.Database {
  if (!cacheDb) {
    cacheDb = getDatabase();
  }
  return cacheDb;
}

export function closeEmbeddingCacheDatabase(): void {
  cacheDb?.close();
  cacheDb = null;
}

export function buildEmbeddingCacheKey(parts: EmbeddingCacheKeyParts): string {
  return [parts.provider, parts.baseUrl, parts.model, parts.vectorSize, parts.contentHash].join("|");
}

function isValidEmbedding(value: unknown, expectedSize: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === expectedSize &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

export function readEmbeddingCache(cacheKey: string, expectedSize: number): number[] | null {
  const row = db().prepare("SELECT * FROM embedding_cache WHERE cache_key = ?").get(cacheKey) as
    | EmbeddingCacheRow
    | undefined;

  if (!row) return null;

  try {
    const parsed = JSON.parse(row.embedding_json) as unknown;
    if (!isValidEmbedding(parsed, expectedSize)) {
      db().prepare("DELETE FROM embedding_cache WHERE cache_key = ?").run(cacheKey);
      return null;
    }

    db()
      .prepare("UPDATE embedding_cache SET last_used_at = ? WHERE cache_key = ?")
      .run(new Date().toISOString(), cacheKey);
    return parsed;
  } catch {
    db().prepare("DELETE FROM embedding_cache WHERE cache_key = ?").run(cacheKey);
    return null;
  }
}

export function writeEmbeddingCache(entry: EmbeddingCacheEntry): void {
  if (!isValidEmbedding(entry.embedding, entry.vectorSize)) return;

  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO embedding_cache
      (cache_key, provider, base_url, model, vector_size, content_hash, embedding_json, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       embedding_json = excluded.embedding_json,
       last_used_at = excluded.last_used_at`,
    )
    .run(
      entry.cacheKey,
      entry.provider,
      entry.baseUrl,
      entry.model,
      entry.vectorSize,
      entry.contentHash,
      JSON.stringify(entry.embedding),
      now,
      now,
    );
}

export function deleteEmbeddingCache(cacheKey: string): void {
  db().prepare("DELETE FROM embedding_cache WHERE cache_key = ?").run(cacheKey);
}

export function countPersistentEmbeddingCache(): number {
  const row = db().prepare("SELECT COUNT(*) as count FROM embedding_cache").get() as { count: number };
  return row.count;
}
