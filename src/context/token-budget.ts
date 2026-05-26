import { CodeUnit } from "../parser/types";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function truncateLargeUnits(units: CodeUnit[], maxTokens: number, maxUnitRatio = 0.4): CodeUnit[] {
  const maxSingleUnit = Math.floor(maxTokens * maxUnitRatio);
  return units.map((unit) => {
    if (estimateTokens(unit.code) <= maxSingleUnit) return unit;

    const charLimit = maxSingleUnit * 3;
    const truncatedCode = unit.code.slice(0, charLimit);
    const visibleLineCount = Math.max(1, truncatedCode.split("\n").length);
    return {
      ...unit,
      code: truncatedCode + "\n// ... truncated ...",
      endLine: Math.min(unit.endLine, unit.startLine + visibleLineCount - 1),
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
