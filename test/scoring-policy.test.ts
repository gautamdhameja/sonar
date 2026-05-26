import test from "node:test";
import assert from "node:assert/strict";
import { CodeUnit } from "../src/parser/types";
import { hasExactEvidenceMatch, testFilePenalty, workflowEvidenceBonus } from "../src/retriever/scoring-policy";

function unit(id: string, overrides: Partial<CodeUnit> = {}): CodeUnit {
  return {
    id,
    filePath: `src/${id}.ts`,
    language: "typescript",
    kind: "module",
    name: id,
    code: `export const ${id} = true;`,
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

test("hasExactEvidenceMatch matches explicit file paths and exact code needles", () => {
  assert.equal(
    hasExactEvidenceMatch(
      unit("config", { filePath: "src/llama/config.ts", code: "const serverUrl = process.env.LLAMA_SERVER_URL;" }),
      ["llama/config.ts"],
      [],
    ),
    true,
  );
  assert.equal(
    hasExactEvidenceMatch(
      unit("schema", { filePath: "src/llama/schema.ts", code: "LLAMA_SERVER_URL: z.string().url()" }),
      [],
      ["llama_server_url"],
    ),
    true,
  );
});

test("workflowEvidenceBonus rewards pipeline stage evidence with diagnostics", () => {
  const result = workflowEvidenceBonus(
    unit("daily", {
      filePath: "src/daily/pipeline.ts",
      code: "collectCandidates(); classifyCandidates(); scoreCandidates(); saveCandidates();",
    }),
    "How does the daily pipeline collect, classify, score, and save candidates?",
    "reranker",
  );

  assert.ok(result.score > 0);
  assert.ok(result.reasons.includes("daily pipeline file"));
  assert.ok(result.reasons.includes("classification stage match"));
  assert.ok(result.reasons.includes("persistence stage match"));
});

test("testFilePenalty only demotes tests when tests are not requested", () => {
  const testUnit = unit("config-test", { filePath: "test/config.test.ts" });

  assert.equal(testFilePenalty(testUnit, "Create an onboarding overview", 30).score, -30);
  assert.equal(testFilePenalty(testUnit, "How is config validated in tests?", 30).score, 0);
});
