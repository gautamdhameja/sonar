import test from "node:test";
import assert from "node:assert/strict";
import { CodeUnit } from "../src/parser/types";
import { CodeUnitStore } from "../src/retriever/unit-store";
import { onboardingRetrieval } from "../src/retriever/onboarding-retriever";

function unit(id: string, overrides: Partial<CodeUnit> = {}): CodeUnit {
  return {
    id,
    filePath: `src/${id}.ts`,
    language: "typescript",
    kind: "module",
    name: id,
    code: `export const ${id} = true;`,
    startLine: 1,
    endLine: 4,
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

test("onboardingRetrieval favors docs, app boundaries, and product workflows", async () => {
  const store = await storeWithUnits([
    unit("readme", {
      id: "readme",
      filePath: "README.md",
      language: "markdown",
      code: "# Acme\nA product for teams to share diagrams and collaborate offline.",
    }),
    unit("app", {
      id: "app",
      filePath: "src/App.tsx",
      name: "App",
      code: "export function App() { return <ShareDialog />; }",
    }),
    unit("local", {
      id: "local",
      filePath: "src/data/LocalData.ts",
      name: "LocalData",
      code: "export function save() { localStorage.setItem('elements', '[]'); }",
    }),
    unit("test", {
      id: "test",
      filePath: "tests/App.test.tsx",
      code: "test('renders', () => true);",
    }),
  ]);

  const result = onboardingRetrieval(store, {
    query: "Create a codebase briefing for a product manager focused on sharing, collaboration, and offline saving.",
    topK: 3,
  });

  assert.deepEqual(
    result.retrieved.map((item) => item.unitId),
    ["readme", "local", "app"],
  );
  assert.ok(result.diagnostics[0].reasons.includes("overview documentation"));
  assert.equal(
    result.retrieved.some((item) => item.unitId === "test"),
    false,
  );
});

test("onboardingRetrieval penalizes giant modules in favor of targeted workflow files", async () => {
  const store = await storeWithUnits([
    unit("giant", {
      id: "giant",
      filePath: "src/App.tsx",
      name: "App",
      startLine: 1,
      endLine: 2000,
      code: "collaboration ".repeat(3000),
    }),
    unit("portal", {
      id: "portal",
      filePath: "src/collab/Portal.tsx",
      name: "broadcastScene",
      kind: "function",
      code: "socket.emit('client-broadcast', encryptedBuffer, iv);",
    }),
  ]);

  const result = onboardingRetrieval(store, {
    query: "Explain collaboration for onboarding.",
    topK: 2,
  });

  assert.equal(result.retrieved[0].unitId, "portal");
});
