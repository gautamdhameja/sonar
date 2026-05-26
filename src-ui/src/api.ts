import type { FollowupResponse, OnboardingSessionResponse, Project } from "./types";

export const apiBaseUrl = "http://127.0.0.1:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
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
): Promise<{ projectId: string; unitCount: number; timeSeconds: number }> {
  return request("/projects/index", {
    method: "POST",
    body: JSON.stringify({ repoRoot, name, summarize: true }),
  });
}

export async function createOnboardingSession(projectId: string): Promise<OnboardingSessionResponse> {
  return request<OnboardingSessionResponse>(`/projects/${projectId}/onboarding/sessions`, {
    method: "POST",
    body: JSON.stringify({
      audience: "A product manager joining the team in their first week",
      focus: [
        "what the product does",
        "top user workflows",
        "local/offline behavior",
        "collaboration and sharing",
        "privacy and operational risks",
        "questions to ask engineering",
      ],
      persona: {
        role: "product_manager",
        technicalBackground: "basic",
        avoidJargon: true,
        explanationDepth: "standard",
        businessContext: "Create first-week onboarding documentation, not deep code analysis.",
      },
    }),
  });
}

export async function askFollowup(projectId: string, sessionId: string, question: string): Promise<FollowupResponse> {
  return request<FollowupResponse>(`/projects/${projectId}/onboarding/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}
