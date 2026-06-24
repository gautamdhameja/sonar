import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, toErrorResponse } from "../src/api/errors";
import { LlmGenerationError } from "../src/generator/errors";

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

test("toErrorResponse preserves actionable typed model failures", () => {
  assert.deepEqual(
    toErrorResponse(
      new LlmGenerationError(
        "unreachable",
        "Model endpoint is unreachable. Start the local model server or update the OpenAI-compatible endpoint in settings.",
        "connect ECONNREFUSED 127.0.0.1:8080",
      ),
    ),
    {
      status: 502,
      message:
        "Model endpoint is unreachable. Start the local model server or update the OpenAI-compatible endpoint in settings.",
    },
  );
  assert.deepEqual(
    toErrorResponse(
      new LlmGenerationError(
        "timeout",
        "Model request timed out. Check that the model server is running and responsive, or choose a smaller or faster model.",
        "Request timed out after 180000ms",
      ),
    ),
    {
      status: 502,
      message:
        "Model request timed out. Check that the model server is running and responsive, or choose a smaller or faster model.",
    },
  );
});
