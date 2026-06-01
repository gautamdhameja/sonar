import { invoke } from "@tauri-apps/api/core";
import type { FollowupResponse, IndexProjectResponse, OnboardingSessionResponse, Project } from "./types";
import { briefingRoleProfiles } from "./app/constants";
import type { BriefingRole } from "./app/types";

export const apiBaseUrl = "http://127.0.0.1:3001";

let apiToken = "";

interface DesktopTokenConfig {
  apiToken?: string | null;
}

export function setApiToken(token: string | null | undefined): void {
  apiToken = token?.trim() ?? "";
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

async function hydrateApiToken(): Promise<void> {
  if (apiToken || !isTauriRuntime()) return;
  const config = await invoke<DesktopTokenConfig>("get_model_config");
  setApiToken(config.apiToken);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await hydrateApiToken();
  return requestWithToken<T>(path, init, true);
}

async function requestWithToken<T>(
  path: string,
  init: RequestInit | undefined,
  allowTokenRefresh: boolean,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(apiToken ? { "X-Sonar-Token": apiToken } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const body = text && contentType.includes("application/json") ? (JSON.parse(text) as unknown) : {};

  if (response.status === 401 && allowTokenRefresh && isTauriRuntime()) {
    apiToken = "";
    await hydrateApiToken();
    if (apiToken) return requestWithToken<T>(path, init, false);
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : text.trim()
          ? `Request failed with ${response.status}: ${text.trim().slice(0, 300)}`
          : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export async function listProjects(): Promise<Project[]> {
  return request<Project[]>("/projects");
}

export async function indexProject(
  repoRoot: string,
  name: string,
  signal?: AbortSignal,
  summarize = false,
): Promise<IndexProjectResponse> {
  return request("/projects/index", {
    method: "POST",
    signal,
    body: JSON.stringify({ repoRoot, name, summarize }),
  });
}

export async function createOnboardingSession(
  projectId: string,
  briefingRole: BriefingRole,
  signal?: AbortSignal,
): Promise<OnboardingSessionResponse> {
  const profile = briefingRoleProfiles[briefingRole];

  return request<OnboardingSessionResponse>(`/projects/${projectId}/onboarding/sessions`, {
    method: "POST",
    signal,
    body: JSON.stringify({
      audience: profile.audience,
      focus: profile.focus,
      persona: profile.persona,
    }),
  });
}

export async function getLatestOnboardingSession(projectId: string): Promise<OnboardingSessionResponse | null> {
  try {
    return await request<OnboardingSessionResponse>(`/projects/${projectId}/onboarding/sessions/latest`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("No saved briefing found")) return null;
    throw err;
  }
}

export async function askFollowup(
  projectId: string,
  sessionId: string,
  question: string,
  history: FollowupResponse[] = [],
): Promise<FollowupResponse> {
  return request<FollowupResponse>(`/projects/${projectId}/onboarding/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      question,
      history: history.map((item) => ({
        question: item.question,
        answer: item.answer,
        intent: item.intent,
      })),
    }),
  });
}
