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
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.equal(health.headers.get("x-sonar-service"), "workspace-engine");
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.equal(health.headers.get("x-powered-by"), null);

    const unauthenticatedProjectHealth = await fetch(`${baseUrl}/health/project`);
    assert.equal(unauthenticatedProjectHealth.status, 401);

    const dependencies = await fetch(`${baseUrl}/health/dependencies`, {
      headers: { "X-Sonar-Token": "integration-token" },
    });
    assert.equal(dependencies.status, 200);
    const dependencyBody = (await dependencies.json()) as {
      status: "ok" | "degraded";
      dependencies: Array<{ name: string; status: "ok" | "error"; message?: string }>;
    };
    assert.match(dependencyBody.status, /^(ok|degraded)$/);
    assert.ok(dependencyBody.dependencies.some((dependency) => dependency.name === "chat"));

    const blockedOrigin = await fetch(`${baseUrl}/projects`, {
      headers: {
        Origin: "http://evil.localhost",
        "X-Sonar-Token": "integration-token",
      },
    });
    assert.equal(blockedOrigin.status, 403);

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
