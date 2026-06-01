import test from "node:test";
import assert from "node:assert/strict";
import { CodeUnit } from "../src/parser/types";
import { planBriefingEvidence } from "../src/retriever/briefing-evidence-planner";
import { isBriefingNoiseFile } from "../src/retriever/source-classifier";
import { CodeUnitStore } from "../src/retriever/unit-store";

function unit(filePath: string, code = "export const value = true;"): CodeUnit {
  return {
    id: filePath,
    filePath,
    language: filePath.endsWith(".md") ? "markdown" : filePath.endsWith(".json") ? "json" : "typescript",
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

test("isBriefingNoiseFile excludes agent and generated repository noise from initial briefings", () => {
  assert.equal(isBriefingNoiseFile(".agents/skills/postgres/references/storage-layout.md"), true);
  assert.equal(isBriefingNoiseFile("public/vendor/handsontable/handsontable.full.min.js"), true);
  assert.equal(isBriefingNoiseFile("package-lock.json"), true);
  assert.equal(isBriefingNoiseFile("prisma/schema/share-link.prisma"), false);
  assert.equal(isBriefingNoiseFile("pages/api/share-links/index.ts"), false);
});

test("planBriefingEvidence selects broad product architecture evidence instead of a narrow export cluster", async () => {
  const store = new CodeUnitStore();
  await store.loadFromUnits([
    unit("README.md", "# Acme Portal\nUpload assets, share them with recipients, and report activity."),
    unit("package.json", '{"dependencies":{"next":"latest","prisma":"latest","stripe":"latest"}}'),
    unit("prisma/schema/share-link.prisma", "model ShareLink { id String @id emailProtected Boolean }"),
    unit("prisma/schema/asset-space.prisma", "model AssetSpace { id String @id }"),
    unit("prisma/schema/account.prisma", "model Account { id String @id plan String }"),
    unit("lib/auth/auth-options.ts", "export const authOptions = { providers: [] };"),
    unit("middleware.ts", "export function middleware(request) { return routeByHost(request); }"),
    unit("pages/portal/[linkId]/index.tsx", "export default function PortalPage() { return <Viewer />; }"),
    unit("app/api/activity/route.ts", "export async function POST() { return recordActivity(); }"),
    unit("app/api/spaces/access/route.ts", "export async function POST() { return verifySpaceAccess(); }"),
    unit("pages/api/share-links/index.ts", "export default function handler() { return createShareLink(); }"),
    unit("pages/api/assets/create.ts", "export default function handler() { return createAsset(); }"),
    unit("lib/assets/process-asset.ts", "export function processAsset() { return queueConversion(); }"),
    unit("lib/storage/put-file.ts", "export function putFile() { return uploadToStorage(); }"),
    unit("lib/analytics/record-event.ts", "export function recordEvent() { return sendMetric(); }"),
    unit("ee/limits/constants.ts", "export const limits = { spaces: 10 };"),
    unit("ee/features/workflows/lib/engine.ts", "export function runWorkflow() { return routeViewer(); }"),
    unit("lib/trigger/convert-files.ts", "export const convertFiles = task({ id: 'convert-files' });"),
    unit("app/(ee)/api/ai/chat/route.ts", "export async function POST() { return createChat(); }"),
    unit("pages/api/spaces/[id]/export-activity.ts", "export default function exportActivity() {}"),
    unit(
      "pages/api/spaces/[id]/groups/[groupId]/export-activity.ts",
      "export default function exportGroupActivity() {}",
    ),
    unit(".agents/skills/postgres/references/storage-layout.md", "# PGDATA layout"),
  ]);

  const plan = planBriefingEvidence(store, [
    "Product In One Paragraph",
    "Codebase Product Map",
    "Top User Workflows",
    "Data, Privacy, And Operational Notes",
    "Risks Or Open Questions",
  ]);
  const files = new Set(plan.units.map((item) => item.filePath));
  const exportActivityCount = plan.units.filter((item) => item.filePath.includes("export-activity")).length;

  assert.equal(
    [...files].some((filePath) => filePath.startsWith(".agents/")),
    false,
  );
  assert.ok(files.has("README.md"));
  assert.ok(files.has("package.json"));
  assert.ok(files.has("prisma/schema/share-link.prisma"));
  assert.ok(files.has("prisma/schema/asset-space.prisma"));
  assert.ok(files.has("lib/auth/auth-options.ts"));
  assert.ok(files.has("middleware.ts"));
  assert.ok(files.has("pages/portal/[linkId]/index.tsx"));
  assert.ok(files.has("app/api/activity/route.ts") || files.has("lib/analytics/record-event.ts"));
  assert.ok(files.has("pages/api/share-links/index.ts"));
  assert.ok(
    files.has("lib/storage/put-file.ts") ||
      files.has("lib/assets/process-asset.ts") ||
      files.has("pages/api/assets/create.ts"),
  );
  assert.ok(files.has("app/api/activity/route.ts") || files.has("lib/analytics/record-event.ts"));
  assert.ok(files.has("ee/limits/constants.ts"));
  assert.ok(files.has("ee/features/workflows/lib/engine.ts") || files.has("lib/trigger/convert-files.ts"));
  assert.ok(exportActivityCount <= 1);
  assert.ok(plan.census.noiseFiles >= 1);
  assert.equal(plan.missingBuckets.length, 0);
});
