import test from "node:test";
import assert from "node:assert/strict";
import { applyOptionalLocalReranker } from "../src/retriever/local-reranker-hook";

test("applyOptionalLocalReranker preserves deterministic ranking when disabled", async () => {
  const result = await applyOptionalLocalReranker(
    [{ unitId: "a", rrfScore: 1, keywordRank: 1, semanticRank: null, isVendored: false }],
    [
      {
        unitId: "a",
        filePath: "src/a.ts",
        name: "a",
        kind: "function",
        originalScore: 1,
        rerankedScore: 1,
        keywordRank: 1,
        semanticRank: null,
        reasons: [],
      },
    ],
  );

  assert.equal(result.enabled, false);
  assert.equal(result.results[0].unitId, "a");
});
