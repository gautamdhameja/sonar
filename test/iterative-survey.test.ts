import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { LlmCompletion } from "../src/generator/llm-client";
import { runIterativeRepositorySurvey } from "../src/survey/iterative-survey";
import { MemoryGraph } from "../src/survey/memory-graph";

const fixtureRoot = (...parts: string[]) => path.join(process.cwd(), "test", "fixtures", ...parts);

function completion(content: unknown): LlmCompletion {
  return {
    content: typeof content === "string" ? content : JSON.stringify(content),
    finishReason: "stop",
    truncated: false,
  };
}

function consolidatedGraph(projectId: string): MemoryGraph {
  return {
    projectId,
    generatedAt: "2026-06-17T00:00:00.000Z",
    summary: "The repository exposes a command-line cache utility.",
    inspectedFiles: ["src/main.c"],
    warnings: [],
    nodes: [
      {
        id: "file-main-c",
        type: "file",
        label: "src/main.c",
        summary: "Entry point reads CLI arguments and coordinates cache work.",
        confidence: "high",
        sources: [{ filePath: "src/main.c", startLine: 1, endLine: 12 }],
      },
    ],
    edges: [],
  };
}

function cacheNode() {
  return {
    id: "state-last-run",
    type: "state" as const,
    label: "Last run marker",
    summary: "Cache helper appends a completed marker to a state file path.",
    confidence: "high" as const,
    sources: [{ filePath: "src/cache.c", startLine: 1, endLine: 8 }],
  };
}

test("runIterativeRepositorySurvey builds a source-backed graph through a bounded model loop", async () => {
  const projectId = "project-survey-1";
  const calls: string[] = [];

  const result = await runIterativeRepositorySurvey({
    repoRoot: fixtureRoot("survey-c-project"),
    projectId,
    repoName: "C Tool",
    budget: { maxIterations: 1, maxFilesPerIteration: 2, maxFilesTotal: 2 },
    complete: async (system) => {
      calls.push(system);
      if (/survey planner/i.test(system)) {
        return completion({
          files: [
            { filePath: "missing.c", reason: "model mistake", priority: 100 },
            { filePath: "src/main.c", reason: "entry point", priority: 90 },
          ],
          questions: ["What starts the program?"],
          warnings: [],
        });
      }
      if (/source analyst/i.test(system)) {
        return completion({
          summary: "Observed the command-line entry point.",
          inspectedFiles: ["src/main.c"],
          warnings: [],
          nodes: consolidatedGraph(projectId).nodes,
          edges: [],
        });
      }
      return completion(consolidatedGraph(projectId));
    },
  });

  assert.equal(result.iterations, 1);
  assert.equal(result.graph.nodes[0].id, "file-main-c");
  assert.ok(result.inspectedFiles.includes("src/main.c"));
  assert.ok(result.warnings.some((warning) => warning.includes("missing.c")));
  assert.equal(calls.filter((call) => /source analyst/i.test(call)).length, 1);
});

test("runIterativeRepositorySurvey stops at the total file budget", async () => {
  const projectId = "project-survey-2";
  let plannerCalls = 0;

  const result = await runIterativeRepositorySurvey({
    repoRoot: fixtureRoot("survey-c-project"),
    projectId,
    repoName: "C Tool",
    budget: { maxIterations: 3, maxFilesPerIteration: 1, maxFilesTotal: 1 },
    complete: async (system) => {
      if (/survey planner/i.test(system)) {
        plannerCalls += 1;
        return completion({ files: [{ filePath: "src/main.c", priority: 10 }], questions: [], warnings: [] });
      }
      if (/source analyst/i.test(system)) {
        return completion({
          summary: "Observed one file.",
          inspectedFiles: ["src/main.c"],
          warnings: [],
          nodes: consolidatedGraph(projectId).nodes,
          edges: [],
        });
      }
      return completion(consolidatedGraph(projectId));
    },
  });

  assert.equal(plannerCalls, 1);
  assert.equal(result.inspectedFiles.length, 1);
});

test("runIterativeRepositorySurvey deterministically compacts when model consolidation truncates", async () => {
  const projectId = "project-survey-compact-fallback";

  const result = await runIterativeRepositorySurvey({
    repoRoot: fixtureRoot("survey-c-project"),
    projectId,
    repoName: "C Tool",
    budget: { maxIterations: 1, maxFilesPerIteration: 2, maxFilesTotal: 2 },
    complete: async (system) => {
      if (/survey planner/i.test(system)) {
        return completion({ files: [{ filePath: "src/main.c", priority: 10 }], questions: [], warnings: [] });
      }
      if (/source analyst/i.test(system)) {
        return completion({
          summary: "Observed the command-line entry point.",
          inspectedFiles: ["src/main.c"],
          warnings: [],
          nodes: [
            ...consolidatedGraph(projectId).nodes,
            ...Array.from({ length: 24 }, (_, index) => ({
              id: `extra-workflow-${index}`,
              type: "workflow",
              label: `Extra workflow ${index}`,
              summary: "Additional source-backed workflow that should be bounded by deterministic compaction.",
              confidence: "medium",
              sources: [{ filePath: "src/main.c", startLine: 1, endLine: 12 }],
            })),
          ],
          edges: [],
        });
      }
      return {
        content: '{"projectId":"project-survey-compact-fallback","nodes":[',
        finishReason: "length",
        truncated: true,
      };
    },
  });

  assert.ok(result.graph.nodes.length <= 14);
  assert.ok(result.graph.warnings.some((warning) => warning.includes("deterministic graph compaction")));
  assert.equal(
    result.graph.nodes.some((node) => node.id === "file-main-c"),
    true,
  );
});

test("runIterativeRepositorySurvey salvages valid graph items when one model update item is invalid", async () => {
  const projectId = "project-survey-salvage";

  const result = await runIterativeRepositorySurvey({
    repoRoot: fixtureRoot("survey-c-project"),
    projectId,
    repoName: "C Tool",
    budget: { maxIterations: 1, validationPasses: 0, maxFilesPerIteration: 1, maxFilesTotal: 1 },
    complete: async (system) => {
      if (/survey planner/i.test(system)) {
        return completion({ files: [{ filePath: "src/main.c", priority: 10 }], questions: [], warnings: [] });
      }
      if (/source analyst/i.test(system)) {
        return completion({
          summary: "Observed the command-line entry point.",
          inspectedFiles: ["src/main.c"],
          warnings: [],
          nodes: [
            consolidatedGraph(projectId).nodes[0],
            {
              id: "invalid-service-node",
              type: "service",
              label: "Invalid service",
              summary: "This node uses a type outside the graph schema.",
              confidence: "medium",
              sources: [{ filePath: "src/main.c", startLine: 1, endLine: 12 }],
            },
          ],
          edges: [
            {
              id: "edge-to-missing-node",
              type: "calls",
              from: "file-main-c",
              to: "missing-node",
              confidence: "medium",
              sources: [{ filePath: "src/main.c", startLine: 1, endLine: 12 }],
            },
          ],
        });
      }
      return completion(consolidatedGraph(projectId));
    },
  });

  assert.equal(
    result.graph.nodes.some((node) => node.id === "file-main-c"),
    true,
  );
  assert.equal(
    result.graph.nodes.some((node) => node.id === "invalid-service-node"),
    false,
  );
  assert.equal(result.graph.edges.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("Rejected graph node invalid-service-node")));
  assert.ok(result.warnings.some((warning) => warning.includes("Rejected graph edge edge-to-missing-node")));
});

test("runIterativeRepositorySurvey uses the validation pass to represent inspected but uncited files", async () => {
  const projectId = "project-survey-validation";
  let validationCalls = 0;

  const result = await runIterativeRepositorySurvey({
    repoRoot: fixtureRoot("survey-c-project"),
    projectId,
    repoName: "C Tool",
    budget: { maxIterations: 1, validationPasses: 1, maxFilesPerIteration: 2, maxValidationFiles: 1, maxFilesTotal: 2 },
    complete: async (system) => {
      if (/survey planner/i.test(system)) {
        return completion({
          files: [
            { filePath: "src/main.c", priority: 20 },
            { filePath: "src/cache.c", priority: 10 },
          ],
          questions: [],
          warnings: [],
        });
      }
      if (/source analyst/i.test(system)) {
        return completion({
          summary: "Observed the command-line entry point but missed the state helper.",
          inspectedFiles: ["src/main.c", "src/cache.c"],
          warnings: [],
          nodes: consolidatedGraph(projectId).nodes,
          edges: [],
        });
      }
      if (/memory graph auditor/i.test(system)) {
        validationCalls += 1;
        return completion({
          summary: "Added the previously uncited state helper.",
          inspectedFiles: ["src/cache.c"],
          warnings: [],
          nodes: [cacheNode()],
          edges: [
            {
              id: "main-depends-on-last-run-state",
              type: "depends_on",
              from: "file-main-c",
              to: "state-last-run",
              confidence: "low",
              sources: [{ filePath: "src/cache.c", startLine: 1, endLine: 8 }],
            },
          ],
        });
      }
      return completion({
        ...consolidatedGraph(projectId),
        nodes: [...consolidatedGraph(projectId).nodes, cacheNode()],
        edges: [
          {
            id: "main-depends-on-last-run-state",
            type: "depends_on",
            from: "file-main-c",
            to: "state-last-run",
            confidence: "low",
            sources: [{ filePath: "src/cache.c", startLine: 1, endLine: 8 }],
          },
        ],
        inspectedFiles: ["src/main.c", "src/cache.c"],
      });
    },
  });

  assert.equal(validationCalls, 1);
  assert.equal(
    result.graph.nodes.some((node) => node.id === "state-last-run"),
    true,
  );
  assert.equal(
    result.graph.edges.some((edge) => edge.id === "main-depends-on-last-run-state"),
    true,
  );
});
