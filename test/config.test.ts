import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHAT_BASE_URL, DEFAULT_CHAT_MODEL, loadConfig } from "../src/config";

test("loadConfig provides local defaults", () => {
  const config = loadConfig({ HOME: "/tmp/sonar-home" });

  assert.equal(config.chat.baseUrl, DEFAULT_CHAT_BASE_URL);
  assert.equal(config.chat.model, DEFAULT_CHAT_MODEL);
  assert.equal(config.storage.dbPath, "/tmp/sonar-home/.sonar/projects.db");
  assert.equal(config.api.host, "127.0.0.1");
  assert.equal(config.generator.maxResponseTokens, 1800);
  assert.deepEqual(config.security.allowedRepoRoots, [process.cwd()]);
  assert.equal(config.security.allowAnyRepoRoot, false);
});

test("loadConfig reads environment overrides", () => {
  const config = loadConfig({
    HOME: "/tmp/sonar-home",
    SONAR_CHAT_BASE_URL: "http://127.0.0.1:9000/v1",
    SONAR_CHAT_MODEL: "local/model",
    SONAR_CHAT_API_KEY: "secret",
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
    () => loadConfig({ SONAR_MAX_INDEX_FILES: "not-a-number" }),
    /SONAR_MAX_INDEX_FILES must be a positive integer/,
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
