import test from "node:test";
import assert from "node:assert/strict";
import { CodeUnit } from "../src/parser/types";
import { planBriefingEvidence } from "../src/retriever/briefing-evidence-planner";
import {
  classifyBriefingEvidence,
  isBriefingNoiseFile,
  isNarrowReferenceDoc,
  isProductOverviewDoc,
} from "../src/retriever/source-classifier";
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
  assert.equal(isBriefingNoiseFile("proto/gen/api/v1/memo_service.pb.go"), true);
  assert.equal(isBriefingNoiseFile("docs/plans/2026-01-01-internal-plan.md"), true);
  assert.equal(isBriefingNoiseFile("prisma/schema/share-link.prisma"), false);
  assert.equal(isBriefingNoiseFile("pages/api/share-links/index.ts"), false);
});

test("source classifier separates product overview docs from narrow reference docs", () => {
  assert.equal(isProductOverviewDoc("README.md"), true);
  assert.equal(isProductOverviewDoc("docs/overview.md"), true);
  assert.equal(isProductOverviewDoc("docs/content/en/_index.md"), true);
  assert.equal(isNarrowReferenceDoc("docs/content/en/functions/resources/PostProcess.md"), true);
  assert.equal(isNarrowReferenceDoc("docs/content/en/methods/resource/Process.md"), true);
  assert.equal(isNarrowReferenceDoc("README.md"), false);
});

test("source classifier recognizes common non-JavaScript project manifests", () => {
  const manifests = [
    "go.mod",
    "Cargo.toml",
    "pyproject.toml",
    "pom.xml",
    "build.gradle",
    "CMakeLists.txt",
    "Sonar.csproj",
  ];

  for (const filePath of manifests) {
    assert.deepEqual(classifyBriefingEvidence(filePath).sort(), ["operations_config", "stack_config"]);
  }
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

test("planBriefingEvidence recognizes generic service and store layers", async () => {
  const store = new CodeUnitStore();
  await store.loadFromUnits([
    unit("README.md", "# Notes\nSelf-hosted note taking."),
    unit("cmd/notes/main.go", "func main() { server.NewServer().Start() }"),
    unit("server/server.go", "func NewServer() { registerAPI(); serveFrontend(); }"),
    unit("server/router/api/v1/note_service.go", "func (s *APIV1Service) CreateNote() { s.Store.CreateNote() }"),
    unit("server/router/api/v1/auth_service.go", "func (s *APIV1Service) SignIn() { comparePassword(); }"),
    unit(
      "server/router/api/v1/attachment_service.go",
      "func (s *APIV1Service) CreateAttachment() { SaveAttachmentBlob(); }",
    ),
    unit("store/note.go", "type Note struct { Content string; Visibility string }"),
    unit("store/attachment.go", "type Attachment struct { Filename string; Blob []byte }"),
    unit(
      "web/src/components/CreateAccessTokenDialog.tsx",
      "export function CreateAccessTokenDialog() { return null; }",
    ),
  ]);

  const plan = planBriefingEvidence(store, [
    "Codebase Product Map",
    "Top User Workflows",
    "Main Systems And Ownership Areas",
    "Data, Privacy, And Operational Notes",
  ]);
  const files = new Set(plan.units.map((item) => item.filePath));

  assert.ok(files.has("server/router/api/v1/note_service.go"));
  assert.ok(files.has("server/router/api/v1/auth_service.go"));
  assert.ok(files.has("server/router/api/v1/attachment_service.go"));
  assert.ok(files.has("store/note.go"));
  assert.ok(files.has("store/attachment.go"));
  assert.ok(files.has("server/server.go") || files.has("cmd/notes/main.go"));
});

test("planBriefingEvidence prefers core entity service and store files over adjacent share and attachment files", async () => {
  const store = new CodeUnitStore();
  await store.loadFromUnits([
    unit("README.md", "# Notes\nSelf-hosted note taking."),
    unit("server/router/api/v1/note_service.go", "func (s *APIV1Service) CreateNote() { s.Store.CreateNote() }"),
    unit("server/router/api/v1/note_share_service.go", "func (s *APIV1Service) CreateNoteShare() {}"),
    unit("server/router/api/v1/attachment_service.go", "func (s *APIV1Service) CreateAttachment() {}"),
    unit("store/note.go", "type Note struct { Content string; Visibility string }"),
    unit("store/note_share.go", "type NoteShare struct { NoteID int32 }"),
    unit("store/attachment.go", "type Attachment struct { Filename string }"),
  ]);

  const plan = planBriefingEvidence(store, ["Codebase Product Map", "Top User Workflows"]);
  const files = plan.units.map((item) => item.filePath);

  assert.ok(
    files.indexOf("server/router/api/v1/note_service.go") < files.indexOf("server/router/api/v1/note_share_service.go"),
  );
  assert.ok(files.indexOf("store/note.go") < files.indexOf("store/note_share.go"));
});

test("planBriefingEvidence balances README claims with code grounding and demotes narrow docs", async () => {
  const store = new CodeUnitStore();
  await store.loadFromUnits([
    unit(
      "README.md",
      "# Hugo\nA fast static site generator with templates, asset pipelines, modules, and a dev server.",
    ),
    unit("docs/content/en/functions/resources/PostProcess.md", "# PostProcess\nPost-process CSS resources."),
    unit("docs/content/en/methods/resource/Process.md", "# Process\nProcess an image resource."),
    unit("main.go", "func main() { commands.Execute(os.Args[1:]) }"),
    unit("commands/commands.go", "func newExec() { newHugoBuildCmd(); newServerCommand(); newModCommands(); }"),
    unit("hugolib/hugo_sites_build.go", "func (h *HugoSites) Build() { h.process(); h.assemble(); h.render(); }"),
    unit("resources/resource_spec.go", "func NewSpec() { images.NewImageProcessor(); newResourceCache(); }"),
  ]);

  const plan = planBriefingEvidence(store, [
    "Product In One Paragraph",
    "Who Uses It And Why",
    "Codebase Product Map",
    "Top User Workflows",
  ]);
  const files = plan.units.map((item) => item.filePath);

  assert.equal(files[0], "README.md");
  assert.ok(files.includes("commands/commands.go") || files.includes("main.go"));
  assert.ok(files.includes("hugolib/hugo_sites_build.go"));
  assert.ok(files.indexOf("README.md") < files.indexOf("docs/content/en/functions/resources/PostProcess.md"));
  assert.ok(
    files.indexOf("commands/commands.go") < files.indexOf("docs/content/en/functions/resources/PostProcess.md"),
  );
});

test("planBriefingEvidence falls back to code evidence when no docs exist", async () => {
  const store = new CodeUnitStore();
  await store.loadFromUnits([
    unit("cmd/tool/main.go", "func main() { commands.Execute(os.Args[1:]) }"),
    unit("commands/server.go", "func newServerCommand() { watchAndServe(); }"),
    unit("internal/build/build.go", "func Build() { process(); render(); postProcess(); }"),
  ]);

  const plan = planBriefingEvidence(store, ["Product In One Paragraph", "Codebase Product Map", "Top User Workflows"]);
  const files = new Set(plan.units.map((item) => item.filePath));

  assert.ok(files.has("cmd/tool/main.go") || files.has("commands/server.go"));
  assert.ok(files.has("internal/build/build.go") || files.has("commands/server.go"));
  assert.equal(
    [...files].some((filePath) => filePath.endsWith(".md")),
    false,
  );
});
