import assert from "node:assert/strict";
import test from "node:test";
import {
  contextBudgetFromWindow,
  extractContextWindowTokens,
  propsEndpointCandidates,
  responseBudgetFromWindow,
} from "../src/generator/model-context";

test("propsEndpointCandidates checks llama.cpp root props before v1-relative props", () => {
  assert.deepEqual(propsEndpointCandidates("http://127.0.0.1:8080/v1"), [
    "http://127.0.0.1:8080/props",
    "http://127.0.0.1:8080/v1/props",
  ]);
});

test("propsEndpointCandidates supports prefixed OpenAI-compatible paths", () => {
  assert.deepEqual(propsEndpointCandidates("http://127.0.0.1:8080/api/v1"), [
    "http://127.0.0.1:8080/api/props",
    "http://127.0.0.1:8080/api/v1/props",
  ]);
});

test("extractContextWindowTokens reads top-level and nested context values", () => {
  assert.equal(extractContextWindowTokens({ n_ctx: 8192 }), 8192);
  assert.equal(extractContextWindowTokens({ default_generation_settings: { n_ctx: "262144" } }), 262144);
  assert.equal(extractContextWindowTokens({ data: { max_context_length: 32768 } }), 32768);
  assert.equal(extractContextWindowTokens({ n_ctx: 0 }), null);
});

test("responseBudgetFromWindow scales with the window and is clamped", () => {
  assert.equal(responseBudgetFromWindow(262_144), 4_000); // very large window -> ceiling
  assert.equal(responseBudgetFromWindow(8_192), 1_800); // small window -> floor
  const mid = responseBudgetFromWindow(48_000);
  assert.ok(mid > 1_800 && mid <= 4_000); // mid window scales between bounds
});

test("contextBudgetFromWindow scales the source budget and caps it", () => {
  assert.equal(contextBudgetFromWindow(262_144, 4_000), 24_000); // capped for local latency
  assert.equal(contextBudgetFromWindow(8_192, 1_800), 2_867); // compact 8K context
  assert.equal(contextBudgetFromWindow(4_096, 1_800), 1_096); // preserves output reserve
});
