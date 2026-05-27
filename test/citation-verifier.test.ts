import test from "node:test";
import assert from "node:assert/strict";
import { verifyCitations } from "../src/generator/citation-verifier";
import { CodeUnit } from "../src/parser/types";

const unit: CodeUnit = {
  id: "unit-1",
  filePath: "src/llama/config.ts",
  language: "typescript",
  kind: "function",
  name: "getLlamaConfig",
  code: "export function getLlamaConfig() {}",
  startLine: 4,
  endLine: 16,
  parentName: null,
  imports: [],
  docstring: null,
  exportedNames: ["getLlamaConfig"],
  calledFunctions: [],
  isVendored: false,
};

test("verifyCitations accepts cited claims with real source citations", () => {
  const result = verifyCitations(
    "The configuration function reads and validates the local model server URL before returning runtime settings [src/llama/config.ts:4-16].",
    [unit],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.invalidCitations, []);
  assert.deepEqual(result.uncitedClaims, []);
});

test("verifyCitations rejects citations outside the supplied line range", () => {
  const result = verifyCitations("The configuration function validates runtime settings [src/llama/config.ts:4-999].", [
    unit,
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidCitations, ["src/llama/config.ts:4-999"]);
});

test("verifyCitations rejects broad file-only citations", () => {
  const result = verifyCitations("The configuration function validates runtime settings [src/llama/config.ts].", [
    unit,
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidCitations, ["src/llama/config.ts"]);
});

test("verifyCitations rejects broad summary labels", () => {
  const result = verifyCitations("The workflow validates local model configuration before execution [Data Flow].", [
    unit,
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidCitations, ["Data Flow"]);
});

test("verifyCitations flags uncited factual claims", () => {
  const result = verifyCitations(
    "The configuration function validates the local model URL before returning runtime settings.",
    [unit],
  );

  assert.equal(result.valid, false);
  assert.equal(result.uncitedClaims.length, 1);
});

test("verifyCitations ignores markdown links as citations", () => {
  const result = verifyCitations(
    "The README links to [documentation](https://example.com), but this implementation claim is still uncited.",
    [unit],
  );

  assert.deepEqual(result.citations, []);
  assert.equal(result.uncitedClaims.length, 1);
});
