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
  isProductOverviewDoc,
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
  CitationVerification,
  CitationVerificationOptions,
  normalizeInvalidCitationsWithMetadata,
  removeInvalidCitationClaims,
  removeUncitedClaims,
  removeWeaklySupportedAiClaims,
  removeWeaklySupportedPrivacyClaims,
  removeWeaklySupportedSecurityAccessClaims,
  removeWeaklySupportedSharingClaims,
  removeWeaklySupportedUsageClaims,
  verifyCitations,
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
  useGraph: true,
  includeSummary: true,
  maxContextRatio: 0.85,
  reason: "briefing generation should prefer product docs, app/package boundaries, and workflow evidence",
};

type SectionFallbackKind =
  | "Product In One Paragraph"
  | "Who Uses It And Why"
  | "Codebase Product Map"
  | "Top User Workflows"
  | "Main Systems And Ownership Areas"
  | "Data, Privacy, And Operational Notes"
  | "Risks Or Open Questions"
  | "Glossary For A Non-Deeply-Technical Reader";

interface BriefingSectionSpec {
  hint: string;
  fallbackKind: SectionFallbackKind;
  // Honest, section-appropriate note used when a section is empty and there is no graph or
  // overview evidence to fall back on. Keeps audience sections (e.g. proof points,
  // differentiators) from inheriting an engineering-flavored note from their fallbackKind.
  emptyNote?: string;
}

// Every briefing section maps to a retrieval hint (what evidence to pull) and a
// fallbackKind (which built-in fallback writer to reuse when the model leaves it empty).
// The eight kinds below double as their own sections; audience-specific sections reuse them.
const SECTION_LIBRARY: Record<string, BriefingSectionSpec> = {
  "Product In One Paragraph": {
    hint: "README docs overview purpose product users feature value proposition",
    fallbackKind: "Product In One Paragraph",
  },
  "Who Uses It And Why": {
    hint: "README docs users customer persona workflow value use case",
    fallbackKind: "Who Uses It And Why",
  },
  "Codebase Product Map": {
    hint: "app main index package boundary module component route service architecture map",
    fallbackKind: "Codebase Product Map",
  },
  "Top User Workflows": {
    hint: "workflow lifecycle create upload import process convert share invite access verify authorize view analytics event metric billing limit plan",
    fallbackKind: "Top User Workflows",
  },
  "Main Systems And Ownership Areas": {
    hint: "architecture subsystem owner module service state manager backend frontend storage api",
    fallbackKind: "Main Systems And Ownership Areas",
  },
  "Data, Privacy, And Operational Notes": {
    hint: "data flow input editor state buffer render display output save persist disk file storage config environment auth privacy security language server lsp tree-sitter parser grammar integration",
    fallbackKind: "Data, Privacy, And Operational Notes",
  },
  "Risks Or Open Questions": {
    hint: "risk security privacy persistence error fallback validation configuration dependency operational failure",
    fallbackKind: "Risks Or Open Questions",
  },
  "Glossary For A Non-Deeply-Technical Reader": {
    hint: "README docs concept terminology glossary domain model workflow component service",
    fallbackKind: "Glossary For A Non-Deeply-Technical Reader",
  },
  "Who It's For And Why They Buy": {
    hint: "README docs customer buyer user persona value use case audience industry problem job to be done",
    fallbackKind: "Who Uses It And Why",
    emptyNote:
      "The selected evidence does not pin down specific buyers; infer the audience cautiously from the README and core workflows before making buyer claims",
  },
  "Capabilities And Differentiators": {
    hint: "feature capability differentiator advantage unique support option configuration integration mode",
    fallbackKind: "Codebase Product Map",
    emptyNote:
      "The selected evidence did not surface clearly differentiating capabilities for this section; review the cited files for the product's core behavior before making competitive claims",
  },
  "Integrations And Data Boundaries": {
    hint: "integration api adapter endpoint dependency data boundary storage auth network external service provider import export",
    fallbackKind: "Data, Privacy, And Operational Notes",
    emptyNote:
      "The selected evidence does not detail external integrations or data boundaries; treat integration and data-handling claims as unconfirmed until the relevant adapters and config are reviewed",
  },
  "Proof Points From The Source": {
    hint: "feature capability performance limit support test example evidence configuration option",
    fallbackKind: "Main Systems And Ownership Areas",
    emptyNote:
      "No strong source-backed proof points surfaced in the selected evidence for this section; point to the cited files directly rather than making unsupported claims",
  },
  "Questions Before You Sell": {
    hint: "risk limitation dependency validation trust security compliance support boundary maturity",
    fallbackKind: "Risks Or Open Questions",
    emptyNote:
      "Before relying on this for a deal, confirm the product's maturity, data handling, and support boundaries against a broader source review",
  },
  "Architecture And Major Systems": {
    hint: "architecture subsystem module service boundary core engine adapter layer pipeline interface",
    fallbackKind: "Main Systems And Ownership Areas",
    emptyNote:
      "The selected evidence is too thin to map the architecture confidently; start from the cited entry and core files before describing the system boundaries",
  },
  "Core Workflows And Data Flow": {
    hint: "workflow lifecycle data flow input process output state pipeline request response handler dispatch",
    fallbackKind: "Top User Workflows",
    emptyNote:
      "The selected evidence does not trace a complete data flow; follow the cited entry and handler files to confirm how work moves through the system",
  },
  "Where To Start Reading": {
    hint: "entry main index readme module package core start configuration bootstrap",
    fallbackKind: "Codebase Product Map",
    emptyNote:
      "Start from the cited entry, README, and core module files above; the selected evidence is too thin for a fuller reading guide",
  },
  "Capabilities, Boundaries, And Assumptions": {
    hint: "feature capability boundary assumption limit option configuration scope support dependency",
    fallbackKind: "Codebase Product Map",
    emptyNote:
      "The selected evidence is thin on explicit boundaries and assumptions; treat the cited files as the starting point and confirm scope with the team",
  },
  "Product Risks, Gaps, And Dependencies": {
    hint: "risk gap dependency limitation missing fallback validation configuration assumption",
    fallbackKind: "Risks Or Open Questions",
    emptyNote:
      "The selected evidence does not surface concrete risks or gaps; confirm dependencies and failure paths in the cited files before relying on this",
  },
  "High-Leverage Questions": {
    hint: "question decision risk assumption dependency priority workflow boundary",
    fallbackKind: "Risks Or Open Questions",
    emptyNote:
      "Frame questions around the cited files' lifecycle, dependencies, and gaps; the selected evidence is not exhaustive",
  },
  "Adoption And Onboarding Workflows": {
    hint: "onboarding setup install configure getting started workflow adoption first run guide quickstart",
    fallbackKind: "Top User Workflows",
    emptyNote:
      "The selected evidence does not lay out a full onboarding path; review the cited setup and configuration files before guiding new users",
  },
  "Support Behavior And Failure Modes": {
    hint: "error failure fallback retry timeout edge case state config support log validation recovery",
    fallbackKind: "Data, Privacy, And Operational Notes",
    emptyNote:
      "The selected evidence does not detail failure modes; review error handling and configuration in the cited files before advising users",
  },
  "Escalation Questions For The Team": {
    hint: "escalation question risk failure dependency support boundary configuration",
    fallbackKind: "Risks Or Open Questions",
    emptyNote:
      "Frame escalation questions around the cited files' failure paths and dependencies; the selected evidence is not exhaustive",
  },
  "What It Enables And Why It Matters": {
    hint: "README docs purpose value capability outcome impact mission strategy problem",
    fallbackKind: "Product In One Paragraph",
    emptyNote:
      "The selected evidence is thin on stated outcomes; read the value of this project from the cited README and core files before drawing strategic conclusions",
  },
  "Capabilities And Constraints": {
    hint: "capability constraint limit boundary scale dependency tradeoff support maturity",
    fallbackKind: "Main Systems And Ownership Areas",
    emptyNote:
      "The selected evidence is thin on constraints; confirm scale, dependencies, and limits against a broader review before making capability claims",
  },
  "Strategic And Operational Risks": {
    hint: "risk security operational scale maintainability dependency compliance failure ownership",
    fallbackKind: "Risks Or Open Questions",
    emptyNote:
      "The selected evidence does not expose concrete strategic or operational risks; confirm scale, ownership, and dependencies in a broader review",
  },
  "Priority Decisions And Questions": {
    hint: "decision priority risk roadmap tradeoff dependency question investment",
    fallbackKind: "Risks Or Open Questions",
    emptyNote:
      "Frame priority decisions around the cited files' dependencies and gaps; the selected evidence is not exhaustive enough to rank investments on its own",
  },
};

const DEFAULT_BRIEFING_PLAN: string[][] = [
  ["Product In One Paragraph", "Who Uses It And Why"],
  ["Codebase Product Map"],
  ["Top User Workflows"],
  ["Main Systems And Ownership Areas", "Data, Privacy, And Operational Notes"],
  ["Risks Or Open Questions", "Glossary For A Non-Deeply-Technical Reader"],
];

const CUSTOMER_SUCCESS_PLAN: string[][] = [
  ["Product In One Paragraph", "Who Uses It And Why"],
  ["Adoption And Onboarding Workflows"],
  ["Support Behavior And Failure Modes", "Data, Privacy, And Operational Notes"],
  ["Escalation Questions For The Team"],
];

// Each audience gets a section set built for what that reader actually needs, not a
// reskin of the engineering orientation. Unknown roles fall back to the general plan.
const AUDIENCE_BRIEFING_PLANS: Partial<Record<Persona["role"], string[][]>> = {
  product_manager: [
    ["Product In One Paragraph", "Who Uses It And Why"],
    ["Top User Workflows"],
    ["Capabilities, Boundaries, And Assumptions"],
    ["Product Risks, Gaps, And Dependencies", "High-Leverage Questions"],
  ],
  engineer: [
    ["Product In One Paragraph"],
    ["Architecture And Major Systems"],
    ["Core Workflows And Data Flow"],
    ["Codebase Product Map"],
    ["Risks Or Open Questions", "Where To Start Reading"],
  ],
  sales: [
    ["Product In One Paragraph", "Who It's For And Why They Buy"],
    ["Capabilities And Differentiators"],
    ["Integrations And Data Boundaries"],
    ["Proof Points From The Source"],
    ["Questions Before You Sell"],
  ],
  customer_success: CUSTOMER_SUCCESS_PLAN,
  support: CUSTOMER_SUCCESS_PLAN,
  operations: CUSTOMER_SUCCESS_PLAN,
  executive: [
    ["Product In One Paragraph"],
    ["What It Enables And Why It Matters"],
    ["Capabilities And Constraints"],
    ["Strategic And Operational Risks"],
    ["Priority Decisions And Questions"],
  ],
};

export function briefingPlanForPersona(persona: Persona): string[][] {
  return AUDIENCE_BRIEFING_PLANS[persona.role] ?? DEFAULT_BRIEFING_PLAN;
}

function sectionRetrievalHint(section: string): string {
  return SECTION_LIBRARY[section]?.hint ?? "";
}

function sectionFallbackKind(section: string): string {
  return SECTION_LIBRARY[section]?.fallbackKind ?? section;
}

// Distilled synthesis sections: kept even when uncited, never overwritten by the
// citation scrubbers, and only backfilled when genuinely empty.
const SYNTHESIS_SECTIONS = ["Product In One Paragraph", "What It Enables And Why It Matters"];

function isSynthesisSection(section: string): boolean {
  return SYNTHESIS_SECTIONS.includes(section);
}

function verifyBriefCitations(
  answer: string,
  contextUnits: CodeUnit[],
  extra: CitationVerificationOptions = {},
): CitationVerification {
  return verifyCitations(answer, contextUnits, { synthesisSections: SYNTHESIS_SECTIONS, ...extra });
}

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

export function selectOnboardingContext(
  units: CodeUnit[],
  maxTokens: number,
  query: string,
  maxUnitRatio = 0.18,
): CodeUnit[] {
  const truncated = truncateLargeUnits(units, maxTokens, maxUnitRatio, query);
  const prioritized = uniqueUnits([
    ...truncated.filter((unit) => isProductOverviewDoc(unit.filePath)).slice(0, 2),
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

// Sections that read best when anchored to the README/overview intro (positioning,
// "what is this", "who buys it"), so we always seed their context with the top of the README.
const OVERVIEW_INTRO_SECTIONS = new Set([
  "Product In One Paragraph",
  "What It Enables And Why It Matters",
  "Who Uses It And Why",
  "Who It's For And Why They Buy",
  "Capabilities And Differentiators",
]);

function overviewIntroUnits(store: CodeUnitStore, limit = 2): CodeUnit[] {
  return store
    .getAllUnits()
    .filter((unit) => isProductOverviewDoc(unit.filePath))
    .sort((a, b) => {
      const aReadme = /(^|\/)readme\.mdx?$/i.test(a.filePath) ? 0 : 1;
      const bReadme = /(^|\/)readme\.mdx?$/i.test(b.filePath) ? 0 : 1;
      if (aReadme !== bReadme) return aReadme - bReadme;
      return a.startLine - b.startLine;
    })
    .slice(0, limit);
}

function sectionsWantOverviewIntro(sections: string[]): boolean {
  return sections.some((section) => OVERVIEW_INTRO_SECTIONS.has(section));
}

function buildSectionQuery(baseQuery: string, sections: string[]): string {
  const sectionHints = sections.map((section) => sectionRetrievalHint(section)).filter(Boolean);
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
  const introUnits = sectionsWantOverviewIntro(sections) ? overviewIntroUnits(store) : [];
  const orderedCandidates = uniqueUnits([...introUnits, ...workflowUnits, ...planned.units, ...candidateUnits]);
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

function cleanOverviewText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Install/setup/meta boilerplate that should never become the product description.
const OVERVIEW_BOILERPLATE_PATTERN =
  /\b(npm install|yarn add|pnpm add|git clone|getting started|installation|install the|development guide|run the repository locally|instructions are for installing|please refer to|table of contents|code of conduct|contributing guide|quick start|quickstart)\b/i;

function firstOverviewStatement(unit: CodeUnit): string | null {
  const paragraphs = unit.code
    .split(/\n{2,}/)
    .map(cleanOverviewText)
    .filter(
      (paragraph) =>
        paragraph.length >= 40 && !/^donate\b/i.test(paragraph) && !OVERVIEW_BOILERPLATE_PATTERN.test(paragraph),
    );
  // Prefer a descriptive "<name> is a/an/the ..." paragraph over the first generic one.
  const descriptive = paragraphs.find((candidate) => /\bis (?:a|an|the|now)\b/i.test(candidate.slice(0, 140)));
  const paragraph = descriptive ?? paragraphs[0];
  if (!paragraph) return null;
  const firstSentence = paragraph.match(/^(.+?[.!?])(?:\s|$)/)?.[1];
  if (firstSentence && firstSentence.length >= 40) return firstSentence;
  if (paragraph.length <= 260) return paragraph;

  const completeSentence = paragraph
    .slice(0, 260)
    .replace(/\s+\S*$/, "")
    .replace(/[,:;]\s*$/, "");
  return `${completeSentence}.`;
}

function citationReadyStatement(statement: string): string {
  return statement.replace(/[.!?]\s*$/, "");
}

function productOverviewFallback(units: CodeUnit[]): { unit: CodeUnit; statement: string } | null {
  const overviewUnit = [...units]
    .filter((unit) => isProductOverviewDoc(unit.filePath))
    .sort((a, b) => {
      const readmeDelta = Number(/^readme\.mdx?$/i.test(b.filePath)) - Number(/^readme\.mdx?$/i.test(a.filePath));
      return readmeDelta || a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine;
    })
    .find((unit) => firstOverviewStatement(unit));
  if (!overviewUnit) return null;

  return {
    unit: overviewUnit,
    statement: firstOverviewStatement(overviewUnit) ?? "",
  };
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

  switch (sectionFallbackKind(section)) {
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
  const overviewFallback = productOverviewFallback(units);
  const kind = sectionFallbackKind(section);

  // Overview-backed fallback for synthesis/persona sections when a README/overview exists.
  if (overviewFallback) {
    if (kind === "Product In One Paragraph") {
      return `The project overview states that ${citationReadyStatement(overviewFallback.statement)} ${cite(overviewFallback.unit)}.`;
    }
    if (kind === "Who Uses It And Why") {
      return `The clearest user signal in the selected evidence is the project overview: ${citationReadyStatement(overviewFallback.statement)} ${cite(overviewFallback.unit)}.`;
    }
  }

  // Audience sections carry a section-appropriate honest note so they do not inherit an
  // engineering-flavored fallback from their generic fallbackKind.
  const emptyNote = SECTION_LIBRARY[section]?.emptyNote;
  if (emptyNote) return `${emptyNote} ${coreCitation}.`;

  switch (kind) {
    case "Product In One Paragraph":
      return `The selected source evidence shows a repository with identifiable entry, workflow, or configuration code; treat this as a cautious source-backed orientation until broader context is inspected ${coreCitation}.`;
    case "Who Uses It And Why":
      return `The provided context does not prove exact user personas, but it does show source-backed workflows or operations that people use, run, configure, or maintain ${workflowCitation}.`;
    case "Codebase Product Map":
      return `Source-backed evidence selected for this section was thin; the cited files above are the most relevant starting points and should be reviewed before drawing broader conclusions ${coreCitation}.`;
    case "Top User Workflows":
      return `1. **Primary repository workflow**: Follow the selected entry, workflow, and state/configuration files before making stronger workflow claims ${workflowCitation}.`;
    case "Main Systems And Ownership Areas":
      return `The cited files are the clearest system boundaries in the selected evidence; a broader source pass is needed to confirm ownership and responsibilities ${joinCitations(evidence.entry, evidence.data, evidence.api, units[0])}.`;
    case "Data, Privacy, And Operational Notes":
      return `The selected evidence is enough to flag state, configuration, security, or operational review as important, but not enough to make broad privacy or compliance claims ${riskCitation}.`;
    case "Risks Or Open Questions":
      return `- Confirm the complete lifecycle, configuration model, and operational failure paths with broader source review before treating this briefing as complete ${riskCitation}.`;
    case "Glossary For A Non-Deeply-Technical Reader":
      return `Key terms for this project are best read from the cited source and documentation above; the selected evidence is too thin for a full glossary ${coreCitation}.`;
    default:
      return `Not enough source-backed evidence was available for this section ${coreCitation}.`;
  }
}

function shouldBackfillSection(body: string, requireCitation = true): boolean {
  const normalized = body.trim();
  if (normalized.length === 0) return true;
  if (/^not found in provided context\.?$/i.test(normalized)) return true;
  // Synthesis sections (requireCitation = false) keep their distilled paragraph even
  // when it has no citation; only empty/"not found" bodies are refilled.
  if (requireCitation && !/\[[^\]\n]+:\d+(?:-\d+)?\]/.test(normalized)) return true;
  return false;
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
    if (!shouldBackfillSection(body, !isSynthesisSection(section))) continue;

    const fallback = `\n${buildSectionFallback(section, units, memoryGraph)}\n\n`;
    next = `${next.slice(0, start)}${fallback}${next.slice(end).replace(/^\n+/, "")}`;
  }

  return next.replace(/\n{3,}/g, "\n\n").trim();
}

// In body-only mode the model returns just the section body; emit the canonical heading
// ourselves and demote any stray headings the model added, so headings never drift.
function forceSingleSectionHeading(content: string, section: string): string {
  let body = content.trim();
  body = body.replace(/^\s*#{1,6}\s+.*(?:\n|$)/, "");
  body = body.replace(/^#{1,3}\s+/gm, "#### ");
  body = body.trim();
  return body.length > 0 ? `### ${section}\n${body}` : `### ${section}`;
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
    bodyOnly?: boolean;
    signal?: AbortSignal;
  },
): Promise<{ content: string; generationTime: number; truncated: boolean }> {
  const prompt = buildOnboardingBriefPartPrompt(contextUnits, options);
  const label = `briefing-part ${options.repoName}: ${options.sections.join(" + ")}`;
  const started = Date.now();
  const completion = await generateCompletion(prompt.system, prompt.user, { label, signal: options.signal });
  let generationTime = Date.now() - started;

  let content: string;
  let truncated: boolean;
  if (!completion.truncated) {
    content = completion.content.trim();
    truncated = false;
  } else {
    const retryStarted = Date.now();
    const retry = await generateCompletion(
      prompt.system,
      [
        prompt.user,
        "",
        "## Retry Constraint",
        "The previous answer was too long. Return a shorter version under 140 words total.",
        "Keep the same requested content and preserve citations.",
      ].join("\n"),
      { label: `${label} retry-shorter`, signal: options.signal },
    );
    generationTime += Date.now() - retryStarted;
    if (!retry.truncated) {
      content = retry.content.trim();
      truncated = false;
    } else {
      content = sanitizeTruncatedBriefingPart(retry.content.trim() || completion.content.trim(), options.sections);
      truncated = true;
    }
  }

  if (options.bodyOnly && options.sections.length === 1) {
    content = forceSingleSectionHeading(content, options.sections[0]);
  }
  return { content, generationTime, truncated };
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
  const briefingParts = briefingPlanForPersona(persona);
  const briefingSections = [...new Set(briefingParts.flat())];
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
  const compactBriefing = localOptimized && !CONFIG.generator.multiPassBriefing;
  const promptGraph =
    memoryGraph && compactBriefing
      ? compactMemoryGraph(memoryGraph, 10, 8)
      : memoryGraph
        ? compactMemoryGraph(memoryGraph, 18, 12)
        : undefined;
  const memoryGraphText = promptGraph ? formatMemoryGraphForPrompt(promptGraph, compactBriefing ? 10 : 18) : undefined;
  const graphUnits = memoryGraph && options.repoRoot ? await graphSourceUnits(options.repoRoot, memoryGraph) : [];
  const sectionContexts = briefingParts.map((sections) => ({
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
          sections: briefingSections,
          contextUnits,
        },
      ]
    : // Multi-pass: one section per call with deterministic headings, so the local model
      // cannot drift section names or restate sections (which produced duplicate headings).
      sectionContexts.flatMap((sectionContext) =>
        sectionContext.sections.map((section) => ({
          sections: [section],
          contextUnits: uniqueUnits([...graphUnits, ...sectionContext.contextUnits]),
        })),
      );
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
        bodyOnly: !compactBriefing,
        signal: options.signal,
      }),
    );
  }
  let brief = [`## ${options.repoName} Codebase Briefing`, ...generatedParts.map((part) => part.content)].join("\n\n");
  let generationTruncated = generatedParts.some((part) => part.truncated);
  let generationTime = Date.now() - generationStart;
  let citationVerification = verifyBriefCitations(brief, contextUnits);
  let repaired = false;

  if (citationVerification.invalidCitations.length > 0) {
    const normalized = normalizeInvalidCitationsWithMetadata(brief, contextUnits, citationVerification);
    const normalizedVerification = verifyBriefCitations(normalized.answer, contextUnits, {
      repairedCitations: normalized.repairedCitations,
    });
    if (normalizedVerification.invalidCitations.length < citationVerification.invalidCitations.length) {
      brief = normalized.answer;
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
    const repairedVerification = verifyBriefCitations(repairedBrief, contextUnits);

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
    const normalized = normalizeInvalidCitationsWithMetadata(brief, contextUnits, citationVerification);
    const normalizedVerification = verifyBriefCitations(normalized.answer, contextUnits, {
      repairedCitations: normalized.repairedCitations,
    });
    if (normalizedVerification.invalidCitations.length < citationVerification.invalidCitations.length) {
      brief = normalized.answer;
      citationVerification = normalizedVerification;
      repaired = true;
    }
  }

  if (citationVerification.invalidCitations.length > 0) {
    const scrubbedBrief = removeInvalidCitationClaims(brief, citationVerification);
    const scrubbedVerification = verifyBriefCitations(scrubbedBrief, contextUnits);
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
    const scrubbedVerification = verifyBriefCitations(scrubbedBrief, contextUnits);
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
      const scrubbedVerification = verifyBriefCitations(scrubbedBrief, contextUnits);
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
    const scrubbedVerification = verifyBriefCitations(scrubbedBrief, contextUnits);
    if (scrubbedBrief !== brief) {
      brief = scrubbedBrief;
      citationVerification = scrubbedVerification;
      repaired = true;
    }
  }

  const backfilledBrief = backfillEmptyBriefingSections(brief, briefingSections, contextUnits, memoryGraph);
  if (backfilledBrief !== brief) {
    brief = backfilledBrief;
    citationVerification = verifyBriefCitations(brief, contextUnits);
    repaired = true;
  }

  if (citationVerification.invalidCitations.length === 0 && citationVerification.uncitedClaims.length > 0) {
    const scrubbedBrief = removeUncitedClaims(brief, citationVerification);
    const scrubbedVerification = verifyBriefCitations(scrubbedBrief, contextUnits);
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
