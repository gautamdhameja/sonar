import { CodeUnit } from "../parser/types";
import { CodeUnitStore } from "./unit-store";
import { RetrievedUnit } from "./retrieved-unit";
import { isBriefingNoiseFile, isDocumentationFile, isTestFile } from "./source-classifier";
import {
  isPackageBoundary,
  normalizedUnitText,
  ONBOARDING_PRODUCT_TERMS,
  ONBOARDING_WORKFLOW_TERMS,
  unitLengthPenalty,
} from "./scoring-policy";

export interface OnboardingRetrievalOptions {
  query: string;
  topK?: number;
  maxPerFile?: number;
}

export interface OnboardingRetrievalDiagnostic {
  unitId: string;
  filePath: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface OnboardingRetrievalResult {
  retrieved: RetrievedUnit[];
  diagnostics: OnboardingRetrievalDiagnostic[];
}

function scoreOnboardingUnit(unit: CodeUnit, query: string): { score: number; reasons: string[] } {
  const text = normalizedUnitText(unit);
  const filePath = unit.filePath.toLowerCase();
  const queryText = query.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (unit.isVendored) return { score: 0, reasons: [] };
  if (isBriefingNoiseFile(unit.filePath)) return { score: 0, reasons: [] };
  if (isTestFile(unit.filePath)) score -= 30;
  if (
    /(^|\/)changelog\.mdx?$/i.test(unit.filePath) &&
    !/\b(changelog|release|version|migration|api change)\b/.test(queryText)
  ) {
    score -= 55;
  }

  if (isDocumentationFile(unit.filePath)) {
    score += /^readme\.md$/i.test(unit.filePath) ? 44 : 24;
    reasons.push("overview documentation");
  }

  if (isPackageBoundary(unit)) {
    score += 22;
    reasons.push("package or app boundary");
  }

  if (/^(src|app|apps|packages)\//.test(filePath)) {
    score += 8;
    reasons.push("production source");
  }

  if (unit.kind === "module") {
    score += 5;
    reasons.push("file-level context");
  } else if (unit.kind === "class" || unit.kind === "function") {
    score += 3;
  }

  for (const term of ONBOARDING_WORKFLOW_TERMS) {
    if (filePath.includes(term) || unit.name.toLowerCase().includes(term)) {
      score += 10;
      reasons.push(`workflow term in path/name: ${term}`);
    } else if (text.includes(term)) {
      score += 3;
    }
  }

  for (const term of ONBOARDING_PRODUCT_TERMS) {
    if (queryText.includes(term) && text.includes(term)) {
      score += 4;
    }
  }

  if (/\b(product manager|pm|briefing|orientation|non-technical)\b/.test(queryText)) {
    if (/\b(readme|docs|welcome|share|export|collab|local|privacy|security|risk)\b/.test(filePath)) {
      score += 10;
      reasons.push("product briefing match");
    }
    if (
      /\b(localdata|filemanager|portal|backend|sharedialog|export|collab|collaboration|storage|share|sync|socket)\b/.test(
        `${filePath} ${unit.name}`.toLowerCase(),
      )
    ) {
      score += 18;
      reasons.push("workflow owner");
    }
  }

  if (
    /\b(local|offline|save|persist|restore)\b/.test(queryText) &&
    /\b(local|storage|save|persist|restore|indexeddb|localstorage)\b/.test(text)
  ) {
    score += 12;
    reasons.push("local persistence evidence");
  }

  if (
    /\b(input|keypress|keyboard|command|editor|buffer|document|state)\b/.test(queryText) &&
    /\b(input|keypress|keyboard|keydown|keyup|command|editor|buffer|document|state|dispatch|update)\b/.test(text)
  ) {
    score += 14;
    reasons.push("input/editor state evidence");
  }

  if (
    /\b(render|display|terminal|output|screen|view)\b/.test(queryText) &&
    /\b(render|display|terminal|output|screen|view|paint|draw|stdout|write)\b/.test(text)
  ) {
    score += 14;
    reasons.push("render/output evidence");
  }

  if (
    /\b(save|persist|persistence|disk|file|write|storage)\b/.test(queryText) &&
    /\b(save|persist|write|disk|file|storage|fs\.|writefile|localstorage|indexeddb|database)\b/.test(text)
  ) {
    score += 14;
    reasons.push("persistence evidence");
  }

  if (
    /\b(language|lsp|tree-sitter|parser|grammar|integration)\b/.test(queryText) &&
    /\b(language|lsp|tree-sitter|treesitter|parser|grammar|syntax|diagnostic|completion)\b/.test(text)
  ) {
    score += 14;
    reasons.push("language feature evidence");
  }

  if (
    /\b(collab|collaboration|share|room|privacy|encrypt)\b/.test(queryText) &&
    /\b(collab|socket|room|backend|encrypt|decrypt|share|sync)\b/.test(text)
  ) {
    score += 12;
    reasons.push("collaboration/privacy evidence");
  }

  score += unitLengthPenalty(unit);

  return { score, reasons };
}

export function onboardingRetrieval(
  store: CodeUnitStore,
  options: OnboardingRetrievalOptions,
): OnboardingRetrievalResult {
  const topK = options.topK ?? 24;
  const maxPerFile = options.maxPerFile ?? 2;
  const fileCounts = new Map<string, number>();

  const scored = store
    .getAllUnits()
    .map((unit) => {
      const { score, reasons } = scoreOnboardingUnit(unit, options.query);
      return { unit, score, reasons };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath));

  const selected: typeof scored = [];
  for (const entry of scored) {
    const count = fileCounts.get(entry.unit.filePath) ?? 0;
    if (count >= maxPerFile) continue;
    selected.push(entry);
    fileCounts.set(entry.unit.filePath, count + 1);
    if (selected.length >= topK) break;
  }

  return {
    retrieved: selected.map((entry, index) => ({
      unitId: entry.unit.id,
      rrfScore: entry.score,
      keywordRank: index + 1,
      semanticRank: null,
      isVendored: entry.unit.isVendored,
    })),
    diagnostics: selected.map((entry) => ({
      unitId: entry.unit.id,
      filePath: entry.unit.filePath,
      name: entry.unit.name,
      score: entry.score,
      reasons: entry.reasons,
    })),
  };
}
