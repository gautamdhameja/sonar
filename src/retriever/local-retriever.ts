import { CodeUnitStore } from "./unit-store";
import { RetrievedUnit } from "./hybrid-retriever";
import { CodeUnit } from "../parser/types";
import {
  extractExactNeedles,
  extractIdentifiers,
  extractPaths,
  extractPhrases,
  extractTerms,
  normalizeQueryText,
  splitIdentifier,
} from "./query-features";
import { isDocumentationFile } from "./source-classifier";

const normalize = normalizeQueryText;

function searchableText(unit: CodeUnit): string {
  return [
    unit.filePath,
    unit.kind,
    unit.name,
    unit.docstring ?? "",
    unit.imports.join("\n"),
    unit.exportedNames.join("\n"),
    unit.calledFunctions.join("\n"),
    unit.code,
  ]
    .join("\n")
    .toLowerCase();
}

function rawSearchableText(unit: CodeUnit): string {
  return [
    unit.filePath,
    unit.kind,
    unit.name,
    unit.docstring ?? "",
    unit.imports.join("\n"),
    unit.exportedNames.join("\n"),
    unit.calledFunctions.join("\n"),
    unit.code,
  ].join("\n");
}

export function localExactSearch(query: string, store: CodeUnitStore, topK = 10): RetrievedUnit[] {
  const identifiers = extractIdentifiers(query).map(normalize);
  const paths = extractPaths(query).map(normalize);
  const normalizedQuery = normalize(query);

  const scored = store
    .getAllUnits()
    .map((unit) => {
      const name = normalize(unit.name);
      const filePath = normalize(unit.filePath);
      const exports = unit.exportedNames.map(normalize);
      let score = 0;

      if (paths.some((targetPath) => filePath === targetPath || filePath.endsWith(targetPath))) {
        score += 20;
      } else if (paths.some((targetPath) => filePath.includes(targetPath))) {
        score += 12;
      }

      if (identifiers.includes(name)) {
        score += 18;
      } else if (identifiers.some((identifier) => name.includes(identifier))) {
        score += 8;
      }

      if (exports.some((exportedName) => identifiers.includes(exportedName))) {
        score += 10;
      }

      if (normalizedQuery.includes(filePath)) {
        score += 10;
      }

      return { unit, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath))
    .slice(0, topK);

  return scored.map((entry, index) => ({
    unitId: entry.unit.id,
    rrfScore: entry.score,
    keywordRank: index + 1,
    semanticRank: null,
    isVendored: entry.unit.isVendored,
  }));
}

export function localGrepSearch(query: string, store: CodeUnitStore, topK = 20): RetrievedUnit[] {
  const needles = extractExactNeedles(query);
  const terms = extractTerms(query);
  const paths = extractPaths(query).map(normalize);

  if (needles.length === 0 && terms.length === 0 && paths.length === 0) {
    return [];
  }

  const scored = store
    .getAllUnits()
    .map((unit) => {
      const rawText = rawSearchableText(unit);
      const lowerText = rawText.toLowerCase();
      const code = unit.code;
      const lowerCode = code.toLowerCase();
      const filePath = normalize(unit.filePath);
      const name = normalize(unit.name);
      const nameParts = new Set(splitIdentifier(unit.name));
      const fileParts = new Set(splitIdentifier(unit.filePath));
      let score = 0;

      for (const path of paths) {
        if (filePath === path || filePath.endsWith(path)) score += 30;
        else if (filePath.includes(path)) score += 15;
      }

      for (const needle of needles) {
        const lowerNeedle = normalize(needle);
        const isCodeConstant = /\b[A-Z][A-Z0-9_]{3,}\b/.test(needle);
        if (unit.filePath === needle || filePath.endsWith(lowerNeedle)) score += 28;
        if (unit.name === needle) score += 24;
        else if (name === lowerNeedle) score += 20;
        if (unit.exportedNames.includes(needle)) score += 18;
        if (unit.imports.some((imp) => imp.includes(needle))) score += 14;
        if (code.includes(needle)) score += isCodeConstant ? 26 : 18;
        else if (lowerCode.includes(lowerNeedle)) score += isCodeConstant ? 18 : 10;
        if (rawText.includes(needle)) score += isCodeConstant ? 12 : 6;
        else if (lowerText.includes(lowerNeedle)) score += isCodeConstant ? 8 : 3;
      }

      for (const term of terms) {
        const parts = splitIdentifier(term.value);
        const partMatches = parts.filter((part) => nameParts.has(part) || fileParts.has(part)).length;
        if (partMatches > 0) score += term.codeLike ? partMatches * 6 : partMatches * 2;
        if (name === term.value) score += 10;
        if (filePath.includes(term.value)) score += term.codeLike ? 8 : 3;
      }

      if (/\b(schema|validate|validation|zod|config|env|setting)\b/i.test(query)) {
        if (/\b(schema|config|env|test|spec)\b/i.test(unit.filePath)) score += 8;
        if (/\b(schema|validate|validation|zod|process\.env)\b/i.test(unit.code)) score += 8;
      }

      if (unit.isVendored) score *= 0.2;

      return { unit, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath))
    .slice(0, topK);

  return scored.map((entry, index) => ({
    unitId: entry.unit.id,
    rrfScore: entry.score,
    keywordRank: index + 1,
    semanticRank: null,
    isVendored: entry.unit.isVendored,
  }));
}

export function localLexicalSearch(query: string, store: CodeUnitStore, topK = 10): RetrievedUnit[] {
  const phrases = extractPhrases(query).map(normalize);
  const terms = extractTerms(query);
  const paths = extractPaths(query).map(normalize);

  if (phrases.length === 0 && terms.length === 0 && paths.length === 0) {
    return [];
  }

  const scored = store
    .getAllUnits()
    .map((unit) => {
      const text = searchableText(unit);
      const filePath = normalize(unit.filePath);
      const name = normalize(unit.name);
      let score = 0;

      for (const path of paths) {
        if (filePath === path || filePath.endsWith(path)) score += 18;
        else if (filePath.includes(path)) score += 9;
      }

      for (const phrase of phrases) {
        if (text.includes(phrase)) score += 14;
      }

      const code = normalize(unit.code);

      for (const term of terms) {
        if (name === term.value) score += 10;
        else if (name.includes(term.value)) score += 6;
        if (filePath.includes(term.value)) score += term.codeLike ? 10 : 5;
        if (unit.exportedNames.some((exportedName) => normalize(exportedName).includes(term.value))) {
          score += term.codeLike ? 10 : 4;
        }
        if (unit.imports.some((imp) => normalize(imp).includes(term.value))) score += term.codeLike ? 8 : 4;
        if (unit.calledFunctions.some((fn) => normalize(fn).includes(term.value))) score += term.codeLike ? 8 : 3;
        if (unit.docstring && normalize(unit.docstring).includes(term.value)) score += 3;
        if (code.includes(term.value)) score += term.codeLike ? 14 : 1;
      }

      if (unit.isVendored) score *= 0.2;

      return { unit, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath))
    .slice(0, topK);

  return scored.map((entry, index) => ({
    unitId: entry.unit.id,
    rrfScore: entry.score,
    keywordRank: index + 1,
    semanticRank: null,
    isVendored: entry.unit.isVendored,
  }));
}

export function localOnboardingSearch(query: string, store: CodeUnitStore, topK = 12): RetrievedUnit[] {
  const normalized = normalize(query);
  const scored = store
    .getAllUnits()
    .map((unit) => {
      const filePath = normalize(unit.filePath);
      const name = normalize(unit.name);
      const code = normalize(unit.code);
      let score = 0;

      if (isDocumentationFile(unit.filePath)) score += 30;
      if (/src\/(main|runpipeline)\.(ts|tsx|js|jsx|py)$/.test(filePath)) score += 24;
      if (/src\/framework\/pipeline\/(runner|defaultcomponents)\.(ts|tsx|js|jsx|py)$/.test(filePath)) score += 22;
      if (/src\/daily\/pipeline\.(ts|tsx|js|jsx|py)$/.test(filePath)) score += 20;
      if (/src\/(config|db|llama|agent|tools)\//.test(filePath)) score += 8;
      if (
        /\b(purpose|overview|architecture|workflow|onboarding|customer|business|risk)\b/.test(
          `${filePath} ${name} ${code}`,
        )
      ) {
        score += 6;
      }
      if (normalized.includes("sales") && /\b(customer|value|use case|digest|enterprise)\b/.test(code)) score += 8;
      if (unit.isVendored) score *= 0.2;

      return { unit, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath))
    .slice(0, topK);

  return scored.map((entry, index) => ({
    unitId: entry.unit.id,
    rrfScore: entry.score,
    keywordRank: index + 1,
    semanticRank: null,
    isVendored: entry.unit.isVendored,
  }));
}
