import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("API starts with isolated storage and enforces token-protected reads", async () => {
  process.env.SONAR_API_TOKEN = "integration-token";
  process.env.SONAR_DB_PATH = join(mkdtempSync(join(tmpdir(), "sonar-api-integration-")), "projects.db");
  process.env.SONAR_LOG_LEVEL = "silent";

  const { startServer } = await import("../src/api/server");
  const running = await startServer(0);
  try {
    if (!running.server.listening) {
      await once(running.server, "listening");
    }
    const address = running.server.address();
    assert.ok(address && typeof address !== "string");

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${baseUrl}/health`, {
      headers: { "X-Sonar-Token": "integration-token" },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.equal(health.headers.get("x-powered-by"), null);

    const unauthenticatedProjects = await fetch(`${baseUrl}/projects`);
    assert.equal(unauthenticatedProjects.status, 401);

    const authenticatedProjects = await fetch(`${baseUrl}/projects`, {
      headers: { "X-Sonar-Token": "integration-token" },
    });
    assert.equal(authenticatedProjects.status, 200);
    assert.deepEqual(await authenticatedProjects.json(), []);
  } finally {
    running.server.closeAllConnections?.();
    await running.close();
  }
});
