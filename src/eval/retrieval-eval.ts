import { CodeUnitStore } from "../retriever/unit-store";
import { RetrievedUnit } from "../retriever/hybrid-retriever";
import { QueryIntent } from "../retriever/query-intent";
import { rerankRetrievedResults } from "../retriever/reranker";
import { localExactSearch, localGrepSearch, localLexicalSearch, localOnboardingSearch } from "../retriever/local-retriever";
import { planQuery } from "../retriever/query-router";

export interface RetrievalEvalCase {
  name: string;
  query: string;
  intent?: QueryIntent;
  retrieved?: RetrievedUnit[];
  expectedFiles: string[];
  topK?: number;
}

export interface RetrievalEvalResult {
  name: string;
  passed: boolean;
  missingFiles: string[];
  rankedFiles: string[];
}

export function evaluateRetrievalCases(
  cases: RetrievalEvalCase[],
  store: CodeUnitStore,
): RetrievalEvalResult[] {
  return cases.map((evalCase) => {
    const queryPlan = planQuery(evalCase.query);
    const intent = evalCase.intent ?? queryPlan.intent;
    const retrieved = evalCase.retrieved ?? retrieveForEval(evalCase.query, store, evalCase.topK ?? 20);
    const { diagnostics } = rerankRetrievedResults(
      evalCase.query,
      intent,
      retrieved,
      store,
      evalCase.topK ?? 10,
    );
    const rankedFiles = diagnostics.map((item) => item.filePath);
    const rankedSet = new Set(rankedFiles);
    const missingFiles = evalCase.expectedFiles.filter((filePath) => !rankedSet.has(filePath));

    return {
      name: evalCase.name,
      passed: missingFiles.length === 0,
      missingFiles,
      rankedFiles,
    };
  });
}

export function retrieveForEval(query: string, store: CodeUnitStore, topK = 20): RetrievedUnit[] {
  const plan = planQuery(query);
  const resultSets: RetrievedUnit[][] = [];

  if (plan.useLocalExact) resultSets.push(localExactSearch(query, store, topK));
  if (plan.useLexical) {
    if (plan.intent === "architecture_overview" || plan.intent === "business_overview") {
      resultSets.push(localOnboardingSearch(query, store, topK));
    }
    resultSets.push(localGrepSearch(query, store, topK));
    resultSets.push(localLexicalSearch(query, store, topK));
  }

  const byId = new Map<string, RetrievedUnit>();
  for (const result of resultSets.flat()) {
    const existing = byId.get(result.unitId);
    if (!existing || result.rrfScore > existing.rrfScore) {
      byId.set(result.unitId, { ...result });
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK);
}
