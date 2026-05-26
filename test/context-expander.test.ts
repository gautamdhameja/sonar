import test from "node:test";
import assert from "node:assert/strict";
import { expandContext } from "../src/context/expander";
import { CodeUnit } from "../src/parser/types";
import { CodeUnitStore } from "../src/retriever/unit-store";

function unit(id: string, overrides: Partial<CodeUnit> = {}): CodeUnit {
  return {
    id,
    filePath: "src/a.ts",
    language: "typescript",
    kind: "function",
    name: id,
    code: `export function ${id}() {}`,
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

async function storeWithUnits(units: CodeUnit[]): Promise<CodeUnitStore> {
  const store = new CodeUnitStore();
  await store.loadFromUnits(units);
  return store;
}

test("expandContext only adds methods from the retrieved class file", async () => {
  const store = await storeWithUnits([
    unit("client-a", { kind: "class", name: "Client", filePath: "src/a.ts" }),
    unit("connect-a", { kind: "method", name: "connect", parentName: "Client", filePath: "src/a.ts" }),
    unit("client-b", { kind: "class", name: "Client", filePath: "src/b.ts" }),
    unit("connect-b", { kind: "method", name: "connect", parentName: "Client", filePath: "src/b.ts" }),
  ]);

  const expanded = expandContext(["client-a"], store);

  assert.equal(expanded.some((item) => item.id === "connect-a"), true);
  assert.equal(expanded.some((item) => item.id === "connect-b"), false);
});

test("expandContext follows terminal member call names", async () => {
  const store = await storeWithUnits([
    unit("run", { calledFunctions: ["client.connect", "connect"] }),
    unit("connect", { name: "connect" }),
  ]);

  const expanded = expandContext(["run"], store);

  assert.equal(expanded.some((item) => item.id === "connect"), true);
});
