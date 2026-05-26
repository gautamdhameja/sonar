import { CodeUnit } from "../parser/types";
import { QueryIntent } from "./query-intent";
import { isDocumentationFile, isTestFile, queryNeedsTestEvidence } from "./source-classifier";

export interface ScoreReason {
  score: number;
  reasons: string[];
}

function unitSearchText(unit: CodeUnit): string {
  return [
    unit.filePath,
    unit.name,
    unit.code,
    unit.imports.join("\n"),
    unit.exportedNames.join("\n"),
  ].join("\n").toLowerCase();
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
  const asksWorkflow = /\b(how does|workflow|pipeline|flow|process|collect|classify|score|save|persist|candidate)\b/.test(normalized);
  if (!asksWorkflow) return { score: 0, reasons: [] };

  const filePath = unit.filePath.toLowerCase();
  const text = `${filePath} ${unit.name} ${unit.code}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const weight = scale === "packer"
    ? { daily: 18, runner: 14, components: 12, stageFile: 14, db: 18, collect: 10, stage: 18, digest: 8 }
    : { daily: 8, runner: 6, components: 5, stageFile: 4, db: 3, collect: 4, stage: 5, digest: 3 };

  if (/src\/daily\/pipeline\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
    score += weight.daily;
    reasons.push("daily pipeline file");
  }
  if (/src\/framework\/pipeline\/runner\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
    score += weight.runner;
    reasons.push("pipeline runner file");
  }
  if (/src\/framework\/pipeline\/defaultcomponents\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
    score += weight.components;
    reasons.push("default pipeline components");
  }
  if (/src\/daily\/(classification|scoring|digest)\.(ts|tsx|js|jsx|py)$/.test(filePath)) {
    score += weight.stageFile;
    reasons.push("workflow stage file");
  }
  if (/src\/db\//.test(filePath)) {
    score += weight.db;
    reasons.push("persistence source");
  }

  if (/\b(collect|collection|candidate|source)\b/.test(normalized) && /\b(collect\w*|candidate\w*|source\w*|arxiv|hacker|search\w*)\b/.test(text)) {
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
  if (/\b(save|persist|store|db|database|write)\b/.test(normalized) && /\b(save\w*|persist\w*|upsert\w*|insert\w*|db|database|store\w*)\b/.test(text)) {
    score += weight.stage;
    reasons.push("persistence stage match");
  }
  if (/\b(digest|render|output)\b/.test(normalized) && /\b(digest|render|output)\b/.test(text)) {
    score += weight.digest;
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
  if (/src\/(main|runPipeline)\.(ts|tsx|js|jsx|py)$/.test(unit.filePath)) {
    score += 7;
    reasons.push("entry point source");
  }
  if (/src\/framework\/pipeline\/(runner|defaultComponents)\.(ts|tsx|js|jsx|py)$/.test(unit.filePath)) {
    score += 6;
    reasons.push("central pipeline source");
  }
  if (/src\/(config|db|llama)\//.test(unit.filePath)) {
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
