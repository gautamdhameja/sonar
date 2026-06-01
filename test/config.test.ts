import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHAT_BASE_URL, DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL, loadConfig } from "../src/config";

test("loadConfig provides local defaults", () => {
  const config = loadConfig({ HOME: "/tmp/sonar-home" });

  assert.equal(config.chat.baseUrl, DEFAULT_CHAT_BASE_URL);
  assert.equal(config.chat.model, DEFAULT_CHAT_MODEL);
  assert.equal(config.embedding.provider, "ollama");
  assert.equal(config.embedding.baseUrl, "http://localhost:11434");
  assert.equal(config.embedding.model, "nomic-embed-text");
  assert.equal(config.embedding.maxInputTokens, 384);
  assert.equal(config.embedding.concurrency, 2);
  assert.equal(config.embedding.maxRetries, 2);
  assert.equal(config.embedding.fallbackOnFailure, true);
  assert.equal(config.embedding.maxFallbackRatio, 0.1);
  assert.equal(config.ollama.baseUrl, "http://localhost:11434");
  assert.equal(config.qdrant.port, 6333);
  assert.equal(config.qdrant.vectorSize, 768);
  assert.equal(config.storage.dbPath, "/tmp/sonar-home/.sonar/projects.db");
  assert.equal(config.api.host, "127.0.0.1");
  assert.deepEqual(config.security.allowedRepoRoots, [process.cwd()]);
  assert.equal(config.security.allowAnyRepoRoot, false);
});

test("loadConfig uses Docker Model Runner embedding defaults for OpenAI-compatible embeddings", () => {
  const config = loadConfig({
    HOME: "/tmp/sonar-home",
    SONAR_EMBEDDING_PROVIDER: "openai",
  });

  assert.equal(config.embedding.baseUrl, DEFAULT_CHAT_BASE_URL);
  assert.equal(config.embedding.model, DEFAULT_EMBEDDING_MODEL);
});

test("loadConfig reads environment overrides", () => {
  const config = loadConfig({
    HOME: "/tmp/sonar-home",
    SONAR_CHAT_BASE_URL: "http://127.0.0.1:9000/v1",
    SONAR_CHAT_MODEL: "local/model",
    SONAR_CHAT_API_KEY: "secret",
    SONAR_EMBEDDING_PROVIDER: "openai",
    SONAR_EMBEDDING_BASE_URL: "http://127.0.0.1:12434/engines/v1",
    SONAR_EMBEDDING_MODEL: "local/embed",
    SONAR_EMBEDDING_API_KEY: "embed-secret",
    SONAR_EMBEDDING_MAX_INPUT_TOKENS: "256",
    SONAR_EMBEDDING_CONCURRENCY: "1",
    SONAR_EMBEDDING_MAX_RETRIES: "3",
    SONAR_EMBEDDING_FALLBACK_ON_FAILURE: "false",
    SONAR_EMBEDDING_MAX_FALLBACK_RATIO: "0.25",
    SONAR_OLLAMA_BASE_URL: "http://127.0.0.1:11435",
    SONAR_QDRANT_PORT: "6334",
    SONAR_QDRANT_VECTOR_SIZE: "1024",
    SONAR_DB_PATH: "/tmp/sonar.db",
    SONAR_API_HOST: "0.0.0.0",
    SONAR_CORS_ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
    SONAR_API_TOKEN: "dev-token",
    SONAR_ALLOWED_REPO_ROOTS: "/tmp/repos,/Users/example/repos",
    SONAR_ALLOW_ANY_REPO_ROOT: "true",
    SONAR_LOCAL_RERANKER_ENABLED: "true",
    SONAR_LOCAL_RERANKER_TOP_K: "12",
  });

  assert.equal(config.chat.baseUrl, "http://127.0.0.1:9000/v1");
  assert.equal(config.chat.model, "local/model");
  assert.equal(config.chat.apiKey, "secret");
  assert.equal(config.embedding.provider, "openai");
  assert.equal(config.embedding.baseUrl, "http://127.0.0.1:12434/engines/v1");
  assert.equal(config.embedding.model, "local/embed");
  assert.equal(config.embedding.apiKey, "embed-secret");
  assert.equal(config.embedding.maxInputTokens, 256);
  assert.equal(config.embedding.concurrency, 1);
  assert.equal(config.embedding.maxRetries, 3);
  assert.equal(config.embedding.fallbackOnFailure, false);
  assert.equal(config.embedding.maxFallbackRatio, 0.25);
  assert.equal(config.ollama.baseUrl, "http://127.0.0.1:11435");
  assert.equal(config.qdrant.port, 6334);
  assert.equal(config.qdrant.vectorSize, 1024);
  assert.equal(config.storage.dbPath, "/tmp/sonar.db");
  assert.equal(config.api.host, "0.0.0.0");
  assert.deepEqual(config.api.corsAllowedOrigins, ["http://localhost:5173", "http://127.0.0.1:5173"]);
  assert.deepEqual(config.security.allowedRepoRoots, ["/tmp/repos", "/Users/example/repos"]);
  assert.equal(config.security.allowAnyRepoRoot, true);
  assert.equal(config.security.apiToken, "dev-token");
  assert.equal(config.retriever.localReranker.enabled, true);
  assert.equal(config.retriever.localReranker.topK, 12);
});

test("loadConfig rejects invalid numeric values", () => {
  assert.throws(
    () => loadConfig({ SONAR_QDRANT_PORT: "not-a-number" }),
    /SONAR_QDRANT_PORT must be a positive integer/,
  );
});

test("loadConfig rejects invalid URLs", () => {
  assert.throws(() => loadConfig({ SONAR_CHAT_BASE_URL: "localhost:8000" }), /SONAR_CHAT_BASE_URL must be a valid URL/);
});

test("loadConfig rejects invalid booleans", () => {
  assert.throws(
    () => loadConfig({ SONAR_LOCAL_RERANKER_ENABLED: "maybe" }),
    /SONAR_LOCAL_RERANKER_ENABLED must be a boolean/,
  );
});

test("loadConfig rejects invalid embedding providers", () => {
  assert.throws(
    () => loadConfig({ SONAR_EMBEDDING_PROVIDER: "docker-model-runner" }),
    /SONAR_EMBEDDING_PROVIDER must be "ollama" or "openai"/,
  );
});
