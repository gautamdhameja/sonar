import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.SONAR_DB_PATH = join(mkdtempSync(join(tmpdir(), "sonar-embedding-cache-")), "projects.db");

test("embedding cache can be cleared and inspected", async () => {
  const { clearEmbeddingCache, getEmbeddingCacheSize } = await import("../src/indexer/embedder");

  clearEmbeddingCache();
  assert.equal(getEmbeddingCacheSize(), 0);
});

test("persistent embedding cache stores and reads vectors", async () => {
  const {
    buildEmbeddingCacheKey,
    countPersistentEmbeddingCache,
    closeEmbeddingCacheDatabase,
    deleteEmbeddingCache,
    readEmbeddingCache,
    writeEmbeddingCache,
  } = await import("../src/indexer/embedding-cache");
  const parts = {
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "nomic-embed-text",
    vectorSize: 3,
    contentHash: "hash-a",
  };
  const cacheKey = buildEmbeddingCacheKey(parts);
  deleteEmbeddingCache(cacheKey);

  writeEmbeddingCache({ ...parts, cacheKey, embedding: [0.1, 0.2, 0.3] });

  assert.deepEqual(readEmbeddingCache(cacheKey, 3), [0.1, 0.2, 0.3]);
  assert.ok(countPersistentEmbeddingCache() >= 1);
  closeEmbeddingCacheDatabase();
  assert.deepEqual(readEmbeddingCache(cacheKey, 3), [0.1, 0.2, 0.3]);
});

test("persistent embedding cache drops invalid vector dimensions", async () => {
  const { buildEmbeddingCacheKey, deleteEmbeddingCache, readEmbeddingCache, writeEmbeddingCache } = await import(
    "../src/indexer/embedding-cache"
  );
  const parts = {
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "nomic-embed-text",
    vectorSize: 2,
    contentHash: "hash-b",
  };
  const cacheKey = buildEmbeddingCacheKey(parts);
  deleteEmbeddingCache(cacheKey);

  writeEmbeddingCache({ ...parts, cacheKey, embedding: [1, 2] });

  assert.equal(readEmbeddingCache(cacheKey, 3), null);
  assert.equal(readEmbeddingCache(cacheKey, 2), null);
});
