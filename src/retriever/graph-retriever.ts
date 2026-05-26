import { CodeUnitStore } from "./unit-store";
import { ProjectRepo } from "../db/project-repo";
import { traverseBidirectional, traverseDownstream, traverseUpstream } from "./graph-traverser";
import { RetrievedUnit } from "./hybrid-retriever";
import { CodeUnit } from "../parser/types";
import { QueryIntent } from "./query-intent";

export type GraphTraversalMode = "upstream" | "downstream" | "bidirectional";

export function selectGraphTraversalMode(query: string, intent: QueryIntent): GraphTraversalMode {
  const normalized = query.toLowerCase();

  if (/\b(imported by|used by|who uses|what uses|what depends on|dependents|callers)\b/.test(normalized)) {
    return "downstream";
  }

  if (/\b(depend on|depends on|imports|uses|calls|called by|dependencies)\b/.test(normalized)) {
    return "upstream";
  }

  if (/\b(config|configured|configuration|env|environment|setting|validated|validation|schema)\b/.test(normalized)) {
    return "upstream";
  }

  if (
    intent === "architecture_overview" ||
    intent === "workflow_trace" ||
    intent === "risk_or_gap_analysis"
  ) {
    return "bidirectional";
  }

  return "bidirectional";
}

export function graphEnhancedRetrieval(
  hybridResults: RetrievedUnit[],
  store: CodeUnitStore,
  projectId: string,
  repo: ProjectRepo,
  maxGraphDepth: number = 2,
  query: string = "",
  intent: QueryIntent = "general_code_question",
): CodeUnit[] {
  // Step 1: Look up CodeUnits for hybrid results
  const primaryUnits: CodeUnit[] = [];
  const includedIds = new Set<string>();

  for (const result of hybridResults) {
    const unit = store.getUnit(result.unitId);
    if (unit) {
      primaryUnits.push(unit);
      includedIds.add(unit.id);
    }
  }

  // Step 2: Extract seed file paths
  const seedFiles = [...new Set(primaryUnits.map((u) => u.filePath))];

  // Step 3: Get dependency edges
  const edges = repo.getDependencyEdges(projectId);

  // Step 4: Traverse the graph
  const traversalMode = selectGraphTraversalMode(query, intent);
  const graphNodes = traversalMode === "upstream"
    ? traverseUpstream(seedFiles, edges, maxGraphDepth)
    : traversalMode === "downstream"
      ? traverseDownstream(seedFiles, edges, maxGraphDepth)
      : traverseBidirectional(seedFiles, edges, maxGraphDepth);

  // Step 5 & 6: Collect graph-discovered units with scores
  const graphUnits: Array<{ unit: CodeUnit; bonus: number }> = [];

  for (const node of graphNodes) {
    if (node.depth === 0) continue; // skip seed files, already in primary

    const bonus = node.depth === 1 ? 0.3 : 0.1;
    const fileUnits = store.getUnitsByFile(node.filePath);

    for (const unit of fileUnits) {
      if (!includedIds.has(unit.id)) {
        graphUnits.push({ unit, bonus });
        includedIds.add(unit.id);
      }
    }
  }

  // Step 7: Sort graph units by bonus descending, then append
  graphUnits.sort((a, b) => b.bonus - a.bonus);

  return [...primaryUnits, ...graphUnits.map((g) => g.unit)];
}

export function graphRetrievalDiagnostics(
  query: string,
  intent: QueryIntent,
  seedFiles: string[],
  edges: Array<{ sourceFile: string; targetFile: string; edgeType?: string }>,
): {
  traversalMode: GraphTraversalMode;
  seedFiles: string[];
  edgeTypes: Record<string, number>;
} {
  const edgeTypes: Record<string, number> = {};
  for (const edge of edges) {
    const type = edge.edgeType ?? "imports";
    edgeTypes[type] = (edgeTypes[type] ?? 0) + 1;
  }

  return {
    traversalMode: selectGraphTraversalMode(query, intent),
    seedFiles,
    edgeTypes,
  };
}
