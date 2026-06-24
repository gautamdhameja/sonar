import path from "path";

export const DEFAULT_CHAT_BASE_URL = "http://127.0.0.1:8080/v1";
export const DEFAULT_CHAT_MODEL = "local-model";

export interface SonarConfig {
  api: {
    host: string;
    corsAllowedOrigins: string[];
  };
  chat: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  parser: {
    supportedLanguages: readonly string[];
    maxChunkTokens: number;
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    maxDepth: number;
  };
  retriever: {
    fusedTopK: number;
  };
  generator: {
    maxContextTokens: number;
    maxResponseTokens: number;
    temperature: number;
  };
  storage: {
    dataDir: string;
    dbPath: string;
  };
  security: {
    allowedRepoRoots: string[];
    allowAnyRepoRoot: boolean;
    apiToken: string | null;
  };
}

type Env = NodeJS.ProcessEnv;

function defaultDataDir(env: Env): string {
  const home = env.HOME || env.USERPROFILE || ".";
  return path.join(home, ".sonar");
}

function getString(env: Env, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function getUrl(env: Env, name: string, fallback: string): string {
  const value = getString(env, name, fallback);
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL; received "${value}"`);
  }
}

function getInteger(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim() || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; received "${raw}"`);
  }
  return parsed;
}

function getNumber(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number; received "${raw}"`);
  }
  return parsed;
}

function getBoolean(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean; received "${raw}"`);
}

function optionalToken(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  return value.trim();
}

function getAllowedRepoRoots(env: Env): string[] {
  const raw = env.SONAR_ALLOWED_REPO_ROOTS;
  if (!raw || raw.trim() === "") return [process.cwd()];
  return raw
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function getStringList(env: Env, name: string, fallback: string[]): string[] {
  const raw = env[name];
  if (!raw || raw.trim() === "") return fallback;
  return raw
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(env: Env = process.env): SonarConfig {
  const dataDir = path.resolve(getString(env, "SONAR_DATA_DIR", defaultDataDir(env)));
  const dbPath = path.resolve(getString(env, "SONAR_DB_PATH", path.join(dataDir, "projects.db")));
  const chatBaseUrl = getUrl(env, "SONAR_CHAT_BASE_URL", DEFAULT_CHAT_BASE_URL);
  const chatModel = getString(env, "SONAR_CHAT_MODEL", DEFAULT_CHAT_MODEL);
  return {
    api: {
      host: getString(env, "SONAR_API_HOST", "127.0.0.1"),
      corsAllowedOrigins: getStringList(env, "SONAR_CORS_ALLOWED_ORIGINS", [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3111",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3111",
        "http://127.0.0.1:5173",
        "http://tauri.localhost",
        "tauri://localhost",
      ]),
    },
    chat: {
      baseUrl: chatBaseUrl,
      model: chatModel,
      apiKey: getString(env, "SONAR_CHAT_API_KEY", "not-needed"),
    },
    parser: {
      supportedLanguages: [
        "typescript",
        "python",
        "javascript",
        "rust",
        "go",
        "java",
        "csharp",
        "ruby",
        "cpp",
        "php",
        "kotlin",
        "swift",
        "markdown",
        "json",
        "prisma",
      ],
      maxChunkTokens: 2000,
      maxFiles: getInteger(env, "SONAR_MAX_INDEX_FILES", 5000),
      maxFileBytes: getInteger(env, "SONAR_MAX_INDEX_FILE_BYTES", 1_000_000),
      maxTotalBytes: getInteger(env, "SONAR_MAX_INDEX_TOTAL_BYTES", 50_000_000),
      maxDepth: getInteger(env, "SONAR_MAX_INDEX_DEPTH", 25),
    },
    retriever: {
      fusedTopK: 10,
    },
    generator: {
      maxContextTokens: getInteger(env, "SONAR_MAX_CONTEXT_TOKENS", 1800),
      maxResponseTokens: getInteger(env, "SONAR_MAX_RESPONSE_TOKENS", 1800),
      temperature: getNumber(env, "SONAR_TEMPERATURE", 0.1),
    },
    storage: {
      dataDir,
      dbPath,
    },
    security: {
      allowedRepoRoots: getAllowedRepoRoots(env),
      allowAnyRepoRoot: getBoolean(env, "SONAR_ALLOW_ANY_REPO_ROOT", false),
      apiToken: optionalToken(env.SONAR_API_TOKEN),
    },
  };
}

export const CONFIG = loadConfig();
