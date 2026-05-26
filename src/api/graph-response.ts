import path from "path";
import { CodeUnit } from "../parser/types";

export interface DependencyEdgeRow {
  sourceFile: string;
  targetFile: string;
  importStatement: string;
  edgeType: string;
}

export function buildFileGraphResponse(units: CodeUnit[], edges: DependencyEdgeRow[]) {
  const fileMap = new Map<string, { unitCount: number; kinds: Set<string> }>();
  for (const unit of units) {
    const entry = fileMap.get(unit.filePath);
    if (entry) {
      entry.unitCount++;
      entry.kinds.add(unit.kind);
    } else {
      fileMap.set(unit.filePath, { unitCount: 1, kinds: new Set([unit.kind]) });
    }
  }

  const nodes = Array.from(fileMap.entries()).map(([filePath, info]) => ({
    filePath,
    unitCount: info.unitCount,
    kinds: Array.from(info.kinds),
  }));

  return {
    nodes,
    edges: edges.map((edge) => ({ from: edge.sourceFile, to: edge.targetFile, type: edge.edgeType })),
  };
}

export function buildDirectoryGraphResponse(units: CodeUnit[], edges: DependencyEdgeRow[]) {
  const dirMap = new Map<string, { files: Set<string>; unitCount: number }>();
  for (const unit of units) {
    const dir = path.dirname(unit.filePath);
    const entry = dirMap.get(dir);
    if (entry) {
      entry.files.add(unit.filePath);
      entry.unitCount++;
    } else {
      dirMap.set(dir, { files: new Set([unit.filePath]), unitCount: 1 });
    }
  }

  const nodes = Array.from(dirMap.entries()).map(([directory, info]) => ({
    directory,
    fileCount: info.files.size,
    unitCount: info.unitCount,
  }));

  const dirEdgeSet = new Set<string>();
  const dirEdges: Array<{ from: string; to: string }> = [];
  for (const edge of edges) {
    const fromDir = path.dirname(edge.sourceFile);
    const toDir = path.dirname(edge.targetFile);
    if (fromDir === toDir) continue;
    const key = `${fromDir}|${toDir}`;
    if (!dirEdgeSet.has(key)) {
      dirEdgeSet.add(key);
      dirEdges.push({ from: fromDir, to: toDir });
    }
  }

  return { nodes, edges: dirEdges };
}
