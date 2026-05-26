import test from "node:test";
import assert from "node:assert/strict";
import { MEILI_CODE_SEARCH_SETTINGS } from "../src/indexer/meilisearch-indexer";

test("Meilisearch settings prioritize code identifiers before full code", () => {
  const attrs = MEILI_CODE_SEARCH_SETTINGS.searchableAttributes;

  assert.ok(attrs.indexOf("name") < attrs.indexOf("code"));
  assert.ok(attrs.indexOf("filePath") < attrs.indexOf("code"));
  assert.ok(attrs.indexOf("imports") < attrs.indexOf("code"));
  assert.ok(MEILI_CODE_SEARCH_SETTINGS.typoTolerance.disableOnAttributes.includes("name"));
  assert.ok(MEILI_CODE_SEARCH_SETTINGS.rankingRules.indexOf("exactness") < MEILI_CODE_SEARCH_SETTINGS.rankingRules.indexOf("typo"));
});
