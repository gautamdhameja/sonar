import path from "path";
import { v4 as uuidv4 } from "uuid";
import { CodeUnit } from "./types";

export function ensureFileModuleUnits(units: CodeUnit[]): CodeUnit[] {
  const byFile = new Map<string, CodeUnit[]>();
  for (const unit of units) {
    const list = byFile.get(unit.filePath) ?? [];
    list.push(unit);
    byFile.set(unit.filePath, list);
  }

  const additions: CodeUnit[] = [];
  for (const [filePath, fileUnits] of byFile) {
    if (fileUnits.some((unit) => unit.kind === "module" && unit.startLine === 1)) continue;

    const ordered = [...fileUnits].sort((a, b) => a.startLine - b.startLine);
    const first = ordered[0];
    const imports = [...new Set(fileUnits.flatMap((unit) => unit.imports))];
    const exportedNames = [...new Set(fileUnits.flatMap((unit) => unit.exportedNames))];
    const calledFunctions = [...new Set(fileUnits.flatMap((unit) => unit.calledFunctions))];
    const code = ordered.map((unit) => unit.code).join("\n\n");

    additions.push({
      id: uuidv4(),
      filePath,
      language: first.language,
      kind: "module",
      name: path.basename(filePath, path.extname(filePath)),
      code,
      startLine: 1,
      endLine: Math.max(...fileUnits.map((unit) => unit.endLine)),
      parentName: null,
      imports,
      docstring: first.docstring,
      exportedNames,
      calledFunctions,
      isVendored: fileUnits.every((unit) => unit.isVendored),
    });
  }

  return [...units, ...additions];
}
