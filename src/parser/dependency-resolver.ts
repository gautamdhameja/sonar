import path from "path";
import { CodeUnit } from "./types";

export interface DependencyEdge {
  sourceFile: string;
  targetFile: string;
  importStatement: string;
  edgeType: "imports";
}

function extractImportSpecifiers(importStatement: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /^\s*import\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bexport\s+[^;]*?\bfrom\s+["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of importStatement.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }

  return [...new Set(specifiers)];
}

function candidatePaths(sourceFile: string, importPath: string): string[] {
  const sourceDir = path.posix.dirname(sourceFile);
  const resolved = importPath.startsWith(".")
    ? path.posix.normalize(path.posix.join(sourceDir, importPath))
    : path.posix.normalize(importPath.replace(/^@\//, "src/"));
  const parsed = path.posix.parse(resolved);
  const extless = parsed.ext ? path.posix.join(parsed.dir, parsed.name) : resolved;
  const candidates = [
    resolved,
    extless,
    `${extless}.ts`,
    `${extless}.tsx`,
    `${extless}.js`,
    `${extless}.jsx`,
    `${extless}.py`,
    path.posix.join(extless, "index.ts"),
    path.posix.join(extless, "index.tsx"),
    path.posix.join(extless, "index.js"),
    path.posix.join(extless, "index.jsx"),
    path.posix.join(extless, "__init__.py"),
  ];

  return [...new Set(candidates)];
}

export function extractDependencyEdges(units: CodeUnit[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const fileSet = new Set(units.map((u) => u.filePath));

  const fileImports = new Map<string, Set<string>>();
  for (const unit of units) {
    if (!fileImports.has(unit.filePath)) {
      fileImports.set(unit.filePath, new Set());
    }
    for (const imp of unit.imports) {
      fileImports.get(unit.filePath)!.add(imp);
    }
  }

  for (const [filePath, imports] of fileImports) {
    for (const imp of imports) {
      for (const importPath of extractImportSpecifiers(imp)) {
        if (!importPath.startsWith(".") && !importPath.startsWith("@/") && !importPath.startsWith("src/")) {
          continue;
        }
        for (const candidate of candidatePaths(filePath, importPath)) {
          if (fileSet.has(candidate)) {
            edges.push({ sourceFile: filePath, targetFile: candidate, importStatement: imp, edgeType: "imports" });
            break;
          }
        }
      }
    }
  }

  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.sourceFile}|${edge.targetFile}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
