import test from "node:test";
import assert from "node:assert/strict";
import { extractDependencyEdges } from "../src/parser/dependency-resolver";
import { CodeUnit } from "../src/parser/types";

function unit(id: string, filePath: string, imports: string[]): CodeUnit {
  return {
    id,
    filePath,
    language: "typescript",
    kind: "module",
    name: filePath,
    code: imports.join("\n"),
    startLine: 1,
    endLine: imports.length,
    parentName: null,
    imports,
    docstring: null,
    exportedNames: [],
    calledFunctions: [],
    isVendored: false,
  };
}

test("extractDependencyEdges resolves TypeScript source for .js import specifiers", () => {
  const edges = extractDependencyEdges([
    unit("config", "src/llama/config.ts", [
      "import { LlamaConfigSchema } from './schema.js';",
      "import type { LlamaConfig } from './schema.js';",
    ]),
    unit("schema", "src/llama/schema.ts", []),
  ]);

  assert.deepEqual(edges.map((edge) => `${edge.sourceFile}->${edge.targetFile}`), [
    "src/llama/config.ts->src/llama/schema.ts",
  ]);
  assert.equal(edges[0].edgeType, "imports");
});

test("extractDependencyEdges resolves directory index and export-from imports", () => {
  const edges = extractDependencyEdges([
    unit("main", "src/main.ts", [
      "export { run } from './framework/pipeline/index.js';",
      "import './setup.js';",
    ]),
    unit("index", "src/framework/pipeline/index.ts", []),
    unit("setup", "src/setup.ts", []),
  ]);

  assert.deepEqual(new Set(edges.map((edge) => edge.targetFile)), new Set([
    "src/framework/pipeline/index.ts",
    "src/setup.ts",
  ]));
});

test("extractDependencyEdges resolves common src aliases", () => {
  const edges = extractDependencyEdges([
    unit("main", "src/main.ts", [
      "import { getLlamaConfig } from '@/llama/config.js';",
      "import { runPipeline } from 'src/framework/pipeline/runner.js';",
    ]),
    unit("config", "src/llama/config.ts", []),
    unit("runner", "src/framework/pipeline/runner.ts", []),
  ]);

  assert.deepEqual(new Set(edges.map((edge) => edge.targetFile)), new Set([
    "src/llama/config.ts",
    "src/framework/pipeline/runner.ts",
  ]));
});
