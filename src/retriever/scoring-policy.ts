import { CodeUnit } from "../parser/types";
import { QueryIntent } from "./query-intent";
import { isDocumentationFile, isTestFile, queryNeedsTestEvidence } from "./source-classifier";

export interface ScoreReason {
  score: number;
  reasons: string[];
}

export const ONBOARDING_WORKFLOW_TERMS = [
  // Curated for cross-repository structure and product behavior, not one app's domain vocabulary.
  "app",
  "command",
  "file",
  "input",
  "process",
  "pipeline",
  "workflow",
  "render",
  "display",
  "output",
  "state",
  "write",
  "export",
  "import",
  "save",
  "storage",
  "sync",
  "backend",
  "auth",
  "login",
  "settings",
  "onboarding",
  "parser",
] as const;

export const ONBOARDING_PRODUCT_TERMS = [
  "product",
  "user",
  "customer",
  "workflow",
  "feature",
  "offline",
  "privacy",
  "security",
  "risk",
  "roadmap",
  "overview",
] as const;

export function normalizedUnitText(unit: CodeUnit): string {
  return [
    unit.filePath,
    unit.name,
    unit.kind,
    unit.docstring ?? "",
    unit.exportedNames.join(" "),
    unit.calledFunctions.join(" "),
    unit.code,
  ]
    .join("\n")
    .toLowerCase();
}

export function isPackageBoundary(unit: CodeUnit): boolean {
  return (
    /(^|\/)(index|main|app|server|client)\.(ts|tsx|js|jsx|py)$/.test(unit.filePath) ||
    /^packages\/[^/]+\/src\/index\.(ts|tsx|js|jsx|py)$/.test(unit.filePath) ||
    /^packages\/[^/]+\/index\.(ts|tsx|js|jsx|py)$/.test(unit.filePath)
  );
}

export function unitLengthPenalty(unit: CodeUnit): number {
  const lineCount = unit.endLine - unit.startLine + 1;
  if (isDocumentationFile(unit.filePath) && /(^|\/)readme\.mdx?$/i.test(unit.filePath)) return 0;
  if (isDocumentationFile(unit.filePath) && lineCount > 1000) return -30;
  if (lineCount > 1200) return -32;
  if (lineCount > 600) return -20;
  if (lineCount > 300) return -8;
  return 0;
}

function unitSearchText(unit: CodeUnit): string {
  return [unit.filePath, unit.name, unit.code, unit.imports.join("\n"), unit.exportedNames.join("\n")]
    .join("\n")
    .toLowerCase();
}

export function kindPriority(kind: CodeUnit["kind"]): number {
  switch (kind) {
    case "class":
      return 3;
    case "function":
      return 2.5;
    case "method":
      return 2;
    case "module":
      return 1.5;
  }
}

export function exactMetadataMatchBonus(unit: CodeUnit, terms: string[]): number {
  const name = unit.name.toLowerCase();
  const filePath = unit.filePath.toLowerCase();
  const exports = unit.exportedNames.map((item) => item.toLowerCase());
  let bonus = 0;

  for (const term of terms) {
    if (name === term) bonus += 10;
    else if (name.includes(term)) bonus += 4;
    if (filePath.includes(term)) bonus += 3;
    if (exports.includes(term)) bonus += 5;
  }

  return bonus;
}

export function hasExactEvidenceMatch(unit: CodeUnit, paths: string[], needles: string[]): boolean {
  const filePath = unit.filePath.toLowerCase();
  const code = unit.code.toLowerCase();

  if (paths.some((targetPath) => filePath === targetPath || filePath.endsWith(targetPath))) {
    return true;
  }

  return needles.some((needle) => code.includes(needle) || filePath.includes(needle));
}

export function hasExactNeedleMatch(unit: CodeUnit, needles: string[]): boolean {
  const haystack = unitSearchText(unit);
  return needles.some((needle) => haystack.includes(needle));
}

export function supportFileBonus(unit: CodeUnit, query: string): number {
  if (!/\b(schema|validate|validation|zod|config|configured|env|setting|test|spec)\b/i.test(query)) {
    return 0;
  }

  let bonus = 0;
  if (/\b(schema|config|env|test|spec)\b/i.test(unit.filePath)) bonus += 8;
  if (/\b(schema|validate|validation|zod|process\.env)\b/i.test(unit.code)) bonus += 8;
  return bonus;
}

export function queryTermMatchBonus(unit: CodeUnit, terms: string[]): ScoreReason {
  const unitText = `${unit.filePath} ${unit.name} ${unit.exportedNames.join(" ")}`.toLowerCase();
  const matches = terms.filter((term) => unitText.includes(term)).length;
  if (matches === 0) return { score: 0, reasons: [] };
  return {
    score: Math.min(8, matches * 2),
    reasons: [`${matches} query term matches`],
  };
}

export function workflowEvidenceBonus(unit: CodeUnit, query: string, scale: "packer" | "reranker"): ScoreReason {
  const normalized = query.toLowerCase();
  const asksWorkflow =
    /\b(how does|workflow|pipeline|flow|process|collect|classify|score|save|persist|candidate)\b/.test(normalized);
  if (!asksWorkflow) return { score: 0, reasons: [] };

  const filePath = unit.filePath.toLowerCase();
  const text = `${filePath} ${unit.name} ${unit.code}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const weight =
    scale === "packer"
      ? { entry: 16, stageFile: 14, persistenceSource: 14, collect: 8, stage: 16, output: 6 }
      : { entry: 7, stageFile: 4, persistenceSource: 3, collect: 3, stage: 5, output: 2 };

  if (/(^|\/)(pipeline|workflow|flow|runner|orchestrator|processor)\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
    score += weight.entry;
    reasons.push("workflow entry file");
  }
  if (/(^|\/)(classification|classify|scoring|ranking|collector|collection|sync)\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
    score += weight.stageFile;
    reasons.push("workflow stage file");
  }
  if (/(^|\/)(db|database|storage|store)\//.test(filePath)) {
    score += weight.persistenceSource;
    reasons.push("persistence source");
  }

  if (/\b(collect|collection|candidate|source)\b/.test(normalized) && /\b(collect\w*|source\w*)\b/.test(text)) {
    score += weight.collect;
    reasons.push("collection stage match");
  }
  if (/\b(classify|classification|category|categorize)\b/.test(normalized) && /\b(classif|categor)/.test(text)) {
    score += weight.stage;
    reasons.push("classification stage match");
  }
  if (/\b(score|scoring|rank|ranking|rubric)\b/.test(normalized) && /\b(score\w*|rank\w*|rubric\w*)\b/.test(text)) {
    score += weight.stage;
    reasons.push("scoring stage match");
  }
  if (
    /\b(save|persist|store|db|database|write)\b/.test(normalized) &&
    /\b(save\w*|persist\w*|upsert\w*|insert\w*|db|database|store\w*)\b/.test(text)
  ) {
    score += weight.stage;
    reasons.push("persistence stage match");
  }
  if (
    /\b(render|output|response|present)\b/.test(normalized) &&
    /\b(render\w*|output\w*|response\w*|present\w*)\b/.test(text)
  ) {
    score += weight.output;
    reasons.push("output stage match");
  }

  return { score, reasons };
}

export function overviewEvidenceBonus(unit: CodeUnit, intent: QueryIntent): ScoreReason {
  if (intent !== "architecture_overview" && intent !== "business_overview") {
    return { score: 0, reasons: [] };
  }

  const reasons: string[] = [];
  let score = 0;

  if (isDocumentationFile(unit.filePath)) {
    score += 8;
    reasons.push("documentation overview source");
  }
  const filePath = unit.filePath.toLowerCase();

  if (/(^|\/)(main|index|app|server|client|run|runner)\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
    score += 7;
    reasons.push("entry point source");
  }
  if (/(^|\/)(pipeline|workflow|flow|orchestrator|processor)\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
    score += 6;
    reasons.push("central workflow source");
  }
  if (/(^|\/)(config|db|database|storage|model|llm|ai)\//.test(filePath)) {
    score += 3;
    reasons.push("core subsystem source");
  }

  return { score, reasons };
}

export function testFilePenalty(unit: CodeUnit, query: string, amount: number): ScoreReason {
  if (!isTestFile(unit.filePath) || queryNeedsTestEvidence(query)) return { score: 0, reasons: [] };
  return {
    score: -amount,
    reasons: ["test source demoted for non-test query"],
  };
}
