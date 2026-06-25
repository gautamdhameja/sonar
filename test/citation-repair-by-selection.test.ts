import assert from "node:assert/strict";
import test from "node:test";
import { attachCitationsBySelection } from "../src/generator/citation-repair-by-selection";
import { verifyCitations } from "../src/generator/citation-verifier";
import { CodeUnit } from "../src/parser/types";

const unit: CodeUnit = {
  id: "share-unit",
  filePath: "src/share.ts",
  language: "typescript",
  kind: "function",
  name: "shareFile",
  code: "export function shareFile() { return true; }",
  startLine: 1,
  endLine: 8,
  parentName: null,
  imports: [],
  docstring: null,
  exportedNames: ["shareFile"],
  calledFunctions: [],
  isVendored: false,
};

test("attachCitationsBySelection appends a valid selected tag", async () => {
  const brief = "### Top User Workflows\nUsers can share files with collaborators through the sharing workflow.";
  const verification = verifyCitations(brief, [unit]);

  const result = await attachCitationsBySelection(brief, [unit], verification, {}, async () => ({
    content: "[src/share.ts:1-8]",
    finishReason: "stop",
    truncated: false,
  }));

  assert.equal(result.attached, 1);
  assert.equal(result.calls, 1);
  assert.match(
    result.brief,
    /Users can share files with collaborators through the sharing workflow \[src\/share\.ts:1-8\]\./,
  );
});

test("attachCitationsBySelection cites the exact uncited sentence in a multi-sentence line", async () => {
  const brief = [
    "### Top User Workflows",
    "1. Share files: Users can share files with collaborators through the sharing workflow. The share module handles access [src/share.ts:1-8].",
  ].join("\n");
  const verification = verifyCitations(brief, [unit]);

  const result = await attachCitationsBySelection(brief, [unit], verification, {}, async () => ({
    content: "[src/share.ts:1-8]",
    finishReason: "stop",
    truncated: false,
  }));

  assert.equal(result.attached, 1);
  assert.match(
    result.brief,
    /Users can share files with collaborators through the sharing workflow \[src\/share\.ts:1-8\]\. The share module handles access/,
  );
  assert.deepEqual(verifyCitations(result.brief, [unit]).uncitedClaims, []);
});

test("attachCitationsBySelection leaves DROP choices unchanged", async () => {
  const brief = "### Top User Workflows\nUsers can share files with collaborators through the sharing workflow.";
  const verification = verifyCitations(brief, [unit]);

  const result = await attachCitationsBySelection(brief, [unit], verification, {}, async () => ({
    content: "DROP",
    finishReason: "stop",
    truncated: false,
  }));

  assert.equal(result.attached, 0);
  assert.equal(result.dropped, 1);
  assert.equal(result.brief, brief);
});

test("attachCitationsBySelection ignores unknown tags and respects maxCalls", async () => {
  const brief = [
    "### Top User Workflows",
    "Users can share files with collaborators through the sharing workflow.",
    "Users can export files for downstream review through the export workflow.",
  ].join("\n");
  const verification = verifyCitations(brief, [unit]);
  let calls = 0;

  const result = await attachCitationsBySelection(brief, [unit], verification, { maxCalls: 1 }, async () => {
    calls += 1;
    return {
      content: "[src/unknown.ts:1-2]",
      finishReason: "stop",
      truncated: false,
    };
  });

  assert.equal(calls, 1);
  assert.equal(result.calls, 1);
  assert.equal(result.attached, 0);
  assert.equal(result.brief, brief);
});
