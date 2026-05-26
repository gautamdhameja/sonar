import path from "path";
import { CodeUnit } from "../parser/types";

function directoryRole(filePath: string): string {
  const dir = path.posix.dirname(filePath);
  if (filePath.toLowerCase().endsWith(".md") || dir === "docs") return "documentation";
  if (dir.includes("test")) return "tests";
  if (dir.includes("config")) return "configuration";
  if (dir.includes("db")) return "persistence";
  if (dir.includes("llama") || dir.includes("llm")) return "local model integration";
  if (dir.includes("pipeline")) return "pipeline orchestration";
  if (dir.includes("daily")) return "daily workflow";
  if (dir.includes("api")) return "HTTP API";
  if (dir.includes("parser")) return "source parsing";
  if (dir.includes("retriever")) return "retrieval";
  return dir === "." ? "repository root" : dir;
}

function siblingNames(unit: CodeUnit, unitsByFile: Map<string, CodeUnit[]>): string[] {
  return (unitsByFile.get(unit.filePath) ?? [])
    .filter((candidate) => candidate.id !== unit.id)
    .slice(0, 12)
    .map((candidate) => candidate.name);
}

export function buildContextualHeader(unit: CodeUnit, unitsByFile?: Map<string, CodeUnit[]>): string {
  const siblings = unitsByFile ? siblingNames(unit, unitsByFile) : [];
  return [
    `File: ${unit.filePath}`,
    `Directory role: ${directoryRole(unit.filePath)}`,
    `Unit: ${unit.kind} ${unit.name}`,
    unit.parentName ? `Parent: ${unit.parentName}` : "",
    unit.exportedNames.length > 0 ? `Exports: ${unit.exportedNames.join(", ")}` : "",
    unit.imports.length > 0 ? `Imports: ${unit.imports.slice(0, 12).join(" | ")}` : "",
    unit.calledFunctions.length > 0 ? `Calls: ${unit.calledFunctions.slice(0, 16).join(", ")}` : "",
    siblings.length > 0 ? `Sibling symbols: ${siblings.join(", ")}` : "",
    unit.isVendored ? "Source class: vendored dependency" : "Source class: project source",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContextualEmbeddingTexts(units: CodeUnit[]): string[] {
  const unitsByFile = new Map<string, CodeUnit[]>();
  for (const unit of units) {
    const list = unitsByFile.get(unit.filePath) ?? [];
    list.push(unit);
    unitsByFile.set(unit.filePath, list);
  }

  return units.map((unit) =>
    [
      buildContextualHeader(unit, unitsByFile),
      unit.docstring ? `Docstring:\n${unit.docstring}` : "",
      "Code:",
      unit.code,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

export function enrichUnitsForKeywordIndex(units: CodeUnit[]): Array<CodeUnit & { contextualText: string }> {
  const contextualTexts = buildContextualEmbeddingTexts(units);
  return units.map((unit, index) => ({
    ...unit,
    contextualText: contextualTexts[index],
  }));
}
