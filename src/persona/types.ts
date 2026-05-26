export type UserRole =
  | "product_manager"
  | "sales"
  | "customer_success"
  | "support"
  | "operations"
  | "executive"
  | "engineer"
  | "other";

export type TechnicalBackground = "none" | "basic" | "some_coding" | "technical";

export type ExplanationDepth = "quick" | "standard" | "deep";

export interface Persona {
  role: UserRole;
  roleDescription?: string;
  technicalBackground: TechnicalBackground;
  businessContext?: string;
  preferredAnalogies?: string[];
  avoidJargon: boolean;
  explanationDepth: ExplanationDepth;
}

export const DEFAULT_PERSONA: Persona = {
  role: "other",
  technicalBackground: "basic",
  avoidJargon: true,
  explanationDepth: "standard",
};
