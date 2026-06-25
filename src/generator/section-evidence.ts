import { CodeUnit } from "../parser/types";
import { Persona } from "../persona/types";
import { verifyCitations } from "./citation-verifier";
import { generateCompletion, LlmCompletion, LlmCompletionOptions } from "./llm-client";
import { modelSupportsGrammar } from "./model-context";
import { allowedCitationMenuForUnits } from "./onboarding-prompt";
import { citationTagForUnit, formatCodeUnitForPrompt } from "./source-context";
import { parseJsonFromModel } from "./structured-llm";

export interface EvidenceItem {
  fact: string;
  citation: string;
  unitId: string;
}

export type EvidenceLedger = Map<string, EvidenceItem[]>;

type CompletionFn = (system: string, user: string, options?: LlmCompletionOptions) => Promise<LlmCompletion>;

function evidenceResponseFormat(tags: string[]): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: "section_evidence",
      strict: true,
      schema: {
        type: "array",
        minItems: 0,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            fact: { type: "string" },
            citation: { type: "string", enum: tags },
          },
          required: ["fact", "citation"],
          additionalProperties: false,
        },
      },
    },
  };
}

function escapeGrammarLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function evidenceExtractionGrammar(tags: string[]): string {
  const citationChoices = tags.map((tag) => `"${escapeGrammarLiteral(tag)}"`).join(" | ");
  return [
    'root ::= ws "[" ws (item (ws "," ws item){0,7})? ws "]" ws',
    'item ::= "{" ws "\\"fact\\"" ws ":" ws string ws "," ws "\\"citation\\"" ws ":" ws citation ws "}"',
    `citation ::= ${citationChoices}`,
    'string ::= "\\"" chars "\\""',
    'chars ::= ([^"\\\\] | "\\\\" (["\\\\/bfnrt] | "u" hex hex hex hex))*',
    "hex ::= [0-9a-fA-F]",
    "ws ::= [ \\t\\n\\r]*",
  ].join("\n");
}

function validateEvidenceValue(value: unknown, units: CodeUnit[]): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  const unitByTag = new Map(units.map((unit) => [`[${citationTagForUnit(unit)}]`, unit]));
  const seen = new Set<string>();
  const items: EvidenceItem[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const fact = typeof (raw as { fact?: unknown }).fact === "string" ? (raw as { fact: string }).fact.trim() : "";
    const citation =
      typeof (raw as { citation?: unknown }).citation === "string" ? (raw as { citation: string }).citation.trim() : "";
    const unit = unitByTag.get(citation);
    if (!fact || !unit) continue;

    const verification = verifyCitations(`${fact} ${citation}`, units);
    if (!verification.valid) continue;

    const key = `${fact.toLowerCase()} ${citation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ fact, citation, unitId: unit.id });
  }

  return items;
}

export async function extractSectionEvidence(
  units: CodeUnit[],
  section: string,
  options: { focus: string[]; persona: Persona; signal?: AbortSignal; ledger?: EvidenceLedger },
  complete: CompletionFn = generateCompletion,
): Promise<EvidenceItem[]> {
  if (units.length === 0) return [];

  const tags = units.map((unit) => `[${citationTagForUnit(unit)}]`);
  const priorEvidence = options.ledger
    ? Array.from(options.ledger.values())
        .flat()
        .map((item) => `- ${item.fact} ${item.citation}`)
    : [];
  const system = [
    "Extract source-backed evidence for one codebase briefing section.",
    "Return only JSON. Every citation must be copied exactly from the allowed citation list.",
    "Never fabricate a citation or infer beyond the provided source context.",
  ].join("\n");
  const user = [
    "## Section",
    section,
    "",
    "## Focus",
    ...options.focus.map((item) => `- ${item}`),
    "",
    ...(priorEvidence.length > 0 ? ["## Previously Validated Evidence", ...priorEvidence.slice(0, 20), ""] : []),
    ...allowedCitationMenuForUnits(units),
    "## Source Context",
    ...units.flatMap((unit) => [formatCodeUnitForPrompt(unit), ""]),
    'Return a JSON array of 4-8 objects. Each object must have {"fact":"...","citation":"[file:start-end]"}.',
  ].join("\n");

  const completion = await complete(system, user, {
    label: `section-evidence ${section}`,
    signal: options.signal,
    temperature: 0.1,
    maxResponseTokens: 700,
    grammar: modelSupportsGrammar() ? evidenceExtractionGrammar(tags) : undefined,
    responseFormat: modelSupportsGrammar() ? undefined : evidenceResponseFormat(tags),
  });
  const parsed = parseJsonFromModel(completion.content);
  if (parsed.value === null) return [];

  const evidence = validateEvidenceValue(parsed.value, units);
  if (options.ledger) {
    for (const item of evidence) {
      const list = options.ledger.get(item.unitId) ?? [];
      list.push(item);
      options.ledger.set(item.unitId, list);
    }
  }
  return evidence;
}

export async function composeSectionFromEvidence(
  evidence: EvidenceItem[],
  section: string,
  options: { persona: Persona; wordLimit: number; signal?: AbortSignal },
  complete: CompletionFn = generateCompletion,
): Promise<string> {
  if (evidence.length === 0) return "";

  const system = [
    "Write one concise codebase briefing section from a validated evidence list.",
    "Use only the supplied facts. End every factual claim with the provided citation copied verbatim.",
    "Do not introduce facts or citations that are not in the evidence list.",
  ].join("\n");
  const user = [
    "## Section",
    section,
    "",
    `## Word Limit\n${options.wordLimit}`,
    "",
    "## Evidence",
    ...evidence.map((item) => `- ${item.fact} ${item.citation}`),
    "",
    "Write only the section body. Do not write the section heading.",
  ].join("\n");

  const completion = await complete(system, user, {
    label: `section-compose ${section}`,
    signal: options.signal,
    maxResponseTokens: Math.max(500, Math.min(1_200, options.wordLimit * 5)),
  });
  return completion.content.trim();
}
