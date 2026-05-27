import { CodeUnit } from "../parser/types";

export function isTestFile(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/|(\.|-)(test|spec)\.[tj]sx?$|(^|\/)test_[^/]+\.py$|(^|\/)[^/]+_test\.py$/.test(
    filePath,
  );
}

export function isDocumentationFile(filePath: string): boolean {
  return /^(readme|docs\/|.*\.mdx?$)/i.test(filePath);
}

export function isVendored(unit: CodeUnit): boolean {
  return unit.isVendored;
}

export function queryNeedsTestEvidence(query: string): boolean {
  return /\b(test|tests|spec|coverage|validated|validation|schema|config|configured|env)\b/i.test(query);
}
