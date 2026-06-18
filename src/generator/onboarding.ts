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
import {
  compactMemoryGraph,
  formatMemoryGraphForPrompt,
  MemoryGraph,
  MemoryGraphNode,
  MemoryGraphSourceRef,
} from "../survey/memory-graph";
import { runIterativeRepositorySurvey } from "../survey/iterative-survey";
import { logger } from "../utils/logger";
import {
  normalizeInvalidCitations,
  removeInvalidCitationClaims,
  removeUncitedClaims,
  removeWeaklySupportedAiClaims,
  removeWeaklySupportedPrivacyClaims,
  removeWeaklySupportedSecurityAccessClaims,
  removeWeaklySupportedSharingClaims,
  removeWeaklySupportedUsageClaims,
  verifyCitations,
  CitationVerification,
} from "./citation-verifier";
import { generateCompletion } from "./llm-client";
import { buildCitationRepairPrompt, buildOnboardingBriefPartPrompt } from "./onboarding-prompt";
import { graphSourceUnits } from "./source-fallback";

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
  memoryGraph?: MemoryGraph;
  surveyTime?: number;
  surveyFallbackUsed?: boolean;
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
const BRIEFING_SECTIONS = [...new Set(BRIEFING_PARTS.flat())];

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

function isLocalChatEndpoint(): boolean {
  try {
    const hostname = new URL(CONFIG.chat.baseUrl).hostname;
    return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

function sourceList(units: CodeUnit[]) {
  return orderEvidenceSources(uniqueUnits(units)).map((unit) => ({
    filePath: unit.filePath,
    name: unit.name,
    kind: unit.kind,
    lines: `${unit.startLine}-${unit.endLine}`,
  }));
}

export function sourceListWithCitations(units: CodeUnit[], citations: string[], store: CodeUnitStore) {
  const sources = sourceList(units);
  const seen = new Set(sources.map((source) => `${source.filePath}:${source.lines}`));
  const basenameCounts = new Map<string, number>();
  for (const unit of units) {
    const basename = unit.filePath.split("/").at(-1) ?? unit.filePath;
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  for (const citation of citations) {
    const match = citation.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (!match) continue;
    const citedPath = match[1];
    const startLine = Number.parseInt(match[2], 10);
    const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine;
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) continue;
    const matchingUnit =
      units.find((unit) => unit.filePath === citedPath && startLine >= unit.startLine && endLine <= unit.endLine) ??
      units.find((unit) => {
        const basename = unit.filePath.split("/").at(-1) ?? unit.filePath;
        return (
          basenameCounts.get(basename) === 1 &&
          basename === citedPath &&
          startLine >= unit.startLine &&
          endLine <= unit.endLine
        );
      });
    const filePath = matchingUnit?.filePath ?? citedPath;
    const lines = `${startLine}-${endLine}`;
    const key = `${filePath}:${lines}`;
    if (seen.has(key)) continue;

    const storedUnit =
      matchingUnit ??
      store.getUnitsByFile(filePath).find((unit) => startLine >= unit.startLine && endLine <= unit.endLine);
    sources.push({
      filePath,
      name: storedUnit?.name ?? filePath.split("/").at(-1) ?? filePath,
      kind: storedUnit?.kind ?? "module",
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
  const prioritized = uniqueUnits([
    ...truncated.filter((unit) => classifyBriefingEvidence(unit.filePath).includes("overview_docs")).slice(0, 2),
    ...truncated,
  ]);
  const selected: CodeUnit[] = [];
  let total = 0;

  for (const unit of prioritized) {
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

function cite(unit: CodeUnit): string {
  return `[${unit.filePath}:${unit.startLine}-${unit.endLine}]`;
}

function firstEvidence(units: CodeUnit[], buckets: BriefingEvidenceBucket[]): CodeUnit | undefined {
  return units.find((unit) => classifyBriefingEvidence(unit.filePath).some((bucket) => buckets.includes(bucket)));
}

function fallbackEvidence(units: CodeUnit[]): {
  entry?: CodeUnit;
  ui?: CodeUnit;
  api?: CodeUnit;
  data?: CodeUnit;
  auth?: CodeUnit;
  ops?: CodeUnit;
} {
  return {
    entry: firstEvidence(units, ["overview_docs", "stack_config", "operations_config", "api_handlers"]),
    ui: firstEvidence(units, ["routes_pages"]),
    api: firstEvidence(units, ["api_handlers"]),
    data: firstEvidence(units, ["storage_files"]),
    auth: firstEvidence(units, ["auth_security"]),
    ops: firstEvidence(units, ["workflow_jobs", "analytics_tracking"]),
  };
}

function joinCitations(...units: Array<CodeUnit | undefined>): string {
  return uniqueUnits(units.filter((unit): unit is CodeUnit => Boolean(unit)))
    .slice(0, 3)
    .map(cite)
    .join(" ");
}

function citationForGraphSource(source: MemoryGraphSourceRef, units: CodeUnit[]): string | null {
  const unit = units.find(
    (candidate) =>
      candidate.filePath === source.filePath &&
      source.startLine >= candidate.startLine &&
      source.endLine <= candidate.endLine,
  );
  if (unit) return `[${source.filePath}:${source.startLine}-${source.endLine}]`;

  const overlappingUnit = units.find(
    (candidate) =>
      candidate.filePath === source.filePath &&
      candidate.startLine <= source.endLine &&
      candidate.endLine >= source.startLine,
  );
  return overlappingUnit ? cite(overlappingUnit) : null;
}

function citationForGraphNode(node: MemoryGraphNode, units: CodeUnit[]): string | null {
  for (const source of node.sources) {
    const citation = citationForGraphSource(source, units);
    if (citation) return citation;
  }
  return null;
}

function graphNodesWithCitations(
  memoryGraph: MemoryGraph | undefined,
  units: CodeUnit[],
): Array<{
  node: MemoryGraphNode;
  citation: string;
}> {
  if (!memoryGraph) return [];
  return memoryGraph.nodes
    .map((node) => ({ node, citation: citationForGraphNode(node, units) }))
    .filter((item): item is { node: MemoryGraphNode; citation: string } => Boolean(item.citation));
}

function nodeLine(item: { node: MemoryGraphNode; citation: string }): string {
  return `- **${item.node.label}**: ${cleanGraphSummary(item.node.summary)} ${item.citation}.`;
}

function cleanGraphSummary(summary: string): string {
  return summary.replace(/\s+Evidence:\s+.*$/i, "").trim();
}

function buildGraphSectionFallback(
  section: string,
  units: CodeUnit[],
  memoryGraph: MemoryGraph | undefined,
): string | null {
  const graphItems = graphNodesWithCitations(memoryGraph, units);
  if (graphItems.length === 0) return null;

  const workflows = graphItems.filter((item) => item.node.type === "workflow");
  const systems = graphItems.filter((item) => ["area", "workflow", "boundary", "state"].includes(item.node.type));
  const riskItems = graphItems.filter((item) => item.node.type === "risk");
  const stateOrBoundary = graphItems.filter((item) => ["state", "boundary"].includes(item.node.type));
  const top = (items: typeof graphItems, count: number) => items.slice(0, count);
  const primary = top(systems.length > 0 ? systems : graphItems, 3);
  const primaryLabels = primary.map((item) => item.node.label).join(", ");

  switch (section) {
    case "Product In One Paragraph":
      return `The inspected evidence shows ${primaryLabels} as central repository responsibilities; treat this as a source-backed orientation, not a complete product description ${primary.map((item) => item.citation).join(" ")}.`;
    case "Who Uses It And Why":
      return `The inspected context does not prove exact personas. It does show workflows likely used by people operating, configuring, or extending the project: ${primaryLabels} ${primary.map((item) => item.citation).join(" ")}.`;
    case "Codebase Product Map":
      return top(systems.length > 0 ? systems : graphItems, 5)
        .map(nodeLine)
        .join("\n");
    case "Top User Workflows":
      return top(workflows.length > 0 ? workflows : systems, 5)
        .map(
          (item, index) =>
            `${index + 1}. **${item.node.label}**: ${cleanGraphSummary(item.node.summary)} ${item.citation}.`,
        )
        .join("\n");
    case "Main Systems And Ownership Areas":
      return top(systems.length > 0 ? systems : graphItems, 5)
        .map(nodeLine)
        .join("\n");
    case "Data, Privacy, And Operational Notes":
      if (stateOrBoundary.length > 0) return top(stateOrBoundary, 4).map(nodeLine).join("\n");
      return `The inspected graph does not expose enough state, boundary, privacy, or operational evidence for a strong claim; review the central workflows before making risk decisions ${primary.map((item) => item.citation).join(" ")}.`;
    case "Risks Or Open Questions":
      if (riskItems.length > 0) return top(riskItems, 4).map(nodeLine).join("\n");
      return `- Confirm edge cases, failure modes, and operational boundaries around ${primaryLabels}; the inspected graph is useful but not exhaustive ${primary.map((item) => item.citation).join(" ")}.`;
    case "Glossary For A Non-Deeply-Technical Reader":
      return top(graphItems, 5)
        .map((item) => `- **${item.node.label}**: ${cleanGraphSummary(item.node.summary)} ${item.citation}.`)
        .join("\n");
    default:
      return null;
  }
}

function buildSectionFallback(section: string, units: CodeUnit[], memoryGraph?: MemoryGraph): string {
  const graphFallback = buildGraphSectionFallback(section, units, memoryGraph);
  if (graphFallback) return graphFallback;

  const evidence = fallbackEvidence(units);
  const coreCitation = joinCitations(evidence.entry, evidence.ui, evidence.api, units[0]);
  const workflowCitation = joinCitations(evidence.ui, evidence.api, evidence.data, units[0]);
  const riskCitation = joinCitations(evidence.auth, evidence.data, evidence.ops, evidence.api, units[0]);

  switch (section) {
    case "Product In One Paragraph":
      return `The selected source evidence shows a repository with identifiable entry, workflow, or configuration code; treat this as a cautious source-backed orientation until broader context is inspected ${coreCitation}.`;
    case "Who Uses It And Why":
      return `The provided context does not prove exact user personas, but it does show source-backed workflows or operations that people use, run, configure, or maintain ${workflowCitation}.`;
    case "Codebase Product Map":
      return [
        `- **Runtime or entry area**: Startup or top-level code is represented in the selected evidence ${joinCitations(evidence.entry, units[0])}.`,
        `- **Workflow area**: The selected evidence includes code that coordinates repository behavior ${joinCitations(evidence.ui, evidence.api, evidence.data, units[0])}.`,
        `- **Configuration or operations area**: Configuration, security, or operational evidence should be reviewed before making broader claims ${riskCitation}.`,
      ].join("\n");
    case "Top User Workflows":
      return `1. **Primary repository workflow**: Follow the selected entry, workflow, and state/configuration files before making stronger workflow claims ${workflowCitation}.`;
    case "Main Systems And Ownership Areas":
      return [
        `- **Runtime and delivery**: Startup or execution evidence is present ${joinCitations(evidence.entry, evidence.api, units[0])}.`,
        `- **Workflow coordination**: Selected files appear to coordinate repository behavior ${workflowCitation}.`,
        `- **State or configuration**: Persistence, configuration, service, or storage files should be reviewed as likely ownership boundaries ${joinCitations(evidence.data, evidence.auth, units[0])}.`,
      ].join("\n");
    case "Data, Privacy, And Operational Notes":
      return `The selected evidence is enough to flag state, configuration, security, or operational review as important, but not enough to make broad privacy or compliance claims ${riskCitation}.`;
    case "Risks Or Open Questions":
      return `- Confirm the complete lifecycle, configuration model, and operational failure paths with broader source review before treating this briefing as complete ${riskCitation}.`;
    case "Glossary For A Non-Deeply-Technical Reader":
      return [
        `- **Entry point**: Code that starts or wires the application ${joinCitations(evidence.entry, units[0])}.`,
        `- **Workflow code**: Code that coordinates a user, operator, or system task ${workflowCitation}.`,
        `- **State or configuration**: Files that shape how the project stores data, reads settings, or controls behavior ${joinCitations(evidence.data, evidence.auth, units[0])}.`,
      ].join("\n");
    default:
      return `Not enough source-backed evidence was available for this section ${coreCitation}.`;
  }
}

function shouldBackfillSection(body: string): boolean {
  const normalized = body.trim();
  return (
    normalized.length === 0 ||
    /^not found in provided context\.?$/i.test(normalized) ||
    !/\[[^\]\n]+:\d+(?:-\d+)?\]/.test(normalized)
  );
}

export function backfillEmptyBriefingSections(
  brief: string,
  sections: string[],
  units: CodeUnit[],
  memoryGraph?: MemoryGraph,
): string {
  if (units.length === 0) return brief;

  let next = brief;
  for (const section of sections) {
    const match = next.match(sectionPattern(section));
    if (!match || match.index === undefined) continue;

    const start = match.index + match[0].length;
    const nextHeadingIndex = next.slice(start).search(/^###\s+/m);
    const end = nextHeadingIndex >= 0 ? start + nextHeadingIndex : next.length;
    const body = next.slice(start, end);
    if (!shouldBackfillSection(body)) continue;

    const fallback = `\n${buildSectionFallback(section, units, memoryGraph)}\n\n`;
    next = `${next.slice(0, start)}${fallback}${next.slice(end).replace(/^\n+/, "")}`;
  }

  return next.replace(/\n{3,}/g, "\n\n").trim();
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
    memoryGraphText?: string;
    signal?: AbortSignal;
  },
): Promise<{ content: string; generationTime: number; truncated: boolean }> {
  const prompt = buildOnboardingBriefPartPrompt(contextUnits, options);
  const label = `briefing-part ${options.repoName}: ${options.sections.join(" + ")}`;
  const started = Date.now();
  const completion = await generateCompletion(prompt.system, prompt.user, { label, signal: options.signal });
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
    { label: `${label} retry-shorter`, signal: options.signal },
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
    repoRoot?: string;
    memoryGraph?: MemoryGraph;
    signal?: AbortSignal;
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
  let memoryGraph = options.memoryGraph;
  let surveyTime = 0;
  let surveyFallbackUsed = false;
  const localOptimized = isLocalChatEndpoint();

  if (!memoryGraph && options.repoRoot && !localOptimized) {
    const surveyStart = Date.now();
    try {
      const survey = await runIterativeRepositorySurvey({
        repoRoot: options.repoRoot,
        projectId: options.projectId,
        repoName: options.repoName,
        signal: options.signal,
      });
      memoryGraph = survey.graph;
      surveyFallbackUsed = survey.fallbackUsed;
      surveyTime = Date.now() - surveyStart;
    } catch (err) {
      surveyFallbackUsed = true;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Repository survey failed; falling back to retrieval-first briefing: ${message}`);
      surveyTime = Date.now() - surveyStart;
    }
  } else if (localOptimized) {
    surveyFallbackUsed = true;
    logger.info("Using compact local-model briefing path; skipping LLM survey graph generation");
  }

  const workflowPlan = buildBriefingWorkflowPlan(store);
  const workflowPlanText = workflowPlanToPrompt(workflowPlan);
  const compactBriefing = localOptimized;
  const promptGraph =
    memoryGraph && compactBriefing
      ? compactMemoryGraph(memoryGraph, 10, 8)
      : memoryGraph
        ? compactMemoryGraph(memoryGraph, 18, 12)
        : undefined;
  const memoryGraphText = promptGraph ? formatMemoryGraphForPrompt(promptGraph, compactBriefing ? 10 : 18) : undefined;
  const graphUnits = memoryGraph && options.repoRoot ? await graphSourceUnits(options.repoRoot, memoryGraph) : [];
  const sectionContexts = BRIEFING_PARTS.map((sections) => ({
    sections,
    ...retrieveContextForSections(store, query, sections, workflowPlan),
  }));
  const rawContextUnits = uniqueUnits([
    ...graphUnits,
    ...sectionContexts.flatMap((sectionContext) => sectionContext.contextUnits),
  ]);
  const contextUnits = compactBriefing
    ? selectOnboardingContext(rawContextUnits, CONFIG.generator.maxContextTokens, query, 0.1)
    : rawContextUnits;
  const retrievalDiagnostics = uniqueDiagnostics(
    sectionContexts.flatMap((sectionContext) => sectionContext.diagnostics),
  );
  const retrievalTime = Date.now() - retrievalStart;

  const generationStart = Date.now();
  const generatedParts = [];
  const generationContexts = compactBriefing
    ? [
        {
          sections: BRIEFING_SECTIONS,
          contextUnits,
        },
      ]
    : sectionContexts.map((sectionContext) => ({
        sections: sectionContext.sections,
        contextUnits: uniqueUnits([...graphUnits, ...sectionContext.contextUnits]),
      }));
  for (const sectionContext of generationContexts) {
    generatedParts.push(
      await generateBriefingPart(sectionContext.contextUnits, {
        repoName: options.repoName,
        audience,
        focus,
        persona,
        sections: sectionContext.sections,
        workflowPlanText,
        memoryGraphText,
        signal: options.signal,
      }),
    );
  }
  let brief = [`## ${options.repoName} Codebase Briefing`, ...generatedParts.map((part) => part.content)].join("\n\n");
  let generationTruncated = generatedParts.some((part) => part.truncated);
  let generationTime = Date.now() - generationStart;
  let citationVerification = verifyCitations(brief, contextUnits);
  let repaired = false;

  if (citationVerification.invalidCitations.length > 0) {
    const normalizedBrief = normalizeInvalidCitations(brief, contextUnits, citationVerification);
    const normalizedVerification = verifyCitations(normalizedBrief, contextUnits);
    if (normalizedVerification.invalidCitations.length < citationVerification.invalidCitations.length) {
      brief = normalizedBrief;
      citationVerification = normalizedVerification;
      repaired = true;
    }
  }

  if (citationVerification.invalidCitations.length > 0) {
    const repairStart = Date.now();
    const repairPrompt = buildCitationRepairPrompt(brief, contextUnits, citationVerification);
    const repairedCompletion = await generateCompletion(repairPrompt.system, repairPrompt.user, {
      label: `briefing-citation-repair ${options.repoName}`,
      signal: options.signal,
    });
    const repairedBrief = repairedCompletion.content;
    const repairedVerification = verifyCitations(repairedBrief, contextUnits);

    if (
      !repairedCompletion.truncated &&
      repairedVerification.invalidCitations.length === 0 &&
      repairedVerification.uncitedClaims.length <= citationVerification.uncitedClaims.length
    ) {
      brief = repairedBrief;
      citationVerification = repairedVerification;
      generationTruncated = false;
      repaired = true;
    }
    generationTime += Date.now() - repairStart;
  }

  if (citationVerification.invalidCitations.length > 0) {
    const normalizedBrief = normalizeInvalidCitations(brief, contextUnits, citationVerification);
    const normalizedVerification = verifyCitations(normalizedBrief, contextUnits);
    if (normalizedVerification.invalidCitations.length < citationVerification.invalidCitations.length) {
      brief = normalizedBrief;
      citationVerification = normalizedVerification;
      repaired = true;
    }
  }

  if (citationVerification.invalidCitations.length > 0) {
    const scrubbedBrief = removeInvalidCitationClaims(brief, citationVerification);
    const scrubbedVerification = verifyCitations(scrubbedBrief, contextUnits);
    if (
      scrubbedBrief.length >= Math.max(120, brief.length * 0.25) &&
      scrubbedVerification.invalidCitations.length < citationVerification.invalidCitations.length
    ) {
      brief = scrubbedBrief;
      citationVerification = scrubbedVerification;
      repaired = true;
    }
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

  if (citationVerification.invalidCitations.length === 0) {
    const scrubbedBrief = removeWeaklySupportedAiClaims(
      removeWeaklySupportedPrivacyClaims(
        removeWeaklySupportedSecurityAccessClaims(
          removeWeaklySupportedUsageClaims(
            removeWeaklySupportedSharingClaims(brief, citationVerification),
            citationVerification,
          ),
          citationVerification,
        ),
        citationVerification,
      ),
      citationVerification,
    );
    if (scrubbedBrief !== brief) {
      const scrubbedVerification = verifyCitations(scrubbedBrief, contextUnits);
      if (
        scrubbedVerification.valid ||
        scrubbedVerification.uncitedClaims.length <= citationVerification.uncitedClaims.length
      ) {
        brief = scrubbedBrief;
        citationVerification = scrubbedVerification;
        repaired = true;
      }
    }
  }

  if (citationVerification.invalidCitations.length === 0 && citationVerification.uncitedClaims.length > 0) {
    const scrubbedBrief = removeUncitedClaims(brief, citationVerification);
    const scrubbedVerification = verifyCitations(scrubbedBrief, contextUnits);
    if (scrubbedBrief !== brief) {
      brief = scrubbedBrief;
      citationVerification = scrubbedVerification;
      repaired = true;
    }
  }

  const backfilledBrief = backfillEmptyBriefingSections(brief, BRIEFING_SECTIONS, contextUnits, memoryGraph);
  if (backfilledBrief !== brief) {
    brief = backfilledBrief;
    citationVerification = verifyCitations(brief, contextUnits);
    repaired = true;
  }

  if (citationVerification.invalidCitations.length === 0 && citationVerification.uncitedClaims.length > 0) {
    const scrubbedBrief = removeUncitedClaims(brief, citationVerification);
    const scrubbedVerification = verifyCitations(scrubbedBrief, contextUnits);
    if (scrubbedBrief !== brief) {
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
    memoryGraph,
    surveyTime,
    surveyFallbackUsed,
  };
}
