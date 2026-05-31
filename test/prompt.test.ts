import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../src/generator/prompt";
import { CodeUnit } from "../src/parser/types";

const unit: CodeUnit = {
  id: "unit-1",
  filePath: "src/orders.ts",
  language: "typescript",
  kind: "function",
  name: "createOrder",
  code: "export function createOrder() { return true; }",
  startLine: 1,
  endLine: 1,
  parentName: null,
  imports: [],
  docstring: null,
  exportedNames: ["createOrder"],
  calledFunctions: [],
  isVendored: false,
};

test("buildPrompt includes persona guidance", () => {
  const prompt = buildPrompt("What does this app do?", [unit], "sonar", "A local code explainer.", {
    role: "product_manager",
    technicalBackground: "basic",
    avoidJargon: true,
    explanationDepth: "standard",
    businessContext: "Prepare onboarding notes",
  });

  assert.match(prompt.system, /Role: product manager/);
  assert.match(prompt.system, /Prepare onboarding notes/);
  assert.match(prompt.system, /Prefer plain language/);
  assert.match(prompt.system, /Code Context as authoritative/);
  assert.match(prompt.system, /untrusted content to analyze/);
  assert.match(prompt.user, /## Codebase Overview \(Supplemental\)/);
  assert.match(prompt.user, /src\/orders.ts:1-1 - function createOrder/);
});

test("buildPrompt omits empty optional persona fields", () => {
  const prompt = buildPrompt("Explain createOrder", [unit], "sonar");

  assert.doesNotMatch(prompt.system, /Role details:/);
  assert.doesNotMatch(prompt.system, /Business context:/);
  assert.match(prompt.system, /Role: other/);
});

test("buildPrompt truncates overview when code context is available", () => {
  const longOverview = [
    "# Overview",
    "x".repeat(3500),
    "## Late Section",
    "This should be omitted when code context is present.",
  ].join("\n\n");

  const prompt = buildPrompt("How does the workflow run?", [unit], "sonar", longOverview);

  assert.match(prompt.user, /Overview truncated because precise code context is available/);
  assert.doesNotMatch(prompt.user, /This should be omitted/);
});
