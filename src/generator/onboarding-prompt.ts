import { CodeUnit } from "../parser/types";
import { DEFAULT_PERSONA, Persona } from "../persona/types";
import { buildPersonaGuidance } from "./persona-guidance";

export interface OnboardingBriefOptions {
  repoName: string;
  audience: string;
  focus: string[];
  persona?: Persona;
}

function sourceKey(unit: CodeUnit): string {
  return `${unit.filePath}:${unit.startLine}-${unit.endLine}`;
}

export function buildOnboardingBriefPrompt(
  units: CodeUnit[],
  options: OnboardingBriefOptions,
): { system: string; user: string } {
  const persona = options.persona ?? DEFAULT_PERSONA;
  const system = [
    `You are Sonar, writing first-week onboarding documentation for "${options.repoName}".`,
    "The reader wants the kind of explanation they would get in their first week at a company, not a deep code walkthrough.",
    "",
    buildPersonaGuidance(persona),
    "",
    "RULES:",
    "1. Use only the provided source context.",
    "2. Every factual bullet or sentence must include a citation in the form [file:start-end].",
    "3. If a topic is not supported by the provided source context, write 'Not found in provided context' for that topic.",
    "4. Prefer product language: users, workflows, promises, data, ownership, risks, and questions to ask.",
    "5. Avoid low-level implementation details unless they explain product behavior or risk.",
    "6. Mark inferences with '(inferred)' and cite the source that supports the inference.",
    "7. Keep the result concise enough to read in one sitting.",
  ].join("\n");

  const parts: string[] = [
    `## Audience`,
    options.audience,
    "",
    "## Focus Areas",
    ...options.focus.map((item) => `- ${item}`),
    "",
    "## Required Output Structure",
    "1. Product In One Paragraph",
    "2. Who Uses It And Why",
    "3. First-Week Product Map",
    "4. Top User Workflows",
    "5. Main Systems And Ownership Areas",
    "6. Data, Privacy, And Operational Notes",
    "7. Risks Or Open Questions",
    "8. Glossary For A Non-Deeply-Technical Reader",
    "",
    "## Source Context",
  ];

  for (const unit of units) {
    parts.push(`### ${sourceKey(unit)} - ${unit.kind} ${unit.name}`);
    parts.push(`\`\`\`${unit.language}`);
    parts.push(unit.code);
    parts.push("```");
    parts.push("");
  }

  return { system, user: parts.join("\n") };
}

export function buildCitationRepairPrompt(answer: string, units: CodeUnit[]): { system: string; user: string } {
  const system = [
    "You repair source grounding in an onboarding brief.",
    "Use only the listed sources. Do not add new facts.",
    "Every factual bullet or sentence must include a valid citation in the form [file:start-end].",
    "Remove unsupported claims instead of leaving them uncited.",
    "Keep the same overall structure.",
  ].join("\n");

  const sourceList = units.map((unit) => `- ${sourceKey(unit)} (${unit.kind} ${unit.name})`).join("\n");
  const user = ["## Valid Sources", sourceList, "", "## Brief To Repair", answer].join("\n");

  return { system, user };
}
