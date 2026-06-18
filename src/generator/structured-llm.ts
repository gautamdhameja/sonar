import { logger } from "../utils/logger";
import { generateCompletion, LlmCompletion } from "./llm-client";

export interface StructuredValidation<T> {
  valid: boolean;
  value: T | null;
  errors: string[];
}

export type StructuredCompletion = (
  system: string,
  user: string,
  options?: { signal?: AbortSignal },
) => Promise<LlmCompletion>;

export interface GenerateStructuredJsonOptions<T> {
  system: string;
  user: string;
  validate: (value: unknown) => StructuredValidation<T>;
  complete?: StructuredCompletion;
  maxRepairAttempts?: number;
  label?: string;
  signal?: AbortSignal;
}

export type StructuredJsonResult<T> =
  | {
      ok: true;
      value: T;
      attempts: number;
      repaired: boolean;
      rawContent: string;
    }
  | {
      ok: false;
      attempts: number;
      errors: string[];
      rawContent: string;
      truncated: boolean;
    };

export function extractJsonText(content: string): string | null {
  const start = content.search(/[[{]/);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }

    if (char === "}" || char === "]") {
      const expected = stack.pop();
      if (expected !== char) return null;
      if (stack.length === 0) return content.slice(start, index + 1);
    }
  }

  return null;
}

export function parseJsonFromModel(content: string): { value: unknown | null; errors: string[] } {
  const jsonText = extractJsonText(content);
  if (!jsonText) return { value: null, errors: ["No complete JSON object or array found in model response"] };

  try {
    return { value: JSON.parse(jsonText), errors: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { value: null, errors: [`Invalid JSON: ${message}`] };
  }
}

function buildRepairPrompt(originalUser: string, rawContent: string, errors: string[]): string {
  return [
    originalUser,
    "",
    "## Repair Required",
    "Return only valid JSON matching the requested schema.",
    "If the previous response was truncated, return a much shorter JSON object instead of repeating the same length.",
    "Do not add facts that are not supported by the supplied source excerpts.",
    "If a claim lacks source evidence, remove it or put it in warnings/openQuestions instead of inventing citations.",
    "Validation errors:",
    ...errors.map((error) => `- ${error}`),
    "",
    "Previous response:",
    rawContent.slice(0, 8000),
  ].join("\n");
}

export async function generateStructuredJson<T>(
  options: GenerateStructuredJsonOptions<T>,
): Promise<StructuredJsonResult<T>> {
  const complete = options.complete;
  const maxRepairAttempts = options.maxRepairAttempts ?? 1;
  let user = options.user;
  let rawContent = "";
  let truncated = false;
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= maxRepairAttempts + 1; attempt += 1) {
    const label = options.label ? `${options.label} attempt ${attempt}` : undefined;
    const completion = complete
      ? await complete(options.system, user, { signal: options.signal })
      : await generateCompletion(options.system, user, { label, signal: options.signal });
    rawContent = completion.content;
    truncated = completion.truncated;

    const parsed = parseJsonFromModel(rawContent);
    if (parsed.value !== null) {
      const validation = options.validate(parsed.value);
      if (validation.valid && validation.value) {
        return {
          ok: true,
          value: validation.value,
          attempts: attempt,
          repaired: attempt > 1,
          rawContent,
        };
      }
      lastErrors = validation.errors.length > 0 ? validation.errors : ["Structured JSON failed validation"];
    } else {
      lastErrors = parsed.errors;
    }

    if (truncated) lastErrors = [...lastErrors, "Model response was truncated"];
    logger.warn(`Structured JSON invalid${label ? ` for ${label}` : ""}: ${lastErrors.join("; ")}`);
    if (attempt <= maxRepairAttempts) user = buildRepairPrompt(options.user, rawContent, lastErrors);
  }

  return {
    ok: false,
    attempts: maxRepairAttempts + 1,
    errors: lastErrors,
    rawContent,
    truncated,
  };
}
