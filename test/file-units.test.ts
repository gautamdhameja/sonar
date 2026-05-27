import test from "node:test";
import assert from "node:assert/strict";
import { ensureFileModuleUnits } from "../src/parser/file-units";
import { CodeUnit } from "../src/parser/types";

function unit(id: string, overrides: Partial<CodeUnit> = {}): CodeUnit {
  return {
    id,
    filePath: "src/orders.ts",
    language: "typescript",
    kind: "function",
    name: id,
    code: `export function ${id}() { return true; }`,
    startLine: 2,
    endLine: 4,
    parentName: null,
    imports: ["import { db } from './db.js';"],
    docstring: null,
    exportedNames: [id],
    calledFunctions: ["db.insert"],
    isVendored: false,
    ...overrides,
  };
}

test("ensureFileModuleUnits adds whole-file anchors when missing", () => {
  const units = ensureFileModuleUnits([unit("createOrder"), unit("cancelOrder", { startLine: 6, endLine: 8 })]);
  const module = units.find((candidate) => candidate.kind === "module");

  assert.ok(module);
  assert.equal(module.filePath, "src/orders.ts");
  assert.equal(module.name, "orders");
  assert.match(module.code, /createOrder/);
  assert.match(module.code, /cancelOrder/);
});

test("ensureFileModuleUnits does not duplicate existing module anchors", () => {
  const units = ensureFileModuleUnits([
    unit("orders", { kind: "module", name: "orders", startLine: 1, endLine: 10 }),
    unit("createOrder"),
  ]);

  assert.equal(units.filter((candidate) => candidate.kind === "module").length, 1);
});

test("ensureFileModuleUnits uses original source when available", () => {
  const source = [
    "import { db } from './db.js';",
    "const TABLE = 'orders';",
    "export function createOrder() {",
    "  return db.insert(TABLE);",
    "}",
  ].join("\n");
  const units = ensureFileModuleUnits(
    [unit("createOrder", { startLine: 3, endLine: 5 })],
    new Map([["src/orders.ts", source]]),
  );
  const module = units.find((candidate) => candidate.kind === "module");

  assert.ok(module);
  assert.match(module.code, /const TABLE = 'orders'/);
  assert.equal(module.endLine, 5);
});
