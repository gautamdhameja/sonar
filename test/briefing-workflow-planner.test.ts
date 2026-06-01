import test from "node:test";
import assert from "node:assert/strict";
import { CodeUnit } from "../src/parser/types";
import { buildBriefingWorkflowPlan, workflowPlanToPrompt } from "../src/retriever/briefing-workflow-planner";
import { CodeUnitStore } from "../src/retriever/unit-store";

function unit(filePath: string, code = "export const value = true;"): CodeUnit {
  return {
    id: filePath,
    filePath,
    language: filePath.endsWith(".md") ? "markdown" : filePath.endsWith(".prisma") ? "prisma" : "typescript",
    kind: "module",
    name: filePath.split("/").at(-1) ?? filePath,
    code,
    startLine: 1,
    endLine: code.split("\n").length,
    parentName: null,
    imports: [],
    docstring: null,
    exportedNames: [],
    calledFunctions: [],
    isVendored: false,
  };
}

test("buildBriefingWorkflowPlan reconstructs central product workflows before secondary AI features", async () => {
  const store = new CodeUnitStore();
  await store.loadFromUnits([
    unit("README.md", "# Acme Portal\nUpload assets, share them with recipients, and report activity."),
    unit("package.json", '{"dependencies":{"next":"latest","prisma":"latest","stripe":"latest"}}'),
    unit("prisma/schema/asset.prisma", "model Asset { id String @id shareLinks ShareLink[] }"),
    unit(
      "prisma/schema/share-link.prisma",
      "model ShareLink { id String @id asset Asset @relation(fields: [id], references: [id]) }",
    ),
    unit("prisma/schema/account.prisma", "model Account { id String @id plan String }"),
    unit("prisma/schema/activity-event.prisma", "model ActivityEvent { id String @id linkId String }"),
    unit("pages/api/assets/create.ts", "export default function handler() { return createAsset(); }"),
    unit("lib/assets/process-asset.ts", "export function processAsset() { return queueConversion(); }"),
    unit("lib/storage/put-file.ts", "export function putFile() { return uploadToStorage(); }"),
    unit("pages/api/share-links/index.ts", "export default function handler() { return createShareLink(); }"),
    unit("pages/portal/[linkId]/index.tsx", "export default function RecipientPortal() { return verifyAccess(); }"),
    unit("components/access/access-form.tsx", "export function AccessForm() { return verifyEmail(); }"),
    unit("app/api/activity/route.ts", "export async function POST() { return recordActivity(); }"),
    unit("lib/analytics/record-event.ts", "export function recordEvent() { return sendMetric(); }"),
    unit("ee/limits/constants.ts", "export const limits = { assets: 100 };"),
    unit("ee/stripe/webhooks/checkout-session-completed.ts", "export function checkoutSessionCompleted() {}"),
    unit("app/(ee)/api/ai/chat/route.ts", "export async function POST() { return createChat(); }"),
    unit("prisma/schema/conversation.prisma", "model Conversation { id String @id }"),
  ]);

  const plan = buildBriefingWorkflowPlan(store);
  const workflowIds = plan.workflows.map((workflow) => workflow.id);
  const aiIndex = workflowIds.indexOf("ai-assistance");

  assert.match(plan.productHypothesis, /Asset|ShareLink|ActivityEvent/);
  assert.ok(plan.domainEntities.some((entity) => entity.name === "Asset"));
  assert.ok(plan.domainEntities.some((entity) => entity.name === "ShareLink"));
  assert.ok(workflowIds.includes("content-lifecycle"));
  assert.ok(workflowIds.includes("sharing-access"));
  assert.ok(workflowIds.includes("viewer-analytics"));
  assert.ok(aiIndex === -1 || workflowIds.indexOf("sharing-access") < aiIndex);
  assert.ok(aiIndex === -1 || workflowIds.indexOf("content-lifecycle") < aiIndex);
  assert.ok(plan.lifecycleEvidence.some((item) => item.filePath === "pages/api/assets/create.ts"));
  assert.ok(plan.lifecycleEvidence.some((item) => item.filePath === "lib/assets/process-asset.ts"));
  assert.ok(plan.lifecycleEvidence.some((item) => item.filePath === "pages/api/share-links/index.ts"));
  assert.ok(plan.lifecycleEvidence.some((item) => item.filePath === "pages/portal/[linkId]/index.tsx"));
  assert.ok(plan.lifecycleEvidence.some((item) => item.filePath === "components/access/access-form.tsx"));
  assert.ok(plan.lifecycleEvidence.some((item) => item.filePath === "lib/analytics/record-event.ts"));
  assert.ok(plan.lifecycleEvidence.some((item) => item.filePath === "ee/limits/constants.ts"));
  assert.ok(plan.centralEvidence.some((item) => item.filePath === "pages/api/share-links/index.ts"));
  assert.ok(plan.centralEvidence.some((item) => item.filePath === "lib/analytics/record-event.ts"));
});

test("workflowPlanToPrompt emits a compact source-backed map for generation", async () => {
  const store = new CodeUnitStore();
  await store.loadFromUnits([
    unit("README.md", "# Acme\nShare files."),
    unit("prisma/schema/share-link.prisma", "model ShareLink { id String @id }"),
    unit("pages/api/share-links/index.ts", "export default function handler() { return createShareLink(); }"),
    unit("pages/portal/[linkId]/index.tsx", "export default function PortalPage() { return null; }"),
  ]);

  const text = workflowPlanToPrompt(buildBriefingWorkflowPlan(store));

  assert.match(text, /Internal Workflow Map/);
  assert.match(text, /Product hypothesis/);
  assert.match(text, /Domain entities/);
  assert.match(text, /Ranked workflows/);
  assert.match(text, /Mandatory lifecycle evidence/);
  assert.match(text, /\[prisma\/schema\/share-link\.prisma:1-1\]/);
});
