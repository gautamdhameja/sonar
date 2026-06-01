import { CodeUnit } from "../parser/types";

export function buildSourceEvidenceFallback(contextUnits: CodeUnit[]): string {
  const sources = contextUnits.slice(0, 4);
  if (sources.length === 0) {
    return "Sonar could not generate a reliable answer from the local model, and no source evidence was available.";
  }

  return [
    "Sonar could not generate a reliable natural-language answer from the local model. The most relevant source evidence is:",
    "",
    ...sources.map(
      (unit) =>
        `- \`${unit.name}\` in \`${unit.filePath}\` covers lines ${unit.startLine}-${unit.endLine} [${unit.filePath}:${unit.startLine}-${unit.endLine}].`,
    ),
  ].join("\n");
}
