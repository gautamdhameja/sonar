import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config";

test("loadConfig provides local defaults", () => {
  const config = loadConfig({ HOME: "/tmp/sonar-home" });

  assert.equal(config.chat.baseUrl, "http://localhost:8000/v1");
  assert.equal(config.chat.model, "Qwen/Qwen3.5-9B");
  assert.equal(config.ollama.baseUrl, "http://localhost:11434");
  assert.equal(config.qdrant.port, 6333);
  assert.equal(config.qdrant.vectorSize, 768);
  assert.equal(config.storage.dbPath, "/tmp/sonar-home/.code-explorer/projects.db");
});

test("loadConfig reads environment overrides", () => {
  const config = loadConfig({
    HOME: "/tmp/sonar-home",
    SONAR_CHAT_BASE_URL: "http://127.0.0.1:9000/v1",
    SONAR_CHAT_MODEL: "local/model",
    SONAR_CHAT_API_KEY: "secret",
    SONAR_OLLAMA_BASE_URL: "http://127.0.0.1:11435",
    SONAR_QDRANT_PORT: "6334",
    SONAR_QDRANT_VECTOR_SIZE: "1024",
    SONAR_DB_PATH: "/tmp/sonar.db",
    SONAR_ALLOWED_REPO_ROOTS: "/tmp/repos,/Users/example/repos",
    SONAR_LOCAL_RERANKER_ENABLED: "true",
    SONAR_LOCAL_RERANKER_TOP_K: "12",
  });

  assert.equal(config.chat.baseUrl, "http://127.0.0.1:9000/v1");
  assert.equal(config.chat.model, "local/model");
  assert.equal(config.chat.apiKey, "secret");
  assert.equal(config.ollama.baseUrl, "http://127.0.0.1:11435");
  assert.equal(config.qdrant.port, 6334);
  assert.equal(config.qdrant.vectorSize, 1024);
  assert.equal(config.storage.dbPath, "/tmp/sonar.db");
  assert.deepEqual(config.security.allowedRepoRoots, ["/tmp/repos", "/Users/example/repos"]);
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
  assert.throws(
    () => loadConfig({ SONAR_CHAT_BASE_URL: "localhost:8000" }),
    /SONAR_CHAT_BASE_URL must be a valid URL/,
  );
});

test("loadConfig rejects invalid booleans", () => {
  assert.throws(
    () => loadConfig({ SONAR_LOCAL_RERANKER_ENABLED: "maybe" }),
    /SONAR_LOCAL_RERANKER_ENABLED must be a boolean/,
  );
});
