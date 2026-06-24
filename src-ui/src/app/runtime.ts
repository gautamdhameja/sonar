import { invoke } from "@tauri-apps/api/core";
import { apiBaseUrl } from "../api";
import type {
  ClonedRepository,
  DesktopModelConfig,
  DiagnosticsBundle,
  PreparedRepository,
  ServiceSnapshot,
} from "../types";
import { localLlamaConfig } from "./constants";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

async function browserServiceSnapshot(): Promise<ServiceSnapshot> {
  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      apiBaseUrl,
      chatBaseUrl: "Configured on the desktop runtime",
      services: [
        {
          id: "sonar",
          label: "Workspace engine",
          state: "ready",
          detail: "responding",
          url: `${apiBaseUrl}/health`,
          managed: false,
        },
        {
          id: "desktop",
          label: "Desktop service manager",
          state: "missing",
          detail: "open with Tauri to start local services",
          managed: true,
        },
      ],
    };
  } catch (err) {
    return {
      apiBaseUrl,
      chatBaseUrl: "Configured on the desktop runtime",
      services: [
        {
          id: "sonar",
          label: "Workspace engine",
          state: "missing",
          detail: err instanceof Error ? err.message : String(err),
          url: `${apiBaseUrl}/health`,
          managed: false,
        },
        {
          id: "desktop",
          label: "Desktop service manager",
          state: "missing",
          detail: "open with Tauri to start local services",
          managed: true,
        },
      ],
    };
  }
}

export async function serviceCommand(command: "service_snapshot" | "bootstrap_services"): Promise<ServiceSnapshot> {
  if (isTauriRuntime()) {
    return invoke<ServiceSnapshot>(command);
  }
  return browserServiceSnapshot();
}

export async function cloneGithubRepository(repository: string): Promise<ClonedRepository> {
  if (!isTauriRuntime()) {
    throw new Error("Open Sonar as a desktop app to clone GitHub repositories automatically.");
  }
  return invoke<ClonedRepository>("clone_github_repository", { repository });
}

export async function prepareRepositoryForIndexing(repoPath: string, projectName: string): Promise<PreparedRepository> {
  if (!isTauriRuntime()) {
    return { localPath: repoPath, indexedPath: repoPath };
  }
  return invoke<PreparedRepository>("prepare_repository_for_indexing", { repoPath, projectName });
}

export async function loadModelConfig(): Promise<DesktopModelConfig> {
  if (!isTauriRuntime()) {
    return localLlamaConfig;
  }
  return invoke<DesktopModelConfig>("get_model_config");
}

export async function saveModelConfig(config: DesktopModelConfig): Promise<ServiceSnapshot> {
  const savedConfig = { ...config, modelSetupComplete: true };
  if (!isTauriRuntime()) {
    return browserServiceSnapshot();
  }
  return invoke<ServiceSnapshot>("save_model_config", { config: savedConfig });
}

export async function createDiagnosticsBundle(): Promise<DiagnosticsBundle> {
  if (!isTauriRuntime()) {
    throw new Error("Open Sonar as a desktop app to create a local diagnostics bundle.");
  }
  return invoke<DiagnosticsBundle>("create_diagnostics_bundle");
}
