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

test("parseTypeScript captures export-from and dynamic imports as dependency evidence", async () => {
  const units = await parseTypeScript(
    [
      "export { createClient } from './client';",
      "export async function loadPage() {",
      "  return import('./pages/home');",
      "}",
    ].join("\n"),
    "src/index.ts",
  );

  const loadPage = units.find((unit) => unit.name === "loadPage");
  assert.ok(loadPage);
  assert.ok(loadPage.imports.some((line) => line.includes("from './client'")));
  assert.ok(loadPage.imports.some((line) => line.includes("import('./pages/home')")));
  assert.deepEqual(loadPage.exportedNames, ["loadPage"]);
  assert.match(loadPage.code, /^export async function loadPage/);
});

test("parsePython extracts decorated class methods", async () => {
  const units = await parsePython(
    [
      "class RuntimeConfig:",
      "    @property",
      "    def server_url(self):",
      "        return self.env['LLAMA_SERVER_URL']",
    ].join("\n"),
    "src/config.py",
  );

  const method = units.find((unit) => unit.kind === "method" && unit.name === "server_url");
  assert.ok(method);
  assert.match(method.code, /@property/);
});
