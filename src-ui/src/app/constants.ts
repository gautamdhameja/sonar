import type { DesktopModelConfig } from "../types";
import type { BriefingRole } from "./types";

export const defaultQuestion = "What should I understand first, and what should I ask next?";
export const defaultBriefingRole: BriefingRole = "product_strategy";

type BriefingRoleProfile = {
  label: string;
  description: string;
  audience: string;
  focus: string[];
  persona: {
    role: "product_manager" | "sales" | "customer_success" | "executive" | "engineer" | "other";
    roleDescription: string;
    technicalBackground: "basic" | "some_coding" | "technical";
    avoidJargon: boolean;
    explanationDepth: "quick" | "standard" | "deep";
    businessContext: string;
  };
};

export const briefingRoleProfiles = {
  product_strategy: {
    label: "Product & Strategy",
    description: "Users, workflows, value, decision questions.",
    audience:
      "A product, strategy, or founder-type teammate who needs to understand users, product behavior, workflow value, and priority questions.",
    focus: [
      "what the product or system appears to do for users",
      "core user workflows and value moments",
      "major capabilities, boundaries, and assumptions",
      "product risks, gaps, and dependencies",
      "high-leverage questions for product, design, and engineering",
    ],
    persona: {
      role: "product_manager",
      roleDescription: "Product and strategy",
      technicalBackground: "basic",
      avoidJargon: true,
      explanationDepth: "standard",
      businessContext:
        "Write a practical product briefing. Emphasize what the system enables, who it helps, how important workflows fit together, and what decisions or questions should come next.",
    },
  },
  engineering: {
    label: "Technical Orientation",
    description: "Architecture shape, data flow, systems, risks.",
    audience:
      "A technical teammate who needs the architecture shape, core workflows, source ownership areas, and implementation risks before deeper engineering work.",
    focus: [
      "architecture and major system boundaries",
      "core workflows and data flow",
      "important modules, interfaces, and ownership areas",
      "operational, security, and maintainability risks",
      "files or concepts an engineer should read first",
    ],
    persona: {
      role: "engineer",
      roleDescription: "Technical orientation",
      technicalBackground: "technical",
      avoidJargon: false,
      explanationDepth: "standard",
      businessContext:
        "Write a technical orientation briefing. Include architecture, data flow, implementation tradeoffs, and concrete source navigation, but stay at briefing depth rather than line-by-line code analysis.",
    },
  },
  go_to_market: {
    label: "Go-to-Market",
    description: "Positioning, buyers, integrations, proof points.",
    audience:
      "A go-to-market teammate in marketing, sales, business development, or solutions who needs customer value, positioning, buyer questions, and credible proof points.",
    focus: [
      "customer value and likely buyer use cases",
      "user-facing capabilities and differentiators",
      "integration points, dependencies, and data boundaries",
      "positioning proof points supported by the source",
      "commercial, trust, and validation questions for the team",
    ],
    persona: {
      role: "sales",
      roleDescription: "Go-to-market",
      technicalBackground: "basic",
      avoidJargon: true,
      explanationDepth: "standard",
      businessContext:
        "Write a customer-facing discovery briefing. Translate technical behavior into customer impact, credible claims, integration implications, risk, and useful follow-up questions.",
    },
  },
  customer_success: {
    label: "Customer Success",
    description: "Support paths, adoption, risks, operations.",
    audience:
      "A customer success, support, implementation, or operations teammate who needs adoption workflows, support boundaries, failure modes, and escalation questions.",
    focus: [
      "customer onboarding and adoption workflows",
      "support-relevant behavior, states, and failure paths",
      "data, privacy, and operational boundaries",
      "configuration, deployment, or dependency risks",
      "escalation questions for engineering or product",
    ],
    persona: {
      role: "customer_success",
      roleDescription: "Customer success and support",
      technicalBackground: "basic",
      avoidJargon: true,
      explanationDepth: "standard",
      businessContext:
        "Write an adoption and support briefing. Emphasize workflows, customer-facing behavior, operational boundaries, risks, and what the team should know before helping users.",
    },
  },
  leadership: {
    label: "Leadership",
    description: "Capabilities, tradeoffs, risk, priorities.",
    audience:
      "An executive, product leader, engineering leader, or investor-facing operator who needs strategic capability, risk, and priority context.",
    focus: [
      "what the system enables and why it matters",
      "business-critical capabilities and constraints",
      "technical, operational, security, or trust risks",
      "ownership, scale, and maintainability implications",
      "priority decisions and questions for the team",
    ],
    persona: {
      role: "executive",
      roleDescription: "Leadership",
      technicalBackground: "some_coding",
      avoidJargon: true,
      explanationDepth: "standard",
      businessContext:
        "Write a leadership briefing. Balance product capability, strategic risk, operational maturity, and technical tradeoffs. Avoid code detail unless it changes a decision.",
    },
  },
} satisfies Record<BriefingRole, BriefingRoleProfile>;

export const localLlamaConfig: DesktopModelConfig = {
  modelSetupComplete: false,
  modelMode: "local",
  chatBaseUrl: "http://127.0.0.1:8080/v1",
  chatModel: "local-model",
  chatApiKey: "not-needed",
};

export const openAiCompatibleConfig: DesktopModelConfig = {
  modelSetupComplete: false,
  modelMode: "api",
  chatBaseUrl: "https://api.openai.com/v1",
  chatModel: "gpt-4.1-mini",
  chatApiKey: "",
};

export const suggestedQuestions = [
  "What should I read first?",
  "What are the main user workflows?",
  "What is risky or unclear?",
  "What should I ask engineering?",
  "How does data move through this app?",
  "What are the main user-facing features?",
  "What are the important systems?",
  "What might break in production?",
  "Which files explain the product best?",
  "What should a non-technical teammate know?",
];
