import { MemoryGraph, MemoryGraphNodeType } from "../survey/memory-graph";

export interface BriefingGraphEvaluation {
  score: number;
  presentNodeTypes: MemoryGraphNodeType[];
  missingNodeTypes: MemoryGraphNodeType[];
  sourceBackedNodeRatio: number;
  hasUncertainty: boolean;
  findings: string[];
}

const REQUIRED_NODE_TYPES: MemoryGraphNodeType[] = ["area", "workflow", "boundary", "state", "risk", "file"];

export function evaluateMemoryGraphCoverage(graph: MemoryGraph): BriefingGraphEvaluation {
  const presentNodeTypes = [...new Set(graph.nodes.map((node) => node.type))].sort() as MemoryGraphNodeType[];
  const missingNodeTypes = REQUIRED_NODE_TYPES.filter((type) => !presentNodeTypes.includes(type));
  const sourceBackedNodes = graph.nodes.filter((node) => node.sources.length > 0).length;
  const sourceBackedNodeRatio = graph.nodes.length === 0 ? 0 : sourceBackedNodes / graph.nodes.length;
  const hasUncertainty =
    graph.nodes.some((node) => node.type === "risk" || (node.openQuestions && node.openQuestions.length > 0)) ||
    graph.warnings.length > 0;
  const findings: string[] = [];

  if (!presentNodeTypes.includes("workflow")) findings.push("No workflow nodes were produced.");
  if (!presentNodeTypes.includes("boundary"))
    findings.push("No input/output or external boundary nodes were produced.");
  if (!presentNodeTypes.includes("state")) findings.push("No state or data nodes were produced.");
  if (sourceBackedNodeRatio < 0.8) findings.push("Too many graph nodes lack source evidence.");
  if (!hasUncertainty) findings.push("No uncertainty or risk was recorded.");

  const coverageScore = (REQUIRED_NODE_TYPES.length - missingNodeTypes.length) / REQUIRED_NODE_TYPES.length;
  const evidenceScore = Math.min(1, sourceBackedNodeRatio);
  const uncertaintyScore = hasUncertainty ? 1 : 0;
  const score = Math.round((coverageScore * 0.55 + evidenceScore * 0.35 + uncertaintyScore * 0.1) * 100);

  return {
    score,
    presentNodeTypes,
    missingNodeTypes,
    sourceBackedNodeRatio,
    hasUncertainty,
    findings,
  };
}
