import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodeUnitStore } from "../src/retriever/unit-store";
import { localExactSearch, localGrepSearch, localLexicalSearch, localOnboardingSearch } from "../src/retriever/local-retriever";
import { CodeUnit } from "../src/parser/types";

function unit(overrides: Partial<CodeUnit>): CodeUnit {
  return {
    id: "unit-1",
    filePath: "src/api/server.ts",
    language: "typescript",
    kind: "function",
    name: "startServer",
    code: "const baseUrl = process.env.SONAR_CHAT_BASE_URL; throw new Error('missing chat endpoint');",
    startLine: 1,
    endLine: 3,
    parentName: null,
    imports: ["import express from 'express';"],
    docstring: "Starts the local HTTP API server.",
    exportedNames: ["startServer"],
    calledFunctions: ["express"],
    isVendored: false,
    ...overrides,
  };
}

async function storeWithUnits(units: CodeUnit[]): Promise<CodeUnitStore> {
  const dir = mkdtempSync(join(tmpdir(), "sonar-store-"));
  const file = join(dir, "units.json");
  writeFileSync(file, JSON.stringify(units), "utf-8");
  const store = new CodeUnitStore();
  await store.load(file);
  return store;
}

test("localExactSearch prioritizes file and symbol matches", async () => {
  const store = await storeWithUnits([
    unit({ id: "server", filePath: "src/api/server.ts", name: "startServer" }),
    unit({ id: "repo", filePath: "src/db/project-repo.ts", name: "ProjectRepo", kind: "class" }),
  ]);

  assert.equal(localExactSearch("Explain src/api/server.ts", store)[0].unitId, "server");
  assert.equal(localExactSearch("Explain the ProjectRepo class", store)[0].unitId, "repo");
});

test("localLexicalSearch finds config keys and error literals without vectors", async () => {
  const store = await storeWithUnits([
    unit({ id: "server" }),
    unit({
      id: "other",
      filePath: "src/parser/index.ts",
      name: "parseRepository",
      code: "export function parseRepository() { return []; }",
    }),
  ]);

  assert.equal(localLexicalSearch("Where is SONAR_CHAT_BASE_URL configured?", store)[0].unitId, "server");
  assert.equal(localLexicalSearch("\"missing chat endpoint\"", store)[0].unitId, "server");
});

test("localGrepSearch prioritizes exact constants and validation-adjacent files", async () => {
  const store = await storeWithUnits([
    unit({
      id: "config",
      filePath: "src/llama/config.ts",
      name: "getLlamaConfig",
      code: "const serverUrl = process.env.LLAMA_SERVER_URL ?? 'http://localhost:8080';",
      exportedNames: ["getLlamaConfig"],
    }),
    unit({
      id: "schema",
      filePath: "src/llama/schema.ts",
      name: "LlamaConfigSchema",
      code: "export const LlamaConfigSchema = z.object({ LLAMA_SERVER_URL: z.string().url() });",
      exportedNames: ["LlamaConfigSchema"],
    }),
    unit({
      id: "pipeline",
      filePath: "src/daily/pipeline.ts",
      name: "runDailyPipeline",
      code: "export async function runDailyPipeline() { return []; }",
    }),
  ]);

  const results = localGrepSearch("Where is LLAMA_SERVER_URL configured and validated?", store);
  assert.deepEqual(new Set(results.slice(0, 2).map((result) => result.unitId)), new Set(["schema", "config"]));
  assert.equal(results.some((result) => result.unitId === "pipeline"), false);
});

test("localGrepSearch handles quoted error strings", async () => {
  const store = await storeWithUnits([
    unit({
      id: "client",
      filePath: "src/llama/client.ts",
      name: "callLlama",
      code: "throw new Error('llama server returned invalid JSON');",
    }),
    unit({
      id: "other",
      filePath: "src/daily/scoring.ts",
      name: "scoreCandidate",
      code: "export function scoreCandidate() { return 1; }",
    }),
  ]);

  assert.equal(localGrepSearch("\"llama server returned invalid JSON\"", store)[0].unitId, "client");
});

test("localOnboardingSearch prefers docs and production entry points", async () => {
  const store = await storeWithUnits([
    unit({
      id: "test",
      filePath: "tests/tools.test.ts",
      name: "tools.test",
      code: "test('tool registry', () => true);",
      language: "typescript",
      kind: "module",
    }),
    unit({
      id: "readme",
      filePath: "README.md",
      name: "Birbal",
      code: "Enterprise AI daily digest and use case scout.",
      language: "markdown",
      kind: "module",
    }),
    unit({
      id: "main",
      filePath: "src/main.ts",
      name: "main",
      code: "export async function main() {}",
    }),
  ]);

  assert.deepEqual(localOnboardingSearch("Create a sales onboarding overview", store).slice(0, 2).map((r) => r.unitId), [
    "readme",
    "main",
  ]);
});
