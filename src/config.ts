import path from "path";

export const DEFAULT_CHAT_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1";
export const DEFAULT_CHAT_MODEL = "hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL";
export const DEFAULT_EMBEDDING_MODEL = "hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M";

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
  embedding: {
    provider: "openai";
    baseUrl: string;
    model: string;
    apiKey: string;
    maxInputTokens: number;
    concurrency: number;
    maxRetries: number;
    fallbackOnFailure: boolean;
    maxFallbackRatio: number;
  };
  meilisearch: {
    host: string;
    apiKey: string;
  };
  qdrant: {
    host: string;
    port: number;
    vectorSize: number;
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
    keywordTopK: number;
    semanticTopK: number;
    fusedTopK: number;
    rrf_k: number;
    vendoredPenalty: number;
    localReranker: {
      enabled: boolean;
      topK: number;
    };
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
  const embeddingProvider = getString(env, "SONAR_EMBEDDING_PROVIDER", "openai");
  if (embeddingProvider !== "openai") {
    throw new Error(`SONAR_EMBEDDING_PROVIDER must be "openai"; received "${embeddingProvider}"`);
  }
  const embeddingBaseUrl = getUrl(env, "SONAR_EMBEDDING_BASE_URL", chatBaseUrl);
  const embeddingModel = getString(env, "SONAR_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL);

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
    embedding: {
      provider: embeddingProvider,
      baseUrl: embeddingBaseUrl,
      model: embeddingModel,
      apiKey: getString(env, "SONAR_EMBEDDING_API_KEY", "not-needed"),
      maxInputTokens: getInteger(env, "SONAR_EMBEDDING_MAX_INPUT_TOKENS", 384),
      concurrency: getInteger(env, "SONAR_EMBEDDING_CONCURRENCY", 2),
      maxRetries: getInteger(env, "SONAR_EMBEDDING_MAX_RETRIES", 2),
      fallbackOnFailure: getBoolean(env, "SONAR_EMBEDDING_FALLBACK_ON_FAILURE", true),
      maxFallbackRatio: getNumber(env, "SONAR_EMBEDDING_MAX_FALLBACK_RATIO", 0.1),
    },
    meilisearch: {
      host: getUrl(env, "SONAR_MEILI_HOST", "http://localhost:7700"),
      apiKey: getString(env, "SONAR_MEILI_API_KEY", env.SONAR_API_TOKEN ?? ""),
    },
    qdrant: {
      host: getString(env, "SONAR_QDRANT_HOST", "localhost"),
      port: getInteger(env, "SONAR_QDRANT_PORT", 6333),
      vectorSize: getInteger(env, "SONAR_QDRANT_VECTOR_SIZE", 768),
    },
    parser: {
      supportedLanguages: ["typescript", "python", "javascript", "rust", "go", "java", "csharp", "markdown"],
      maxChunkTokens: 2000,
      maxFiles: getInteger(env, "SONAR_MAX_INDEX_FILES", 5000),
      maxFileBytes: getInteger(env, "SONAR_MAX_INDEX_FILE_BYTES", 1_000_000),
      maxTotalBytes: getInteger(env, "SONAR_MAX_INDEX_TOTAL_BYTES", 50_000_000),
      maxDepth: getInteger(env, "SONAR_MAX_INDEX_DEPTH", 25),
    },
    retriever: {
      keywordTopK: 30,
      semanticTopK: 30,
      fusedTopK: 10,
      rrf_k: 60,
      vendoredPenalty: 0.2,
      localReranker: {
        enabled: getBoolean(env, "SONAR_LOCAL_RERANKER_ENABLED", false),
        topK: getInteger(env, "SONAR_LOCAL_RERANKER_TOP_K", 30),
      },
    },
    generator: {
      maxContextTokens: getInteger(env, "SONAR_MAX_CONTEXT_TOKENS", 1800),
      maxResponseTokens: getInteger(env, "SONAR_MAX_RESPONSE_TOKENS", 900),
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
