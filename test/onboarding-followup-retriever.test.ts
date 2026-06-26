import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "../src/context/token-budget";
import { CodeUnit } from "../src/parser/types";
import { CodeUnitStore } from "../src/retriever/unit-store";
import { classifyOnboardingFollowup, retrieveOnboardingFollowup } from "../src/retriever/onboarding-followup-retriever";
import { followupContextUnits, packFollowupContextUnits } from "../src/generator/onboarding-followup";
import type { OnboardingSession } from "../src/db/project-repo";
import { DEFAULT_PERSONA } from "../src/persona/types";

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
  });

  assert.equal(result.intent, "workflow");
  assert.equal(result.contextUnits[0].filePath, "src/collab/Portal.tsx");
  assert.equal(result.diagnostics[0].filePath, "src/collab/Portal.tsx");
});

test("followupContextUnits keeps saved briefing sources valid for follow-up citations", async () => {
  const readme = unit("readme", {
    id: "readme",
    filePath: "README.md",
    name: "Readme",
    code: [
      "Click is a Python package for creating command line interfaces.",
      "This line is inside the cited range.",
      "This line is outside the cited range.",
    ].join("\n"),
    startLine: 1,
    endLine: 3,
  });
  const core = unit("core", {
    id: "core",
    filePath: "src/click/core.py",
    name: "core",
    code: "def command(): pass",
    startLine: 1,
    endLine: 23,
  });
  const store = await storeWithUnits([readme, core]);
  const session = {
    id: "session-1",
    projectId: "project-1",
    repoName: "click",
    audience: null,
    focus: [],
    persona: DEFAULT_PERSONA,
    brief: "Click creates command line interfaces [README.md:1-11].",
    sourceFiles: ["README.md"],
    sources: [{ filePath: "README.md", name: "Readme", kind: "module", lines: "1-2" }],
    citationVerification: null,
    retrievalTime: 0,
    generationTime: 0,
    generationTruncated: false,
    rollingSummary: null,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
  } as OnboardingSession;

  const context = followupContextUnits(session, [core], store);

  assert.deepEqual(
    context.map((item) => item.filePath),
    ["README.md", "src/click/core.py"],
  );
  assert.equal(
    context[0]?.code,
    "Click is a Python package for creating command line interfaces.\nThis line is inside the cited range.",
  );
});

test("packFollowupContextUnits bounds saved briefing sources after merging", async () => {
  const longText = Array.from(
    { length: 420 },
    (_, index) => `Line ${index + 1}: collaboration persistence sharing detail.`,
  ).join("\n");
  const readme = unit("readme", {
    id: "readme",
    filePath: "README.md",
    name: "Readme",
    code: longText,
    startLine: 1,
    endLine: 420,
  });
  const guide = unit("guide", {
    id: "guide",
    filePath: "docs/guide.md",
    name: "Guide",
    code: longText,
    startLine: 1,
    endLine: 420,
  });
  const core = unit("core", {
    id: "core",
    filePath: "src/collab/core.ts",
    name: "core",
    code: "export function share() { return 'collaboration persistence'; }",
    startLine: 1,
    endLine: 12,
  });
  const store = await storeWithUnits([readme, guide, core]);
  const session = {
    id: "session-1",
    projectId: "project-1",
    repoName: "demo",
    audience: null,
    focus: [],
    persona: DEFAULT_PERSONA,
    brief: "Demo briefing [README.md:1-420] [docs/guide.md:1-420].",
    sourceFiles: ["README.md", "docs/guide.md"],
    sources: [
      { filePath: "README.md", name: "Readme", kind: "module", lines: "1-420" },
      { filePath: "docs/guide.md", name: "Guide", kind: "module", lines: "1-420" },
    ],
    citationVerification: null,
    retrievalTime: 0,
    generationTime: 0,
    generationTruncated: false,
    rollingSummary: null,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
  } as OnboardingSession;

  const context = packFollowupContextUnits(session, [core], store, {
    query: "How does collaboration sharing work?",
    maxTokens: 320,
  });

  assert.ok(context.some((item) => item.filePath === "README.md"));
  assert.ok(context.some((item) => item.filePath === "src/collab/core.ts"));
  assert.ok(estimateTokens(context.map((item) => item.code).join("\n\n")) <= 320);
});
