import fs from "fs/promises";
import path from "path";
import { CodeUnit } from "../parser/types";
import { graphSources, MemoryGraph } from "../survey/memory-graph";

export function buildSourceEvidenceFallback(units: CodeUnit[]): string {
  if (units.length === 0) {
    return "The provided context does not include enough source evidence to answer this question.";
  }

  return units
    .slice(0, 4)
    .map((unit) => {
      const summary =
        unit.docstring?.trim() ||
        `${unit.kind} ${unit.name} is available as source evidence for this follow-up question.`;
      return `- ${summary} [${unit.filePath}:${unit.startLine}-${unit.endLine}]`;
    })
    .join("\n");
}

function languageFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const languages = new Map<string, string>([
    [".c", "c"],
    [".h", "c"],
    [".cpp", "cpp"],
    [".cc", "cpp"],
    [".cs", "csharp"],
    [".go", "go"],
    [".java", "java"],
    [".js", "javascript"],
    [".jsx", "javascript"],
    [".json", "json"],
    [".md", "markdown"],
    [".py", "python"],
    [".rs", "rust"],
    [".ts", "typescript"],
    [".tsx", "typescript"],
    [".yaml", "yaml"],
    [".yml", "yaml"],
  ]);
  return languages.get(extension) ?? (extension.replace(/^\./, "") || "text");
}

async function readLineRange(
  repoRoot: string,
  filePath: string,
  startLine: number,
  endLine: number,
): Promise<string | null> {
  if (!isSafeRepoRelativePath(filePath)) return null;
  try {
    const root = await fs.realpath(repoRoot);
    const fullPath = await fs.realpath(path.join(root, filePath));
    const relative = path.relative(root, fullPath);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const text = await fs.readFile(fullPath, "utf-8");
    return text
      .split(/\r?\n/)
      .slice(startLine - 1, endLine)
      .join("\n");
  } catch {
    return null;
  }
}

function isSafeRepoRelativePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.trim().length > 0 &&
    !path.isAbsolute(normalized) &&
    !normalized.split("/").includes("..") &&
    !normalized.split("/").includes("")
  );
}

export async function graphSourceUnits(repoRoot: string, graph: MemoryGraph): Promise<CodeUnit[]> {
  const units: CodeUnit[] = [];
  const inspectedFiles = new Set(graph.inspectedFiles);
  for (const source of graphSources(graph)) {
    if (!inspectedFiles.has(source.filePath)) continue;
    const code = await readLineRange(repoRoot, source.filePath, source.startLine, source.endLine);
    if (code === null) continue;
    units.push({
      id: `graph-source:${source.filePath}:${source.startLine}-${source.endLine}`,
      filePath: source.filePath,
      language: languageFromPath(source.filePath),
      kind: "module",
      name: source.filePath.split("/").at(-1) ?? source.filePath,
      code,
      startLine: source.startLine,
      endLine: source.endLine,
      parentName: null,
      imports: [],
      docstring: null,
      exportedNames: [],
      calledFunctions: [],
      isVendored: false,
    });
  }
  return units;
}
