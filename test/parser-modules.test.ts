import test from "node:test";
import assert from "node:assert/strict";
import { parseTypeScript } from "../src/parser/ts-parser";
import { parsePython } from "../src/parser/py-parser";

test("parseTypeScript creates a module unit for schema-only files", async () => {
  const units = await parseTypeScript(
    [
      "import { z } from 'zod';",
      "export const LlamaEnvSchema = z.object({ LLAMA_SERVER_URL: z.string().url() });",
      "export type LlamaConfig = z.infer<typeof LlamaEnvSchema>;",
    ].join("\n"),
    "src/llama/schema.ts",
  );

  assert.equal(units.length, 1);
  assert.equal(units[0].kind, "module");
  assert.equal(units[0].filePath, "src/llama/schema.ts");
  assert.match(units[0].code, /LLAMA_SERVER_URL/);
});

test("parsePython creates a module unit for constant-only files", async () => {
  const units = await parsePython(
    [
      "from pydantic import BaseModel",
      "LLAMA_SERVER_URL = 'http://localhost:8080'",
    ].join("\n"),
    "src/llama/schema.py",
  );

  assert.equal(units.length, 1);
  assert.equal(units[0].kind, "module");
  assert.match(units[0].code, /LLAMA_SERVER_URL/);
});
