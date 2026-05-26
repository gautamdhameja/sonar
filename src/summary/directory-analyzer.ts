import path from "path";
import { CodeUnit } from "../parser/types";

export interface DirectoryProfile {
  path: string;
  fileCount: number;
  unitCounts: { function: number; class: number; method: number; module: number };
  unitNames: string[];
  importedBy: string[];
  importsFrom: string[];
  sampleDocstrings: string[];
}

export interface CodebaseStructure {
  projectName: string;
  totalFiles: number;
  totalUnits: number;
  entryPoints: string[];
  directories: DirectoryProfile[];
  dependencyGraph: Array<{ from: string; to: string }>;
}

const ENTRY_POINT_NAMES = new Set([
  "index.ts",
  "main.ts",
  "app.ts",
  "server.ts",
  "index.js",
  "main.js",
  "app.js",
  "server.js",
  "main.py",
  "app.py",
]);

export function analyzeCodebaseStructure(
  units: CodeUnit[],
  edges: Array<{ sourceFile: string; targetFile: string }>,
  projectName: string,
): CodebaseStructure {
  // Step 1: Group units by directory
  const dirUnits = new Map<string, CodeUnit[]>();
  const allFiles = new Set<string>();

  for (const unit of units) {
    allFiles.add(unit.filePath);
    const dir = path.dirname(unit.filePath);
    const list = dirUnits.get(dir);
    if (list) {
      list.push(unit);
    } else {
      dirUnits.set(dir, [unit]);
    }
  }

  // Step 3: Build directory-level dependency graph
  const dirEdgeSet = new Set<string>();
  const dirEdges: Array<{ from: string; to: string }> = [];

  for (const edge of edges) {
    const fromDir = path.dirname(edge.sourceFile);
    const toDir = path.dirname(edge.targetFile);
    if (fromDir === toDir) continue; // skip self-loops
    const key = `${fromDir}|${toDir}`;
    if (!dirEdgeSet.has(key)) {
      dirEdgeSet.add(key);
      dirEdges.push({ from: fromDir, to: toDir });
    }
  }

  // Build importedBy and importsFrom maps for directories
  const importedByMap = new Map<string, Set<string>>();
  const importsFromMap = new Map<string, Set<string>>();

  for (const edge of dirEdges) {
    if (!importsFromMap.has(edge.from)) importsFromMap.set(edge.from, new Set());
    importsFromMap.get(edge.from)!.add(edge.to);

    if (!importedByMap.has(edge.to)) importedByMap.set(edge.to, new Set());
    importedByMap.get(edge.to)!.add(edge.from);
  }

  // Step 1 continued: Build DirectoryProfiles
  const directories: DirectoryProfile[] = [];

  for (const [dir, dirUnitList] of dirUnits) {
    const files = new Set<string>();
    const counts = { function: 0, class: 0, method: 0, module: 0 };
    const names: string[] = [];
    const docstrings: string[] = [];

    for (const unit of dirUnitList) {
      files.add(unit.filePath);
      counts[unit.kind] = (counts[unit.kind] ?? 0) + 1;

      if (unit.kind === "function" || unit.kind === "class") {
        names.push(unit.name);
      }

      if (unit.docstring && docstrings.length < 3) {
        docstrings.push(unit.docstring);
      }
    }

    directories.push({
      path: dir,
      fileCount: files.size,
      unitCounts: counts,
      unitNames: names,
      importedBy: Array.from(importedByMap.get(dir) ?? []),
      importsFrom: Array.from(importsFromMap.get(dir) ?? []),
      sampleDocstrings: docstrings,
    });
  }

  // Sort directories by path for consistent output
  directories.sort((a, b) => a.path.localeCompare(b.path));

  // Step 2: Identify entry points
  const filesWithIncoming = new Set<string>();
  const filesWithOutgoing = new Set<string>();

  for (const edge of edges) {
    filesWithIncoming.add(edge.targetFile);
    filesWithOutgoing.add(edge.sourceFile);
  }

  const entryPoints: string[] = [];
  for (const file of allFiles) {
    const basename = path.basename(file);
    if (ENTRY_POINT_NAMES.has(basename)) {
      entryPoints.push(file);
    } else if (!filesWithIncoming.has(file) && filesWithOutgoing.has(file)) {
      entryPoints.push(file);
    }
  }

  entryPoints.sort();

  return {
    projectName,
    totalFiles: allFiles.size,
    totalUnits: units.length,
    entryPoints,
    directories,
    dependencyGraph: dirEdges,
  };
}
