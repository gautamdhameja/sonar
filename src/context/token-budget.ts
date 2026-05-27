import { CodeUnit } from "../parser/types";
import { extractNeedlesForCitationOrPacking } from "../retriever/query-features";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function lineNumberForOffset(text: string, offset: number): number {
  if (offset <= 0) return 1;
  return text.slice(0, offset).split("\n").length;
}

function findBestNeedleOffset(code: string, needles: string[]): number {
  const lowerCode = code.toLowerCase();
  for (const needle of needles) {
    const normalized = needle.toLowerCase();
    if (!normalized) continue;
    const offset = lowerCode.indexOf(normalized);
    if (offset !== -1) return offset;
  }
  return -1;
}

export function truncateLargeUnits(units: CodeUnit[], maxTokens: number, maxUnitRatio = 0.4, query = ""): CodeUnit[] {
  const maxSingleUnit = Math.floor(maxTokens * maxUnitRatio);
  const needles = extractNeedlesForCitationOrPacking(query);
  return units.map((unit) => {
    if (estimateTokens(unit.code) <= maxSingleUnit) return unit;

    const charLimit = maxSingleUnit * 3;
    const evidenceOffset = findBestNeedleOffset(unit.code, needles);
    const rawStart = evidenceOffset === -1 ? 0 : Math.max(0, evidenceOffset - Math.floor(charLimit / 2));
    const snippetStart = rawStart === 0 ? 0 : unit.code.lastIndexOf("\n", rawStart) + 1;
    const snippetEnd = Math.min(unit.code.length, snippetStart + charLimit);
    const truncatedCode = unit.code.slice(snippetStart, snippetEnd);
    const visibleLineCount = Math.max(1, truncatedCode.split("\n").length);
    const startLine = unit.startLine + lineNumberForOffset(unit.code, snippetStart) - 1;
    const prefix = snippetStart > 0 ? "// ... truncated above ...\n" : "";
    const suffix = snippetEnd < unit.code.length ? "\n// ... truncated below ..." : "";

    return {
      ...unit,
      code: `${prefix}${truncatedCode}${suffix}`,
      startLine,
      endLine: Math.min(unit.endLine, startLine + visibleLineCount - 1),
    };
  });
}

export function trimToTokenBudget(units: CodeUnit[], maxTokens: number): CodeUnit[] {
  const trimmed = truncateLargeUnits(units, maxTokens);
  const result: CodeUnit[] = [];
  let total = 0;

  for (const unit of trimmed) {
    const tokens = estimateTokens(unit.code);
    if (total + tokens > maxTokens) break;
    result.push(unit);
    total += tokens;
  }

  return result;
}
