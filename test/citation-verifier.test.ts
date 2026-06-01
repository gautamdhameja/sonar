import test from "node:test";
import assert from "node:assert/strict";
import { removeUncitedClaims, verifyCitations } from "../src/generator/citation-verifier";
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

test("verifyCitations expands combined citation ranges", () => {
  const result = verifyCitations(
    "The configuration logic reads one setting and validates another [src/llama/config.ts:4-8, src/llama/config.ts:9-12].",
    [{ ...unit, startLine: 4, endLine: 12 }],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.citations, ["src/llama/config.ts:4-8", "src/llama/config.ts:9-12"]);
});

test("verifyCitations expands repeated ranges for the same file", () => {
  const result = verifyCitations(
    "The configuration logic reads one setting and validates another [src/llama/config.ts:4-8, 9-12].",
    [{ ...unit, startLine: 4, endLine: 12 }],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.citations, ["src/llama/config.ts:4-8", "src/llama/config.ts:9-12"]);
});

test("verifyCitations accepts bare file-line citations from small local models", () => {
  const result = verifyCitations(
    "The function `getLlamaConfig` in src/llama/config.ts:4-16 retrieves the value from the environment.",
    [unit],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.citations, ["src/llama/config.ts:4-16"]);
  assert.deepEqual(result.uncitedClaims, []);
});

test("verifyCitations accepts unambiguous line-only citations from small local models", () => {
  const result = verifyCitations("The function reads local storage [4-16].", [unit]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.invalidCitations, []);
});

test("verifyCitations rejects ambiguous line-only citations", () => {
  const result = verifyCitations("The function reads local storage [4-16].", [
    unit,
    { ...unit, id: "unit-2", filePath: "src/other.ts" },
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidCitations, ["4-16"]);
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

test("verifyCitations ignores where-to-look-next navigation guidance", () => {
  const result = verifyCitations(
    "For local storage logic: Look at `src/client/api/index.ts`. This file contains the core functions for saving and retrieving data.",
    [unit],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.uncitedClaims, []);
});

test("verifyCitations allows unsupported-context gap statements without citations", () => {
  const result = verifyCitations(
    "The provided context does not contain the runtime validation code. To answer this completely, the missing implementation would be needed. To answer this, the code that performs the validation would need to be provided. To answer this question, the code would need to include validation logic.",
    [unit],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.uncitedClaims, []);
});

test("verifyCitations ignores markdown links as citations", () => {
  const result = verifyCitations(
    "The README links to [documentation](https://example.com), but this implementation claim is still uncited.",
    [unit],
  );

  assert.deepEqual(result.citations, []);
  assert.equal(result.uncitedClaims.length, 1);
});

test("removeUncitedClaims removes exact unsupported lines", () => {
  const answer = [
    "Supported claim [src/llama/config.ts:4-16].",
    "* **Server:** The server handles authenticated data synchronization.",
  ].join("\n");
  const verification = verifyCitations(answer, [unit]);

  const scrubbed = removeUncitedClaims(answer, verification);

  assert.equal(scrubbed, "Supported claim [src/llama/config.ts:4-16].");
  assert.equal(verifyCitations(scrubbed, [unit]).valid, true);
});
