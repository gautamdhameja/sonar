import { RetrievedUnit, safeHybridSearch } from "../retriever/hybrid-retriever";
import { CodeUnitStore } from "../retriever/unit-store";
import { expandContext } from "../context/expander";
import { graphEnhancedRetrieval } from "../retriever/graph-retriever";
import { buildPrompt } from "./prompt";
import { generateResponse } from "./llm-client";
import { ProjectRepo } from "../db/project-repo";
import { CodeUnit } from "../parser/types";
import { CONFIG } from "../config";
import { DEFAULT_PERSONA, Persona } from "../persona/types";
import { QueryIntent } from "../retriever/query-intent";
import {
  localExactSearch,
  localGrepSearch,
  localLexicalSearch,
  localOnboardingSearch,
} from "../retriever/local-retriever";
import { planQuery, QueryPlan } from "../retriever/query-router";
import { packContext } from "../context/packer";
import { rerankRetrievedResults, RetrievalDiagnostic } from "../retriever/reranker";
import { applyOptionalLocalReranker } from "../retriever/local-reranker-hook";
import { verifyCitations, CitationVerification } from "./citation-verifier";

export interface QueryResult {
  answer: string;
  projectId: string;
  sources: Array<{ filePath: string; name: string; kind: string; lines: string }>;
  retrievalTime: number;
  generationTime: number;
  graphEnhanced: boolean;
  persona: Persona;
  intent: QueryIntent;
  queryPlan: QueryPlan;
  retrievalDiagnostics: RetrievalDiagnostic[];
  localReranker: {
    enabled: boolean;
    reason: string;
  };
  citationVerification: CitationVerification;
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
    existing.keywordRank =
      existing.keywordRank === null
        ? result.keywordRank
        : result.keywordRank === null
          ? existing.keywordRank
          : Math.min(existing.keywordRank, result.keywordRank);
    existing.semanticRank =
      existing.semanticRank === null
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

export async function answerQuery(
  query: string,
  store: CodeUnitStore,
  repoName: string,
  projectId: string,
  codebaseSummary?: string | null,
  repo?: ProjectRepo,
  persona: Persona = DEFAULT_PERSONA,
): Promise<QueryResult> {
  const queryPlan = planQuery(query);
  const retrievalStart = Date.now();

  const retrievedSets: RetrievedUnit[][] = [];

  if (queryPlan.useLocalExact) {
    retrievedSets.push(localExactSearch(query, store, CONFIG.retriever.fusedTopK));
  }

  if (queryPlan.useLexical) {
    if (queryPlan.intent === "architecture_overview" || queryPlan.intent === "business_overview") {
      retrievedSets.push(localOnboardingSearch(query, store, CONFIG.retriever.fusedTopK));
    }
    retrievedSets.push(localGrepSearch(query, store, CONFIG.retriever.fusedTopK * 2));
    retrievedSets.push(localLexicalSearch(query, store, CONFIG.retriever.fusedTopK));
  }

  if (queryPlan.useVector) {
    retrievedSets.push(await safeHybridSearch(query, projectId));
  }

  let retrieved = mergeRetrievedResults(retrievedSets.flat(), CONFIG.retriever.fusedTopK * 2);

  if (retrieved.length === 0) {
    retrieved = await safeHybridSearch(query, projectId);
  }

  const reranked = rerankRetrievedResults(query, queryPlan.intent, retrieved, store, CONFIG.retriever.fusedTopK);
  const localReranked = await applyOptionalLocalReranker(reranked.results, reranked.diagnostics);
  retrieved = localReranked.results;

  const retrievalTime = Date.now() - retrievalStart;

  let contextUnits: CodeUnit[];
  let graphEnhanced = false;

  if (queryPlan.useGraph && repo) {
    // Graph-enhanced retrieval
    contextUnits = graphEnhancedRetrieval(retrieved, store, projectId, repo, 2, query, queryPlan.intent);
    graphEnhanced = true;
  } else {
    // Standard function-level expansion
    const unitIds = retrieved.map((r) => r.unitId);
    contextUnits = expandContext(unitIds, store);
  }

  contextUnits = packContext(contextUnits, retrieved, {
    query,
    maxTokens: Math.max(500, Math.floor(CONFIG.generator.maxContextTokens * queryPlan.maxContextRatio)),
    maxUnitsPerFile: queryPlan.mode === "summary_graph" ? 2 : 3,
    queryPlan,
  });

  const { system, user } = buildPrompt(query, contextUnits, repoName, codebaseSummary, persona);

  const generationStart = Date.now();
  const answer = await generateResponse(system, user);
  const generationTime = Date.now() - generationStart;
  const citationVerification = verifyCitations(answer, contextUnits);

  const sources = contextUnits.map((unit) => ({
    filePath: unit.filePath,
    name: unit.name,
    kind: unit.kind,
    lines: `${unit.startLine}-${unit.endLine}`,
  }));

  return {
    answer,
    projectId,
    sources,
    retrievalTime,
    generationTime,
    graphEnhanced,
    persona,
    intent: queryPlan.intent,
    queryPlan,
    retrievalDiagnostics: localReranked.diagnostics,
    localReranker: {
      enabled: localReranked.enabled,
      reason: localReranked.reason,
    },
    citationVerification,
  };
}
