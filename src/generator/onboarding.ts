import { CONFIG } from "../config";
import { estimateTokens, truncateLargeUnits } from "../context/token-budget";
import { CodeUnit } from "../parser/types";
import { DEFAULT_PERSONA, Persona } from "../persona/types";
import { onboardingRetrieval, OnboardingRetrievalDiagnostic } from "../retriever/onboarding-retriever";
import { QueryPlan } from "../retriever/query-router";
import { CodeUnitStore } from "../retriever/unit-store";
import { verifyCitations, CitationVerification } from "./citation-verifier";
import { generateResponse } from "./llm-client";
import { buildCitationRepairPrompt, buildOnboardingBriefPrompt } from "./onboarding-prompt";

export interface OnboardingBriefResult {
  projectId: string;
  repoName: string;
  audience: string;
  focus: string[];
  brief: string;
  sources: Array<{ filePath: string; name: string; kind: string; lines: string }>;
  retrievalTime: number;
  generationTime: number;
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
  reason: "first-week onboarding should prefer product docs, app/package boundaries, and workflow evidence",
};

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
  const audience = options.audience?.trim() || "A product manager joining the team in their first week";
  const focus = options.focus && options.focus.length > 0 ? options.focus.slice(0, 10) : defaultFocus();
  const persona = options.persona ?? DEFAULT_PERSONA;
  const query = [
    "Create first-week onboarding documentation for this product.",
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
    Math.max(2500, Math.floor(CONFIG.generator.maxContextTokens * ONBOARDING_QUERY_PLAN.maxContextRatio)),
  );
  const retrievalTime = Date.now() - retrievalStart;

  const prompt = buildOnboardingBriefPrompt(contextUnits, {
    repoName: options.repoName,
    audience,
    focus,
    persona,
  });

  const generationStart = Date.now();
  let brief = await generateResponse(prompt.system, prompt.user);
  let generationTime = Date.now() - generationStart;
  let citationVerification = verifyCitations(brief, contextUnits);
  let repaired = false;

  if (!citationVerification.valid) {
    const repairStart = Date.now();
    const repairPrompt = buildCitationRepairPrompt(brief, contextUnits);
    const repairedBrief = await generateResponse(repairPrompt.system, repairPrompt.user);
    const repairedVerification = verifyCitations(repairedBrief, contextUnits);

    if (
      repairedVerification.invalidCitations.length <= citationVerification.invalidCitations.length &&
      repairedVerification.uncitedClaims.length < citationVerification.uncitedClaims.length
    ) {
      brief = repairedBrief;
      citationVerification = repairedVerification;
      repaired = true;
    }
    generationTime += Date.now() - repairStart;
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
    citationVerification,
    repaired,
    retrievalDiagnostics: retrieved.diagnostics,
  };
}
