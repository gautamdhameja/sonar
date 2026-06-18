import assert from "node:assert/strict";
import test from "node:test";
import { compactMemoryGraph, MemoryGraph } from "../src/survey/memory-graph";
import { validateMemoryGraph } from "../src/survey/memory-graph-validator";

const validGraph: MemoryGraph = {
  projectId: "project-1",
  generatedAt: "2026-06-17T00:00:00.000Z",
  summary: "A small file-processing command.",
  inspectedFiles: ["src/main.c"],
  warnings: [],
  nodes: [
    {
      id: "repo",
      type: "repository",
      label: "File copier",
      summary: "The repository appears to copy one file to another.",
      confidence: "high",
      sources: [{ filePath: "src/main.c", startLine: 1, endLine: 31 }],
    },
    {
      id: "risk-missing-docs",
      type: "risk",
      label: "Missing documentation",
      summary: "No README was found in the inspected evidence.",
      confidence: "medium",
      sources: [],
      openQuestions: ["Ask the team where operational documentation lives."],
    },
  ],
  edges: [
    {
      id: "edge-1",
      type: "supports",
      from: "repo",
      to: "risk-missing-docs",
      confidence: "low",
      sources: [{ filePath: "src/main.c", startLine: 1, endLine: 31 }],
    },
  ],
};

test("validateMemoryGraph accepts source-backed nodes and uncertainty nodes", () => {
  const result = validateMemoryGraph(validGraph);

  assert.equal(result.valid, true);
  assert.equal(result.graph?.nodes.length, 2);
  assert.equal(result.graph?.edges.length, 1);
});

test("validateMemoryGraph rejects non-risk nodes without source evidence", () => {
  const result = validateMemoryGraph({
    ...validGraph,
    nodes: [{ ...validGraph.nodes[0], sources: [] }],
    edges: [],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("sources must include evidence")));
});

test("validateMemoryGraph rejects edges that point at missing nodes", () => {
  const result = validateMemoryGraph({
    ...validGraph,
    edges: [{ ...validGraph.edges[0], to: "missing" }],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("to must reference a known node")));
});

test("validateMemoryGraph rejects duplicate edge ids", () => {
  const result = validateMemoryGraph({
    ...validGraph,
    edges: [validGraph.edges[0], { ...validGraph.edges[0] }],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("edge ids must be unique")));
});

test("compactMemoryGraph keeps a valid source-backed graph under local-model limits", () => {
  const graph: MemoryGraph = {
    ...validGraph,
    nodes: [
      ...validGraph.nodes,
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `workflow-${index}`,
        type: "workflow" as const,
        label: `Workflow ${index}`,
        summary: "A deliberately verbose workflow summary that should be shortened during deterministic compaction.",
        confidence: index % 2 === 0 ? ("high" as const) : ("medium" as const),
        sources: [{ filePath: "src/main.c", startLine: 1, endLine: 31 }],
      })),
    ],
    edges: [
      ...validGraph.edges,
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `edge-${index}`,
        type: "supports" as const,
        from: "repo",
        to: `workflow-${index}`,
        confidence: "medium" as const,
        sources: [{ filePath: "src/main.c", startLine: 1, endLine: 31 }],
      })),
    ],
  };

  const compact = compactMemoryGraph(graph, 8, 5);
  const validation = validateMemoryGraph(compact);

  assert.equal(validation.valid, true);
  assert.equal(compact.nodes.length, 8);
  assert.ok(compact.edges.length <= 5);
  assert.ok(compact.edges.every((edge) => compact.nodes.some((node) => node.id === edge.from)));
  assert.ok(compact.edges.every((edge) => compact.nodes.some((node) => node.id === edge.to)));
});
