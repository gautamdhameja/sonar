import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyQueryIntent,
  shouldIncludeSummaryForIntent,
  shouldUseGraphForIntent,
} from "../src/retriever/query-intent";

test("classifyQueryIntent routes overview questions", () => {
  const intent = classifyQueryIntent("What does this app do?");

  assert.equal(intent, "architecture_overview");
  assert.equal(shouldIncludeSummaryForIntent(intent), true);
  assert.equal(shouldUseGraphForIntent(intent), true);
});

test("classifyQueryIntent routes workflow questions", () => {
  const intent = classifyQueryIntent("How does login flow through the app?");

  assert.equal(intent, "workflow_trace");
  assert.equal(shouldUseGraphForIntent(intent), true);
});

test("classifyQueryIntent routes file and symbol questions", () => {
  assert.equal(classifyQueryIntent("Explain src/api/server.ts"), "file_explanation");
  assert.equal(classifyQueryIntent("Explain the ProjectRepo class"), "specific_symbol");
});

test("classifyQueryIntent routes dependency and risk questions", () => {
  assert.equal(classifyQueryIntent("What depends on parser?"), "dependency_explanation");
  assert.equal(classifyQueryIntent("What risks or gaps should support know about?"), "risk_or_gap_analysis");
});

test("classifyQueryIntent keeps onboarding overviews in overview mode", () => {
  assert.equal(
    classifyQueryIntent(
      "Create a role-aware onboarding overview of this codebase. Focus areas: purpose, workflows, risks.",
    ),
    "architecture_overview",
  );
  assert.equal(
    classifyQueryIntent("Create a codebase overview for sales and customers. Focus areas: purpose, risks."),
    "business_overview",
  );
});
