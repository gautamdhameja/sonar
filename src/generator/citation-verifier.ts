import { CodeUnit } from "../parser/types";
import path from "path";

export interface CitationVerification {
  valid: boolean;
  citations: string[];
  invalidCitations: string[];
  uncitedClaims: string[];
  sourceKeys: string[];
}

const bracketCitationPattern = /\[([^\]\n]{2,240})\](?!\()/g;
const bareCitationPattern =
  /\b((?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.(?:c|cc|cpp|cs|css|go|h|hpp|html|java|js|jsx|json|kt|kts|md|mjs|php|py|rb|rs|scss|sql|swift|toml|ts|tsx|yaml|yml):\d+(?:-\d+)?)\b/g;

function splitClaims(answer: string): string[] {
  return answer
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(
      (line) =>
        line.length > 40 &&
        !/^#{1,6}\s/.test(line) &&
        !/^\|/.test(line) &&
        !/:$/.test(line) &&
        !/^\*\*[^*]+:\*\*:?$/.test(line) &&
        !/^["“].+\?["”]?$/.test(line) &&
        !/\?["”]?$/.test(line) &&
        !/\b(not found|not supported|does not contain|do not contain|does not include|does not show|what is missing|would be needed|would need to (?:show|be provided|include)|is needed|could not determine)\b/i.test(
          line,
        ) &&
        !/^(purpose|main components|how work moves|questions|what this means)\b/i.test(line),
    );
}

function normalizeCitation(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function parseCitation(value: string): { filePath: string; startLine?: number; endLine?: number } | null {
  const match = value.trim().match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return null;
  const startLine = match[2] ? Number.parseInt(match[2], 10) : undefined;
  const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine;
  if (
    (startLine !== undefined && !Number.isFinite(startLine)) ||
    (endLine !== undefined && !Number.isFinite(endLine))
  ) {
    return null;
  }
  return {
    filePath: normalizeCitation(match[1]),
    startLine,
    endLine,
  };
}

function expandCitationGroup(value: string): string[] {
  const parts = value
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [value.trim()];

  const expanded: string[] = [];
  let currentFilePath: string | null = null;
  for (const part of parts) {
    const withFile = part.match(/^(.+?):(\d+(?:-\d+)?)$/);
    if (withFile) {
      currentFilePath = withFile[1];
      expanded.push(part);
      continue;
    }
    if (currentFilePath && /^\d+(?:-\d+)?$/.test(part)) {
      expanded.push(`${currentFilePath}:${part}`);
      continue;
    }
    expanded.push(part);
  }

  return expanded;
}

function hasCitation(value: string): boolean {
  bracketCitationPattern.lastIndex = 0;
  bareCitationPattern.lastIndex = 0;
  return bracketCitationPattern.test(value) || bareCitationPattern.test(value);
}

export function verifyCitations(answer: string, contextUnits: CodeUnit[]): CitationVerification {
  bracketCitationPattern.lastIndex = 0;
  const bracketCitations = Array.from(answer.matchAll(bracketCitationPattern), (match) => match[1].trim()).flatMap(
    expandCitationGroup,
  );
  bareCitationPattern.lastIndex = 0;
  const bareCitations = Array.from(answer.matchAll(bareCitationPattern), (match) => match[1].trim());
  const citations = [...new Set([...bracketCitations, ...bareCitations])];
  const sourceKeys = new Set<string>();
  const basenameCounts = new Map<string, number>();

  for (const unit of contextUnits) {
    const basename = normalizeCitation(path.basename(unit.filePath));
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  for (const unit of contextUnits) {
    const basename = path.basename(unit.filePath);
    sourceKeys.add(normalizeCitation(unit.filePath));
    sourceKeys.add(normalizeCitation(`${unit.filePath}:${unit.name}`));
    sourceKeys.add(normalizeCitation(`${unit.filePath}:${unit.startLine}`));
    sourceKeys.add(normalizeCitation(`${unit.filePath}:${unit.startLine}-${unit.endLine}`));
    sourceKeys.add(normalizeCitation(`${unit.filePath}:${unit.name}:${unit.startLine}-${unit.endLine}`));
    if (basenameCounts.get(normalizeCitation(basename)) === 1) {
      sourceKeys.add(normalizeCitation(basename));
      sourceKeys.add(normalizeCitation(`${basename}:${unit.name}`));
      sourceKeys.add(normalizeCitation(`${basename}:${unit.startLine}`));
      sourceKeys.add(normalizeCitation(`${basename}:${unit.startLine}-${unit.endLine}`));
      sourceKeys.add(normalizeCitation(`${basename}:${unit.name}:${unit.startLine}-${unit.endLine}`));
    }
  }

  const validRanges = contextUnits.flatMap((unit) => {
    const keys = [normalizeCitation(unit.filePath)];
    const basename = path.basename(unit.filePath);
    if (basenameCounts.get(normalizeCitation(basename)) === 1) keys.push(normalizeCitation(basename));
    return keys.map((key) => ({ filePath: key, startLine: unit.startLine, endLine: unit.endLine }));
  });

  const invalidCitations = citations.filter((citation) => {
    const parsed = parseCitation(citation);
    if (!parsed) return true;

    return !validRanges.some((range) => {
      if (parsed.filePath !== range.filePath) return false;
      if (parsed.startLine === undefined) return false;
      const citationEnd = parsed.endLine ?? parsed.startLine;
      return parsed.startLine >= range.startLine && citationEnd <= range.endLine;
    });
  });
  const uncitedClaims = splitClaims(answer).filter((claim) => !hasCitation(claim));

  return {
    valid: invalidCitations.length === 0 && uncitedClaims.length === 0,
    citations,
    invalidCitations,
    uncitedClaims,
    sourceKeys: Array.from(sourceKeys).sort(),
  };
}
