import test from "node:test";
import assert from "node:assert/strict";
import { packContext } from "../src/context/packer";
import { CodeUnit } from "../src/parser/types";

function unit(id: string, overrides: Partial<CodeUnit> = {}): CodeUnit {
  return {
    id,
    filePath: `src/${id}.ts`,
    language: "typescript",
    kind: "function",
    name: id,
    code: `export function ${id}() { return true; }`,
    startLine: 1,
    endLine: 1,
    parentName: null,
    imports: [],
    docstring: null,
    exportedNames: [],
    calledFunctions: [],
    isVendored: false,
    ...overrides,
  };
}

test("packContext prioritizes retrieved and exact symbol matches", () => {
  const packed = packContext(
    [unit("unrelated"), unit("ProjectRepo", { kind: "class", exportedNames: ["ProjectRepo"] }), unit("helper")],
    [{ unitId: "helper", rrfScore: 1, keywordRank: 1, semanticRank: null, isVendored: false }],
    { query: "Explain ProjectRepo", maxTokens: 300 },
  );

  assert.equal(packed[0].id, "helper");
  assert.equal(packed[1].id, "ProjectRepo");
});

test("packContext applies file diversity and token limits", () => {
  const packed = packContext(
    [
      unit("a1", { filePath: "src/a.ts" }),
      unit("a2", { filePath: "src/a.ts" }),
      unit("a3", { filePath: "src/a.ts" }),
      unit("b1", { filePath: "src/b.ts", code: "x".repeat(1200) }),
    ],
    [
      { unitId: "a1", rrfScore: 5, keywordRank: 1, semanticRank: null, isVendored: false },
      { unitId: "a2", rrfScore: 4, keywordRank: 2, semanticRank: null, isVendored: false },
      { unitId: "a3", rrfScore: 3, keywordRank: 3, semanticRank: null, isVendored: false },
      { unitId: "b1", rrfScore: 2, keywordRank: 4, semanticRank: null, isVendored: false },
    ],
    { query: "a", maxTokens: 120, maxUnitsPerFile: 2 },
  );

  assert.equal(packed.filter((item) => item.filePath === "src/a.ts").length, 2);
  assert.ok(packed.every((item) => item.code.length <= 1200));
});

test("packContext keeps exact evidence even when one file has many units", () => {
  const packed = packContext(
    [
      unit("a1", { filePath: "src/llama/config.ts", code: "export const one = 1;" }),
      unit("a2", { filePath: "src/llama/config.ts", code: "export const two = 2;" }),
      unit("a3", { filePath: "src/llama/config.ts", code: "const serverUrl = process.env.LLAMA_SERVER_URL;" }),
      unit("a4", { filePath: "src/llama/config.ts", code: "export const four = 4;" }),
    ],
    [
      { unitId: "a1", rrfScore: 5, keywordRank: 1, semanticRank: null, isVendored: false },
      { unitId: "a2", rrfScore: 4, keywordRank: 2, semanticRank: null, isVendored: false },
      { unitId: "a3", rrfScore: 3, keywordRank: 3, semanticRank: null, isVendored: false },
      { unitId: "a4", rrfScore: 2, keywordRank: 4, semanticRank: null, isVendored: false },
    ],
    { query: "Where is LLAMA_SERVER_URL configured?", maxTokens: 500, maxUnitsPerFile: 2 },
  );

  assert.ok(packed.some((item) => item.id === "a3"));
});

test("packContext favors schema and test support for validation queries", () => {
  const packed = packContext(
    [
      unit("main", { filePath: "src/main.ts", code: "export function main() {}" }),
      unit("schema", {
        filePath: "src/llama/schema.ts",
        code: "export const LlamaConfigSchema = z.object({ LLAMA_SERVER_URL: z.string().url() });",
      }),
      unit("test", {
        filePath: "tests/llama.test.ts",
        code: "assert.equal(getLlamaConfig().serverUrl, process.env.LLAMA_SERVER_URL);",
      }),
    ],
    [{ unitId: "main", rrfScore: 1, keywordRank: 1, semanticRank: null, isVendored: false }],
    { query: "Where is LLAMA_SERVER_URL validated?", maxTokens: 500 },
  );

  assert.deepEqual(new Set(packed.map((item) => item.id)), new Set(["main", "schema", "test"]));
  assert.ok(packed.findIndex((item) => item.id === "schema") < packed.findIndex((item) => item.id === "test"));
});

test("packContext demotes tests for broad onboarding queries", () => {
  const packed = packContext(
    [
      unit("test", { filePath: "tests/tools.test.ts", code: "test('tooling', () => true);" }),
      unit("pipeline", {
        filePath: "src/workflows/runner.ts",
        code: "export async function runWorkflow() {}",
      }),
      unit("workflow", { filePath: "src/workflows/pipeline.ts", code: "export const pipeline = {};" }),
    ],
    [
      { unitId: "test", rrfScore: 10, keywordRank: 1, semanticRank: null, isVendored: false },
      { unitId: "pipeline", rrfScore: 1, keywordRank: 2, semanticRank: null, isVendored: false },
      { unitId: "workflow", rrfScore: 1, keywordRank: 3, semanticRank: null, isVendored: false },
    ],
    { query: "Create a role-aware onboarding overview of this codebase", maxTokens: 500 },
  );

  assert.notEqual(packed[0].id, "test");
});

test("packContext boosts workflow stage files for pipeline questions", () => {
  const packed = packContext(
    [
      unit("registry", {
        filePath: "src/workflows/registry.ts",
        code: "export function getCollector() { return collector; }",
      }),
      unit("workflow", {
        filePath: "src/workflows/pipeline.ts",
        code: "export const pipeline = { collect: true, classify: true, score: true, save: true };",
      }),
      unit("scoring", {
        filePath: "src/workflows/scoring.ts",
        code: "export function scoreCandidate() { return 1; }",
      }),
      unit("storage", {
        filePath: "src/db/items.ts",
        code: "export function upsertItem() { return true; }",
      }),
    ],
    [
      { unitId: "registry", rrfScore: 5, keywordRank: 1, semanticRank: null, isVendored: false },
      { unitId: "workflow", rrfScore: 1, keywordRank: 2, semanticRank: null, isVendored: false },
      { unitId: "scoring", rrfScore: 1, keywordRank: 3, semanticRank: null, isVendored: false },
      { unitId: "storage", rrfScore: 1, keywordRank: 4, semanticRank: null, isVendored: false },
    ],
    { query: "How does the pipeline collect, classify, score, and save items?", maxTokens: 700 },
  );

  assert.equal(packed[0].id, "workflow");
  assert.ok(packed.findIndex((item) => item.id === "scoring") < packed.findIndex((item) => item.id === "registry"));
  assert.ok(packed.findIndex((item) => item.id === "storage") < packed.findIndex((item) => item.id === "registry"));
});

test("packContext does not boost removed repo-specific paths", () => {
  const packed = packContext(
    [
      unit("runner", { filePath: "src/runpipeline.ts", code: "export function start() {}" }),
      unit("entry", { filePath: "src/main.ts", code: "export function start() {}" }),
    ],
    [
      { unitId: "runner", rrfScore: 1, keywordRank: 1, semanticRank: null, isVendored: false },
      { unitId: "entry", rrfScore: 1, keywordRank: 2, semanticRank: null, isVendored: false },
    ],
    {
      query: "Create a codebase onboarding overview",
      maxTokens: 500,
      queryPlan: {
        intent: "architecture_overview",
        mode: "summary_graph",
        requiredEvidence: ["entry_points"],
        preferredSources: ["code"],
        graphDirection: "bidirectional",
        sourceBudget: { code: 6, docs: 0, tests: 0 },
        useLocalExact: false,
        useLexical: true,
        useGraph: true,
        includeSummary: true,
        maxContextRatio: 0.65,
        reason: "test",
      },
    },
  );

  assert.equal(packed[0].id, "entry");
});

test("packContext applies query plan evidence preferences", () => {
  const packed = packContext(
    [
      unit("code", { filePath: "src/main.ts", code: "export function main() {}" }),
      unit("docs", { filePath: "README.md", language: "markdown", kind: "module", code: "# Product overview" }),
    ],
    [
      { unitId: "code", rrfScore: 5, keywordRank: 1, semanticRank: null, isVendored: false },
      { unitId: "docs", rrfScore: 1, keywordRank: 2, semanticRank: null, isVendored: false },
    ],
    {
      query: "Create a codebase onboarding overview",
      maxTokens: 500,
      queryPlan: {
        intent: "architecture_overview",
        mode: "summary_graph",
        requiredEvidence: ["overview_docs", "entry_points"],
        preferredSources: ["docs", "code", "graph"],
        graphDirection: "bidirectional",
        sourceBudget: { code: 6, docs: 3, tests: 0 },
        useLocalExact: false,
        useLexical: true,
        useGraph: true,
        includeSummary: true,
        maxContextRatio: 0.65,
        reason: "test",
      },
    },
  );

  assert.equal(packed[0].id, "docs");
});
