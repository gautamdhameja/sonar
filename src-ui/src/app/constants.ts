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
    description: "Users, workflows, value, roadmap questions.",
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
    label: "Engineering",
    description: "Architecture, flows, modules, risks.",
    audience:
      "An engineer joining the project who needs architecture, core workflows, source ownership areas, and implementation risks.",
    focus: [
      "architecture and major system boundaries",
      "core workflows and data flow",
      "important modules, interfaces, and ownership areas",
      "operational, security, and maintainability risks",
      "files or concepts an engineer should read first",
    ],
    persona: {
      role: "engineer",
      roleDescription: "Engineering",
      technicalBackground: "technical",
      avoidJargon: false,
      explanationDepth: "deep",
      businessContext:
        "Write a technical onboarding briefing. Include architecture, data flow, implementation tradeoffs, and concrete source navigation, while keeping every claim grounded in citations.",
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

export const dockerModelRunnerConfig: DesktopModelConfig = {
  modelSetupComplete: false,
  modelMode: "local",
  chatBaseUrl: "http://localhost:12434/engines/llama.cpp/v1",
  chatModel: "hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL",
  chatApiKey: "not-needed",
  embeddingBaseUrl: "http://localhost:12434/engines/v1",
  embeddingModel: "hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M",
  embeddingApiKey: "not-needed",
  embeddingVectorSize: 768,
  apiToken: "",
};

export const openAiCompatibleConfig: DesktopModelConfig = {
  modelSetupComplete: false,
  modelMode: "api",
  chatBaseUrl: "https://api.openai.com/v1",
  chatModel: "gpt-4.1-mini",
  chatApiKey: "",
  embeddingBaseUrl: "https://api.openai.com/v1",
  embeddingModel: "text-embedding-3-small",
  embeddingApiKey: "",
  embeddingVectorSize: 1536,
  apiToken: "",
};

export const suggestedQuestions = [
  "What should I read first?",
  "Where does the main workflow start?",
  "What is risky or unclear?",
  "What should I ask engineering?",
  "How does data move through this app?",
  "What are the main user-facing features?",
  "Where are the configuration boundaries?",
  "What would break first in production?",
  "Which files explain the product best?",
  "What should a non-technical teammate know?",
];
