import { QueryIntent } from "./query-intent";
import { RetrievedUnit } from "./hybrid-retriever";
import { CodeUnitStore } from "./unit-store";
import { extractNeedlesForCitationOrPacking, extractPaths, extractTerms } from "./query-features";
import {
  hasExactNeedleMatch,
  overviewEvidenceBonus,
  queryTermMatchBonus,
  testFilePenalty,
  workflowEvidenceBonus,
} from "./scoring-policy";

export interface RetrievalDiagnostic {
  unitId: string;
  filePath: string;
  name: string;
  kind: string;
  originalScore: number;
  rerankedScore: number;
  keywordRank: number | null;
  semanticRank: number | null;
  reasons: string[];
}

function queryTerms(query: string): string[] {
  return extractTerms(query).map((term) => term.value);
}

function queryNeedles(query: string): string[] {
  return [
    ...new Set([
      ...extractNeedlesForCitationOrPacking(query),
      ...extractPaths(query).map((item) => item.toLowerCase()),
    ]),
  ];
}

export function rerankRetrievedResults(
  query: string,
  intent: QueryIntent,
  retrieved: RetrievedUnit[],
  store: CodeUnitStore,
  topK: number,
): { results: RetrievedUnit[]; diagnostics: RetrievalDiagnostic[] } {
  const needles = queryNeedles(query);
  const terms = queryTerms(query);
  const maxScore = Math.max(0, ...retrieved.map((result) => result.rrfScore));

  const scored = retrieved.map((result, order) => {
    const unit = store.getUnit(result.unitId);
    const reasons: string[] = [];
    const base = maxScore > 0 ? (result.rrfScore / maxScore) * 20 : 0;
    let score = base - order * 0.001;

    if (unit) {
      if (result.keywordRank !== null) reasons.push(`keyword rank ${result.keywordRank}`);
      if (result.semanticRank !== null) reasons.push(`semantic rank ${result.semanticRank}`);

      if (hasExactNeedleMatch(unit, needles)) {
        score += 28;
        reasons.push("exact query literal/path match");
      }

      const termMatches = queryTermMatchBonus(unit, terms);
      score += termMatches.score;
      reasons.push(...termMatches.reasons);

      const workflow = workflowEvidenceBonus(unit, query, "reranker");
      score += workflow.score;
      reasons.push(...workflow.reasons);

      const overview = overviewEvidenceBonus(unit, intent);
      score += overview.score;
      reasons.push(...overview.reasons);

      const testPenalty = testFilePenalty(unit, query, 30);
      score += testPenalty.score;
      reasons.push(...testPenalty.reasons);

      if (unit.isVendored) {
        score -= 20;
        reasons.push("vendored source demoted");
      }
    }

    return { result, unit, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score);

  const results = scored.slice(0, topK).map((entry) => ({
    ...entry.result,
    rrfScore: entry.score,
  }));

  const diagnostics = scored.slice(0, topK).map((entry) => ({
    unitId: entry.result.unitId,
    filePath: entry.unit?.filePath ?? "(missing unit)",
    name: entry.unit?.name ?? "(missing unit)",
    kind: entry.unit?.kind ?? "(missing unit)",
    originalScore: entry.result.rrfScore,
    rerankedScore: entry.score,
    keywordRank: entry.result.keywordRank,
    semanticRank: entry.result.semanticRank,
    reasons: entry.reasons,
  }));

  return { results, diagnostics };
}
