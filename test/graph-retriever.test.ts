import test from "node:test";
import assert from "node:assert/strict";
import { graphRetrievalDiagnostics, selectGraphTraversalMode } from "../src/retriever/graph-retriever";

test("selectGraphTraversalMode follows dependency question direction", () => {
  assert.equal(selectGraphTraversalMode("What depends on parser?", "dependency_explanation"), "downstream");
  assert.equal(selectGraphTraversalMode("What does parser depend on?", "dependency_explanation"), "upstream");
});

test("selectGraphTraversalMode keeps workflows broad", () => {
  assert.equal(
    selectGraphTraversalMode("How does the daily pipeline collect and score candidates?", "workflow_trace"),
    "bidirectional",
  );
});

test("selectGraphTraversalMode treats config validation as upstream context", () => {
  assert.equal(
    selectGraphTraversalMode("Where is LLAMA_SERVER_URL configured and validated?", "general_code_question"),
    "upstream",
  );
});

test("graphRetrievalDiagnostics summarizes traversal and edge types", () => {
  const diagnostics = graphRetrievalDiagnostics(
    "How does the daily pipeline work?",
    "workflow_trace",
    ["src/daily/pipeline.ts"],
    [
      { sourceFile: "src/daily/pipeline.ts", targetFile: "src/db/items.ts", edgeType: "imports" },
      { sourceFile: "src/daily/pipeline.ts", targetFile: "src/db/useCases.ts", edgeType: "imports" },
    ],
  );

  assert.equal(diagnostics.traversalMode, "bidirectional");
  assert.equal(diagnostics.edgeTypes.imports, 2);
});
