export type MemoryGraphNodeType = "repository" | "area" | "workflow" | "boundary" | "state" | "risk" | "file";
export type MemoryGraphEdgeType = "supports" | "reads" | "writes" | "calls" | "depends_on" | "unclear_about";
export type MemoryGraphConfidence = "low" | "medium" | "high";

export interface MemoryGraphSourceRef {
  filePath: string;
  startLine: number;
  endLine: number;
  note?: string;
}

export interface MemoryGraphNode {
  id: string;
  type: MemoryGraphNodeType;
  label: string;
  summary: string;
  confidence: MemoryGraphConfidence;
  sources: MemoryGraphSourceRef[];
  observations?: string[];
  openQuestions?: string[];
}

export interface MemoryGraphEdge {
  id: string;
  type: MemoryGraphEdgeType;
  from: string;
  to: string;
  label?: string;
  confidence: MemoryGraphConfidence;
  sources: MemoryGraphSourceRef[];
}

export interface MemoryGraph {
  projectId: string;
  generatedAt: string;
  summary: string;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  inspectedFiles: string[];
  warnings: string[];
}

export function emptyMemoryGraph(projectId: string): MemoryGraph {
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    summary: "No repository memory graph has been generated yet.",
    nodes: [],
    edges: [],
    inspectedFiles: [],
    warnings: [],
  };
}

export function sourceKey(source: MemoryGraphSourceRef): string {
  return `${source.filePath}:${source.startLine}-${source.endLine}`;
}

export function graphSources(graph: MemoryGraph): MemoryGraphSourceRef[] {
  const seen = new Set<string>();
  const output: MemoryGraphSourceRef[] = [];
  for (const source of [
    ...graph.nodes.flatMap((node) => node.sources),
    ...graph.edges.flatMap((edge) => edge.sources),
  ]) {
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(source);
  }
  return output.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine);
}

const NODE_TYPE_PRIORITY: Record<MemoryGraphNodeType, number> = {
  repository: 70,
  area: 60,
  workflow: 55,
  boundary: 50,
  state: 45,
  file: 48,
  risk: 25,
};

const CONFIDENCE_PRIORITY: Record<MemoryGraphConfidence, number> = {
  high: 30,
  medium: 20,
  low: 10,
};

function nodeRank(node: MemoryGraphNode): number {
  const sourceScore = Math.min(5, node.sources.length) * 4;
  const observationScore = Math.min(3, node.observations?.length ?? 0) * 2;
  const questionScore = Math.min(2, node.openQuestions?.length ?? 0);
  return (
    NODE_TYPE_PRIORITY[node.type] +
    CONFIDENCE_PRIORITY[node.confidence] +
    sourceScore +
    observationScore +
    questionScore
  );
}

function compactNode(node: MemoryGraphNode): MemoryGraphNode {
  return {
    ...node,
    summary: node.summary.slice(0, 260),
    sources: node.sources.slice(0, 3),
    observations: node.observations?.slice(0, 3),
    openQuestions: node.openQuestions?.slice(0, 3),
  };
}

export function compactMemoryGraph(graph: MemoryGraph, maxNodes = 14, maxEdges = 12): MemoryGraph {
  const nodes = [...graph.nodes]
    .sort((a, b) => nodeRank(b) - nodeRank(a) || a.id.localeCompare(b.id))
    .slice(0, maxNodes)
    .map(compactNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.sources.length > 0)
    .sort(
      (a, b) =>
        CONFIDENCE_PRIORITY[b.confidence] - CONFIDENCE_PRIORITY[a.confidence] ||
        b.sources.length - a.sources.length ||
        a.id.localeCompare(b.id),
    )
    .slice(0, maxEdges)
    .map((edge) => ({
      ...edge,
      sources: edge.sources.slice(0, 2),
    }));

  const summary =
    graph.summary.trim() ||
    `Repository survey identified ${nodes
      .slice(0, 5)
      .map((node) => node.label)
      .join(", ")}.`;

  return {
    ...graph,
    generatedAt: new Date().toISOString(),
    summary: summary.slice(0, 360),
    nodes,
    edges,
    inspectedFiles: [...new Set(graph.inspectedFiles)].slice(0, 80),
    warnings: [...new Set(graph.warnings)].slice(0, 24),
  };
}

export function formatMemoryGraphForPrompt(graph: MemoryGraph, maxNodes = 30): string {
  const lines: string[] = [
    "## Repository Memory Graph",
    `Graph summary: ${graph.summary}`,
    `Inspected files: ${graph.inspectedFiles.slice(0, 40).join(", ") || "none"}`,
  ];

  if (graph.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of graph.warnings.slice(0, 8)) lines.push(`- ${warning}`);
  }

  lines.push("", "Nodes:");
  for (const node of graph.nodes.slice(0, maxNodes)) {
    const sources = node.sources.map(sourceKey).join(" ");
    const openQuestions = node.openQuestions?.length ? ` Open questions: ${node.openQuestions.join("; ")}` : "";
    lines.push(
      `- ${node.id} | ${node.type}: ${node.label} (${node.confidence}) - ${node.summary} Evidence: ${sources}.${openQuestions}`,
    );
  }

  if (graph.edges.length > 0) {
    lines.push("", "Edges:");
    for (const edge of graph.edges.slice(0, maxNodes)) {
      const sources = edge.sources.map(sourceKey).join(" ");
      lines.push(
        `- ${edge.type}: ${edge.from} -> ${edge.to} (${edge.confidence}) ${edge.label ?? ""} Evidence: ${sources}.`,
      );
    }
  }

  return lines.join("\n");
}
