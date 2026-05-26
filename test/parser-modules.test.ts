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
    ["from pydantic import BaseModel", "LLAMA_SERVER_URL = 'http://localhost:8080'"].join("\n"),
    "src/llama/schema.py",
  );

  assert.equal(units.length, 1);
  assert.equal(units[0].kind, "module");
  assert.match(units[0].code, /LLAMA_SERVER_URL/);
});

test("parsers are safe to use concurrently across languages", async () => {
  for (let i = 0; i < 10; i++) {
    const [tsUnits, pyUnits] = await Promise.all([
      parseTypeScript("export function connect() { return client.open(); }", `src/client-${i}.ts`),
      parsePython("def run():\n    return client.open()", `src/client_${i}.py`),
    ]);

    assert.equal(
      tsUnits.some((unit) => unit.name === "connect"),
      true,
    );
    assert.equal(
      pyUnits.some((unit) => unit.name === "run"),
      true,
    );
  }
});

test("parsers include terminal member call names for expansion", async () => {
  const tsUnits = await parseTypeScript("export function run() { return client.connect(); }", "src/client.ts");
  const pyUnits = await parsePython("def run():\n    return client.connect()", "src/client.py");

  assert.ok(tsUnits.find((unit) => unit.name === "run")?.calledFunctions.includes("connect"));
  assert.ok(pyUnits.find((unit) => unit.name === "run")?.calledFunctions.includes("connect"));
});
