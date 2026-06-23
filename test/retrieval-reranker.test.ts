import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodeUnit } from "../src/parser/types";
import { CodeUnitStore } from "../src/retriever/unit-store";
import { rerankRetrievedResults } from "../src/retriever/reranker";
import { evaluateRetrievalCases } from "../src/eval/retrieval-eval";
import { RetrievedUnit } from "../src/retriever/retrieved-unit";

function unit(id: string, filePath: string, code: string, name = id): CodeUnit {
  return {
    id,
    filePath,
    language: filePath.endsWith(".md") ? "markdown" : "typescript",
    kind: "module",
    name,
    code,
    startLine: 1,
    endLine: code.split("\n").length,
    parentName: null,
    imports: [],
    docstring: null,
    exportedNames: [name],
    calledFunctions: [],
    isVendored: false,
  };
}

async function storeWithUnits(units: CodeUnit[]): Promise<CodeUnitStore> {
  const dir = mkdtempSync(join(tmpdir(), "sonar-rerank-"));
  const file = join(dir, "units.json");
  writeFileSync(file, JSON.stringify(units), "utf-8");
  const store = new CodeUnitStore();
  await store.load(file);
  return store;
}

function retrieved(unitId: string, score: number, rank: number): RetrievedUnit {
  return { unitId, rrfScore: score, keywordRank: rank, semanticRank: null, isVendored: false };
}

test("rerankRetrievedResults explains exact config source selection", async () => {
  const store = await storeWithUnits([
    unit("config", "src/llama/config.ts", "process.env.LLAMA_SERVER_URL", "getLlamaConfig"),
    unit("schema", "src/llama/schema.ts", "LLAMA_SERVER_URL: z.string().url()", "schema"),
    unit("runner", "src/framework/pipeline/runner.ts", "validateConfiguredSourceIds", "runner"),
  ]);

  const { results, diagnostics } = rerankRetrievedResults(
    "Where is LLAMA_SERVER_URL configured and validated?",
    "general_code_question",
    [retrieved("runner", 10, 1), retrieved("config", 1, 2), retrieved("schema", 1, 3)],
    store,
    3,
  );

  assert.deepEqual(
    results.slice(0, 2).map((result) => result.unitId),
    ["config", "schema"],
  );
  assert.ok(diagnostics[0].reasons.some((reason) => reason.includes("exact query")));
});

test("evaluateRetrievalCases reports missing expected files", async () => {
  const store = await storeWithUnits([
    unit("config", "src/llama/config.ts", "process.env.LLAMA_SERVER_URL", "getLlamaConfig"),
    unit("schema", "src/llama/schema.ts", "LLAMA_SERVER_URL: z.string().url()", "schema"),
  ]);

  const [result] = evaluateRetrievalCases(
    [
      {
        name: "llama config",
        query: "Where is LLAMA_SERVER_URL configured and validated?",
        intent: "general_code_question",
        retrieved: [retrieved("config", 1, 1), retrieved("schema", 1, 2)],
        expectedFiles: ["src/llama/config.ts", "src/llama/schema.ts"],
      },
    ],
    store,
  );

  assert.equal(result.passed, true);
  assert.deepEqual(result.missingFiles, []);
});
