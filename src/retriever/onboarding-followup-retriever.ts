import { CodeUnit } from "../parser/types";
import { expandContext } from "../context/expander";
import { packContext } from "../context/packer";
import { CONFIG } from "../config";
import { ProjectRepo } from "../db/project-repo";
import { CodeUnitStore } from "./unit-store";
import { graphEnhancedRetrieval } from "./graph-retriever";
import { hybridSearch, RetrievedUnit } from "./hybrid-retriever";
import { localExactSearch, localGrepSearch, localLexicalSearch, localOnboardingSearch } from "./local-retriever";
import { rerankRetrievedResults, RetrievalDiagnostic } from "./reranker";
import { planQuery, QueryPlan } from "./query-router";

export type OnboardingFollowupIntent =
  | "glossary"
  | "workflow"
  | "source_location"
  | "risk_questions"
  | "code_explanation"
  | "persona_rewrite"
  | "general_followup";

export interface OnboardingFollowupRetrievalInput {
  query: string;
  projectId: string;
  store: CodeUnitStore;
  sourceFiles: string[];
  repo?: ProjectRepo;
  maxContextRatio?: number;
  useVector?: boolean;
}

export interface OnboardingFollowupRetrievalResult {
  intent: OnboardingFollowupIntent;
  queryPlan: QueryPlan;
  contextUnits: CodeUnit[];
  diagnostics: RetrievalDiagnostic[];
  graphEnhanced: boolean;
  retrievalTime: number;
}

function mergeRetrievedResults(resultSets: RetrievedUnit[], topK: number): RetrievedUnit[] {
  const byId = new Map<string, RetrievedUnit>();

  for (const result of resultSets) {
    const existing = byId.get(result.unitId);
    if (!existing) {
      byId.set(result.unitId, { ...result });
      continue;
    }

    existing.rrfScore = Math.max(existing.rrfScore, result.rrfScore);
    existing.keywordRank = existing.keywordRank === null
      ? result.keywordRank
      : result.keywordRank === null
        ? existing.keywordRank
        : Math.min(existing.keywordRank, result.keywordRank);
    existing.semanticRank = existing.semanticRank === null
      ? result.semanticRank
      : result.semanticRank === null
        ? existing.semanticRank
        : Math.min(existing.semanticRank, result.semanticRank);
    existing.isVendored = existing.isVendored || result.isVendored;
  }

  return Array.from(byId.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK);
}

export function classifyOnboardingFollowup(query: string): OnboardingFollowupIntent {
  const normalized = query.toLowerCase();

  if (/\b(what does|what is|define|meaning|glossary|term)\b/.test(normalized)) {
    return "glossary";
  }
  if (/\b(how does|flow|workflow|journey|process|lifecycle|pipeline|what happens when)\b/.test(normalized)) {
    return "workflow";
  }
  if (/\b(where|which file|implemented|implementation|source|code lives|find)\b/.test(normalized)) {
    return "source_location";
  }
  if (/\b(risk|concern|ask engineering|open question|unknown|tradeoff|privacy|security)\b/.test(normalized)) {
    return "risk_questions";
  }
  if (/\b(explain this file|explain this function|function|class|component|method)\b/.test(normalized) || /[`'"][^`'"]{4,}[`'"]/.test(query)) {
    return "code_explanation";
  }
  if (/\b(rewrite|summarize for|explain to|for a pm|for design|for support|non technical|non-technical)\b/.test(normalized)) {
    return "persona_rewrite";
  }

  return "general_followup";
}

function sourceFileResults(store: CodeUnitStore, sourceFiles: string[], query: string, topK: number): RetrievedUnit[] {
  const seen = new Set<string>();
  const results: RetrievedUnit[] = [];
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 3);

  for (const file of sourceFiles) {
    const units = store
      .getUnitsByFile(file)
      .filter((unit) => !unit.isVendored)
      .map((unit) => {
        const text = `${unit.filePath} ${unit.name} ${unit.code}`.toLowerCase();
        const lineCount = unit.endLine - unit.startLine + 1;
        let score = 0;

        if (unit.kind === "function" || unit.kind === "method") score += 14;
        if (unit.kind === "class") score += lineCount > 250 ? -8 : 6;
        if (unit.kind === "module") score += lineCount > 220 ? -14 : 4;
        if (lineCount <= 80) score += 8;
        else if (lineCount <= 180) score += 3;
        else score -= 10;

        for (const term of terms) {
          if (text.includes(term)) score += 4;
        }
        if (/\b(collab|share|portal|firebase|socket|room|link|encrypt|storage|local)\b/.test(text)) score += 8;
        if (/\b(test|spec|changelog)\b/.test(unit.filePath.toLowerCase())) score -= 30;

        return { unit, score };
      })
      .sort((a, b) => {
        return b.score - a.score ||
          a.unit.startLine - b.unit.startLine ||
          a.unit.filePath.localeCompare(b.unit.filePath);
      })
      .slice(0, 3)
      .map((entry) => entry.unit);

    for (const unit of units) {
      if (seen.has(unit.id)) continue;
      seen.add(unit.id);
      results.push({
        unitId: unit.id,
        rrfScore: Math.max(5, topK - results.length),
        keywordRank: results.length + 1,
        semanticRank: null,
        isVendored: unit.isVendored,
      });
      if (results.length >= topK) return results;
    }
  }

  return results;
}

function boostOnboardingSources(
  retrieved: RetrievedUnit[],
  store: CodeUnitStore,
  sourceFiles: string[],
  intent: OnboardingFollowupIntent,
): RetrievedUnit[] {
  const sourceSet = new Set(sourceFiles);
  const boost = intent === "source_location" || intent === "code_explanation" ? 14 : 24;

  return retrieved.map((result) => {
    const unit = store.getUnit(result.unitId);
    if (!unit || !sourceSet.has(unit.filePath)) return result;
    return {
      ...result,
      rrfScore: result.rrfScore + boost,
    };
  });
}

function filterDistractingFollowupResults(
  query: string,
  retrieved: RetrievedUnit[],
  store: CodeUnitStore,
  sourceFiles: string[],
): RetrievedUnit[] {
  const normalized = query.toLowerCase();
  const sourceSet = new Set(sourceFiles);
  const asksForReleaseHistory = /\b(changelog|release|version|migration|api change)\b/.test(normalized);
  const asksForMermaid = /\bmermaid\b/.test(normalized);

  return retrieved.filter((result) => {
    const unit = store.getUnit(result.unitId);
    if (!unit) return false;
    if (sourceSet.has(unit.filePath)) return true;

    const filePath = unit.filePath.toLowerCase();
    if (!asksForReleaseHistory && /(^|\/)changelog\.mdx?$/.test(filePath)) return false;
    if (!asksForMermaid && filePath.includes("mermaid-to-excalidraw")) return false;
    return true;
  });
}

function buildRetrievalQuery(query: string, intent: OnboardingFollowupIntent): string {
  if (intent === "workflow") return `${query} workflow flow data persistence sharing collaboration entry point`;
  if (intent === "risk_questions") return `${query} risk privacy security storage auth persistence operations`;
  if (intent === "glossary") return `${query} definition purpose product concept user workflow`;
  return query;
}

export async function retrieveOnboardingFollowup(input: OnboardingFollowupRetrievalInput): Promise<OnboardingFollowupRetrievalResult> {
  const start = Date.now();
  const intent = classifyOnboardingFollowup(input.query);
  const retrievalQuery = buildRetrievalQuery(input.query, intent);
  const queryPlan = planQuery(retrievalQuery);
  const topK = CONFIG.retriever.fusedTopK;
  const pinnedSourceResults = sourceFileResults(input.store, input.sourceFiles, retrievalQuery, Math.min(12, topK + 2))
    .map((result, index) => ({ ...result, rrfScore: 1000 - index }));

  const retrievedSets: RetrievedUnit[][] = [
    pinnedSourceResults,
    localExactSearch(retrievalQuery, input.store, topK),
    localGrepSearch(retrievalQuery, input.store, topK * 2),
    localLexicalSearch(retrievalQuery, input.store, topK),
  ];

  if (intent === "glossary" || intent === "persona_rewrite" || queryPlan.intent === "architecture_overview" || queryPlan.intent === "business_overview") {
    retrievedSets.push(localOnboardingSearch(retrievalQuery, input.store, topK));
  }

  if (queryPlan.useVector && input.useVector !== false) {
    retrievedSets.push(await hybridSearch(retrievalQuery, input.projectId));
  }

  let retrieved = mergeRetrievedResults(retrievedSets.flat(), topK * 2);
  retrieved = filterDistractingFollowupResults(retrievalQuery, retrieved, input.store, input.sourceFiles);
  retrieved = boostOnboardingSources(retrieved, input.store, input.sourceFiles, intent);

  const reranked = rerankRetrievedResults(retrievalQuery, queryPlan.intent, retrieved, input.store, topK);
  retrieved = mergeRetrievedResults([...pinnedSourceResults, ...reranked.results], topK);

  let contextUnits: CodeUnit[];
  let graphEnhanced = false;
  const graphRepo = input.repo;
  const shouldUseGraph = graphRepo !== undefined && (intent === "workflow" || queryPlan.useGraph);

  if (shouldUseGraph) {
    contextUnits = [
      ...pinnedSourceResults
        .map((result) => input.store.getUnit(result.unitId))
        .filter((unit): unit is CodeUnit => unit !== undefined),
      ...graphEnhancedRetrieval(retrieved, input.store, input.projectId, graphRepo, 1, retrievalQuery, queryPlan.intent),
    ];
    graphEnhanced = true;
  } else {
    contextUnits = [
      ...pinnedSourceResults
        .map((result) => input.store.getUnit(result.unitId))
        .filter((unit): unit is CodeUnit => unit !== undefined),
      ...expandContext(retrieved.map((result) => result.unitId), input.store),
    ];
  }

  contextUnits = packContext(contextUnits, retrieved, {
    query: retrievalQuery,
    maxTokens: Math.max(500, Math.floor(CONFIG.generator.maxContextTokens * (input.maxContextRatio ?? 0.8))),
    maxUnitsPerFile: 3,
    queryPlan,
  });

  return {
    intent,
    queryPlan,
    contextUnits,
    diagnostics: reranked.diagnostics,
    graphEnhanced,
    retrievalTime: Date.now() - start,
  };
}
