import path from "path";
import { v4 as uuidv4 } from "uuid";
import { CodeUnit } from "./types";

function titleFromMarkdown(source: string, filePath: string): string {
  const heading = source.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 120);
  return path.basename(filePath, path.extname(filePath));
}

export function parseMarkdown(source: string, filePath: string): CodeUnit[] {
  if (source.trim().length === 0) return [];

  return [
    {
      id: uuidv4(),
      filePath,
      language: "markdown",
      kind: "module",
      name: titleFromMarkdown(source, filePath),
      code: source,
      startLine: 1,
      endLine: source.split("\n").length,
      parentName: null,
      imports: [],
      docstring: null,
      exportedNames: [],
      calledFunctions: [],
      isVendored: false,
    },
  ];
}
