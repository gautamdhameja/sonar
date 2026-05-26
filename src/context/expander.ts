import { CodeUnit } from "../parser/types";
import { CodeUnitStore } from "../retriever/unit-store";
import { CONFIG } from "../config";
import { estimateTokens, truncateLargeUnits } from "./token-budget";

export function expandContext(retrievedIds: string[], store: CodeUnitStore): CodeUnit[] {
  const included = new Set<string>();
  const primary: CodeUnit[] = [];
  const expanded: CodeUnit[] = [];

  // Step 1: Look up primary units
  for (const id of retrievedIds) {
    const unit = store.getUnit(id);
    if (!unit) continue;
    primary.push(unit);
    included.add(unit.id);
  }

  // Step 3: Expand class/method relationships
  for (const unit of primary) {
    if (unit.kind === "method" && unit.parentName) {
      // Find parent class in same file
      const candidates = store.getUnitsByFile(unit.filePath);
      const parentClass = candidates.find((u) => u.kind === "class" && u.name === unit.parentName);
      if (parentClass && !included.has(parentClass.id)) {
        expanded.push(parentClass);
        included.add(parentClass.id);
      }
    } else if (unit.kind === "class") {
      // Add all methods of this class
      const methods = store.getMethodsOfClass(unit.name, unit.filePath);
      for (const method of methods) {
        if (!included.has(method.id)) {
          expanded.push(method);
          included.add(method.id);
        }
      }
    }
  }

  // Step 4: Follow calledFunctions for top 3 primary units
  let additionalCount = 0;
  const maxAdditional = 5;
  for (let i = 0; i < Math.min(3, primary.length) && additionalCount < maxAdditional; i++) {
    const unit = primary[i];
    for (const fnName of unit.calledFunctions) {
      if (additionalCount >= maxAdditional) break;
      const matches = store.getUnitsByName(fnName);
      if (matches.length > 0 && !included.has(matches[0].id)) {
        expanded.push(matches[0]);
        included.add(matches[0].id);
        additionalCount++;
      }
    }
  }

  // Step 6: Sort expanded units by filePath
  expanded.sort((a, b) => a.filePath.localeCompare(b.filePath));

  // Step 7: Trim to fit token budget
  const maxTokens = CONFIG.generator.maxContextTokens;
  const boundedPrimary = truncateLargeUnits(primary, maxTokens);
  const boundedExpanded = truncateLargeUnits(expanded, maxTokens);

  // Remove primary units from end if they still exceed budget
  let primaryTokens = boundedPrimary.reduce((sum, u) => sum + estimateTokens(u.code), 0);
  while (primaryTokens > maxTokens && boundedPrimary.length > 1) {
    const removed = boundedPrimary.pop()!;
    included.delete(removed.id);
    primaryTokens -= estimateTokens(removed.code);
  }

  let expandedTokens = boundedExpanded.reduce((sum, u) => sum + estimateTokens(u.code), 0);
  while (primaryTokens + expandedTokens > maxTokens && boundedExpanded.length > 0) {
    const removed = boundedExpanded.pop()!;
    expandedTokens -= estimateTokens(removed.code);
  }

  return [...boundedPrimary, ...boundedExpanded];
}
