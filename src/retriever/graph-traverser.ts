export interface GraphNode {
  filePath: string;
  depth: number;
  direction: "upstream" | "downstream" | "seed";
}

function traverse(
  seedFiles: string[],
  edges: Array<{ sourceFile: string; targetFile: string }>,
  maxDepth: number,
  mode: "upstream" | "downstream",
): GraphNode[] {
  const visited = new Map<string, GraphNode>();

  for (const file of seedFiles) {
    if (!visited.has(file)) {
      visited.set(file, { filePath: file, depth: 0, direction: "seed" });
    }
  }

  let frontier = new Set(seedFiles);

  for (let depth = 1; depth <= maxDepth && frontier.size > 0; depth++) {
    const nextFrontier = new Set<string>();

    for (const edge of edges) {
      if (mode === "upstream") {
        // seed is the source, target is the dependency
        if (frontier.has(edge.sourceFile) && !visited.has(edge.targetFile)) {
          visited.set(edge.targetFile, { filePath: edge.targetFile, depth, direction: "upstream" });
          nextFrontier.add(edge.targetFile);
        }
      } else {
        // seed is the target, source is the dependent
        if (frontier.has(edge.targetFile) && !visited.has(edge.sourceFile)) {
          visited.set(edge.sourceFile, { filePath: edge.sourceFile, depth, direction: "downstream" });
          nextFrontier.add(edge.sourceFile);
        }
      }
    }

    frontier = nextFrontier;
  }

  return Array.from(visited.values()).sort((a, b) => a.depth - b.depth || a.filePath.localeCompare(b.filePath));
}

export function traverseUpstream(
  seedFiles: string[],
  edges: Array<{ sourceFile: string; targetFile: string }>,
  maxDepth: number,
): GraphNode[] {
  return traverse(seedFiles, edges, maxDepth, "upstream");
}

export function traverseDownstream(
  seedFiles: string[],
  edges: Array<{ sourceFile: string; targetFile: string }>,
  maxDepth: number,
): GraphNode[] {
  return traverse(seedFiles, edges, maxDepth, "downstream");
}

export function traverseBidirectional(
  seedFiles: string[],
  edges: Array<{ sourceFile: string; targetFile: string }>,
  maxDepth: number,
): GraphNode[] {
  const upstream = traverse(seedFiles, edges, maxDepth, "upstream");
  const downstream = traverse(seedFiles, edges, maxDepth, "downstream");

  const merged = new Map<string, GraphNode>();

  for (const node of upstream) {
    merged.set(node.filePath, node);
  }

  for (const node of downstream) {
    const existing = merged.get(node.filePath);
    if (!existing || node.depth < existing.depth) {
      merged.set(node.filePath, node);
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.depth - b.depth || a.filePath.localeCompare(b.filePath));
}
