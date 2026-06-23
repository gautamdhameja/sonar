import { CodeUnit } from "../parser/types";
import { redactSensitiveText } from "../security/source-safety";

function safeFenceLanguage(language: string): string {
  return language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "text";
}

function escapeFenceBreakouts(text: string): string {
  return text.replace(/```/g, "``\\`");
}

export function formatCodeUnitForPrompt(unit: CodeUnit): string {
  const code = escapeFenceBreakouts(redactSensitiveText(unit.filePath, unit.code));
  return [
    `### ${unit.filePath}:${unit.startLine}-${unit.endLine} - ${unit.kind} ${unit.name}`,
    `\`\`\`${safeFenceLanguage(unit.language)}`,
    code,
    "```",
  ].join("\n");
}
