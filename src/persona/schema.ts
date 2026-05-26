import { DEFAULT_PERSONA, ExplanationDepth, Persona, TechnicalBackground, UserRole } from "./types";

const USER_ROLES: readonly UserRole[] = [
  "product_manager",
  "sales",
  "customer_success",
  "support",
  "operations",
  "executive",
  "engineer",
  "other",
];

const TECHNICAL_BACKGROUNDS: readonly TechnicalBackground[] = ["none", "basic", "some_coding", "technical"];

const EXPLANATION_DEPTHS: readonly ExplanationDepth[] = ["quick", "standard", "deep"];

export class PersonaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonaValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new PersonaValidationError(`persona.${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, 1000);
}

function optionalStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PersonaValidationError(`persona.${key} must be an array of strings`);
  }
  return value
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function enumValue<T extends string>(
  input: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new PersonaValidationError(`persona.${key} must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

function booleanValue(input: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new PersonaValidationError(`persona.${key} must be a boolean`);
  }
  return value;
}

export function parsePersona(value: unknown): Persona {
  if (value === undefined || value === null) {
    return DEFAULT_PERSONA;
  }
  if (!isRecord(value)) {
    throw new PersonaValidationError("persona must be an object");
  }

  const persona: Persona = {
    role: enumValue(value, "role", USER_ROLES, DEFAULT_PERSONA.role),
    technicalBackground: enumValue(
      value,
      "technicalBackground",
      TECHNICAL_BACKGROUNDS,
      DEFAULT_PERSONA.technicalBackground,
    ),
    avoidJargon: booleanValue(value, "avoidJargon", DEFAULT_PERSONA.avoidJargon),
    explanationDepth: enumValue(value, "explanationDepth", EXPLANATION_DEPTHS, DEFAULT_PERSONA.explanationDepth),
  };

  const roleDescription = optionalString(value, "roleDescription");
  if (roleDescription) persona.roleDescription = roleDescription;

  const businessContext = optionalString(value, "businessContext");
  if (businessContext) persona.businessContext = businessContext;

  const preferredAnalogies = optionalStringArray(value, "preferredAnalogies");
  if (preferredAnalogies && preferredAnalogies.length > 0) {
    persona.preferredAnalogies = preferredAnalogies;
  }

  return persona;
}

export type { Persona } from "./types";
