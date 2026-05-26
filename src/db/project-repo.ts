import Database from "better-sqlite3";
import { getDatabase } from "./schema";
import { CodeUnit } from "../parser/types";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { DEFAULT_PERSONA, Persona } from "../persona/types";
import type { CitationVerification } from "../generator/citation-verifier";

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  indexedAt: string;
  unitCount: number;
  fileCount: number;
  summary: string | null;
  summaryGeneratedAt: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  repo_path: string;
  indexed_at: string;
  unit_count: number;
  file_count: number;
  summary: string | null;
  summary_generated_at: string | null;
}

interface CodeUnitRow {
  id: string;
  project_id: string;
  file_path: string;
  language: string;
  kind: string;
  name: string;
  code: string;
  start_line: number;
  end_line: number;
  parent_name: string | null;
  imports: string;
  docstring: string | null;
  exported_names: string;
  called_functions: string;
  is_vendored: number;
}

export interface OnboardingSession {
  id: string;
  projectId: string;
  repoName: string;
  audience: string | null;
  focus: string[];
  persona: Persona;
  brief: string;
  sourceFiles: string[];
  rollingSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  intent: string | null;
  sources: Array<{ filePath: string; name: string; kind: string; lines: string }>;
  citationVerification: CitationVerification | null;
  createdAt: string;
}

interface OnboardingSessionRow {
  id: string;
  project_id: string;
  repo_name: string;
  audience: string | null;
  focus_json: string;
  persona_json: string;
  brief: string;
  source_files_json: string;
  rolling_summary: string | null;
  created_at: string;
  updated_at: string;
}

interface OnboardingMessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  intent: string | null;
  sources_json: string;
  citation_verification_json: string | null;
  created_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    indexedAt: row.indexed_at,
    unitCount: row.unit_count,
    fileCount: row.file_count,
    summary: row.summary,
    summaryGeneratedAt: row.summary_generated_at,
  };
}

function parseJsonArrayField(value: string, fieldName: string, unitId: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    logger.warn(`Invalid ${fieldName} JSON for code unit ${unitId}; using empty array`);
    return [];
  }
}

function parseJsonObjectField<T>(value: string | null, fallback: T, fieldName: string, id: string): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    logger.warn(`Invalid ${fieldName} JSON for ${id}; using fallback`);
    return fallback;
  }
}

function rowToCodeUnit(row: CodeUnitRow): CodeUnit {
  return {
    id: row.id,
    filePath: row.file_path,
    language: row.language,
    kind: row.kind as CodeUnit["kind"],
    name: row.name,
    code: row.code,
    startLine: row.start_line,
    endLine: row.end_line,
    parentName: row.parent_name,
    imports: parseJsonArrayField(row.imports, "imports", row.id),
    docstring: row.docstring,
    exportedNames: parseJsonArrayField(row.exported_names, "exported_names", row.id),
    calledFunctions: parseJsonArrayField(row.called_functions, "called_functions", row.id),
    isVendored: row.is_vendored === 1,
  };
}

function rowToOnboardingSession(row: OnboardingSessionRow): OnboardingSession {
  return {
    id: row.id,
    projectId: row.project_id,
    repoName: row.repo_name,
    audience: row.audience,
    focus: parseJsonObjectField(row.focus_json, [], "focus", row.id),
    persona: parseJsonObjectField(row.persona_json, DEFAULT_PERSONA, "persona", row.id),
    brief: row.brief,
    sourceFiles: parseJsonObjectField(row.source_files_json, [], "source files", row.id),
    rollingSummary: row.rolling_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToOnboardingMessage(row: OnboardingMessageRow): OnboardingMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    intent: row.intent,
    sources: parseJsonObjectField(row.sources_json, [], "message sources", row.id),
    citationVerification: parseJsonObjectField(row.citation_verification_json, null, "citation verification", row.id),
    createdAt: row.created_at,
  };
}

export class ProjectRepo {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  createProject(name: string, repoPath: string): Project {
    const id = uuidv4();
    const indexedAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO projects (id, name, repo_path, indexed_at, unit_count, file_count)
         VALUES (?, ?, ?, ?, 0, 0)`,
      )
      .run(id, name, repoPath, indexedAt);

    return { id, name, repoPath, indexedAt, unitCount: 0, fileCount: 0, summary: null, summaryGeneratedAt: null };
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? rowToProject(row) : undefined;
  }

  getProjectByPath(repoPath: string): Project | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE repo_path = ?").get(repoPath) as ProjectRow | undefined;
    return row ? rowToProject(row) : undefined;
  }

  listProjects(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY indexed_at DESC").all() as ProjectRow[];
    return rows.map(rowToProject);
  }

  deleteProject(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  updateProjectStats(id: string, unitCount: number, fileCount: number): void {
    this.db
      .prepare("UPDATE projects SET unit_count = ?, file_count = ? WHERE id = ?")
      .run(unitCount, fileCount, id);
  }

  updateProjectSummary(id: string, summary: string): void {
    this.db
      .prepare("UPDATE projects SET summary = ?, summary_generated_at = ? WHERE id = ?")
      .run(summary, new Date().toISOString(), id);
  }

  insertCodeUnits(projectId: string, units: CodeUnit[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO code_units (id, project_id, file_path, language, kind, name, code, start_line, end_line, parent_name, imports, docstring, exported_names, called_functions, is_vendored)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertAll = this.db.transaction((items: CodeUnit[]) => {
      for (const u of items) {
        stmt.run(
          u.id,
          projectId,
          u.filePath,
          u.language,
          u.kind,
          u.name,
          u.code,
          u.startLine,
          u.endLine,
          u.parentName,
          JSON.stringify(u.imports),
          u.docstring,
          JSON.stringify(u.exportedNames),
          JSON.stringify(u.calledFunctions),
          u.isVendored ? 1 : 0,
        );
      }
    });

    insertAll(units);
  }

  getCodeUnit(id: string): CodeUnit | undefined {
    const row = this.db.prepare("SELECT * FROM code_units WHERE id = ?").get(id) as CodeUnitRow | undefined;
    return row ? rowToCodeUnit(row) : undefined;
  }

  getCodeUnitsByProject(projectId: string): CodeUnit[] {
    const rows = this.db
      .prepare("SELECT * FROM code_units WHERE project_id = ?")
      .all(projectId) as CodeUnitRow[];
    return rows.map(rowToCodeUnit);
  }

  getCodeUnitsByFile(projectId: string, filePath: string): CodeUnit[] {
    const rows = this.db
      .prepare("SELECT * FROM code_units WHERE project_id = ? AND file_path = ?")
      .all(projectId, filePath) as CodeUnitRow[];
    return rows.map(rowToCodeUnit);
  }

  getCodeUnitsByName(projectId: string, name: string): CodeUnit[] {
    const rows = this.db
      .prepare("SELECT * FROM code_units WHERE project_id = ? AND name = ?")
      .all(projectId, name) as CodeUnitRow[];
    return rows.map(rowToCodeUnit);
  }

  getMethodsOfClass(projectId: string, className: string): CodeUnit[] {
    const rows = this.db
      .prepare("SELECT * FROM code_units WHERE project_id = ? AND kind = 'method' AND parent_name = ?")
      .all(projectId, className) as CodeUnitRow[];
    return rows.map(rowToCodeUnit);
  }

  getProjectStats(projectId: string): {
    totalUnits: number;
    byKind: Record<string, number>;
    byLanguage: Record<string, number>;
    totalFiles: number;
  } {
    const kindRows = this.db
      .prepare("SELECT kind, COUNT(*) as count FROM code_units WHERE project_id = ? GROUP BY kind")
      .all(projectId) as Array<{ kind: string; count: number }>;

    const langRows = this.db
      .prepare("SELECT language, COUNT(*) as count FROM code_units WHERE project_id = ? GROUP BY language")
      .all(projectId) as Array<{ language: string; count: number }>;

    const fileRow = this.db
      .prepare("SELECT COUNT(DISTINCT file_path) as count FROM code_units WHERE project_id = ?")
      .get(projectId) as { count: number };

    const byKind: Record<string, number> = {};
    let totalUnits = 0;
    for (const row of kindRows) {
      byKind[row.kind] = row.count;
      totalUnits += row.count;
    }

    const byLanguage: Record<string, number> = {};
    for (const row of langRows) {
      byLanguage[row.language] = row.count;
    }

    return { totalUnits, byKind, byLanguage, totalFiles: fileRow.count };
  }

  insertDependencyEdges(
    projectId: string,
    edges: Array<{ sourceFile: string; targetFile: string; importStatement: string; edgeType?: string }>,
  ): void {
    const stmt = this.db.prepare(
      `INSERT INTO dependency_edges (project_id, source_file, target_file, import_statement, edge_type)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const insertAll = this.db.transaction((items: typeof edges) => {
      for (const e of items) {
        stmt.run(projectId, e.sourceFile, e.targetFile, e.importStatement, e.edgeType ?? "imports");
      }
    });

    insertAll(edges);
  }

  getDependencyEdges(
    projectId: string,
  ): Array<{ sourceFile: string; targetFile: string; importStatement: string; edgeType: string }> {
    const rows = this.db
      .prepare("SELECT source_file, target_file, import_statement, edge_type FROM dependency_edges WHERE project_id = ?")
      .all(projectId) as Array<{ source_file: string; target_file: string; import_statement: string; edge_type: string }>;

    return rows.map((r) => ({
      sourceFile: r.source_file,
      targetFile: r.target_file,
      importStatement: r.import_statement,
      edgeType: r.edge_type,
    }));
  }

  createOnboardingSession(input: {
    projectId: string;
    repoName: string;
    audience?: string | null;
    focus?: string[];
    persona: Persona;
    brief: string;
    sourceFiles: string[];
    rollingSummary?: string | null;
  }): OnboardingSession {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO onboarding_sessions
          (id, project_id, repo_name, audience, focus_json, persona_json, brief, source_files_json, rolling_summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.repoName,
        input.audience ?? null,
        JSON.stringify(input.focus ?? []),
        JSON.stringify(input.persona),
        input.brief,
        JSON.stringify(input.sourceFiles),
        input.rollingSummary ?? null,
        now,
        now,
      );

    return {
      id,
      projectId: input.projectId,
      repoName: input.repoName,
      audience: input.audience ?? null,
      focus: input.focus ?? [],
      persona: input.persona,
      brief: input.brief,
      sourceFiles: input.sourceFiles,
      rollingSummary: input.rollingSummary ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  getOnboardingSession(id: string): OnboardingSession | undefined {
    const row = this.db
      .prepare("SELECT * FROM onboarding_sessions WHERE id = ?")
      .get(id) as OnboardingSessionRow | undefined;
    return row ? rowToOnboardingSession(row) : undefined;
  }

  getOnboardingSessionForProject(projectId: string, sessionId: string): OnboardingSession | undefined {
    const row = this.db
      .prepare("SELECT * FROM onboarding_sessions WHERE project_id = ? AND id = ?")
      .get(projectId, sessionId) as OnboardingSessionRow | undefined;
    return row ? rowToOnboardingSession(row) : undefined;
  }

  updateOnboardingSessionSummary(sessionId: string, rollingSummary: string): void {
    this.db
      .prepare("UPDATE onboarding_sessions SET rolling_summary = ?, updated_at = ? WHERE id = ?")
      .run(rollingSummary, new Date().toISOString(), sessionId);
  }

  addOnboardingMessage(input: {
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    intent?: string | null;
    sources?: Array<{ filePath: string; name: string; kind: string; lines: string }>;
    citationVerification?: CitationVerification | null;
  }): OnboardingMessage {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO onboarding_messages
          (id, session_id, role, content, intent, sources_json, citation_verification_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.role,
        input.content,
        input.intent ?? null,
        JSON.stringify(input.sources ?? []),
        input.citationVerification ? JSON.stringify(input.citationVerification) : null,
        now,
      );

    return {
      id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      intent: input.intent ?? null,
      sources: input.sources ?? [],
      citationVerification: input.citationVerification ?? null,
      createdAt: now,
    };
  }

  listOnboardingMessages(sessionId: string, limit = 12): OnboardingMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM onboarding_messages
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(sessionId, limit) as OnboardingMessageRow[];
    return rows.reverse().map(rowToOnboardingMessage);
  }

  close(): void {
    this.db.close();
  }
}
