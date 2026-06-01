import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseRepository } from "../src/parser";
import { parseTypeScript } from "../src/parser/ts-parser";
import { parsePython } from "../src/parser/py-parser";
import { parseGenericSource } from "../src/parser/generic-parser";
import { detectUnsupportedSourceLanguages } from "../src/parser/language-support";

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

test("parseGenericSource extracts Rust functions and type units", async () => {
  const units = await parseGenericSource(
    [
      "use std::fs;",
      "pub struct DocumentBuffer { text: String }",
      "impl DocumentBuffer {",
      "    pub fn save(&self, path: &str) { fs::write(path, &self.text).unwrap(); }",
      "}",
      "pub fn handle_keypress(input: char, buffer: &mut DocumentBuffer) {",
      "    if input == 's' { buffer.save(\"notes.txt\"); }",
      "}",
    ].join("\n"),
    "src/editor.rs",
  );

  assert.ok(units.some((unit) => unit.language === "rust" && unit.name === "DocumentBuffer"));
  assert.ok(units.some((unit) => unit.language === "rust" && unit.name === "handle_keypress"));
  assert.ok(units.some((unit) => unit.imports.some((line) => line.includes("use std::fs"))));
});

test("parseGenericSource extracts Go, Java, and C# code units", async () => {
  const [goUnits, javaUnits, csharpUnits] = await Promise.all([
    parseGenericSource(
      [
        'import "os"',
        "type Store struct { Path string }",
        "func (s Store) Save(data []byte) error { return os.WriteFile(s.Path, data, 0644) }",
        "func NewStore(path string) Store { return Store{Path: path} }",
      ].join("\n"),
      "store/store.go",
    ),
    parseGenericSource(
      [
        "import java.nio.file.Files;",
        "class Workspace {",
        '  void render() { System.out.println("ready"); }',
        "}",
      ].join("\n"),
      "src/Workspace.java",
    ),
    parseGenericSource(
      ["using System;", "class Workspace {", '  void Render() { Console.WriteLine("ready"); }', "}"].join("\n"),
      "src/Workspace.cs",
    ),
  ]);

  assert.ok(goUnits.some((unit) => unit.language === "go" && unit.name === "NewStore"));
  assert.ok(goUnits.some((unit) => unit.language === "go" && unit.imports.some((line) => line.includes("os"))));
  assert.ok(javaUnits.some((unit) => unit.language === "java" && unit.name === "Workspace"));
  assert.ok(javaUnits.some((unit) => unit.language === "java" && unit.name === "render"));
  assert.ok(csharpUnits.some((unit) => unit.language === "csharp" && unit.name === "Workspace"));
  assert.ok(csharpUnits.some((unit) => unit.language === "csharp" && unit.name === "Render"));
});

test("parseRepository indexes common non-JS source files", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "sonar-parser-"));
  try {
    await writeFile(
      path.join(repoRoot, "main.rs"),
      ["pub struct AppState { value: String }", 'pub fn run(state: AppState) { println!("{}", state.value); }'].join(
        "\n",
      ),
    );
    await writeFile(
      path.join(repoRoot, "server.go"),
      ["package main", 'import "fmt"', 'func StartServer() { fmt.Println("ready") }'].join("\n"),
    );

    const units = await parseRepository(repoRoot);
    assert.ok(units.some((unit) => unit.filePath === "main.rs" && unit.language === "rust" && unit.name === "run"));
    assert.ok(
      units.some((unit) => unit.filePath === "server.go" && unit.language === "go" && unit.name === "StartServer"),
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("parseRepository indexes manifest and schema text modules for briefing evidence", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "sonar-text-modules-"));
  try {
    await mkdir(path.join(repoRoot, "prisma"));
    await writeFile(path.join(repoRoot, "package.json"), '{"dependencies":{"next":"latest"}}');
    await writeFile(path.join(repoRoot, "package-lock.json"), '{"lockfileVersion":3}');
    await writeFile(path.join(repoRoot, "prisma", "schema.prisma"), "model Link { id String @id }");

    const units = await parseRepository(repoRoot);

    assert.ok(units.some((unit) => unit.filePath === "package.json" && unit.language === "json"));
    assert.ok(units.some((unit) => unit.filePath === "prisma/schema.prisma" && unit.language === "prisma"));
    assert.equal(
      units.some((unit) => unit.filePath === "package-lock.json"),
      false,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("detectUnsupportedSourceLanguages reports unsupported source files without flagging supported files", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "sonar-language-support-"));
  try {
    await writeFile(path.join(repoRoot, "app.ts"), "export function run() { return true; }");
    await writeFile(path.join(repoRoot, "main.rs"), "pub fn run() {}");
    await writeFile(path.join(repoRoot, "README.md"), "# Supported docs");
    await writeFile(path.join(repoRoot, "legacy.php"), "<?php function legacy() {}");
    await writeFile(path.join(repoRoot, "native.cpp"), "int main() { return 0; }");
    await mkdir(path.join(repoRoot, "prisma", "migrations", "20260101000000_init"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "prisma", "migrations", "20260101000000_init", "migration.sql"),
      "CREATE TABLE users (id text primary key);",
    );
    await mkdir(path.join(repoRoot, "node_modules"));
    await writeFile(path.join(repoRoot, "node_modules", "ignored.rb"), "def ignored; end");

    const unsupported = await detectUnsupportedSourceLanguages(repoRoot);

    assert.deepEqual(
      unsupported.map((item) => item.extension),
      [".cpp", ".php"],
    );
    assert.equal(unsupported.find((item) => item.extension === ".php")?.fileCount, 1);
    assert.equal(
      unsupported.some((item) => item.extension === ".ts" || item.extension === ".rs"),
      false,
    );
    assert.equal(
      unsupported.some((item) => item.extension === ".rb"),
      false,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
