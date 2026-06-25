import { CONFIG } from "../config";
import { CodeUnit } from "../parser/types";
import { logger } from "../utils/logger";
import { CitationVerification, verifyCitations } from "./citation-verifier";
import { generateCompletion, LlmCompletion, LlmCompletionOptions } from "./llm-client";
import { modelSupportsGrammar } from "./model-context";
import { allowedCitationMenuForUnits } from "./onboarding-prompt";
import { citationTagForUnit } from "./source-context";

type CompletionFn = (system: string, user: string, options?: LlmCompletionOptions) => Promise<LlmCompletion>;

export interface CitationSelectionRepairResult {
  brief: string;
  attached: number;
  dropped: number;
  calls: number;
}

function escapeGrammarLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function citationChoiceGrammar(choices: string[]): string {
  return `root ::= ${choices.map((choice) => `"${escapeGrammarLiteral(choice)}"`).join(" | ")}`;
}

export function citationChoiceResponseFormat(choices: string[]): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: "citation_choice",
      strict: true,
      schema: {
        type: "object",
        properties: {
          choice: { type: "string", enum: choices },
        },
        required: ["choice"],
        additionalProperties: false,
      },
    },
  };
}

function parseCitationChoice(content: string, allowed: Set<string>): string | "DROP" | null {
  const trimmed = content.trim();
  if (allowed.has(trimmed)) return trimmed;
  if (trimmed === "DROP") return "DROP";

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && "choice" in parsed) {
      const choice = (parsed as { choice?: unknown }).choice;
      if (choice === "DROP") return "DROP";
      if (typeof choice === "string" && allowed.has(choice)) return choice;
    }
  } catch {
    // Fall through to bracket extraction.
  }

  const bracketed = trimmed.match(/\[[^\]]+\]/)?.[0];
  if (bracketed && allowed.has(bracketed)) return bracketed;
  return null;
}

function appendCitationToClaimLine(brief: string, claim: string, tag: string): string {
  const lines = brief.split("\n");
  const index = lines.findIndex((line) => line.includes(claim));
  if (index === -1) return brief;
  const citedClaim = /[.!?]\s*$/.test(claim)
    ? claim.replace(/\s*([.!?])\s*$/, ` ${tag}$1`)
    : `${claim.replace(/\s+$/, "")} ${tag}`;
  lines[index] = lines[index].replace(claim, citedClaim);
  return lines.join("\n");
}

export async function attachCitationsBySelection(
  brief: string,
  units: CodeUnit[],
  verification: CitationVerification,
  options: { signal?: AbortSignal; maxCalls?: number },
  complete: CompletionFn = generateCompletion,
): Promise<CitationSelectionRepairResult> {
  if (!CONFIG.generator.citationRepairSelection || verification.uncitedClaims.length === 0 || units.length === 0) {
    return { brief, attached: 0, dropped: 0, calls: 0 };
  }

  const tags = units.map((unit) => `[${citationTagForUnit(unit)}]`);
  const allowed = new Set(tags);
  const choices = [...tags, "DROP"];
  const grammar = modelSupportsGrammar() ? citationChoiceGrammar(choices) : undefined;
  const responseFormat = grammar ? undefined : citationChoiceResponseFormat(choices);
  const maxCalls = Math.min(
    options.maxCalls ?? CONFIG.generator.citationRepairMaxCalls,
    verification.uncitedClaims.length,
  );
  const menu = allowedCitationMenuForUnits(units).join("\n");
  const system = [
    "You attach citations to a single codebase briefing claim.",
    "Never fabricate a citation. Choose only a tag copied exactly from the allowed list.",
    "Reply with one allowed citation tag, or DROP if no listed source directly supports the statement.",
  ].join("\n");

  let nextBrief = brief;
  let attached = 0;
  let dropped = 0;
  let calls = 0;

  for (const claim of verification.uncitedClaims.slice(0, maxCalls)) {
    const user = [
      "## Claim",
      claim,
      "",
      menu,
      "Reply with exactly one tag from the list that directly supports this statement, or reply DROP if none does. Output only the tag or DROP.",
    ].join("\n");

    const completion = await complete(system, user, {
      label: "citation-repair-selection",
      signal: options.signal,
      temperature: 0.1,
      maxResponseTokens: 40,
      grammar,
      responseFormat,
    });
    calls += 1;

    const choice = parseCitationChoice(completion.content, allowed);
    if (choice && choice !== "DROP") {
      const candidate = appendCitationToClaimLine(nextBrief, claim, choice);
      const candidateVerification = verifyCitations(candidate, units);
      if (candidate !== nextBrief && candidateVerification.invalidCitations.length === 0) {
        nextBrief = candidate;
        attached += 1;
        continue;
      }
    }

    dropped += 1;
  }

  logger.info(`repair-by-selection: attached=${attached} dropped=${dropped} calls=${calls}`);
  return { brief: nextBrief, attached, dropped, calls };
}
