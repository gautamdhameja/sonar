import { CodeUnit } from "../parser/types";
import { CONFIG } from "../config";
import { OnboardingSession, ProjectRepo } from "../db/project-repo";
import { CodeUnitStore } from "../retriever/unit-store";
import { OnboardingFollowupIntent, retrieveOnboardingFollowup } from "../retriever/onboarding-followup-retriever";
import { formatMemoryGraphForPrompt } from "../survey/memory-graph";
import { buildPersonaGuidance } from "./persona-guidance";
import { generateCompletionWithLengthRetry, generateResponse } from "./llm-client";
import { removeUncitedClaims, verifyCitations, CitationVerification } from "./citation-verifier";
import { buildSourceEvidenceFallback } from "./source-fallback";

export interface OnboardingFollowupResult {
  sessionId: string;
  projectId: string;
  question: string;
  answer: string;
  intent: OnboardingFollowupIntent;
  sources: Array<{ filePath: string; name: string; kind: string; lines: string }>;
  retrievalTime: number;
  generationTime: number;
  generationTruncated: boolean;
  graphEnhanced: boolean;
  citationVerification: CitationVerification;
  queryPlanReason: string;
}

export interface OnboardingFollowupHistoryItem {
  question: string;
  answer: string;
  intent?: string | null;
}

function trimText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const trimmed = value.slice(0, maxChars);
  const breakAt = Math.max(trimmed.lastIndexOf("\n\n"), trimmed.lastIndexOf("\n- "), trimmed.lastIndexOf(". "));
  return `${(breakAt > maxChars * 0.5 ? trimmed.slice(0, breakAt + 1) : trimmed).trim()}\n[Truncated]`;
}

function formatHistory(history: OnboardingFollowupHistoryItem[]): string {
  if (history.length === 0) return "No prior follow-up messages in this app session.";
  return history
    .slice(-2)
    .map((item) =>
      [
        `User: ${trimText(item.question.replace(/\s+/g, " ").trim(), 180)}`,
        `Sonar: ${trimText(item.answer.replace(/\s+/g, " ").trim(), 240)}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function formatSources(units: CodeUnit[]): string {
  return units
    .map((unit) => {
      return [
        `### ${unit.filePath}:${unit.startLine}-${unit.endLine} - ${unit.kind} ${unit.name}`,
        `\`\`\`${unit.language}`,
        unit.code,
        "```",
      ].join("\n");
    })
    .join("\n\n");
}

function buildFollowupPrompt(input: {
  session: OnboardingSession;
  history: OnboardingFollowupHistoryItem[];
  question: string;
  intent: OnboardingFollowupIntent;
  contextUnits: CodeUnit[];
  memoryGraphText?: string;
}): { system: string; user: string } {
  const system = [
    `You are Sonar, a local codebase briefing assistant for "${input.session.repoName}".`,
    "Your job is to answer follow-up questions after a source-grounded codebase briefing.",
    "Sonar is optimized for high-level project understanding with local or modest models, not deep implementation work.",
    "",
    buildPersonaGuidance(input.session.persona),
    "",
    "RULES:",
    "1. Use the briefing and conversation history only for orientation.",
    "2. Treat the Code Context as authoritative for concrete claims.",
    "3. Every concrete product, workflow, file, component, data, privacy, or operational claim must include a citation in [file:start-end] form.",
    "4. If the provided context does not answer the question, say what is missing and suggest the source or team to ask.",
    "5. Keep the default depth suitable for a product manager, founder, designer, support lead, or other non-deeply-technical teammate.",
    '6. Separate observed facts from inferences. Mark inferences with "(inferred)".',
    "7. If the user asks for debugging, refactoring, line-by-line code explanation, or implementation decisions, give a brief orientation-level answer from the context and say that detailed code work should be handled by an engineer or coding agent with full repository context.",
    "8. Do not present Sonar as a replacement for a deep code review, debugger, or implementation assistant.",
    "9. Use the Repository Memory Graph only to orient broad answers. Do not cite graph text unless the same file range appears in Code Context.",
  ].join("\n");

  const user = [
    "## Audience",
    input.session.audience ?? "A teammate trying to understand this repository.",
    "",
    "## Follow-Up Intent",
    input.intent,
    "",
    "## Session Focus",
    input.session.focus.length > 0
      ? input.session.focus.map((item) => `- ${item}`).join("\n")
      : "No explicit focus areas.",
    "",
    "## Codebase Briefing (Orientation Only)",
    trimText(input.session.brief, 300),
    "",
    ...(input.memoryGraphText
      ? ["## Repository Memory Graph (Orientation Only)", trimText(input.memoryGraphText, 1800), ""]
      : []),
    "## Rolling Conversation Summary",
    "Follow-up answers are not persisted. Use only the recent in-memory messages below for this app session.",
    "",
    "## Recent Messages",
    formatHistory(input.history),
    "",
    "## Code Context",
    formatSources(input.contextUnits),
    "",
    "## User Follow-Up Question",
    input.question,
    "",
    "## Answer Format",
    "Return one short answer paragraph followed by up to four concise bullets.",
    "Use section headings only for broad workflow, risk, or architecture questions.",
    "Do not use decorative separators.",
    "Every factual sentence or bullet must include a citation.",
  ].join("\n");

  return { system, user };
}

function buildFollowupCitationRepairPrompt(
  answer: string,
  contextUnits: CodeUnit[],
  issues: CitationVerification,
): { system: string; user: string } {
  const validSources = contextUnits.map((unit) => `- ${unit.filePath}:${unit.startLine}-${unit.endLine}`).join("\n");

  return {
    system: [
      "You repair citations in Sonar briefing follow-up answers.",
      "Only use citations that are present in the supplied valid source list.",
      "Do not add new claims. Remove or qualify claims that cannot be supported by the listed sources.",
    ].join("\n"),
    user: [
      "## Valid Sources",
      validSources,
      "",
      "## Issues To Fix",
      ...issues.invalidCitations.map((citation) => `- Invalid citation: ${citation}`),
      ...issues.uncitedClaims.map((claim) => `- Uncited claim: ${claim}`),
      "",
      "## Answer To Repair",
      answer,
      "",
      "Return the full repaired answer. Every concrete claim must include a valid [file:start-end] citation.",
    ].join("\n"),
  };
}

export async function answerOnboardingFollowup(input: {
  session: OnboardingSession;
  question: string;
  history?: OnboardingFollowupHistoryItem[];
  store: CodeUnitStore;
  repo: ProjectRepo;
  signal?: AbortSignal;
}): Promise<OnboardingFollowupResult> {
  const memoryGraph = input.repo.getMemoryGraph(input.session.projectId);
  const memoryGraphText = memoryGraph ? formatMemoryGraphForPrompt(memoryGraph, 18) : undefined;
  const retrieval = await retrieveOnboardingFollowup({
    query: input.question,
    projectId: input.session.projectId,
    store: input.store,
    sourceFiles: input.session.sourceFiles,
    repo: input.repo,
    maxContextRatio: 0.16,
  });

  const { system, user } = buildFollowupPrompt({
    session: input.session,
    history: input.history ?? [],
    question: input.question,
    intent: retrieval.intent,
    contextUnits: retrieval.contextUnits,
    memoryGraphText,
  });

  const generationStart = Date.now();
  const completion = await generateCompletionWithLengthRetry(
    system,
    user,
    "The previous answer was too long. Return exactly three bullets under 100 words.",
    { signal: input.signal },
  );
  let answer = completion.content;
  let generationTruncated = completion.truncated;
  let generationTime = Date.now() - generationStart;
  let citationVerification = verifyCitations(answer, retrieval.contextUnits);

  if (citationVerification.invalidCitations.length > 0) {
    const repairPrompt = buildFollowupCitationRepairPrompt(answer, retrieval.contextUnits, citationVerification);
    const repairStart = Date.now();
    const repaired = await generateResponse(repairPrompt.system, repairPrompt.user, { signal: input.signal });
    const repairedVerification = verifyCitations(repaired, retrieval.contextUnits);
    generationTime += Date.now() - repairStart;

    if (
      repairedVerification.invalidCitations.length <= citationVerification.invalidCitations.length &&
      repairedVerification.uncitedClaims.length <= citationVerification.uncitedClaims.length
    ) {
      answer = repaired;
      citationVerification = repairedVerification;
      generationTruncated = false;
    }
  }

  if (citationVerification.invalidCitations.length === 0 && citationVerification.uncitedClaims.length > 0) {
    const scrubbedAnswer = removeUncitedClaims(answer, citationVerification);
    const scrubbedVerification = verifyCitations(scrubbedAnswer, retrieval.contextUnits);
    if (
      scrubbedAnswer.length >= Math.max(120, answer.length * 0.35) &&
      scrubbedVerification.uncitedClaims.length < citationVerification.uncitedClaims.length
    ) {
      answer = scrubbedAnswer;
      citationVerification = scrubbedVerification;
    }
  }
  if (generationTruncated && citationVerification.valid && answer.length >= 120 && /[.!?)]$/.test(answer.trim())) {
    generationTruncated = false;
  }
  if (answer.trim() === "" || (generationTruncated && !citationVerification.valid)) {
    answer = buildSourceEvidenceFallback(retrieval.contextUnits);
    citationVerification = verifyCitations(answer, retrieval.contextUnits);
    generationTruncated = false;
  }

  const sources = retrieval.contextUnits.map((unit) => ({
    filePath: unit.filePath,
    name: unit.name,
    kind: unit.kind,
    lines: `${unit.startLine}-${unit.endLine}`,
  }));

  return {
    sessionId: input.session.id,
    projectId: input.session.projectId,
    question: input.question,
    answer,
    intent: retrieval.intent,
    sources,
    retrievalTime: retrieval.retrievalTime,
    generationTime,
    generationTruncated,
    graphEnhanced: retrieval.graphEnhanced || Boolean(memoryGraph),
    citationVerification,
    queryPlanReason: retrieval.queryPlan.reason,
  };
}

export function onboardingSessionSourceFiles(sources: Array<{ filePath: string }>): string[] {
  return [...new Set(sources.map((source) => source.filePath))].slice(0, CONFIG.retriever.fusedTopK);
}
