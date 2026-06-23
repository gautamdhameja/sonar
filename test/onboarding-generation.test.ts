import assert from "node:assert/strict";
import test from "node:test";
import {
  backfillEmptyBriefingSections,
  sanitizeTruncatedBriefingPart,
  selectOnboardingContext,
  sourceListWithCitations,
} from "../src/generator/onboarding";
import { normalizeInvalidCitations, verifyCitations } from "../src/generator/citation-verifier";
import { graphSourceUnits } from "../src/generator/source-fallback";
import path from "node:path";
import { CodeUnitStore } from "../src/retriever/unit-store";

const fixtureRoot = (...parts: string[]) => path.join(process.cwd(), "test", "fixtures", ...parts);

function unit(filePath: string, startLine = 1, endLine = 10, code = `source for ${filePath}`) {
  return {
    id: `${filePath}:${startLine}-${endLine}`,
    filePath,
    language: filePath.endsWith(".tsx") ? "typescript" : "go",
    kind: "module" as const,
    name: filePath.split("/").at(-1) ?? filePath,
    code,
    startLine,
    endLine,
    parentName: null,
    imports: [],
    docstring: null,
    exportedNames: [],
    calledFunctions: [],
    isVendored: false,
  };
}

test("sanitizeTruncatedBriefingPart removes incomplete trailing fragments and fills missing sections", () => {
  const result = sanitizeTruncatedBriefingPart(
    [
      "### Top User Workflows",
      "Users create notes through the app [src/app.ts:4-18].",
      "*",
      "",
      "### Main Systems And Ownership Areas",
      "The app module owns user actions [src/app.ts:",
    ].join("\n"),
    ["Top User Workflows", "Main Systems And Ownership Areas", "Risks Or Open Questions"],
  );

  assert.match(result, /Users create notes through the app \[src\/app\.ts:4-18\]\./);
  assert.doesNotMatch(result, /\n\*/);
  assert.doesNotMatch(result, /\[src\/app\.ts:$/);
  assert.match(result, /### Main Systems And Ownership Areas\nNot found in provided context/);
  assert.match(result, /### Risks Or Open Questions\nNot found in provided context/);
});

test("backfillEmptyBriefingSections fills empty required sections with cited conservative evidence", () => {
  const brief = [
    "## demo Codebase Briefing",
    "",
    "### Product In One Paragraph",
    "",
    "### Top User Workflows",
    "Not found in provided context.",
    "",
    "### Main Systems And Ownership Areas",
    "- **Content**: Existing supported line [server/router/api/v1/memo_service.go:73-91].",
  ].join("\n");
  const units = [
    unit("cmd/memos/main.go", 1, 36),
    unit("web/src/components/MemoEditor/index.tsx", 1, 21),
    unit("server/router/api/v1/memo_service.go", 73, 91),
  ];

  const backfilled = backfillEmptyBriefingSections(
    brief,
    ["Product In One Paragraph", "Top User Workflows", "Main Systems And Ownership Areas"],
    units,
  );
  const verification = verifyCitations(backfilled, units);

  assert.match(backfilled, /### Product In One Paragraph\n+\s*The selected source evidence shows/);
  assert.match(backfilled, /### Top User Workflows\n+\s*1\. \*\*Primary repository workflow\*\*/);
  assert.match(backfilled, /Existing supported line/);
  assert.equal(verification.valid, true);
});

test("backfillEmptyBriefingSections uses overview docs for product fallback when available", () => {
  const brief = [
    "## click Codebase Briefing",
    "",
    "### Product In One Paragraph",
    "",
    "### Who Uses It And Why",
    "Not found in provided context.",
  ].join("\n");
  const readme = unit(
    "README.md",
    1,
    8,
    [
      "# Click",
      "",
      "Click is a Python package for creating beautiful command line interfaces in a composable way with as little code as necessary.",
      "",
      "It aims to make writing command line tools quick and fun.",
    ].join("\n"),
  );

  const backfilled = backfillEmptyBriefingSections(
    brief,
    ["Product In One Paragraph", "Who Uses It And Why"],
    [readme, unit("src/click/core.py", 1, 20)],
  );
  const verification = verifyCitations(backfilled, [readme]);

  assert.match(backfilled, /Click is a Python package/);
  assert.doesNotMatch(backfilled, /The selected source evidence shows/);
  assert.match(backfilled, /\[README\.md:1-8\]/);
  assert.equal(verification.valid, true);
});

test("selectOnboardingContext keeps true overview docs before narrow docs", () => {
  const readme = unit(
    "README.md",
    1,
    20,
    [
      "# Click",
      "",
      "Click is a Python package for creating beautiful command line interfaces in a composable way with as little code as necessary.",
      "",
      "It aims to make writing command line tools quick and fun.",
    ].join("\n"),
  );
  const narrowDoc = unit(
    "docs/commands.md",
    1,
    20,
    "Command reference documentation explains advanced command and context behavior.",
  );
  const core = unit("src/click/core.py", 1, 200, "def command():\n  pass\n".repeat(80));

  const selected = selectOnboardingContext(
    [narrowDoc, core, readme],
    140,
    "README docs overview purpose product users feature value proposition",
    0.5,
  );

  assert.equal(selected[0]?.filePath, "README.md");
});

test("backfillEmptyBriefingSections prefers memory graph evidence over web-app assumptions", () => {
  const brief = [
    "## hugo Codebase Briefing",
    "",
    "### Product In One Paragraph",
    "",
    "### Codebase Product Map",
    "The core product areas include:",
    "",
    "### Top User Workflows",
    "Not found in provided context.",
  ].join("\n");
  const units = [unit("hugolib/hugo_sites_build.go", 10, 30), unit("tpl/tplimpl/templatestore.go", 4, 20)];
  const graph = {
    projectId: "hugo",
    generatedAt: "2026-06-18T00:00:00.000Z",
    summary: "Hugo graph",
    inspectedFiles: ["hugolib/hugo_sites_build.go", "tpl/tplimpl/templatestore.go"],
    warnings: [],
    nodes: [
      {
        id: "build-workflow",
        type: "workflow" as const,
        label: "Build Workflow",
        summary:
          "Coordinates site building with error handling and progress reporting Evidence: hugolib/hugo_sites_build.go:1-260.",
        confidence: "high" as const,
        sources: [{ filePath: "hugolib/hugo_sites_build.go", startLine: 1, endLine: 260 }],
      },
      {
        id: "template-handling",
        type: "workflow" as const,
        label: "Template Handling",
        summary: "Manages template storage and transformation",
        confidence: "high" as const,
        sources: [{ filePath: "tpl/tplimpl/templatestore.go", startLine: 1, endLine: 260 }],
      },
    ],
    edges: [],
  };
  const backfilled = backfillEmptyBriefingSections(
    brief,
    ["Product In One Paragraph", "Codebase Product Map", "Top User Workflows"],
    units,
    graph,
  );
  const verification = verifyCitations(backfilled, units);

  assert.match(backfilled, /Build Workflow/);
  assert.match(backfilled, /Template Handling/);
  assert.doesNotMatch(backfilled, /The core product areas include:/);
  assert.doesNotMatch(backfilled, /Evidence:/);
  assert.doesNotMatch(backfilled, /backend|API surface|screens|routes/i);
  assert.equal(verification.valid, true);
});

test("graphSourceUnits makes unsupported-language graph evidence citation-checkable", async () => {
  const units = await graphSourceUnits(fixtureRoot("survey-c-project"), {
    projectId: "project-1",
    generatedAt: "2026-06-17T00:00:00.000Z",
    summary: "C project",
    inspectedFiles: ["src/main.c"],
    warnings: [],
    nodes: [
      {
        id: "file-main-c",
        type: "file",
        label: "src/main.c",
        summary: "Main entry point",
        confidence: "high",
        sources: [{ filePath: "src/main.c", startLine: 1, endLine: 12 }],
      },
    ],
    edges: [],
  });

  const verification = verifyCitations("The tool has a C entry point [src/main.c:1-12].", units);
  assert.deepEqual(verification.invalidCitations, []);
});

test("graphSourceUnits rejects graph sources outside inspected repository files", async () => {
  const units = await graphSourceUnits(fixtureRoot("survey-c-project"), {
    projectId: "project-1",
    generatedAt: "2026-06-17T00:00:00.000Z",
    summary: "C project",
    inspectedFiles: ["src/main.c"],
    warnings: [],
    nodes: [
      {
        id: "unsafe",
        type: "file",
        label: "unsafe",
        summary: "Unsafe source should be ignored",
        confidence: "high",
        sources: [{ filePath: "../survey-sparse-docs/README.md", startLine: 1, endLine: 3 }],
      },
      {
        id: "uninspected",
        type: "file",
        label: "uninspected",
        summary: "Uninspected source should be ignored",
        confidence: "high",
        sources: [{ filePath: "src/cache.c", startLine: 1, endLine: 3 }],
      },
    ],
    edges: [],
  });

  assert.deepEqual(units, []);
});

test("sourceListWithCitations canonicalizes unique basename citations", async () => {
  const units = [unit("src/llama/config.ts", 4, 16)];
  const store = new CodeUnitStore();
  await store.loadFromUnits(units);

  const sources = sourceListWithCitations(units, ["config.ts:4-16"], store);

  assert.ok(sources.some((source) => source.filePath === "src/llama/config.ts" && source.lines === "4-16"));
  assert.equal(
    sources.some((source) => source.filePath === "config.ts"),
    false,
  );
});

test("normalizeInvalidCitations maps broad file citations back to supplied context ranges", () => {
  const units = [
    {
      id: "todo-module",
      filePath: "src/components/Todo.jsx",
      language: "javascript",
      kind: "module" as const,
      name: "Todo",
      code: "export default function Todo() {}",
      startLine: 1,
      endLine: 25,
      parentName: null,
      imports: [],
      docstring: null,
      exportedNames: [],
      calledFunctions: [],
      isVendored: false,
    },
  ];
  const answer = "Todo owns task display [src/components/Todo.jsx:1-110].";
  const verification = verifyCitations(answer, units);
  const normalized = normalizeInvalidCitations(answer, units, verification);

  assert.equal(normalized, "Todo owns task display [src/components/Todo.jsx:1-25].");
  assert.deepEqual(verifyCitations(normalized, units).invalidCitations, []);
});
