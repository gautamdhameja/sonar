import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodeUnit } from "../src/parser/types";

process.env.SONAR_DB_PATH = join(mkdtempSync(join(tmpdir(), "sonar-project-repo-")), "projects.db");

function unit(overrides: Partial<CodeUnit> = {}): CodeUnit {
  return {
    id: "unit-1",
    filePath: "src/index.ts",
    language: "typescript",
    kind: "function",
    name: "main",
    code: "export function main() {}",
    startLine: 1,
    endLine: 1,
    parentName: null,
    imports: [],
    docstring: null,
    exportedNames: ["main"],
    calledFunctions: [],
    isVendored: false,
    ...overrides,
  };
}

test("ProjectRepo tolerates corrupt JSON array fields in code units", async () => {
  const { ProjectRepo } = await import("../src/db/project-repo");
  const { getDatabase } = await import("../src/db/schema");
  const repo = new ProjectRepo();
  const project = repo.createProject("repo", "/tmp/repo");
  repo.insertCodeUnits(project.id, [unit()]);

  getDatabase()
    .prepare("UPDATE code_units SET imports = ?, exported_names = ?, called_functions = ? WHERE id = ?")
    .run("{bad json", "{}", "[1]", "unit-1");

  const originalWarn = console.warn;
  console.warn = () => undefined;
  let loaded: CodeUnit | undefined;
  try {
    [loaded] = repo.getCodeUnitsByProject(project.id);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(loaded!.imports, []);
  assert.deepEqual(loaded!.exportedNames, []);
  assert.deepEqual(loaded!.calledFunctions, []);
});

test("ProjectRepo replaces an indexed project in a single repository transaction", async () => {
  const { ProjectRepo } = await import("../src/db/project-repo");
  const repo = new ProjectRepo();

  const first = repo.replaceProjectIndex({
    id: "project-replace-1",
    name: "Repo",
    repoPath: "/tmp/repo-replace",
    units: [unit({ id: "replace-unit-1", filePath: "src/old.ts" })],
    edges: [],
  });
  const second = repo.replaceProjectIndex({
    id: "project-replace-2",
    name: "Repo",
    repoPath: "/tmp/repo-replace",
    units: [unit({ id: "replace-unit-2", filePath: "src/new.ts" })],
    edges: [{ sourceFile: "src/new.ts", targetFile: "src/util.ts", importStatement: "./util" }],
  });

  assert.equal(repo.getProject(first.id), undefined);
  assert.equal(repo.getProjectByPath("/tmp/repo-replace")?.id, second.id);
  assert.deepEqual(
    repo.getCodeUnitsByProject(second.id).map((item) => item.filePath),
    ["src/new.ts"],
  );
  assert.equal(repo.getDependencyEdges(second.id).length, 1);
});

test("ProjectRepo persists and replaces project memory graphs", async () => {
  const { ProjectRepo } = await import("../src/db/project-repo");
  const { getDatabase } = await import("../src/db/schema");
  const repo = new ProjectRepo();
  const project = repo.replaceProjectIndex({
    id: "project-graph-1",
    name: "Graph Repo",
    repoPath: "/tmp/repo-graph",
    units: [unit({ id: "graph-unit-1", filePath: "src/main.ts" })],
    edges: [],
  });

  repo.saveMemoryGraph(project.id, {
    projectId: project.id,
    generatedAt: "2026-06-17T00:00:00.000Z",
    summary: "A graph-backed briefing memory.",
    inspectedFiles: ["src/main.ts"],
    warnings: [],
    nodes: [
      {
        id: "repo",
        type: "repository",
        label: "Graph Repo",
        summary: "The repository has a source-backed entry point.",
        confidence: "high",
        sources: [{ filePath: "src/main.ts", startLine: 1, endLine: 1 }],
      },
    ],
    edges: [],
  });

  assert.equal(repo.getMemoryGraph(project.id)?.nodes[0].label, "Graph Repo");

  getDatabase().prepare("UPDATE project_memory_graphs SET graph_json = ? WHERE project_id = ?").run("{bad", project.id);
  assert.equal(repo.getMemoryGraph(project.id), null);

  const replacement = repo.replaceProjectIndex({
    id: "project-graph-2",
    name: "Graph Repo",
    repoPath: "/tmp/repo-graph",
    units: [unit({ id: "graph-unit-2", filePath: "src/new.ts" })],
    edges: [],
  });
  assert.equal(repo.getMemoryGraph(project.id), null);
  assert.equal(repo.getMemoryGraph(replacement.id), null);
});

test("ProjectRepo persists onboarding sessions and supports legacy messages", async () => {
  const { ProjectRepo } = await import("../src/db/project-repo");
  const { DEFAULT_PERSONA } = await import("../src/persona/types");
  const repo = new ProjectRepo();
  const project = repo.createProject("repo with onboarding", "/tmp/repo-with-onboarding");

  const session = repo.createOnboardingSession({
    projectId: project.id,
    repoName: project.name,
    audience: "Product manager",
    focus: ["sharing", "privacy"],
    persona: DEFAULT_PERSONA,
    brief: "A codebase briefing.",
    sourceFiles: ["README.md", "src/share.ts"],
    sources: [{ filePath: "src/share.ts", name: "share", kind: "function", lines: "1-4" }],
    citationVerification: {
      valid: true,
      citations: ["src/share.ts:1-4"],
      invalidCitations: [],
      uncitedClaims: [],
      sourceKeys: ["src/share.ts:1-4"],
      claims: [],
    },
    retrievalTime: 12,
    generationTime: 34,
    generationTruncated: true,
  });
  repo.addOnboardingMessage({
    sessionId: session.id,
    role: "user",
    content: "How does sharing work?",
    intent: "workflow",
  });
  repo.addOnboardingMessage({
    sessionId: session.id,
    role: "assistant",
    content: "Sharing uses a link.",
    intent: "workflow",
    sources: [{ filePath: "src/share.ts", name: "share", kind: "function", lines: "1-4" }],
    citationVerification: {
      valid: true,
      citations: [],
      invalidCitations: [],
      uncitedClaims: [],
      sourceKeys: [],
      claims: [],
    },
  });
  repo.updateOnboardingSessionSummary(session.id, "User asked about sharing.");

  const loaded = repo.getOnboardingSessionForProject(project.id, session.id);
  assert.equal(loaded?.audience, "Product manager");
  assert.deepEqual(loaded?.focus, ["sharing", "privacy"]);
  assert.deepEqual(loaded?.sourceFiles, ["README.md", "src/share.ts"]);
  assert.equal(loaded?.sources[0].filePath, "src/share.ts");
  assert.equal(loaded?.citationVerification?.valid, true);
  assert.equal(loaded?.retrievalTime, 12);
  assert.equal(loaded?.generationTime, 34);
  assert.equal(loaded?.generationTruncated, true);
  assert.equal(loaded?.rollingSummary, "User asked about sharing.");
  assert.equal(repo.getLatestOnboardingSessionForProject(project.id), undefined);
  assert.equal(repo.listProjects().find((item) => item.id === project.id)?.hasCompletedBriefing, false);

  const messages = repo.listOnboardingMessages(session.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].citationVerification?.valid, true);
  assert.equal(messages[1].sources[0].filePath, "src/share.ts");
});

test("ProjectRepo only marks completed briefings as recent", async () => {
  const { ProjectRepo } = await import("../src/db/project-repo");
  const { DEFAULT_PERSONA } = await import("../src/persona/types");
  const repo = new ProjectRepo();

  const indexedOnly = repo.createProject("indexed only", "/tmp/repo-indexed-only");
  const partial = repo.createProject("partial briefing", "/tmp/repo-partial-briefing");
  const complete = repo.createProject("complete briefing", "/tmp/repo-complete-briefing");

  repo.createOnboardingSession({
    projectId: partial.id,
    repoName: partial.name,
    persona: DEFAULT_PERSONA,
    brief: "A partial briefing.",
    sourceFiles: ["README.md"],
    generationTruncated: true,
  });
  const completeSession = repo.createOnboardingSession({
    projectId: complete.id,
    repoName: complete.name,
    persona: DEFAULT_PERSONA,
    brief: "A complete briefing.",
    sourceFiles: ["README.md"],
  });

  const projects = repo.listProjects();
  assert.equal(projects.find((project) => project.id === indexedOnly.id)?.hasCompletedBriefing, false);
  assert.equal(projects.find((project) => project.id === partial.id)?.hasCompletedBriefing, false);
  assert.equal(projects.find((project) => project.id === complete.id)?.hasCompletedBriefing, true);
  assert.equal(
    projects.find((project) => project.id === complete.id)?.latestCompletedBriefingAt,
    completeSession.updatedAt,
  );
  assert.equal(repo.getLatestOnboardingSessionForProject(partial.id), undefined);
  assert.equal(repo.getLatestOnboardingSessionForProject(complete.id)?.id, completeSession.id);
});

test("ProjectRepo tolerates corrupt onboarding JSON fields", async () => {
  const { ProjectRepo } = await import("../src/db/project-repo");
  const { DEFAULT_PERSONA } = await import("../src/persona/types");
  const { getDatabase } = await import("../src/db/schema");
  const repo = new ProjectRepo();
  const project = repo.createProject("repo with corrupt onboarding", "/tmp/repo-with-corrupt-onboarding");
  const session = repo.createOnboardingSession({
    projectId: project.id,
    repoName: project.name,
    focus: ["sharing"],
    persona: DEFAULT_PERSONA,
    brief: "Brief",
    sourceFiles: ["README.md"],
  });
  repo.addOnboardingMessage({
    sessionId: session.id,
    role: "assistant",
    content: "Answer",
    sources: [{ filePath: "README.md", name: "README", kind: "module", lines: "1-2" }],
  });

  getDatabase()
    .prepare("UPDATE onboarding_sessions SET focus_json = ?, source_files_json = ?, persona_json = ? WHERE id = ?")
    .run("{}", "[1]", "[]", session.id);
  getDatabase().prepare("UPDATE onboarding_messages SET sources_json = ? WHERE session_id = ?").run("[1]", session.id);

  const loaded = repo.getOnboardingSessionForProject(project.id, session.id);
  assert.deepEqual(loaded?.focus, []);
  assert.deepEqual(loaded?.sourceFiles, []);
  assert.deepEqual(loaded?.persona, DEFAULT_PERSONA);
  assert.deepEqual(repo.listOnboardingMessages(session.id)[0].sources, []);
});
