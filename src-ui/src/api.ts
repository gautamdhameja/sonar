import { invoke } from "@tauri-apps/api/core";
import type { FollowupResponse, IndexProjectResponse, OnboardingSessionResponse, Project } from "./types";
import { briefingRoleProfiles } from "./app/constants";
import type { BriefingRole } from "./app/types";

export const apiBaseUrl = "http://127.0.0.1:3001";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (isTauriRuntime()) {
    return requestThroughTauri<T>(path, init);
  }
  return requestDirect<T>(path, init);
}

async function requestDirect<T>(path: string, init: RequestInit | undefined): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  return readResponse<T>(response);
}

async function requestThroughTauri<T>(path: string, init: RequestInit | undefined): Promise<T> {
  const body = parseJsonRequestBody(init?.body);
  const requestPromise = invoke<T>("sonar_api_request", {
    method: init?.method ?? "GET",
    path,
    body,
  });
  return await abortable(requestPromise, init?.signal);
}

function parseJsonRequestBody(body: BodyInit | null | undefined): unknown {
  if (body === undefined || body === null) return null;
  if (typeof body !== "string") {
    throw new Error("Sonar desktop requests only support JSON request bodies.");
  }
  if (!body.trim()) return null;
  return JSON.parse(body) as unknown;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Analysis stopped", "AbortError"));

  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Analysis stopped", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(err);
      },
    );
  });
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const body = text && contentType.includes("application/json") ? (JSON.parse(text) as unknown) : {};

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
