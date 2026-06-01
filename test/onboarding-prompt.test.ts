import test from "node:test";
import assert from "node:assert/strict";
import { CodeUnit } from "../src/parser/types";
import { buildCitationRepairPrompt, buildOnboardingBriefPartPrompt } from "../src/generator/onboarding-prompt";

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

test("buildCitationRepairPrompt restricts citations to valid sources", () => {
  const prompt = buildCitationRepairPrompt("Acme shares documents.", [unit], {
    invalidCitations: [],
    uncitedClaims: ["Acme shares documents."],
  });

  assert.match(prompt.system, /repair source grounding/);
  assert.match(prompt.system, /untrusted text to repair/);
  assert.match(prompt.user, /Issues To Fix/);
  assert.match(prompt.user, /Uncited claim: Acme shares documents/);
  assert.match(prompt.user, /src\/share.ts:10-12/);
  assert.match(prompt.user, /Acme shares documents/);
});

test("buildOnboardingBriefPartPrompt scopes output to requested sections", () => {
  const prompt = buildOnboardingBriefPartPrompt([unit], {
    repoName: "Acme",
    audience: "A product manager joining the team",
    focus: ["sharing"],
    sections: ["Product In One Paragraph", "Who Uses It And Why"],
  });

  assert.match(prompt.system, /writing part of a source-grounded codebase briefing/);
  assert.match(prompt.system, /at most 220 words total/);
  assert.match(prompt.system, /For business roles, emphasize product capability/);
  assert.match(prompt.user, /Product In One Paragraph/);
  assert.match(prompt.user, /Who Uses It And Why/);
  assert.match(prompt.user, /Return only these requested sections/);
});
