import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildFileObservationPrompt,
  buildGraphConsolidationPrompt,
  buildGraphValidationPrompt,
  buildSurveyPlanningPrompt,
} from "../src/generator/repository-survey-prompt";
import { buildRepositoryInventory } from "../src/survey/repository-inventory";
import { emptyMemoryGraph } from "../src/survey/memory-graph";

const fixtureRoot = (...parts: string[]) => path.join(process.cwd(), "test", "fixtures", ...parts);

test("buildSurveyPlanningPrompt asks for diverse inspection targets and uncertainty", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-misleading-names"));
  const prompt = buildSurveyPlanningPrompt({ repoName: "Misleading", inventory });

  assert.match(prompt.system, /not writing the final briefing/i);
  assert.match(prompt.system, /documentation, filenames, README text, and framework conventions as hypotheses/i);
  assert.match(prompt.user, /src\/banana\.ts/);
  assert.match(prompt.user, /different directories/i);
  assert.match(prompt.user, /uncertainty/i);
  assert.match(prompt.user, /"files"/);
  assert.match(prompt.user, /"questions"/);
});

test("buildSurveyPlanningPrompt exposes documentation context sources separately from code candidates", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-doc-context"));
  const prompt = buildSurveyPlanningPrompt({ repoName: "Ledger", inventory });

  assert.match(prompt.system, /repository README files, docs\/documents directories, module-level READMEs/i);
  assert.match(prompt.system, /hypotheses to verify against code evidence/i);
  assert.match(prompt.user, /Documentation And Context Sources/);
  assert.match(prompt.user, /docs\/architecture\.md/);
  assert.match(prompt.user, /src\/importer\/README\.md/);
  assert.match(prompt.user, /src\/importer\/loader\.ts/);
  assert.match(prompt.user, /Do not inspect docs alone/i);
});

test("buildFileObservationPrompt requires graph observations with evidence", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-c-project"));
  const prompt = buildFileObservationPrompt({
    repoName: "C Tool",
    inventory,
    graph: emptyMemoryGraph("project-1"),
    files: [
      {
        filePath: "src/main.c",
        language: "C",
        startLine: 1,
        endLine: 12,
        text: "int main(int argc, char **argv) { return argc > 1 ? 0 : 1; }",
        signals: ["entry_point", "cli"],
      },
    ],
  });

  assert.match(prompt.system, /source analyst/i);
  assert.match(prompt.system, /Every node and edge must cite/i);
  assert.match(prompt.user, /responsibilities, inputs, outputs, state, boundaries/i);
  assert.match(prompt.user, /"confidence": "low\|medium\|high"/);
  assert.match(prompt.user, /src\/main\.c:1-12/);
  assert.match(prompt.user, /Signals: entry_point, cli/);
});

test("buildGraphConsolidationPrompt asks for a compact local-model graph", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-c-project"));
  const graph = emptyMemoryGraph("project-1");
  graph.summary = "Observed source-backed command-line behavior.";
  graph.nodes = [
    {
      id: "file-main-c",
      type: "file",
      label: "src/main.c",
      summary: "Entry point reads command-line arguments and coordinates file processing.",
      confidence: "high",
      sources: [{ filePath: "src/main.c", startLine: 1, endLine: 12 }],
    },
  ];

  const prompt = buildGraphConsolidationPrompt({ repoName: "C Tool", inventory, graph });

  assert.match(prompt.system, /compact source-backed memory graph/i);
  assert.match(prompt.system, /at most 12 nodes, at most 8 edges/i);
  assert.match(prompt.user, /Compact Inventory/);
  assert.doesNotMatch(prompt.user, /Candidate Files/);
  assert.match(prompt.user, /file-main-c/);
  assert.match(prompt.user, /"projectId"/);
  assert.match(prompt.user, /"sources": \[\{ "filePath"/);
});

test("buildGraphValidationPrompt asks for a small source-backed graph patch", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-c-project"));
  const graph = emptyMemoryGraph("project-1");
  graph.summary = "Observed source-backed command-line behavior.";
  graph.inspectedFiles = ["src/main.c", "src/cache.c"];
  graph.nodes = [
    {
      id: "file-main-c",
      type: "file",
      label: "src/main.c",
      summary: "Entry point reads command-line arguments and coordinates file processing.",
      confidence: "high",
      sources: [{ filePath: "src/main.c", startLine: 1, endLine: 12 }],
    },
  ];

  const prompt = buildGraphValidationPrompt({
    repoName: "C Tool",
    inventory,
    graph,
    files: [
      {
        filePath: "src/cache.c",
        language: "C",
        startLine: 1,
        endLine: 8,
        text: 'void remember_last_run(const char *path) { FILE *state = fopen(path, "a"); }',
        signals: ["file_io", "state"],
      },
    ],
  });

  assert.match(prompt.system, /memory graph auditor/i);
  assert.match(prompt.system, /small graph patch/i);
  assert.match(prompt.system, /Do not repeat unchanged graph nodes/i);
  assert.match(prompt.user, /src\/cache\.c:1-8/);
  assert.match(prompt.user, /misses source-backed central behavior/i);
  assert.match(prompt.user, /Signals: file_io, state/);
});
