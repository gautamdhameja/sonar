import { CONFIG } from "../config";
import { estimateTokens, truncateLargeUnits } from "../context/token-budget";
import { CodeUnit } from "../parser/types";
import { DEFAULT_PERSONA, Persona } from "../persona/types";
import { planBriefingEvidence } from "../retriever/briefing-evidence-planner";
import {
  BriefingWorkflowPlan,
  buildBriefingWorkflowPlan,
  workflowPlanToPrompt,
} from "../retriever/briefing-workflow-planner";
import { onboardingRetrieval, OnboardingRetrievalDiagnostic } from "../retriever/onboarding-retriever";
import { QueryPlan } from "../retriever/query-router";
import {
  BriefingEvidenceBucket,
  classifyBriefingEvidence,
  isBriefingNoiseFile,
  isDocumentationFile,
} from "../retriever/source-classifier";
import { CodeUnitStore } from "../retriever/unit-store";
import { logger } from "../utils/logger";
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
  ["Codebase Product Map"],
  ["Top User Workflows"],
  ["Main Systems And Ownership Areas", "Data, Privacy, And Operational Notes"],
  ["Risks Or Open Questions", "Glossary For A Non-Deeply-Technical Reader"],
];

const COMPLETE_LINE_PATTERN = /(?:[.!?)]|]|\|)$/;

const SECTION_RETRIEVAL_HINTS: Record<string, string> = {
  "Product In One Paragraph": "README docs overview purpose product users feature value proposition",
  "Who Uses It And Why": "README docs users customer persona workflow value use case",
  "Codebase Product Map": "app main index package boundary module component route service architecture map",
  "Top User Workflows":
    "workflow lifecycle create upload import process convert share invite access verify authorize view analytics event metric billing limit plan",
  "Main Systems And Ownership Areas":
    "architecture subsystem owner module service state manager backend frontend storage api",
  "Data, Privacy, And Operational Notes":
    "data flow input editor state buffer render display output save persist disk file storage config environment auth privacy security language server lsp tree-sitter parser grammar integration",
  "Risks Or Open Questions":
    "risk security privacy persistence error fallback validation configuration dependency operational failure",
  "Glossary For A Non-Deeply-Technical Reader":
    "README docs concept terminology glossary domain model workflow component service",
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
  return orderEvidenceSources(uniqueUnits(units)).map((unit) => ({
    filePath: unit.filePath,
    name: unit.name,
    kind: unit.kind,
    lines: `${unit.startLine}-${unit.endLine}`,
  }));
}

function sourceListWithCitations(units: CodeUnit[], citations: string[], store: CodeUnitStore) {
  const sources = sourceList(units);
  const seen = new Set(sources.map((source) => `${source.filePath}:${source.lines}`));

  for (const citation of citations) {
    const match = citation.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (!match) continue;
    const filePath = match[1];
    const startLine = Number.parseInt(match[2], 10);
    const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine;
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) continue;
    const lines = `${startLine}-${endLine}`;
    const key = `${filePath}:${lines}`;
    if (seen.has(key)) continue;

    const matchingUnit = store
      .getUnitsByFile(filePath)
      .find((unit) => startLine >= unit.startLine && endLine <= unit.endLine);
    sources.push({
      filePath,
      name: matchingUnit?.name ?? filePath.split("/").at(-1) ?? filePath,
      kind: matchingUnit?.kind ?? "module",
      lines,
    });
    seen.add(key);
  }

  return sources.sort((a, b) => {
    const codeDelta = Number(!isDocumentationFile(b.filePath)) - Number(!isDocumentationFile(a.filePath));
    if (codeDelta !== 0) return codeDelta;
    return a.filePath.localeCompare(b.filePath) || a.lines.localeCompare(b.lines);
  });
}

function isCodeUnit(unit: CodeUnit): boolean {
  return !isDocumentationFile(unit.filePath);
}

function orderEvidenceSources(units: CodeUnit[]): CodeUnit[] {
  return [...units].sort((a, b) => {
    const codeDelta = Number(isCodeUnit(b)) - Number(isCodeUnit(a));
    if (codeDelta !== 0) return codeDelta;
    return a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine;
  });
}

function uniqueUnits(units: CodeUnit[]): CodeUnit[] {
  const seen = new Set<string>();
  const output: CodeUnit[] = [];
  for (const unit of units) {
    if (seen.has(unit.id)) continue;
    seen.add(unit.id);
    output.push(unit);
  }
  return output;
}

function uniqueDiagnostics(diagnostics: OnboardingRetrievalDiagnostic[]): OnboardingRetrievalDiagnostic[] {
  const seen = new Set<string>();
  const output: OnboardingRetrievalDiagnostic[] = [];
  for (const item of diagnostics) {
    if (seen.has(item.unitId)) continue;
    seen.add(item.unitId);
    output.push(item);
  }
  return output;
}

function selectOnboardingContext(units: CodeUnit[], maxTokens: number, query: string, maxUnitRatio = 0.18): CodeUnit[] {
  const truncated = truncateLargeUnits(units, maxTokens, maxUnitRatio, query);
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

function buildSectionQuery(baseQuery: string, sections: string[]): string {
  const sectionHints = sections.map((section) => SECTION_RETRIEVAL_HINTS[section]).filter(Boolean);
  return [baseQuery, `Sections: ${sections.join(", ")}.`, `Evidence to retrieve: ${sectionHints.join(" ")}.`].join(" ");
}

function retrieveContextForSections(
  store: CodeUnitStore,
  query: string,
  sections: string[],
  workflowPlan: BriefingWorkflowPlan,
): {
  contextUnits: CodeUnit[];
  diagnostics: OnboardingRetrievalDiagnostic[];
} {
  const sectionQuery = buildSectionQuery(query, sections);
  const planned = planBriefingEvidence(store, sections);
  const retrieved = onboardingRetrieval(store, {
    query: sectionQuery,
    topK: 24,
    maxPerFile: 3,
  });

  const candidateUnits = retrieved.retrieved
    .map((result) => store.getUnit(result.unitId))
    .filter((unit): unit is CodeUnit => {
      if (!unit) return false;
      return !isBriefingNoiseFile(unit.filePath);
    });
  const workflowUnits = selectWorkflowPlanUnits(workflowPlan, sections);
  const orderedCandidates = uniqueUnits([...workflowUnits, ...planned.units, ...candidateUnits]);
  const contextUnits = selectOnboardingContext(
    orderedCandidates,
    Math.max(1200, Math.floor(CONFIG.generator.maxContextTokens * ONBOARDING_QUERY_PLAN.maxContextRatio)),
    sectionQuery,
    sections.includes("Top User Workflows") ? 0.12 : 0.18,
  );
  const plannedDiagnostics: OnboardingRetrievalDiagnostic[] = planned.diagnostics.map((diagnostic) => ({
    unitId: diagnostic.unitId,
    filePath: diagnostic.filePath,
    name: diagnostic.name,
    score: diagnostic.score,
    reasons: diagnostic.reasons,
  }));

  if (planned.missingBuckets.length > 0) {
    logger.warn(`Briefing evidence for ${sections.join(", ")} missing buckets: ${planned.missingBuckets.join(", ")}`);
  }
  logger.info(
    `Briefing evidence for ${sections.join(", ")} selected ${contextUnits.length} units from ` +
      `${planned.census.usableUnits}/${planned.census.totalUnits} usable units; noise files excluded: ${planned.census.noiseFiles}`,
  );

  return { contextUnits, diagnostics: [...plannedDiagnostics, ...retrieved.diagnostics] };
}

function selectWorkflowPlanUnits(plan: BriefingWorkflowPlan, sections: string[]): CodeUnit[] {
  const sectionText = sections.join(" ").toLowerCase();
  const units: CodeUnit[] = [];
  const isTopWorkflowSection = sections.includes("Top User Workflows");
  const lifecycleAvailable = plan.lifecycleEvidence.length > 0;

  if (isTopWorkflowSection) {
    units.push(...plan.lifecycleEvidence);
  } else {
    units.push(...plan.centralEvidence.slice(0, 12));
  }

  const workflows = isTopWorkflowSection
    ? [...plan.workflows].sort(
        (a, b) =>
          Number(isSecondaryWorkflow(a, lifecycleAvailable)) - Number(isSecondaryWorkflow(b, lifecycleAvailable)),
      )
    : plan.workflows;

  for (const workflow of workflows) {
    const isWorkflowSection = /workflow|map|systems|data|privacy|risk|user/.test(sectionText);
    const isRiskWorkflow =
      /risk|privacy|operational/.test(sectionText) &&
      hasWorkflowBucket(workflow, [
        "auth_security",
        "storage_files",
        "analytics_tracking",
        "billing_limits",
        "workflow_jobs",
        "ai_features",
      ]);
    const isProductSection = /product|who uses|glossary/.test(sectionText);

    if (isWorkflowSection || isRiskWorkflow || isProductSection) {
      units.push(...workflow.evidence);
    }
  }

  if (isTopWorkflowSection) {
    const secondaryFiles = new Set(
      workflows
        .filter((workflow) => isSecondaryWorkflow(workflow, lifecycleAvailable))
        .flatMap((workflow) => workflow.evidence.map((unit) => unit.filePath)),
    );
    units.push(...plan.centralEvidence.filter((unit) => !secondaryFiles.has(unit.filePath)).slice(0, 6));
  }

  return uniqueUnits(units);
}

function hasWorkflowBucket(
  workflow: BriefingWorkflowPlan["workflows"][number],
  buckets: BriefingEvidenceBucket[],
): boolean {
  return workflow.evidence.some((unit) =>
    classifyBriefingEvidence(unit.filePath).some((bucket) => buckets.includes(bucket)),
  );
}

function isSecondaryWorkflow(
  workflow: BriefingWorkflowPlan["workflows"][number],
  lifecycleAvailable: boolean,
): boolean {
  if (!lifecycleAvailable) return false;
  const hasSecondarySignal = hasWorkflowBucket(workflow, ["ai_features", "auth_security"]);
  const hasPrimarySignal = hasWorkflowBucket(workflow, [
    "routes_pages",
    "api_handlers",
    "storage_files",
    "analytics_tracking",
    "billing_limits",
    "workflow_jobs",
  ]);
  return hasSecondarySignal && !hasPrimarySignal;
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
    workflowPlanText?: string;
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
    "Create a high-level, source-grounded codebase briefing for project orientation.",
    "Prioritize product purpose, users, core workflows, important systems, risks, and source landmarks over low-level implementation detail.",
    `Audience: ${audience}.`,
    `Focus: ${focus.join(", ")}.`,
  ].join(" ");

  const retrievalStart = Date.now();
  const workflowPlan = buildBriefingWorkflowPlan(store);
  const workflowPlanText = workflowPlanToPrompt(workflowPlan);
  const sectionContexts = BRIEFING_PARTS.map((sections) => ({
    sections,
    ...retrieveContextForSections(store, query, sections, workflowPlan),
  }));
  const contextUnits = uniqueUnits(sectionContexts.flatMap((sectionContext) => sectionContext.contextUnits));
  const retrievalDiagnostics = uniqueDiagnostics(
    sectionContexts.flatMap((sectionContext) => sectionContext.diagnostics),
  );
  const retrievalTime = Date.now() - retrievalStart;

  const generationStart = Date.now();
  const generatedParts = [];
  for (const sectionContext of sectionContexts) {
    generatedParts.push(
      await generateBriefingPart(sectionContext.contextUnits, {
        repoName: options.repoName,
        audience,
        focus,
        persona,
        sections: sectionContext.sections,
        workflowPlanText,
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
    sources: sourceListWithCitations(contextUnits, citationVerification.citations, store),
    retrievalTime,
    generationTime,
    generationTruncated,
    citationVerification,
    repaired,
    retrievalDiagnostics,
  };
}
