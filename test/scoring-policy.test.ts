import test from "node:test";
import assert from "node:assert/strict";
import { CodeUnit } from "../src/parser/types";
import {
  ONBOARDING_WORKFLOW_TERMS,
  hasExactEvidenceMatch,
  testFilePenalty,
  workflowEvidenceBonus,
} from "../src/retriever/scoring-policy";

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
    unit("workflow", {
      filePath: "src/workflows/pipeline.ts",
      code: "collectSources(); classifyItems(); scoreItems(); saveItems();",
    }),
    "How does the pipeline collect, classify, score, and save items?",
    "reranker",
  );

  assert.ok(result.score > 0);
  assert.ok(result.reasons.includes("workflow entry file"));
  assert.ok(result.reasons.includes("classification stage match"));
  assert.ok(result.reasons.includes("persistence stage match"));
});

test("workflowEvidenceBonus does not reward removed foreign-repo tokens", () => {
  const socketOnly = workflowEvidenceBonus(
    unit("socket", {
      filePath: "src/socket.ts",
      code: "export function socket() { return 'hacker arxiv digest'; }",
    }),
    "Create an onboarding overview",
    "reranker",
  );
  const collectionQuery = workflowEvidenceBonus(
    unit("foreign", {
      filePath: "src/foreign.ts",
      code: "export const arxivHackerNewsSearch = true;",
    }),
    "How does collection work?",
    "reranker",
  );

  assert.equal(socketOnly.score, 0);
  assert.equal(collectionQuery.score, 0);
  assert.equal(ONBOARDING_WORKFLOW_TERMS.includes("socket" as never), false);
  assert.equal(ONBOARDING_WORKFLOW_TERMS.includes("tree-sitter" as never), false);
});

test("testFilePenalty only demotes tests when tests are not requested", () => {
  const testUnit = unit("config-test", { filePath: "test/config.test.ts" });
  const pythonTestUnit = unit("python-config-test", { filePath: "src/llama/test_config.py" });

  assert.equal(testFilePenalty(testUnit, "Create an onboarding overview", 30).score, -30);
  assert.equal(testFilePenalty(pythonTestUnit, "Create an onboarding overview", 30).score, -30);
  assert.equal(testFilePenalty(testUnit, "How is config validated in tests?", 30).score, 0);
});
