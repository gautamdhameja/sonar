import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, toErrorResponse } from "../src/api/errors";

test("toErrorResponse preserves explicit HTTP errors", () => {
  assert.deepEqual(toErrorResponse(new HttpError(409, "Already indexing")), {
    status: 409,
    message: "Already indexing",
  });
});

test("toErrorResponse exposes model provider failures as bad gateway", () => {
  assert.deepEqual(toErrorResponse(new Error("LLM generation failed: Unsupported parameter: max_tokens")), {
    status: 502,
    message: "Model provider request failed",
  });
  assert.deepEqual(toErrorResponse(new Error("LLM generation failed")), {
    status: 502,
    message: "Model provider request failed",
  });
});
