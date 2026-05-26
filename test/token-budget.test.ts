import test from "node:test";
import assert from "node:assert/strict";
import { trimToTokenBudget, truncateLargeUnits } from "../src/context/token-budget";
import { CodeUnit } from "../src/parser/types";

function unit(id: string, code: string): CodeUnit {
  return {
    id,
    filePath: `${id}.ts`,
    language: "typescript",
    kind: "function",
    name: id,
    code,
    startLine: 1,
    endLine: 1,
    parentName: null,
    imports: [],
    docstring: null,
    exportedNames: [],
    calledFunctions: [],
    isVendored: false,
  };
}

test("trimToTokenBudget truncates oversized units and preserves order", () => {
  const result = trimToTokenBudget([
    unit("large", "x".repeat(1200)),
    unit("small", "return true;"),
  ], 100);

  assert.equal(result.length, 2);
  assert.equal(result[0].id, "large");
  assert.match(result[0].code, /truncated/);
  assert.equal(result[1].id, "small");
});

test("trimToTokenBudget drops later units when the budget is full", () => {
  const result = trimToTokenBudget([
    unit("first", "x".repeat(90)),
    unit("second", "x".repeat(90)),
    unit("third", "x".repeat(90)),
  ], 40);

  assert.deepEqual(result.map((item) => item.id), ["first"]);
});

test("truncateLargeUnits updates endLine to the visible snippet range", () => {
  const result = truncateLargeUnits([
    unit("large", Array.from({ length: 50 }, (_, index) => `line${index}`).join("\n")),
  ], 10, 0.5);

  assert.equal(result[0].startLine, 1);
  assert.ok(result[0].endLine < 50);
  assert.match(result[0].code, /truncated/);
});
