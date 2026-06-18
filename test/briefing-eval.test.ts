import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { evaluateMemoryGraphCoverage } from "../src/eval/briefing-eval";
import { MemoryGraph } from "../src/survey/memory-graph";
import { buildRepositoryInventory } from "../src/survey/repository-inventory";

const fixtureRoot = (...parts: string[]) => path.join(process.cwd(), "test", "fixtures", ...parts);

test("survey regression fixtures expose source signals even with sparse docs", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-sparse-docs"));
  const core = inventory.files.find((file) => file.filePath === "src/core.ts");

  assert.ok(core);
  assert.ok(core.signals.some((signal) => signal.kind === "file_io"));
  assert.ok(core.signals.some((signal) => signal.kind === "state"));
  assert.ok(inventory.candidateFiles.some((file) => file.filePath === "src/core.ts"));
});

test("survey regression fixtures expose enterprise-style boundaries without manifests", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-enterprise-service"));
  const worker = inventory.files.find((file) => file.filePath === "src/worker.go");

  assert.ok(worker);
  assert.equal(worker.language, "Go");
  assert.ok(worker.signals.some((signal) => signal.kind === "network"));
  assert.ok(worker.signals.some((signal) => signal.kind === "config"));
  assert.ok(worker.signals.some((signal) => signal.kind === "logging"));
});

test("evaluateMemoryGraphCoverage scores structural briefing readiness", () => {
  const graph: MemoryGraph = {
    projectId: "project-eval",
    generatedAt: "2026-06-17T00:00:00.000Z",
    summary: "Imports customer records and writes an active paid-customer export.",
    inspectedFiles: ["src/core.ts"],
    warnings: ["README is sparse."],
    nodes: [
      {
        id: "file-core",
        type: "file",
        label: "src/core.ts",
        summary: "Source file with customer import logic.",
        confidence: "high",
        sources: [{ filePath: "src/core.ts", startLine: 1, endLine: 18 }],
      },
      {
        id: "workflow-import",
        type: "workflow",
        label: "Customer import",
        summary: "Reads customer rows, filters active paid customers, and writes JSON output.",
        confidence: "high",
        sources: [{ filePath: "src/core.ts", startLine: 5, endLine: 18 }],
      },
      {
        id: "boundary-files",
        type: "boundary",
        label: "File input and output",
        summary: "The workflow reads from an input path and writes to an output path.",
        confidence: "high",
        sources: [{ filePath: "src/core.ts", startLine: 5, endLine: 17 }],
      },
      {
        id: "state-customers",
        type: "state",
        label: "Customer rows",
        summary: "Rows include email, plan, and active status.",
        confidence: "high",
        sources: [{ filePath: "src/core.ts", startLine: 3, endLine: 13 }],
      },
      {
        id: "risk-sparse-docs",
        type: "risk",
        label: "Sparse docs",
        summary: "The README does not explain the business context.",
        confidence: "medium",
        sources: [],
      },
    ],
    edges: [],
  };

  const evaluation = evaluateMemoryGraphCoverage(graph);
  assert.ok(evaluation.score >= 80);
  assert.deepEqual(evaluation.missingNodeTypes, ["area"]);
  assert.equal(evaluation.hasUncertainty, true);
  assert.equal(evaluation.sourceBackedNodeRatio, 0.8);
});
