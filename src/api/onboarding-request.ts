import { optionalStringList, optionalTrimmedString } from "./request-validation";

export function parseOnboardingRequest(body: unknown): {
  audience?: string;
  focus?: string[];
  error?: string;
} {
  const requestBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const audience = optionalTrimmedString(requestBody.audience, 1000);
  const focus = optionalStringList(requestBody.focus, "focus", 10);
  if (focus.error) return { error: focus.error };
  return { audience, focus: focus.value };
}
