import { CodeUnit } from "../parser/types";
import { RetrievedUnit } from "../retriever/hybrid-retriever";
import { estimateTokens, truncateLargeUnits } from "./token-budget";
import { QueryPlan } from "../retriever/query-router";
import { extractNeedlesForCitationOrPacking, extractPaths, extractTerms } from "../retriever/query-features";
import { isDocumentationFile, isTestFile } from "../retriever/source-classifier";
import {
  exactMetadataMatchBonus,
  hasExactEvidenceMatch,
  kindPriority,
  supportFileBonus,
  testFilePenalty,
  workflowEvidenceBonus,
} from "../retriever/scoring-policy";

export interface PackedContextOptions {
  query: string;
  maxTokens: number;
  maxUnitsPerFile?: number;
  queryPlan?: QueryPlan;
}

function queryTerms(query: string): string[] {
  return extractTerms(query).map((term) => term.value);
}

function queryPaths(query: string): string[] {
  return extractPaths(query).map((item) => item.toLowerCase());
}

function queryNeedles(query: string): string[] {
  return extractNeedlesForCitationOrPacking(query);
}

function queryPlanBonus(unit: CodeUnit, plan?: QueryPlan): number {
  if (!plan) return 0;
  const filePath = unit.filePath.toLowerCase();
  let bonus = 0;

  if (plan.preferredSources.includes("docs") && isDocumentationFile(unit.filePath)) bonus += 36;
  if (plan.preferredSources.includes("tests") && isTestFile(unit.filePath)) bonus += 8;
  if (plan.preferredSources.includes("config") && /\b(config|env|settings?)\b/.test(filePath)) bonus += 8;
  if (plan.preferredSources.includes("schema") && /\bschema\b/.test(filePath)) bonus += 10;

  if (plan.requiredEvidence.includes("entry_points") && /src\/(main|runpipeline)\./.test(filePath)) bonus += 12;
  if (plan.requiredEvidence.includes("central_modules") && /src\/framework\/pipeline\//.test(filePath)) bonus += 8;
  if (
    plan.requiredEvidence.includes("persistence_or_output") &&
    /src\/(db|daily\/digest|pipelines\/.*renderer)/.test(filePath)
  )
    bonus += 8;

  return bonus;
}

export function packContext(units: CodeUnit[], retrieved: RetrievedUnit[], options: PackedContextOptions): CodeUnit[] {
  const retrievedScores = new Map(retrieved.map((result) => [result.unitId, result.rrfScore]));
  const maxRetrievedScore = Math.max(0, ...retrieved.map((result) => result.rrfScore));
  const terms = queryTerms(options.query);
  const paths = queryPaths(options.query);
  const needles = queryNeedles(options.query);
  const maxUnitsPerFile = options.maxUnitsPerFile ?? 3;

  const seen = new Set<string>();
  const uniqueUnits = units.filter((unit) => {
    if (seen.has(unit.id)) return false;
    seen.add(unit.id);
    return true;
  });

  const scored = uniqueUnits
    .map((unit, order) => {
      const retrievalScore = retrievedScores.get(unit.id) ?? 0;
      const retrievalBoost = maxRetrievedScore > 0 ? (retrievalScore / maxRetrievedScore) * 20 : 0;
      const exactEvidence = hasExactEvidenceMatch(unit, paths, needles);
      const score =
        retrievalBoost +
        exactMetadataMatchBonus(unit, terms) +
        (exactEvidence ? 20 : 0) +
        supportFileBonus(unit, options.query) +
        workflowEvidenceBonus(unit, options.query, "packer").score +
        queryPlanBonus(unit, options.queryPlan) +
        testFilePenalty(unit, options.query, 120).score +
        kindPriority(unit.kind) +
        (unit.exportedNames.length > 0 ? 1.5 : 0) +
        (unit.isVendored ? -10 : 0) -
        order * 0.001;

      return { unit, score };
    })
    .sort((a, b) => b.score - a.score);

  const bounded = truncateLargeUnits(
    scored.map((entry) => entry.unit),
    options.maxTokens,
    0.4,
    options.query,
  );
  const byId = new Map(bounded.map((unit) => [unit.id, unit]));
  const scoreById = new Map(scored.map((entry) => [entry.unit.id, entry.score]));
  const fileCounts = new Map<string, number>();
  const packed: CodeUnit[] = [];
  let totalTokens = 0;

  for (const entry of scored) {
    const unit = byId.get(entry.unit.id);
    if (!unit) continue;

    const count = fileCounts.get(unit.filePath) ?? 0;
    const exactEvidence = hasExactEvidenceMatch(unit, paths, needles);
    const fileLimit = exactEvidence ? Math.max(maxUnitsPerFile, 5) : maxUnitsPerFile;
    if (count >= fileLimit) continue;

    const tokens = estimateTokens(unit.code);
    if (totalTokens + tokens > options.maxTokens) continue;

    packed.push(unit);
    fileCounts.set(unit.filePath, count + 1);
    totalTokens += tokens;
  }

  return packed.sort((a, b) => {
    const scoreDelta = (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0);
    if (Math.abs(scoreDelta) >= 5) return scoreDelta;

    const aRank = retrieved.findIndex((result) => result.unitId === a.id);
    const bRank = retrieved.findIndex((result) => result.unitId === b.id);
    if (aRank !== -1 || bRank !== -1) {
      return (aRank === -1 ? Number.MAX_SAFE_INTEGER : aRank) - (bRank === -1 ? Number.MAX_SAFE_INTEGER : bRank);
    }
    return a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine;
  });
}
