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

test("generateCompletion applies per-call generation and constrained output options", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const restore = __setChatCompletionCreateForTest(async (body) => {
    requestBody = body;
    return {
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
    };
  });

  try {
    const result = await generateCompletion("System", "User", {
      label: "option-test",
      maxResponseTokens: 40,
      temperature: 0.2,
      grammar: 'root ::= "DROP"',
      responseFormat: { type: "json_object" },
    });

    assert.equal(result.content, "ok");
    assert.ok(requestBody);
    const body = requestBody as Record<string, unknown>;
    assert.equal(body.temperature, 0.2);
    assert.equal(body.max_tokens, 40);
    assert.equal(body.grammar, 'root ::= "DROP"');
    assert.deepEqual(body.response_format, { type: "json_object" });
  } finally {
    restore();
    __resetPreferredTokenLimitParamForTest();
  }
});

test("generateCompletion retries without constrained output fields when rejected", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const restore = __setChatCompletionCreateForTest(async (body) => {
    bodies.push(body);
    if (bodies.length === 1) {
      const err = new Error("unsupported parameter: grammar") as Error & { status?: number };
      err.status = 400;
      throw err;
    }
    return {
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
    };
  });

  try {
    const result = await generateCompletion("System", "User", {
      label: "constraint-fallback-test",
      grammar: 'root ::= "DROP"',
      maxResponseTokens: 40,
    });

    assert.equal(result.content, "ok");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].grammar, 'root ::= "DROP"');
    assert.equal(bodies[1].grammar, undefined);
    assert.equal(bodies[1].max_tokens, 40);
  } finally {
    restore();
    __resetPreferredTokenLimitParamForTest();
  }
});

test("generateCompletion preserves constrained output fields when only the token parameter is rejected", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const restore = __setChatCompletionCreateForTest(async (body) => {
    bodies.push(body);
    if (bodies.length === 1) {
      const err = new Error("unsupported parameter: max_tokens") as Error & { status?: number; param?: string };
      err.status = 400;
      err.param = "max_tokens";
      throw err;
    }
    return {
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
    };
  });

  try {
    const result = await generateCompletion("System", "User", {
      label: "token-fallback-with-grammar-test",
      grammar: 'root ::= "DROP"',
      maxResponseTokens: 40,
    });

    assert.equal(result.content, "ok");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].grammar, 'root ::= "DROP"');
    assert.equal(bodies[1].max_completion_tokens, 40);
  } finally {
    restore();
    __resetPreferredTokenLimitParamForTest();
  }
});
