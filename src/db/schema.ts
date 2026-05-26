import Database from "better-sqlite3";
import path from "path";
import { mkdirSync } from "fs";
import { CONFIG } from "../config";

export function getDatabase(): Database.Database {
  const DB_PATH = CONFIG.storage.dbPath;
  const DB_DIR = path.dirname(DB_PATH);
  mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  const addColumnIfMissing = (sql: string): void => {
    try {
      db.exec(sql);
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (message.includes("duplicate column name") || message.includes("no such table")) return;
      throw err;
    }
  };

  addColumnIfMissing("ALTER TABLE projects ADD COLUMN summary TEXT");
  addColumnIfMissing("ALTER TABLE projects ADD COLUMN summary_generated_at TEXT");
  addColumnIfMissing("ALTER TABLE code_units ADD COLUMN is_vendored INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("ALTER TABLE dependency_edges ADD COLUMN edge_type TEXT NOT NULL DEFAULT 'imports'");

  db.exec(`
    PRAGMA user_version = 1;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL UNIQUE,
      indexed_at TEXT NOT NULL,
      unit_count INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      summary_generated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS code_units (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      language TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      parent_name TEXT,
      imports TEXT NOT NULL DEFAULT '[]',
      docstring TEXT,
      exported_names TEXT NOT NULL DEFAULT '[]',
      called_functions TEXT NOT NULL DEFAULT '[]',
      is_vendored INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_units_project ON code_units(project_id);
    CREATE INDEX IF NOT EXISTS idx_units_file ON code_units(project_id, file_path);
    CREATE INDEX IF NOT EXISTS idx_units_name ON code_units(project_id, name);
    CREATE INDEX IF NOT EXISTS idx_units_kind ON code_units(project_id, kind);

    CREATE TABLE IF NOT EXISTS dependency_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_file TEXT NOT NULL,
      target_file TEXT NOT NULL,
      import_statement TEXT NOT NULL,
      edge_type TEXT NOT NULL DEFAULT 'imports'
    );

    CREATE INDEX IF NOT EXISTS idx_deps_project ON dependency_edges(project_id);
    CREATE INDEX IF NOT EXISTS idx_deps_source ON dependency_edges(project_id, source_file);
    CREATE INDEX IF NOT EXISTS idx_deps_target ON dependency_edges(project_id, target_file);

    CREATE TABLE IF NOT EXISTS embedding_cache (
      cache_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      vector_size INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_embedding_cache_model ON embedding_cache(provider, model, vector_size);
    CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(content_hash);

    CREATE TABLE IF NOT EXISTS onboarding_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      repo_name TEXT NOT NULL,
      audience TEXT,
      focus_json TEXT NOT NULL DEFAULT '[]',
      persona_json TEXT NOT NULL,
      brief TEXT NOT NULL,
      source_files_json TEXT NOT NULL DEFAULT '[]',
      rolling_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_project ON onboarding_sessions(project_id);

    CREATE TABLE IF NOT EXISTS onboarding_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      intent TEXT,
      sources_json TEXT NOT NULL DEFAULT '[]',
      citation_verification_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_onboarding_messages_session ON onboarding_messages(session_id, created_at);
  `);
}
