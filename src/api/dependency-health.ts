import fs from "fs";
import path from "path";
import { CONFIG } from "../config";

export interface DependencyHealth {
  name: string;
  status: "ok" | "error";
  message?: string;
}

async function checkFetch(name: string, url: string, init?: RequestInit): Promise<DependencyHealth> {
  try {
    const signal = AbortSignal.timeout(1500);
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) {
      return { name, status: "error", message: `HTTP ${response.status}` };
    }
    return { name, status: "ok" };
  } catch (err) {
    return { name, status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkDependencies(): Promise<DependencyHealth[]> {
  const dbCheck = (() => {
    try {
      fs.mkdirSync(path.dirname(CONFIG.storage.dbPath), { recursive: true });
      return { name: "sqlite", status: "ok" as const };
    } catch (err) {
      return { name: "sqlite", status: "error" as const, message: err instanceof Error ? err.message : String(err) };
    }
  })();

  const meili = checkFetch("meilisearch", `${CONFIG.meilisearch.host}/health`, {
    headers: { Authorization: `Bearer ${CONFIG.meilisearch.apiKey}` },
  });
  const qdrant = checkFetch("qdrant", `http://${CONFIG.qdrant.host}:${CONFIG.qdrant.port}/collections`);
  const ollama = checkFetch("ollama", `${CONFIG.ollama.baseUrl}/api/tags`);
  const chat = checkFetch("chat", `${CONFIG.chat.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${CONFIG.chat.apiKey}` },
  });

  return [dbCheck, ...(await Promise.all([meili, qdrant, ollama, chat]))];
}
