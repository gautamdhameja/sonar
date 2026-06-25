import assert from "node:assert/strict";
import test from "node:test";
import { composeSectionFromEvidence, extractSectionEvidence } from "../src/generator/section-evidence";
import { DEFAULT_PERSONA } from "../src/persona/types";
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

test("extractSectionEvidence keeps valid citations and drops invalid ones", async () => {
  const evidence = await extractSectionEvidence(
    [unit],
    "Top User Workflows",
    { focus: ["sharing"], persona: DEFAULT_PERSONA },
    async () => ({
      content: JSON.stringify([
        { fact: "Users can share files.", citation: "[src/share.ts:1-8]" },
        { fact: "Users can export files.", citation: "[src/export.ts:1-2]" },
      ]),
      finishReason: "stop",
      truncated: false,
    }),
  );

  assert.deepEqual(evidence, [
    {
      fact: "Users can share files.",
      citation: "[src/share.ts:1-8]",
      unitId: "share-unit",
    },
  ]);
});

test("extractSectionEvidence returns an empty list for malformed JSON", async () => {
  const evidence = await extractSectionEvidence(
    [unit],
    "Top User Workflows",
    { focus: ["sharing"], persona: DEFAULT_PERSONA },
    async () => ({
      content: "not json",
      finishReason: "stop",
      truncated: false,
    }),
  );

  assert.deepEqual(evidence, []);
});

test("composeSectionFromEvidence writes from the supplied evidence", async () => {
  const content = await composeSectionFromEvidence(
    [
      { fact: "Users can share files.", citation: "[src/share.ts:1-8]", unitId: "share-unit" },
      { fact: "Sharing is implemented in the share module.", citation: "[src/share.ts:1-8]", unitId: "share-unit" },
    ],
    "Top User Workflows",
    { persona: DEFAULT_PERSONA, wordLimit: 120 },
    async () => ({
      content:
        "Users can share files [src/share.ts:1-8]. Sharing is implemented in the share module [src/share.ts:1-8].",
      finishReason: "stop",
      truncated: false,
    }),
  );

  assert.match(content, /Users can share files \[src\/share\.ts:1-8\]/);
  assert.match(content, /Sharing is implemented in the share module \[src\/share\.ts:1-8\]/);
});
