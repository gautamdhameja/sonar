export interface QueryTerm {
  value: string;
  codeLike: boolean;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "what", "where", "when",
  "does", "how", "why", "are", "you", "about", "into", "through", "explain",
]);

export function normalizeQueryText(value: string): string {
  return value.toLowerCase();
}

export function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 1);
}

export function extractIdentifiers(query: string): string[] {
  const quoted = Array.from(query.matchAll(/[`'"]([^`'"]+)[`'"]/g), (match) => match[1]);
  const bare = query.match(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\b/g) ?? [];
  return [...new Set([...quoted, ...bare].filter((token) => token.length > 2))];
}

export function extractPaths(query: string): string[] {
  return Array.from(query.matchAll(/\b[\w./-]+\.(?:ts|tsx|js|jsx|py|md|mdx)\b/g), (match) => match[0]);
}

export function extractPhrases(query: string): string[] {
  return Array.from(query.matchAll(/[`'"]([^`'"]{3,})[`'"]/g), (match) => match[1].trim())
    .filter(Boolean);
}

export function extractExactNeedles(query: string): string[] {
  const quoted = extractPhrases(query);
  const paths = extractPaths(query);
  const constants = query.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) ?? [];
  const dotted = query.match(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g) ?? [];
  const codeIdentifiers = query.match(/\b[A-Za-z_$][\w$-]{3,}\b/g) ?? [];

  return [...new Set([...quoted, ...paths, ...constants, ...dotted, ...codeIdentifiers])]
    .filter((needle) => needle.length >= 3);
}

export function extractTerms(query: string): QueryTerm[] {
  const rawTerms = query.match(/[A-Za-z_$][\w$.-]{2,}/g) ?? [];
  const byValue = new Map<string, QueryTerm>();

  for (const rawTerm of rawTerms) {
    const value = rawTerm.toLowerCase();
    if (STOP_WORDS.has(value)) continue;
    byValue.set(value, {
      value,
      codeLike: /[_.$-]/.test(rawTerm) || /[A-Z0-9_]{4,}/.test(rawTerm),
    });
  }

  return Array.from(byValue.values()).slice(0, 20);
}

export function extractNeedlesForCitationOrPacking(query: string): string[] {
  const quoted = extractPhrases(query);
  const constants = query.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) ?? [];
  return [...new Set([...quoted, ...constants].map((item) => item.toLowerCase()))];
}
