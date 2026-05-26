import test from "node:test";
import assert from "node:assert/strict";
import { CodeUnit } from "../src/parser/types";
import { buildCitationRepairPrompt, buildOnboardingBriefPrompt } from "../src/generator/onboarding-prompt";

const unit: CodeUnit = {
  id: "unit-1",
  filePath: "src/share.ts",
  language: "typescript",
  kind: "function",
  name: "shareDocument",
  code: "export function shareDocument() { return true; }",
  startLine: 10,
  endLine: 12,
  parentName: null,
  imports: [],
  docstring: null,
  exportedNames: ["shareDocument"],
  calledFunctions: [],
  isVendored: false,
};

test("buildOnboardingBriefPrompt asks for first-week docs with strict citations", () => {
  const prompt = buildOnboardingBriefPrompt([unit], {
    repoName: "Acme",
    audience: "A product manager joining the team",
    focus: ["sharing", "risks"],
  });

  assert.match(prompt.system, /first-week onboarding documentation/);
  assert.match(prompt.system, /Every factual bullet or sentence must include a citation/);
  assert.match(prompt.user, /Top User Workflows/);
  assert.match(prompt.user, /src\/share.ts:10-12 - function shareDocument/);
});

test("buildCitationRepairPrompt restricts citations to valid sources", () => {
  const prompt = buildCitationRepairPrompt("Acme shares documents.", [unit]);

  assert.match(prompt.system, /repair source grounding/);
  assert.match(prompt.user, /src\/share.ts:10-12/);
  assert.match(prompt.user, /Acme shares documents/);
});
