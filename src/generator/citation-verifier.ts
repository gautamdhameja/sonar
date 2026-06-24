import { CodeUnit } from "../parser/types";
import path from "path";

export interface CitationVerification {
  valid: boolean;
  citations: string[];
  invalidCitations: string[];
  uncitedClaims: string[];
  sourceKeys: string[];
  claims: CitationClaimVerification[];
}

export type CitationClaimStatus = "verified" | "repaired" | "unverifiable";

export interface CitationClaimVerification {
  text: string;
  status: CitationClaimStatus;
  citations: string[];
  invalidCitations: string[];
}

export interface CitationVerificationOptions {
  repairedCitations?: readonly string[];
}

export interface CitationRepairNormalization {
  answer: string;
  repairedCitations: string[];
}

const bracketCitationPattern = /\[((?:[^[\]\n]|\[[^[\]\n]+\]){2,240})\](?!\()/g;
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
        !/\b(not found|not supported|does not contain|do not contain|does not include|does not show|what is missing|would be needed|would need to (?:show|be provided|include)|is needed|could not determine|could not generate)\b/i.test(
          line,
        ) &&
        !/^(purpose|main components|how work moves|questions|what this means)\b/i.test(line),
    );
}

function isNavigationGuidance(claim: string): boolean {
  return (
    /^(?:\*\*)?(?:for|to understand|to find|where to look|review|look at)\b/i.test(claim) ||
    /^(?:this file|these files)\s+(?:shows?|contains?|defines?|explains?)\b/i.test(claim)
  );
}

function normalizeCitation(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

export function normalizeClaimText(value: string): string {
  return value
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseLineOnlyCitation(value: string): { startLine: number; endLine: number } | null {
  const match = value.trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const startLine = Number.parseInt(match[1], 10);
  const endLine = match[2] ? Number.parseInt(match[2], 10) : startLine;
  return { startLine, endLine };
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

export function verifyCitations(
  answer: string,
  contextUnits: CodeUnit[],
  options: CitationVerificationOptions = {},
): CitationVerification {
  bracketCitationPattern.lastIndex = 0;
  const bracketCitations = Array.from(answer.matchAll(bracketCitationPattern), (match) => match[1].trim()).flatMap(
    expandCitationGroup,
  );
  bareCitationPattern.lastIndex = 0;
  const bareCitations = Array.from(answer.matchAll(bareCitationPattern), (match) => match[1].trim()).filter(
    (citation) =>
      !bracketCitations.some(
        (bracketCitation) => bracketCitation === citation || bracketCitation.endsWith(`/${citation}`),
      ),
  );
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
    const lineOnly = parseLineOnlyCitation(citation);
    if (lineOnly) {
      const matchingUnits = contextUnits.filter(
        (unit) => lineOnly.startLine >= unit.startLine && lineOnly.endLine <= unit.endLine,
      );
      return matchingUnits.length !== 1;
    }

    const parsed = parseCitation(citation);
    if (!parsed) return true;

    return !validRanges.some((range) => {
      if (parsed.filePath !== range.filePath) return false;
      if (parsed.startLine === undefined) return false;
      const citationEnd = parsed.endLine ?? parsed.startLine;
      return parsed.startLine >= range.startLine && citationEnd <= range.endLine;
    });
  });
  const candidateClaims = splitClaims(answer).filter((claim) => !isNavigationGuidance(claim));
  const uncitedClaims = candidateClaims.filter((claim) => !hasCitation(claim));
  const repairedCitations = new Set((options.repairedCitations ?? []).map(normalizeCitation));
  const claims = candidateClaims.map((claim) => {
    const claimCitations = citations.filter((citation) => claim.includes(citation));
    const claimInvalidCitations = invalidCitations.filter((citation) => claim.includes(citation));
    const claimRepairedCitations = claimCitations.filter((citation) =>
      repairedCitations.has(normalizeCitation(citation)),
    );
    return {
      text: claim,
      status:
        claimInvalidCitations.length > 0 || !hasCitation(claim)
          ? "unverifiable"
          : claimRepairedCitations.length > 0
            ? "repaired"
            : "verified",
      citations: claimCitations,
      invalidCitations: claimInvalidCitations,
    } satisfies CitationClaimVerification;
  });

  return {
    valid: invalidCitations.length === 0 && uncitedClaims.length === 0,
    citations,
    invalidCitations,
    uncitedClaims,
    sourceKeys: Array.from(sourceKeys).sort(),
    claims,
  };
}

export function removeUncitedClaims(answer: string, verification: CitationVerification): string {
  if (verification.uncitedClaims.length === 0) return answer;

  let next = answer;
  for (const claim of verification.uncitedClaims) {
    const lines = next.split("\n");
    const filtered = lines.filter((line) => !line.trim().includes(claim));
    if (filtered.length !== lines.length) {
      next = filtered.join("\n");
      continue;
    }
    next = next.replace(claim, "").replace(/[ \t]+\n/g, "\n");
  }

  return next.replace(/\n{3,}/g, "\n\n").trim();
}

export function removeInvalidCitationClaims(answer: string, verification: CitationVerification): string {
  if (verification.invalidCitations.length === 0) return answer;

  let next = answer;
  for (const citation of verification.invalidCitations) {
    const lines = next.split("\n");
    const filtered = lines.filter((line) => !line.includes(citation));
    if (filtered.length !== lines.length) {
      next = filtered.join("\n");
      continue;
    }
    next = next.replace(new RegExp(`\\[[^\\]]*${escapeRegExp(citation)}[^\\]]*\\]`, "g"), "");
    next = next.replace(new RegExp(escapeRegExp(citation), "g"), "");
  }

  return next.replace(/\n{3,}/g, "\n\n").trim();
}

function citationFilePath(citation: string): string {
  const parsed = parseCitation(citation);
  return parsed?.filePath ?? normalizeCitation(citation);
}

function lineCitations(line: string, verification: CitationVerification): string[] {
  return verification.citations.filter((citation) => line.includes(citation));
}

function isRecipientSharingEvidence(filePath: string): boolean {
  return /(share|sharing|share-?link|recipient|invite|invitation|public|viewer|portal|link)/i.test(filePath);
}

function isWeakCredentialSharingClaim(line: string, verification: CitationVerification): boolean {
  if (!/\b(shar(?:e|es|ed|ing)|recipient|public access|invite|invitation)\b/i.test(line)) return false;

  const citations = lineCitations(line, verification);
  if (citations.length === 0) return false;
  const filePaths = citations.map(citationFilePath);
  if (filePaths.some(isRecipientSharingEvidence)) return false;

  return /\b(access tokens?|api keys?|oauth|sessions?|credentials?|auth tokens?|personal tokens?|access|permissions?|private|public|control)\b/i.test(
    line,
  );
}

function isUserFacingAiEvidence(filePath: string): boolean {
  return /(readme|docs?\/|guide|feature|route|router|page|screen|component|chat|assistant|copilot|agent|workflow)/i.test(
    filePath,
  );
}

function isWeakInternalAiClaim(line: string, verification: CitationVerification): boolean {
  if (!/\b(ai|artificial intelligence|llm|model|assistant|copilot|agent)\b/i.test(line)) return false;

  const citations = lineCitations(line, verification);
  if (citations.length === 0) return false;
  const filePaths = citations.map(citationFilePath);
  if (filePaths.some(isUserFacingAiEvidence)) return false;

  return filePaths.every((filePath) =>
    /(^|\/)(internal|pkg|lib|services?)\/.*\b(ai|llm|model|provider|gemini|openai)\b/i.test(filePath),
  );
}

function isWeakCollaborationOrAutomationClaim(line: string, verification: CitationVerification): boolean {
  const claimsCollaboration = /\b(collaborat(?:e|es|ed|ing|ion)|shared content|team|teams)\b/i.test(line);
  const claimsAutomation = /\b(automat(?:e|es|ed|ing|ion)|workflow automation|webhook|integration)\b/i.test(line);
  if (!claimsCollaboration && !claimsAutomation) return false;

  const citations = lineCitations(line, verification);
  if (citations.length === 0) return false;
  const filePaths = citations.map(citationFilePath);

  const hasCollaborationEvidence = filePaths.some((filePath) =>
    /(share|sharing|collab|team|member|comment|recipient|invite|public|viewer)/i.test(filePath),
  );
  const hasAutomationEvidence = filePaths.some((filePath) =>
    /(webhook|workflow|automation|integration|job|queue|event|trigger)/i.test(filePath),
  );

  return (claimsCollaboration && !hasCollaborationEvidence) || (claimsAutomation && !hasAutomationEvidence);
}

function isAccessControlEvidence(filePath: string): boolean {
  return /(auth|permission|access|acl|policy|middleware|route|router|handler|session|user|account|share|invite)/i.test(
    filePath,
  );
}

function isWeakSecurityAccessClaim(line: string, verification: CitationVerification): boolean {
  if (
    !/\b(access controls?|controls?\s+access|access\s+and\s+permissions?|authentication|unauthorized|protect(?:s|ed|ing)?|sensitive routes?|content access|secure handling of routes|permissions?\s+(?:for|to|over)?\s*(?:users?|content|routes?|accounts?))\b/i.test(
      line,
    )
  ) {
    return false;
  }

  const citations = lineCitations(line, verification);
  if (citations.length === 0) return false;
  const filePaths = citations.map(citationFilePath);
  if (filePaths.some(isAccessControlEvidence)) return false;

  return filePaths.some((filePath) => /(security|config|settings?)/i.test(filePath));
}

function isPrivacyEvidence(filePath: string): boolean {
  return /(privacy|analytics|tracking|telemetry|metrics|data-collection|consent)/i.test(filePath);
}

function isWeakPrivacyClaim(line: string, verification: CitationVerification): boolean {
  if (!/\b(privacy|collects?|collection|transmits?|user data|analytics|tracking|telemetry)\b/i.test(line)) return false;

  const citations = lineCitations(line, verification);
  if (citations.length === 0) return false;
  const filePaths = citations.map(citationFilePath);
  if (filePaths.some(isPrivacyEvidence)) return false;

  return true;
}

export function removeWeaklySupportedSharingClaims(answer: string, verification: CitationVerification): string {
  const lines = answer.split("\n");
  const filtered = lines.filter((line) => !isWeakCredentialSharingClaim(line, verification));
  if (filtered.length === lines.length) return answer;
  return filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeWeaklySupportedUsageClaims(answer: string, verification: CitationVerification): string {
  const lines = answer.split("\n");
  const filtered = lines.filter((line) => !isWeakCollaborationOrAutomationClaim(line, verification));
  if (filtered.length === lines.length) return answer;
  return filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeWeaklySupportedAiClaims(answer: string, verification: CitationVerification): string {
  const lines = answer.split("\n");
  const filtered = lines.filter((line) => !isWeakInternalAiClaim(line, verification));
  if (filtered.length === lines.length) return answer;
  return filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeWeaklySupportedSecurityAccessClaims(answer: string, verification: CitationVerification): string {
  const lines = answer.split("\n");
  const filtered = lines.filter((line) => !isWeakSecurityAccessClaim(line, verification));
  if (filtered.length === lines.length) return answer;
  return filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeWeaklySupportedPrivacyClaims(answer: string, verification: CitationVerification): string {
  const lines = answer.split("\n");
  const filtered = lines.filter((line) => !isWeakPrivacyClaim(line, verification));
  if (filtered.length === lines.length) return answer;
  return filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeInvalidCitations(
  answer: string,
  contextUnits: CodeUnit[],
  verification: CitationVerification,
): string {
  return normalizeInvalidCitationsWithMetadata(answer, contextUnits, verification).answer;
}

export function normalizeInvalidCitationsWithMetadata(
  answer: string,
  contextUnits: CodeUnit[],
  verification: CitationVerification,
): CitationRepairNormalization {
  if (verification.invalidCitations.length === 0) return { answer, repairedCitations: [] };

  let next = answer;
  const repairedCitations = new Set<string>();
  const basenameCounts = new Map<string, number>();
  for (const unit of contextUnits) {
    const basename = normalizeCitation(path.basename(unit.filePath));
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  for (const citation of verification.invalidCitations) {
    const parsed = parseCitation(citation);
    if (!parsed) continue;
    const candidates = contextUnits.filter((unit) => {
      const filePath = normalizeCitation(unit.filePath);
      const basename = normalizeCitation(path.basename(unit.filePath));
      return parsed.filePath === filePath || (basenameCounts.get(basename) === 1 && parsed.filePath === basename);
    });
    if (candidates.length === 0) continue;

    const startLine = parsed.startLine ?? 1;
    const endLine = parsed.endLine ?? startLine;
    const ranked = candidates
      .map((unit) => {
        const overlapStart = Math.max(unit.startLine, startLine);
        const overlapEnd = Math.min(unit.endLine, endLine);
        const overlap = Math.max(0, overlapEnd - overlapStart + 1);
        const containsStart = startLine >= unit.startLine && startLine <= unit.endLine ? 1 : 0;
        return { unit, score: overlap * 10 + containsStart };
      })
      .sort((a, b) => b.score - a.score || a.unit.startLine - b.unit.startLine);
    const replacementUnit = ranked[0]?.unit;
    if (!replacementUnit) continue;
    const replacement = `${replacementUnit.filePath}:${replacementUnit.startLine}-${replacementUnit.endLine}`;
    if (replacement !== citation) {
      repairedCitations.add(replacement);
    }
    next = next.replace(new RegExp(escapeRegExp(citation), "g"), replacement);
  }

  return { answer: next, repairedCitations: Array.from(repairedCitations) };
}
