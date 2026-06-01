import { Persona } from "../persona/types";

const ROLE_GUIDANCE: Record<Persona["role"], string> = {
  product_manager:
    "Frame the answer around user problems, product workflows, capabilities, tradeoffs, and decisions a PM should discuss with engineering.",
  sales:
    "Frame the answer around customer value, buyer-facing capabilities, implementation boundaries, and claims that are directly supported by the code.",
  customer_success:
    "Frame the answer around customer workflows, setup or usage implications, support handoffs, and visible behavior.",
  support:
    "Frame the answer around user-facing symptoms, operational steps, likely failure points, and where support should escalate.",
  operations:
    "Frame the answer around process flow, dependencies, reliability, configuration, and operational ownership.",
  executive:
    "Frame the answer around business purpose, major capabilities, strategic risks, and decisions that need technical confirmation.",
  engineer:
    "Use precise technical language for architecture and source landmarks, but keep the answer at orientation depth unless the user explicitly needs a source pointer.",
  other:
    "Use a general stakeholder-friendly explanation focused on what the system does, how the pieces relate, and what is directly supported by the code.",
};

function label(value: string): string {
  return value.replace(/_/g, " ");
}

export function buildPersonaGuidance(persona: Persona): string {
  const lines = [
    "AUDIENCE:",
    `- Role: ${label(persona.role)}`,
    `- Technical background: ${label(persona.technicalBackground)}`,
    `- Explanation depth: ${persona.explanationDepth}`,
    `- Jargon preference: ${persona.avoidJargon ? "avoid jargon and define unavoidable technical terms" : "technical terms are acceptable when useful"}`,
    `- Role guidance: ${ROLE_GUIDANCE[persona.role]}`,
  ];

  if (persona.roleDescription) {
    lines.push(`- Role details: ${persona.roleDescription}`);
  }
  if (persona.businessContext) {
    lines.push(`- Business context: ${persona.businessContext}`);
  }
  if (persona.preferredAnalogies?.length) {
    lines.push(`- Preferred analogy domains: ${persona.preferredAnalogies.join(", ")}`);
  }

  lines.push(
    "",
    "EXPLANATION STYLE:",
    "- Prefer plain language and tie code details to product, workflow, ownership, or risk meaning.",
    "- Stay at briefing depth: explain what matters and where to look, not line-by-line implementation mechanics.",
    '- Separate what the code proves from reasonable inferences; mark inferences with "(inferred)".',
    "- Do not invent customers, market positioning, security claims, or performance claims unless the supplied context supports them.",
    "- Define unavoidable technical terms in one short phrase the first time they appear.",
  );

  return lines.join("\n");
}
