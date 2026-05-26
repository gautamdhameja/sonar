import test from "node:test";
import assert from "node:assert/strict";
import { buildContextualEmbeddingTexts, enrichUnitsForKeywordIndex } from "../src/indexer/contextual-text";
import { CodeUnit } from "../src/parser/types";

function unit(id: string, overrides: Partial<CodeUnit> = {}): CodeUnit {
  return {
    id,
    filePath: "src/llama/config.ts",
    language: "typescript",
    kind: "function",
    name: id,
    code: `export function ${id}() {}`,
    startLine: 1,
    endLine: 1,
    parentName: null,
    imports: ["import { LlamaEnvSchema } from './schema.js';"],
    docstring: null,
    exportedNames: [id],
    calledFunctions: [],
    isVendored: false,
    ...overrides,
  };
}

test("buildContextualEmbeddingTexts adds deterministic file and neighbor context", () => {
  const [text] = buildContextualEmbeddingTexts([unit("getLlamaConfig"), unit("loadLlamaEnv")]);

  assert.match(text, /File: src\/llama\/config.ts/);
  assert.match(text, /Directory role: local model integration/);
  assert.match(text, /Imports: import/);
  assert.match(text, /Sibling symbols: loadLlamaEnv/);
  assert.match(text, /Code:/);
});

test("enrichUnitsForKeywordIndex adds contextualText without mutating code", () => {
  const [enriched] = enrichUnitsForKeywordIndex([unit("getLlamaConfig")]);

  assert.equal(enriched.code, "export function getLlamaConfig() {}");
  assert.match(enriched.contextualText, /Unit: function getLlamaConfig/);
});
