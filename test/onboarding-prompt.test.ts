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
    workflowPlanText: "## Internal Workflow Map\nProduct hypothesis: Acme shares documents.",
  });

  assert.match(prompt.system, /writing part of a source-grounded codebase briefing/);
  assert.match(prompt.system, /at most 260 words total/);
  assert.match(prompt.system, /For business roles, emphasize product capability/);
  assert.match(prompt.system, /Prioritize the central product workflows/);
  assert.match(prompt.system, /prefer end-to-end journeys shown by source evidence/);
  assert.match(prompt.system, /Precision beats completeness/);
  assert.match(prompt.system, /Repository grounding map/);
  assert.match(prompt.system, /not shown in the inspected context/);
  assert.match(prompt.system, /Do not treat access tokens/);
  assert.match(prompt.user, /Product In One Paragraph/);
  assert.match(prompt.user, /Who Uses It And Why/);
  assert.match(prompt.user, /Internal Workflow Map/);
  assert.match(prompt.user, /Product hypothesis: Acme shares documents/);
  assert.match(prompt.user, /Return only these requested sections/);
});

test("buildOnboardingBriefPartPrompt gives Top User Workflows a lifecycle contract", () => {
  const prompt = buildOnboardingBriefPartPrompt([unit], {
    repoName: "Acme",
    audience: "A product manager joining the team",
    focus: ["workflows"],
    sections: ["Top User Workflows"],
    workflowPlanText: "## Internal Workflow Map\nMandatory lifecycle evidence:\n- src/share.ts [src/share.ts:10-12]",
  });

  assert.match(prompt.system, /at most 420 words total/);
  assert.match(prompt.user, /For `Top User Workflows`/);
  assert.match(prompt.user, /Common shapes include create\/open/);
  assert.match(prompt.user, /share\/access/);
  assert.match(prompt.user, /Do not list OAuth, generic authentication, infrastructure, or AI as top workflows unless/);
  assert.match(prompt.user, /Do not say implementation evidence is missing/);
});

test("buildOnboardingBriefPartPrompt body-only mode suppresses headings for a single section", () => {
  const prompt = buildOnboardingBriefPartPrompt([unit], {
    repoName: "Acme",
    audience: "A technical teammate",
    focus: ["architecture"],
    sections: ["Architecture And Major Systems"],
    bodyOnly: true,
  });

  assert.match(prompt.user, /Write only the body content for the section "Architecture And Major Systems"/);
  assert.match(prompt.user, /Do not write the section heading/);
  assert.doesNotMatch(prompt.user, /Use `###` headings matching the section names exactly/);
});

test("buildOnboardingBriefPartPrompt places memory graph before raw source context", () => {
  const prompt = buildOnboardingBriefPartPrompt([unit], {
    repoName: "Acme",
    audience: "A product manager joining the team",
    focus: ["overview"],
    sections: ["Codebase Product Map"],
    memoryGraphText:
      "## Repository Memory Graph\n- workflow: Sharing (high) - Users share documents. Evidence: src/share.ts:10-12.",
  });

  assert.ok(prompt.user.indexOf("## Repository Memory Graph") < prompt.user.indexOf("## Source Context"));
  assert.match(prompt.user, /Users share documents/);
});
