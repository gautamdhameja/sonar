import assert from "node:assert/strict";
import test from "node:test";
import { extractJsonText, generateStructuredJson, StructuredValidation } from "../src/generator/structured-llm";
import { LlmCompletion } from "../src/generator/llm-client";

interface TinyShape {
  name: string;
}

function validateTiny(value: unknown): StructuredValidation<TinyShape> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, value: null, errors: ["value must be an object"] };
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) {
    return { valid: false, value: null, errors: ["name is required"] };
  }
  return { valid: true, value: { name: record.name.trim() }, errors: [] };
}

function completion(content: string, truncated = false): LlmCompletion {
  return { content, finishReason: truncated ? "length" : "stop", truncated };
}

test("extractJsonText extracts fenced JSON with nested braces", () => {
  const text = [
    "Here is the result:",
    "```json",
    '{ "name": "alpha", "nested": { "text": "brace } inside string" } }',
    "```",
  ].join("\n");

  assert.equal(extractJsonText(text), '{ "name": "alpha", "nested": { "text": "brace } inside string" } }');
});

test("generateStructuredJson repairs malformed or invalid model output once", async () => {
  const calls: string[] = [];
  const result = await generateStructuredJson<TinyShape>({
    system: "system",
    user: "user",
    validate: validateTiny,
    complete: async (_system, user) => {
      calls.push(user);
      return calls.length === 1 ? completion('{ "label": "wrong" }') : completion('{ "name": "fixed" }');
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, "fixed");
  assert.equal(result.attempts, 2);
  assert.equal(result.repaired, true);
  assert.match(calls[1], /Repair Required/);
  assert.match(calls[1], /name is required/);
});

test("generateStructuredJson returns controlled failure for non-json output", async () => {
  const result = await generateStructuredJson<TinyShape>({
    system: "system",
    user: "user",
    validate: validateTiny,
    maxRepairAttempts: 0,
    complete: async () => completion("not json at all", true),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.attempts, 1);
  assert.equal(result.truncated, true);
  assert.ok(result.errors.some((error) => error.includes("No complete JSON")));
  assert.ok(result.errors.some((error) => error.includes("truncated")));
});
