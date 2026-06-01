import { CONFIG } from "../config";
import { estimateTokens, truncateLargeUnits } from "../context/token-budget";
import { CodeUnit } from "../parser/types";
import { DEFAULT_PERSONA, Persona } from "../persona/types";
import { onboardingRetrieval, OnboardingRetrievalDiagnostic } from "../retriever/onboarding-retriever";
import { QueryPlan } from "../retriever/query-router";
import { CodeUnitStore } from "../retriever/unit-store";
import { removeUncitedClaims, verifyCitations, CitationVerification } from "./citation-verifier";
import { generateCompletion } from "./llm-client";
import { buildCitationRepairPrompt, buildOnboardingBriefPartPrompt } from "./onboarding-prompt";

export interface OnboardingBriefResult {
  projectId: string;
  repoName: string;
  audience: string;
  focus: string[];
  brief: string;
  sources: Array<{ filePath: string; name: string; kind: string; lines: string }>;
  retrievalTime: number;
  generationTime: number;
  generationTruncated: boolean;
  citationVerification: CitationVerification;
  repaired: boolean;
  retrievalDiagnostics: OnboardingRetrievalDiagnostic[];
}

const ONBOARDING_QUERY_PLAN: QueryPlan = {
  intent: "architecture_overview",
  mode: "summary_graph",
  requiredEvidence: ["overview_docs", "entry_points", "workflow_sources", "risk_sources"],
  preferredSources: ["docs", "code", "graph"],
  graphDirection: "bidirectional",
  sourceBudget: { code: 12, docs: 5, tests: 0 },
  useLocalExact: false,
  useLexical: true,
  useVector: false,
  useGraph: true,
  includeSummary: true,
  maxContextRatio: 0.85,
  reason: "briefing generation should prefer product docs, app/package boundaries, and workflow evidence",
};

const BRIEFING_PARTS = [
  ["Product In One Paragraph", "Who Uses It And Why"],
  ["Codebase Product Map", "Top User Workflows"],
  ["Main Systems And Ownership Areas", "Data, Privacy, And Operational Notes"],
  ["Risks Or Open Questions", "Glossary For A Non-Deeply-Technical Reader"],
];

const COMPLETE_LINE_PATTERN = /(?:[.!?)]|]|\|)$/;

function defaultFocus(): string[] {
  return [
    "what the product does",
    "who uses it",
    "top user workflows",
    "main systems and ownership areas",
    "data, privacy, and operational risks",
    "questions to ask the team",
  ];
}

function sourceList(units: CodeUnit[]) {
  return units.map((unit) => ({
    filePath: unit.filePath,
    name: unit.name,
    kind: unit.kind,
    lines: `${unit.startLine}-${unit.endLine}`,
  }));
}

function selectOnboardingContext(units: CodeUnit[], maxTokens: number): CodeUnit[] {
  const truncated = truncateLargeUnits(units, maxTokens, 0.18);
  const selected: CodeUnit[] = [];
  let total = 0;

  for (const unit of truncated) {
    const tokens = estimateTokens(unit.code);
    if (total + tokens > maxTokens) continue;
    selected.push(unit);
    total += tokens;
  }

  return selected;
}

function sectionPattern(section: string): RegExp {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^###\\s+${escaped}\\s*$`, "im");
}

function trimIncompleteTail(content: string): string {
  const lines = content.trim().split("\n");
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (last === "") {
      lines.pop();
      continue;
    }
    if (/^[-*]\s*$/.test(last) || /\[[^\]]*$/.test(last) || !COMPLETE_LINE_PATTERN.test(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}

export function sanitizeTruncatedBriefingPart(content: string, sections: string[]): string {
  const output: string[] = [];
  for (const section of sections) {
    const match = content.match(sectionPattern(section));
    if (!match || match.index === undefined) {
      output.push(`### ${section}\nNot found in provided context`);
      continue;
    }

    const start = match.index + match[0].length;
    const nextHeading = content.slice(start).search(/^###\s+/m);
    const rawSection = nextHeading >= 0 ? content.slice(start, start + nextHeading) : content.slice(start);
    const sanitized = trimIncompleteTail(rawSection);
    output.push(`### ${section}\n${sanitized || "Not found in provided context"}`);
  }
  return output.join("\n\n");
}

async function generateBriefingPart(
  contextUnits: CodeUnit[],
  options: {
    repoName: string;
    audience: string;
    focus: string[];
    persona: Persona;
    sections: string[];
  },
): Promise<{ content: string; generationTime: number; truncated: boolean }> {
  const prompt = buildOnboardingBriefPartPrompt(contextUnits, options);
  const started = Date.now();
  const completion = await generateCompletion(prompt.system, prompt.user);
  let generationTime = Date.now() - started;

  if (!completion.truncated) {
    return { content: completion.content.trim(), generationTime, truncated: false };
  }

  const retryStarted = Date.now();
  const retry = await generateCompletion(
    prompt.system,
    [
      prompt.user,
      "",
      "## Retry Constraint",
      "The previous answer was too long. Return a shorter version under 140 words total.",
      "Keep the same requested section headings and preserve citations.",
    ].join("\n"),
  );
  generationTime += Date.now() - retryStarted;

  if (!retry.truncated) {
    return { content: retry.content.trim(), generationTime, truncated: false };
  }

  return {
    content: sanitizeTruncatedBriefingPart(retry.content.trim() || completion.content.trim(), options.sections),
    generationTime,
    truncated: true,
  };
}

export async function generateOnboardingBrief(
  store: CodeUnitStore,
  options: {
    projectId: string;
    repoName: string;
    audience?: string;
    focus?: string[];
    persona?: Persona;
  },
): Promise<OnboardingBriefResult> {
  const audience = options.audience?.trim() || "A teammate trying to understand this repository";
  const focus = options.focus && options.focus.length > 0 ? options.focus.slice(0, 10) : defaultFocus();
  const persona = options.persona ?? DEFAULT_PERSONA;
  const query = [
    "Create a source-grounded codebase briefing for this product or repository.",
    `Audience: ${audience}.`,
    `Focus: ${focus.join(", ")}.`,
  ].join(" ");

  const retrievalStart = Date.now();
  const retrieved = onboardingRetrieval(store, {
    query,
    topK: 30,
    maxPerFile: 2,
  });

  const candidateUnits = retrieved.retrieved
    .map((result) => store.getUnit(result.unitId))
    .filter((unit): unit is CodeUnit => Boolean(unit));

  const contextUnits = selectOnboardingContext(
    candidateUnits,
    Math.max(1400, Math.floor(CONFIG.generator.maxContextTokens * ONBOARDING_QUERY_PLAN.maxContextRatio)),
  );
  const retrievalTime = Date.now() - retrievalStart;

  const generationStart = Date.now();
  const generatedParts = [];
  for (const sections of BRIEFING_PARTS) {
    generatedParts.push(
      await generateBriefingPart(contextUnits, {
        repoName: options.repoName,
        audience,
        focus,
        persona,
        sections,
      }),
    );
  }
  let brief = [`## ${options.repoName} Codebase Briefing`, ...generatedParts.map((part) => part.content)].join("\n\n");
  let generationTruncated = generatedParts.some((part) => part.truncated);
  let generationTime = Date.now() - generationStart;
  let citationVerification = verifyCitations(brief, contextUnits);
  let repaired = false;

  if (citationVerification.invalidCitations.length > 0) {
    const repairStart = Date.now();
    const repairPrompt = buildCitationRepairPrompt(brief, contextUnits, citationVerification);
    const repairedCompletion = await generateCompletion(repairPrompt.system, repairPrompt.user);
    const repairedBrief = repairedCompletion.content;
    const repairedVerification = verifyCitations(repairedBrief, contextUnits);

    if (
      !repairedCompletion.truncated &&
      repairedVerification.invalidCitations.length <= citationVerification.invalidCitations.length &&
      repairedVerification.uncitedClaims.length < citationVerification.uncitedClaims.length
    ) {
      brief = repairedBrief;
      citationVerification = repairedVerification;
      generationTruncated = false;
      repaired = true;
    }
    generationTime += Date.now() - repairStart;
  }

  if (citationVerification.invalidCitations.length === 0 && citationVerification.uncitedClaims.length > 0) {
    const scrubbedBrief = removeUncitedClaims(brief, citationVerification);
    const scrubbedVerification = verifyCitations(scrubbedBrief, contextUnits);
    if (
      scrubbedBrief.length >= Math.max(120, brief.length * 0.35) &&
      scrubbedVerification.uncitedClaims.length < citationVerification.uncitedClaims.length
    ) {
      brief = scrubbedBrief;
      citationVerification = scrubbedVerification;
      repaired = true;
    }
  }

  return {
    projectId: options.projectId,
    repoName: options.repoName,
    audience,
    focus,
    brief,
    sources: sourceList(contextUnits),
    retrievalTime,
    generationTime,
    generationTruncated,
    citationVerification,
    repaired,
    retrievalDiagnostics: retrieved.diagnostics,
  };
}
