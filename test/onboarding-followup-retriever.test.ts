import test from "node:test";
import assert from "node:assert/strict";
import { CodeUnit } from "../src/parser/types";
import { CodeUnitStore } from "../src/retriever/unit-store";
import { classifyOnboardingFollowup, retrieveOnboardingFollowup } from "../src/retriever/onboarding-followup-retriever";

function unit(id: string, overrides: Partial<CodeUnit> = {}): CodeUnit {
  return {
    id,
    filePath: `src/${id}.ts`,
    language: "typescript",
    kind: "module",
    name: id,
    code: `export const ${id} = true;`,
    startLine: 1,
    endLine: 8,
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

test("classifyOnboardingFollowup recognizes common onboarding follow-up shapes", () => {
  assert.equal(classifyOnboardingFollowup("What does portal mean here?"), "glossary");
  assert.equal(classifyOnboardingFollowup("How does collaboration sharing flow work?"), "workflow");
  assert.equal(classifyOnboardingFollowup("Where is sharing implemented?"), "source_location");
  assert.equal(classifyOnboardingFollowup("What risks should I ask engineering about?"), "risk_questions");
});

test("retrieveOnboardingFollowup boosts files cited by the onboarding brief", async () => {
  const store = await storeWithUnits([
    unit("portal", {
      id: "portal",
      filePath: "src/collab/Portal.tsx",
      name: "Portal",
      code: "export class Portal { open(socket: WebSocket) { socket.send('scene'); } }",
      startLine: 1,
      endLine: 40,
    }),
    unit("share-dialog", {
      id: "share-dialog",
      filePath: "src/ui/ShareDialog.tsx",
      name: "ShareDialog",
      code: "export function ShareDialog() { return 'share collaboration link'; }",
    }),
    unit("unrelated", {
      id: "unrelated",
      filePath: "src/math/geometry.ts",
      name: "Geometry",
      code: "export function rotate() { return 90; }",
    }),
  ]);

  const result = await retrieveOnboardingFollowup({
    query: "How does the sharing workflow work?",
    projectId: "project-1",
    store,
    sourceFiles: ["src/collab/Portal.tsx"],
    useVector: false,
  });

  assert.equal(result.intent, "workflow");
  assert.equal(result.contextUnits[0].filePath, "src/collab/Portal.tsx");
  assert.equal(result.diagnostics[0].filePath, "src/collab/Portal.tsx");
});
