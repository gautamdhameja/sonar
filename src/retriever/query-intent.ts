export type QueryIntent =
  | "architecture_overview"
  | "business_overview"
  | "workflow_trace"
  | "specific_symbol"
  | "file_explanation"
  | "dependency_explanation"
  | "risk_or_gap_analysis"
  | "general_code_question";

const ARCHITECTURE_PATTERNS = [
  "architecture",
  "overview",
  "how is the project structured",
  "main components",
  "entry point",
  "high level",
  "explain the codebase",
  "what does this project do",
  "what does this app do",
];

const BUSINESS_PATTERNS = [
  "business",
  "customer",
  "customers",
  "user value",
  "sales",
  "positioning",
  "who is this for",
  "what does it do for users",
];

const WORKFLOW_PATTERNS = [
  "how does",
  "flow",
  "workflow",
  "process",
  "lifecycle",
  "pipeline",
  "what happens when",
  "trace",
];

const DEPENDENCY_PATTERNS = [
  "depends on",
  "dependency",
  "dependencies",
  "imports",
  "imported by",
  "calls",
  "connected",
];

const RISK_PATTERNS = ["risk", "risks", "gap", "gaps", "missing", "concerns", "limitations", "what could go wrong"];

function includesAny(query: string, patterns: string[]): boolean {
  return patterns.some((pattern) => query.includes(pattern));
}

function looksLikeFileQuestion(query: string): boolean {
  return /\b[\w./-]+\.(ts|tsx|js|jsx|py)\b/.test(query);
}

function looksLikeSymbolQuestion(rawQuery: string): boolean {
  const quoted = /[`'"]([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)[`'"]/.test(rawQuery);
  const capitalizedSymbol = /\b[A-Z][A-Za-z0-9_$]{2,}\b/.test(rawQuery);
  const explicitSymbolWord = /\b(function|class|method|symbol|component|endpoint)\b/i.test(rawQuery);
  return quoted || (capitalizedSymbol && explicitSymbolWord);
}

export function classifyQueryIntent(query: string): QueryIntent {
  const normalized = query.trim().toLowerCase();

  if (
    normalized.includes("onboarding overview") ||
    normalized.includes("codebase onboarding") ||
    normalized.includes("codebase overview")
  ) {
    return includesAny(normalized, BUSINESS_PATTERNS) ? "business_overview" : "architecture_overview";
  }

  if (includesAny(normalized, RISK_PATTERNS)) return "risk_or_gap_analysis";
  if (includesAny(normalized, DEPENDENCY_PATTERNS)) return "dependency_explanation";
  if (looksLikeFileQuestion(normalized)) return "file_explanation";
  if (includesAny(normalized, BUSINESS_PATTERNS)) return "business_overview";
  if (includesAny(normalized, ARCHITECTURE_PATTERNS)) return "architecture_overview";
  if (includesAny(normalized, WORKFLOW_PATTERNS)) return "workflow_trace";
  if (looksLikeSymbolQuestion(query)) return "specific_symbol";

  return "general_code_question";
}

export function shouldUseGraphForIntent(intent: QueryIntent): boolean {
  return (
    intent === "architecture_overview" ||
    intent === "workflow_trace" ||
    intent === "dependency_explanation" ||
    intent === "risk_or_gap_analysis"
  );
}

export function shouldIncludeSummaryForIntent(intent: QueryIntent): boolean {
  return (
    intent === "architecture_overview" ||
    intent === "business_overview" ||
    intent === "workflow_trace" ||
    intent === "risk_or_gap_analysis"
  );
}
