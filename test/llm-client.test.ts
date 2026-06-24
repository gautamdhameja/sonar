import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetPreferredTokenLimitParamForTest,
  __setChatCompletionCreateForTest,
  classifyLlmError,
  generateCompletion,
} from "../src/generator/llm-client";
import { LlmGenerationError } from "../src/generator/errors";

test("classifyLlmError reports timeout errors", () => {
  const error = classifyLlmError(new Error("Request timed out after 180000ms"));

  assert.equal(error.code, "timeout");
});

test("generateCompletion does not retry timeout failures", async () => {
  let attempts = 0;
  const restore = __setChatCompletionCreateForTest(async () => {
    attempts += 1;
    throw new Error("Request timed out after 180000ms");
  });

  try {
    await assert.rejects(
      () => generateCompletion("System", "User", { label: "timeout-test" }),
      (err) => err instanceof LlmGenerationError && err.code === "timeout",
    );
    assert.equal(attempts, 1);
  } finally {
    restore();
    __resetPreferredTokenLimitParamForTest();
  }
});
