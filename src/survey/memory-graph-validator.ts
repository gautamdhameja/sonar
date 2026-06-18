import {
  MemoryGraph,
  MemoryGraphConfidence,
  MemoryGraphEdge,
  MemoryGraphEdgeType,
  MemoryGraphNode,
  MemoryGraphNodeType,
  MemoryGraphSourceRef,
} from "./memory-graph";

export interface MemoryGraphValidationResult {
  valid: boolean;
  errors: string[];
  graph: MemoryGraph | null;
}

const NODE_TYPES = new Set<MemoryGraphNodeType>([
  "repository",
  "area",
  "workflow",
  "boundary",
  "state",
  "risk",
  "file",
]);
const EDGE_TYPES = new Set<MemoryGraphEdgeType>([
  "supports",
  "reads",
  "writes",
  "calls",
  "depends_on",
  "unclear_about",
]);
const CONFIDENCE_VALUES = new Set<MemoryGraphConfidence>(["low", "medium", "high"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayField(record: Record<string, unknown>, field: string): string[] | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function parseSource(value: unknown, path: string, errors: string[]): MemoryGraphSourceRef | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  const filePath = stringField(value, "filePath");
  const rawStartLine = value.startLine;
  const rawEndLine = value.endLine;
  const startLine =
    typeof rawStartLine === "number" && Number.isInteger(rawStartLine) && rawStartLine >= 1 ? rawStartLine : null;
  const endLine = typeof rawEndLine === "number" && Number.isInteger(rawEndLine) && rawEndLine >= 1 ? rawEndLine : null;
  if (!filePath) errors.push(`${path}.filePath is required`);
  if (startLine === null) errors.push(`${path}.startLine must be a positive integer`);
  if (endLine === null) errors.push(`${path}.endLine must be a positive integer`);
  if (startLine !== null && endLine !== null && endLine < startLine) {
    errors.push(`${path}.endLine must be >= startLine`);
  }
  if (!filePath || startLine === null || endLine === null || endLine < startLine) {
    return null;
  }

  const note = typeof value.note === "string" && value.note.trim() ? value.note.trim() : undefined;
  return { filePath, startLine, endLine, note };
}

function parseSources(value: unknown, path: string, errors: string[]): MemoryGraphSourceRef[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  return value
    .map((source, index) => parseSource(source, `${path}[${index}]`, errors))
    .filter((source): source is MemoryGraphSourceRef => source !== null);
}

function parseNode(value: unknown, index: number, errors: string[]): MemoryGraphNode | null {
  const path = `nodes[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  const id = stringField(value, "id");
  const label = stringField(value, "label");
  const summary = stringField(value, "summary");
  const type = stringField(value, "type") as MemoryGraphNodeType | null;
  const confidence = stringField(value, "confidence") as MemoryGraphConfidence | null;
  if (!id) errors.push(`${path}.id is required`);
  if (!label) errors.push(`${path}.label is required`);
  if (!summary) errors.push(`${path}.summary is required`);
  if (!type || !NODE_TYPES.has(type)) errors.push(`${path}.type is invalid`);
  if (!confidence || !CONFIDENCE_VALUES.has(confidence)) errors.push(`${path}.confidence is invalid`);
  const sources = parseSources(value.sources, `${path}.sources`, errors);
  if (type !== "risk" && sources.length === 0) errors.push(`${path}.sources must include evidence`);

  if (
    !id ||
    !label ||
    !summary ||
    !type ||
    !NODE_TYPES.has(type) ||
    !confidence ||
    !CONFIDENCE_VALUES.has(confidence)
  ) {
    return null;
  }

  return {
    id,
    type,
    label,
    summary,
    confidence,
    sources,
    observations: stringArrayField(value, "observations"),
    openQuestions: stringArrayField(value, "openQuestions"),
  };
}

function parseEdge(value: unknown, index: number, knownNodeIds: Set<string>, errors: string[]): MemoryGraphEdge | null {
  const path = `edges[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  const id = stringField(value, "id");
  const type = stringField(value, "type") as MemoryGraphEdgeType | null;
  const from = stringField(value, "from");
  const to = stringField(value, "to");
  const confidence = stringField(value, "confidence") as MemoryGraphConfidence | null;
  if (!id) errors.push(`${path}.id is required`);
  if (!type || !EDGE_TYPES.has(type)) errors.push(`${path}.type is invalid`);
  if (!from || !knownNodeIds.has(from)) errors.push(`${path}.from must reference a known node`);
  if (!to || !knownNodeIds.has(to)) errors.push(`${path}.to must reference a known node`);
  if (!confidence || !CONFIDENCE_VALUES.has(confidence)) errors.push(`${path}.confidence is invalid`);
  const sources = parseSources(value.sources, `${path}.sources`, errors);
  if (sources.length === 0) errors.push(`${path}.sources must include evidence`);

  if (
    !id ||
    !type ||
    !EDGE_TYPES.has(type) ||
    !from ||
    !knownNodeIds.has(from) ||
    !to ||
    !knownNodeIds.has(to) ||
    !confidence ||
    !CONFIDENCE_VALUES.has(confidence)
  ) {
    return null;
  }

  return {
    id,
    type,
    from,
    to,
    label: stringField(value, "label") ?? undefined,
    confidence,
    sources,
  };
}

export function validateMemoryGraph(value: unknown): MemoryGraphValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["graph must be an object"], graph: null };

  const projectId = stringField(value, "projectId");
  const generatedAt = stringField(value, "generatedAt");
  const summary = stringField(value, "summary");
  if (!projectId) errors.push("projectId is required");
  if (!generatedAt) errors.push("generatedAt is required");
  if (!summary) errors.push("summary is required");

  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  if (!Array.isArray(value.nodes)) errors.push("nodes must be an array");
  const nodes = rawNodes
    .map((node, index) => parseNode(node, index, errors))
    .filter((node): node is MemoryGraphNode => node !== null);
  const knownNodeIds = new Set(nodes.map((node) => node.id));
  if (knownNodeIds.size !== nodes.length) errors.push("node ids must be unique");

  const rawEdges = Array.isArray(value.edges) ? value.edges : [];
  if (!Array.isArray(value.edges)) errors.push("edges must be an array");
  const edges = rawEdges
    .map((edge, index) => parseEdge(edge, index, knownNodeIds, errors))
    .filter((edge): edge is MemoryGraphEdge => edge !== null);

  const inspectedFiles = stringArrayField(value, "inspectedFiles") ?? [];
  const warnings = stringArrayField(value, "warnings") ?? [];

  if (!projectId || !generatedAt || !summary || errors.length > 0) {
    return { valid: false, errors, graph: null };
  }

  return {
    valid: true,
    errors: [],
    graph: {
      projectId,
      generatedAt,
      summary,
      nodes,
      edges,
      inspectedFiles,
      warnings,
    },
  };
}
