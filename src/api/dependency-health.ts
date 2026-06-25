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
      if (name === "chat" && response.status === 401) {
        return {
          name,
          status: "error",
          message: "Model endpoint rejected the configured API key with HTTP 401.",
        };
      }
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

  const chat = checkFetch("chat", `${CONFIG.chat.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${CONFIG.chat.apiKey}` },
  });

  return [dbCheck, await chat];
}
