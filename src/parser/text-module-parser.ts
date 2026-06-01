import path from "path";
import { v4 as uuidv4 } from "uuid";
import { CodeUnit } from "./types";

function languageForTextModule(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".prisma") return "prisma";
  return "text";
}

export function parseTextModule(source: string, filePath: string): CodeUnit[] {
  const lineCount = Math.max(1, source.split("\n").length);
  return [
    {
      id: uuidv4(),
      filePath,
      language: languageForTextModule(filePath),
      kind: "module",
      name: path.basename(filePath),
      code: source,
      startLine: 1,
      endLine: lineCount,
      parentName: null,
      imports: [],
      docstring: null,
      exportedNames: [],
      calledFunctions: [],
      isVendored: false,
    },
  ];
}
