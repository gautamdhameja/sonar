import test from "node:test";
import assert from "node:assert/strict";
import { planQuery } from "../src/retriever/query-router";

test("planQuery routes file and symbol queries to exact mode", () => {
  const filePlan = planQuery("Explain src/api/server.ts");
  assert.equal(filePlan.mode, "exact");
  assert.equal(filePlan.useLocalExact, true);
  assert.equal(filePlan.useVector, false);
  assert.deepEqual(filePlan.requiredEvidence, ["exact_file_or_symbol"]);

  const symbolPlan = planQuery("Explain the ProjectRepo class");
  assert.equal(symbolPlan.mode, "exact");
  assert.equal(symbolPlan.useLocalExact, true);
});

test("planQuery routes literal/debug queries through lexical-first retrieval", () => {
  const plan = planQuery("Where is SONAR_CHAT_BASE_URL configured?");

  assert.equal(plan.mode, "literal");
  assert.equal(plan.useLexical, true);
  assert.equal(plan.useVector, false);
  assert.equal(plan.useGraph, false);
  assert.deepEqual(plan.preferredSources, ["config", "schema", "tests", "code"]);
});

test("planQuery routes overview questions to summary graph mode", () => {
  const plan = planQuery("What does this app do for customers?");

  assert.equal(plan.mode, "summary_graph");
  assert.equal(plan.includeSummary, true);
  assert.equal(plan.useGraph, true);
  assert.equal(plan.useVector, false);
  assert.equal(plan.sourceBudget.docs, 3);
});

test("planQuery routes workflow questions to graph hybrid mode", () => {
  const plan = planQuery("How does the indexing pipeline work?");

  assert.equal(plan.mode, "graph_hybrid");
  assert.equal(plan.useGraph, true);
  assert.equal(plan.useVector, false);
  assert.ok(plan.requiredEvidence.includes("stage_functions"));
});
