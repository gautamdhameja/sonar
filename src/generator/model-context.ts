import { CONFIG } from "../config";
import { logger } from "../utils/logger";

const DEFAULT_CONTEXT_FRACTION = 0.35;
const MIN_CONTEXT_BUDGET_TOKENS = 600;
const MAX_CONTEXT_BUDGET_TOKENS = 24_000;
const MIN_RESPONSE_BUDGET_TOKENS = 1_800;
const MAX_RESPONSE_BUDGET_TOKENS = 4_000;

let supportsGrammar = false;

export function modelSupportsGrammar(): boolean {
  return supportsGrammar;
}

export function responseBudgetFromWindow(contextWindowTokens: number): number {
  // Give the model room to write a full section. Scales with the window but is capped so
  // local generation stays interactive; large windows get the full ceiling.
  const candidate = Math.floor(contextWindowTokens * 0.05);
  return clamp(candidate, MIN_RESPONSE_BUDGET_TOKENS, MAX_RESPONSE_BUDGET_TOKENS);
}

export interface ModelContextBudget {
  contextWindowTokens: number;
  maxContextTokens: number;
  propsUrl: string;
}

export function propsEndpointCandidates(baseUrl: string): string[] {
  const url = new URL(baseUrl);
  const candidates: string[] = [];
  const normalizedPath = url.pathname.replace(/\/+$/, "");

  if (normalizedPath === "/v1" || normalizedPath.endsWith("/v1")) {
    const root = new URL(url.toString());
    const propsRoot = normalizedPath.slice(0, -"/v1".length);
    root.pathname = propsRoot ? `${propsRoot}/` : "/";
    root.search = "";
    root.hash = "";
    candidates.push(new URL("props", root).toString());
  }

  const atBase = new URL(`${baseUrl.replace(/\/+$/, "")}/props`);
  atBase.search = "";
  atBase.hash = "";
  candidates.push(atBase.toString());

  return [...new Set(candidates)];
}

export function extractContextWindowTokens(props: unknown): number | null {
  return findNumericProp(props, new Set(["n_ctx", "context_length", "max_context_length", "max_position_embeddings"]));
}

export function contextBudgetFromWindow(
  contextWindowTokens: number,
  maxResponseTokens: number,
  fraction = DEFAULT_CONTEXT_FRACTION,
): number {
  // n_ctx is model capacity, not a latency guarantee. Keep the automatic budget
  // large enough to benefit long-context models while preserving interactive
  // local generation under the default request timeout.
  const candidate = Math.floor(contextWindowTokens * fraction);
  const outputAndInstructionReserve = maxResponseTokens + 1_200;
  const upperBound = contextWindowTokens - outputAndInstructionReserve;
  const bounded = upperBound > 0 ? Math.min(candidate, upperBound) : candidate;
  return clamp(bounded, MIN_CONTEXT_BUDGET_TOKENS, MAX_CONTEXT_BUDGET_TOKENS);
}

export async function configureDynamicContextBudget(): Promise<ModelContextBudget | null> {
  supportsGrammar = false;
  const explicitContextBudget = Boolean(process.env.SONAR_MAX_CONTEXT_TOKENS?.trim());
  if (process.env.SONAR_MAX_CONTEXT_TOKENS?.trim()) {
    logger.info(
      `Using explicit SONAR_MAX_CONTEXT_TOKENS=${CONFIG.generator.maxContextTokens}; /props probe will not change source context budget`,
    );
  }

  for (const propsUrl of propsEndpointCandidates(CONFIG.chat.baseUrl)) {
    for (const headers of propsRequestHeaders()) {
      const props = await fetchModelProps(propsUrl, headers);
      if (!props) continue;

      const contextWindowTokens = extractContextWindowTokens(props);
      if (!contextWindowTokens) continue;

      supportsGrammar = true;
      if (!process.env.SONAR_MAX_RESPONSE_TOKENS?.trim()) {
        CONFIG.generator.maxResponseTokens = responseBudgetFromWindow(contextWindowTokens);
      }
      const maxContextTokens = explicitContextBudget
        ? CONFIG.generator.maxContextTokens
        : contextBudgetFromWindow(contextWindowTokens, CONFIG.generator.maxResponseTokens);
      CONFIG.generator.maxContextTokens = maxContextTokens;
      logger.info(
        `Model context window detected from ${propsUrl}: n_ctx=${contextWindowTokens}; sourceContextBudget=${maxContextTokens}; responseBudget=${CONFIG.generator.maxResponseTokens}`,
      );
      return { contextWindowTokens, maxContextTokens, propsUrl };
    }
  }

  logger.info(`Model /props did not expose n_ctx; using sourceContextBudget=${CONFIG.generator.maxContextTokens}`);
  return null;
}

function propsRequestHeaders(): Array<Record<string, string> | undefined> {
  const headers: Array<Record<string, string> | undefined> = [undefined];
  if (CONFIG.chat.apiKey && CONFIG.chat.apiKey !== "not-needed") {
    headers.push({ Authorization: `Bearer ${CONFIG.chat.apiKey}` });
  }
  return headers;
}

async function fetchModelProps(propsUrl: string, headers: Record<string, string> | undefined): Promise<unknown | null> {
  try {
    const response = await fetch(propsUrl, {
      headers,
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;

    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function findNumericProp(value: unknown, names: Set<string>, seen = new Set<unknown>()): number | null {
  if (value === null || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  for (const [key, raw] of Object.entries(value)) {
    if (names.has(key)) {
      const parsed = numericValue(raw);
      if (parsed) return parsed;
    }
  }

  for (const raw of Object.values(value)) {
    const nested = findNumericProp(raw, names, seen);
    if (nested) return nested;
  }

  return null;
}

function numericValue(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
