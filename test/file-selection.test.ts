import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { selectSurveyFiles } from "../src/survey/file-selection";
import { emptyMemoryGraph } from "../src/survey/memory-graph";
import { buildRepositoryInventory } from "../src/survey/repository-inventory";

const fixtureRoot = (...parts: string[]) => path.join(process.cwd(), "test", "fixtures", ...parts);

test("selectSurveyFiles honors known requested files and rejects missing paths", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-c-project"));
  const selection = selectSurveyFiles(
    inventory,
    emptyMemoryGraph("project-1"),
    [
      { filePath: "missing.c", priority: 100 },
      { filePath: "src/main.c", priority: 90 },
    ],
    { maxFilesPerIteration: 2, maxFilesTotal: 3 },
  );

  assert.equal(selection.selected[0].filePath, "src/main.c");
  assert.ok(selection.rejected.some((item) => item.filePath === "missing.c" && /not found/.test(item.reason)));
});

test("selectSurveyFiles skips already inspected files and falls back to inventory candidates", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-c-project"));
  const graph = emptyMemoryGraph("project-1");
  graph.inspectedFiles = ["src/main.c"];

  const selection = selectSurveyFiles(inventory, graph, [{ filePath: "src/main.c", priority: 100 }], {
    maxFilesPerIteration: 2,
    maxFilesTotal: 3,
  });

  assert.ok(selection.rejected.some((item) => item.filePath === "src/main.c" && /already inspected/.test(item.reason)));
  assert.ok(selection.selected.some((file) => file.filePath === "src/cache.c"));
});

test("selectSurveyFiles reserves first-pass space for documentation context and code evidence", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-doc-context"));
  const selection = selectSurveyFiles(inventory, emptyMemoryGraph("project-1"), [], {
    maxFilesPerIteration: 4,
    maxFilesTotal: 8,
  });
  const selectedPaths = selection.selected.map((file) => file.filePath);

  assert.ok(selectedPaths.some((filePath) => filePath.endsWith("README.md") || filePath.startsWith("docs/")));
  assert.ok(selectedPaths.some((filePath) => filePath.endsWith(".ts")));
  assert.ok(selection.selected.filter((file) => file.documentation).length <= 2);
});

test("selectSurveyFiles keeps important large files for bounded excerpting", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "sonar-large-survey-"));
  await mkdir(path.join(repoRoot, "src"), { recursive: true });
  try {
    const largeBody = Array.from({ length: 1800 }, (_, index) => `func step${index}() {}`).join("\n");
    await writeFile(path.join(repoRoot, "src", "server.go"), `package main\n\nfunc main() {}\n${largeBody}`);

    const inventory = await buildRepositoryInventory(repoRoot);
    const selection = selectSurveyFiles(
      inventory,
      emptyMemoryGraph("project-1"),
      [{ filePath: "src/server.go", priority: 100 }],
      { maxFilesPerIteration: 1, maxFilesTotal: 1 },
    );

    assert.equal(selection.selected[0]?.filePath, "src/server.go");
    assert.equal(
      selection.rejected.some((item) => /larger than survey file budget/.test(item.reason)),
      false,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
