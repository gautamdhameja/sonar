import { CodeUnit } from "../parser/types";
import { CONFIG } from "../config";
import { OnboardingMessage, OnboardingSession, ProjectRepo } from "../db/project-repo";
import { CodeUnitStore } from "../retriever/unit-store";
import {
  classifyOnboardingFollowup,
  OnboardingFollowupIntent,
  retrieveOnboardingFollowup,
} from "../retriever/onboarding-followup-retriever";
import { buildPersonaGuidance } from "./persona-guidance";
import { generateResponse } from "./llm-client";
import { verifyCitations, CitationVerification } from "./citation-verifier";

export interface OnboardingFollowupResult {
  sessionId: string;
  projectId: string;
  question: string;
  answer: string;
  intent: OnboardingFollowupIntent;
  sources: Array<{ filePath: string; name: string; kind: string; lines: string }>;
  retrievalTime: number;
  generationTime: number;
  graphEnhanced: boolean;
  citationVerification: CitationVerification;
  queryPlanReason: string;
}

function trimText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const trimmed = value.slice(0, maxChars);
  const breakAt = Math.max(trimmed.lastIndexOf("\n\n"), trimmed.lastIndexOf("\n- "), trimmed.lastIndexOf(". "));
  return `${(breakAt > maxChars * 0.5 ? trimmed.slice(0, breakAt + 1) : trimmed).trim()}\n[Truncated]`;
}

function formatHistory(messages: OnboardingMessage[]): string {
  if (messages.length === 0) return "No prior follow-up messages.";
  return messages
    .slice(-8)
    .map((message) => `${message.role === "user" ? "User" : "Sonar"}: ${trimText(message.content, 700)}`)
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
  messages: OnboardingMessage[];
  question: string;
  intent: OnboardingFollowupIntent;
  contextUnits: CodeUnit[];
}): { system: string; user: string } {
  const system = [
    `You are Sonar, a local onboarding assistant for "${input.session.repoName}".`,
    "Your job is to answer follow-up questions after an onboarding brief for a first-week teammate.",
    "",
    buildPersonaGuidance(input.session.persona),
    "",
    "RULES:",
    "1. Use the onboarding brief and conversation history only for orientation.",
    "2. Treat the Code Context as authoritative for concrete claims.",
    "3. Every concrete product, workflow, file, component, data, privacy, or operational claim must include a citation in [file:start-end] form.",
    "4. If the provided context does not answer the question, say what is missing and suggest the source or team to ask.",
    "5. Keep the default depth suitable for a product manager unless the user asks for implementation detail.",
    "6. Separate observed facts from inferences. Mark inferences with \"(inferred)\".",
  ].join("\n");

  const user = [
    "## Audience",
    input.session.audience ?? "A teammate using this as first-week onboarding material.",
    "",
    "## Follow-Up Intent",
    input.intent,
    "",
    "## Session Focus",
    input.session.focus.length > 0 ? input.session.focus.map((item) => `- ${item}`).join("\n") : "No explicit focus areas.",
    "",
    "## Onboarding Brief (Orientation Only)",
    trimText(input.session.brief, 4500),
    "",
    "## Rolling Conversation Summary",
    input.session.rollingSummary ?? "No rolling summary yet.",
    "",
    "## Recent Messages",
    formatHistory(input.messages),
    "",
    "## Code Context",
    formatSources(input.contextUnits),
    "",
    "## User Follow-Up Question",
    input.question,
    "",
    "## Answer Format",
    "Use this structure unless the question is very small:",
    "Short Answer",
    "What The Sources Show",
    "What Is Inferred",
    "Where To Look Next",
    "Questions To Ask Engineering",
  ].join("\n");

  return { system, user };
}

function buildFollowupCitationRepairPrompt(answer: string, contextUnits: CodeUnit[]): { system: string; user: string } {
  const validSources = contextUnits
    .map((unit) => `- ${unit.filePath}:${unit.startLine}-${unit.endLine}`)
    .join("\n");

  return {
    system: [
      "You repair citations in Sonar onboarding follow-up answers.",
      "Only use citations that are present in the supplied valid source list.",
      "Do not add new claims. Remove or qualify claims that cannot be supported by the listed sources.",
    ].join("\n"),
    user: [
      "## Valid Sources",
      validSources,
      "",
      "## Answer To Repair",
      answer,
      "",
      "Return the full repaired answer. Every concrete claim must include a valid [file:start-end] citation.",
    ].join("\n"),
  };
}

function updateRollingSummary(existing: string | null, question: string, answer: string): string {
  const nextEntry = [
    `User asked: ${trimText(question.replace(/\s+/g, " ").trim(), 300)}`,
    `Sonar answered: ${trimText(answer.replace(/\s+/g, " ").trim(), 700)}`,
  ].join("\n");
  return trimText([existing, nextEntry].filter(Boolean).join("\n\n"), 2400);
}

export async function answerOnboardingFollowup(input: {
  session: OnboardingSession;
  question: string;
  store: CodeUnitStore;
  repo: ProjectRepo;
}): Promise<OnboardingFollowupResult> {
  const messages = input.repo.listOnboardingMessages(input.session.id, 10);
  const retrieval = await retrieveOnboardingFollowup({
    query: input.question,
    projectId: input.session.projectId,
    store: input.store,
    sourceFiles: input.session.sourceFiles,
    repo: input.repo,
    maxContextRatio: 0.78,
  });

  const { system, user } = buildFollowupPrompt({
    session: input.session,
    messages,
    question: input.question,
    intent: retrieval.intent,
    contextUnits: retrieval.contextUnits,
  });

  const generationStart = Date.now();
  let answer = await generateResponse(system, user);
  let generationTime = Date.now() - generationStart;
  let citationVerification = verifyCitations(answer, retrieval.contextUnits);

  if (!citationVerification.valid) {
    const repairPrompt = buildFollowupCitationRepairPrompt(answer, retrieval.contextUnits);
    const repairStart = Date.now();
    const repaired = await generateResponse(repairPrompt.system, repairPrompt.user);
    const repairedVerification = verifyCitations(repaired, retrieval.contextUnits);
    generationTime += Date.now() - repairStart;

    if (
      repairedVerification.invalidCitations.length <= citationVerification.invalidCitations.length &&
      repairedVerification.uncitedClaims.length <= citationVerification.uncitedClaims.length
    ) {
      answer = repaired;
      citationVerification = repairedVerification;
    }
  }

  const sources = retrieval.contextUnits.map((unit) => ({
    filePath: unit.filePath,
    name: unit.name,
    kind: unit.kind,
    lines: `${unit.startLine}-${unit.endLine}`,
  }));

  input.repo.addOnboardingMessage({
    sessionId: input.session.id,
    role: "user",
    content: input.question,
    intent: classifyOnboardingFollowup(input.question),
  });
  input.repo.addOnboardingMessage({
    sessionId: input.session.id,
    role: "assistant",
    content: answer,
    intent: retrieval.intent,
    sources,
    citationVerification,
  });
  input.repo.updateOnboardingSessionSummary(input.session.id, updateRollingSummary(input.session.rollingSummary, input.question, answer));

  return {
    sessionId: input.session.id,
    projectId: input.session.projectId,
    question: input.question,
    answer,
    intent: retrieval.intent,
    sources,
    retrievalTime: retrieval.retrievalTime,
    generationTime,
    graphEnhanced: retrieval.graphEnhanced,
    citationVerification,
    queryPlanReason: retrieval.queryPlan.reason,
  };
}

export function onboardingSessionSourceFiles(sources: Array<{ filePath: string }>): string[] {
  return [...new Set(sources.map((source) => source.filePath))].slice(0, CONFIG.retriever.fusedTopK);
}
