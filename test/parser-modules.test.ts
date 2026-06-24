import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseRepository, parseRepositoryWithStats } from "../src/parser";
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

test("parseGenericSource extracts Ruby, C++, PHP, Kotlin, and Swift code units", async () => {
  const [rubyUnits, cppUnits, phpUnits, kotlinUnits, swiftUnits] = await Promise.all([
    parseGenericSource(
      [
        "require 'json'",
        "module Billing",
        "  class Invoice",
        "    def total(amount)",
        "      JSON.parse(amount)",
        "    end",
        "  end",
        "end",
      ].join("\n"),
      "app/invoice.rb",
    ),
    parseGenericSource(
      [
        "#include <vector>",
        "namespace app {",
        "class Store { public: void save(); };",
        "void run() { Store store; store.save(); }",
        "}",
      ].join("\n"),
      "src/store.cpp",
    ),
    parseGenericSource(
      [
        "<?php",
        "namespace App;",
        "use RuntimeException;",
        "class Store { public function save($value) { return helper($value); } }",
        "function helper($value) { return $value; }",
      ].join("\n"),
      "src/Store.php",
    ),
    parseGenericSource(
      [
        "package app",
        "import java.io.File",
        'class Store { fun save(path: String) { File(path).writeText("x") } }',
        'fun run() { Store().save("a") }',
      ].join("\n"),
      "src/Store.kt",
    ),
    parseGenericSource(
      [
        "import Foundation",
        "class Store { func save(path: String) { print(path) } }",
        'func run() { Store().save(path: "a") }',
      ].join("\n"),
      "Sources/Store.swift",
    ),
  ]);

  assert.ok(rubyUnits.some((unit) => unit.language === "ruby" && unit.name === "Invoice"));
  assert.ok(rubyUnits.some((unit) => unit.language === "ruby" && unit.name === "total"));
  assert.ok(rubyUnits.some((unit) => unit.imports.some((line) => line.includes("require 'json'"))));
  assert.ok(cppUnits.some((unit) => unit.language === "cpp" && unit.name === "Store"));
  assert.ok(cppUnits.some((unit) => unit.language === "cpp" && unit.name === "run"));
  assert.ok(cppUnits.some((unit) => unit.imports.some((line) => line.includes("#include <vector>"))));
  assert.ok(phpUnits.some((unit) => unit.language === "php" && unit.name === "Store"));
  assert.ok(phpUnits.some((unit) => unit.language === "php" && unit.name === "save"));
  assert.ok(
    phpUnits.some((unit) => unit.language === "php" && unit.imports.some((line) => line.includes("RuntimeException"))),
  );
  assert.ok(kotlinUnits.some((unit) => unit.language === "kotlin" && unit.name === "Store"));
  assert.ok(kotlinUnits.some((unit) => unit.language === "kotlin" && unit.name === "run"));
  assert.ok(kotlinUnits.some((unit) => unit.imports.some((line) => line.includes("java.io.File"))));
  assert.ok(swiftUnits.some((unit) => unit.language === "swift" && unit.name === "Store"));
  assert.ok(swiftUnits.some((unit) => unit.language === "swift" && unit.name === "run"));
  assert.ok(swiftUnits.some((unit) => unit.imports.some((line) => line.includes("Foundation"))));
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
    await writeFile(
      path.join(repoRoot, "billing.rb"),
      ["class Invoice", "  def total", "    1", "  end", "end"].join("\n"),
    );
    await writeFile(path.join(repoRoot, "native.cpp"), "void RunNative() {}");
    await writeFile(path.join(repoRoot, "legacy.php"), "<?php function run_legacy() {}");
    await writeFile(path.join(repoRoot, "Mobile.kt"), "fun runMobile() {}");
    await writeFile(path.join(repoRoot, "App.swift"), "func runApp() {}");

    const units = await parseRepository(repoRoot);
    assert.ok(units.some((unit) => unit.filePath === "main.rs" && unit.language === "rust" && unit.name === "run"));
    assert.ok(
      units.some((unit) => unit.filePath === "server.go" && unit.language === "go" && unit.name === "StartServer"),
    );
    assert.ok(
      units.some((unit) => unit.filePath === "billing.rb" && unit.language === "ruby" && unit.name === "Invoice"),
    );
    assert.ok(
      units.some((unit) => unit.filePath === "native.cpp" && unit.language === "cpp" && unit.name === "RunNative"),
    );
    assert.ok(
      units.some((unit) => unit.filePath === "legacy.php" && unit.language === "php" && unit.name === "run_legacy"),
    );
    assert.ok(
      units.some((unit) => unit.filePath === "Mobile.kt" && unit.language === "kotlin" && unit.name === "runMobile"),
    );
    assert.ok(
      units.some((unit) => unit.filePath === "App.swift" && unit.language === "swift" && unit.name === "runApp"),
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

test("parseRepositoryWithStats reports files skipped by indexing limits", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "sonar-parser-limits-"));
  try {
    await writeFile(path.join(repoRoot, "large.ts"), `export const large = "${"x".repeat(1_000_001)}";`);

    const result = await parseRepositoryWithStats(repoRoot);

    assert.equal(
      result.units.some((unit) => unit.filePath === "large.ts"),
      false,
    );
    assert.ok(result.warnings.some((warning) => warning.includes("per-file indexing limit")));
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
    await writeFile(path.join(repoRoot, "billing.rb"), "def total; end");
    await writeFile(path.join(repoRoot, "screen.kt"), "fun render() {}");
    await writeFile(path.join(repoRoot, "App.swift"), "func run() {}");
    await writeFile(path.join(repoRoot, "job.scala"), "object Job {}");
    await writeFile(path.join(repoRoot, "plugin.lua"), "function run() end");
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
      [".lua", ".scala"],
    );
    assert.equal(unsupported.find((item) => item.extension === ".lua")?.fileCount, 1);
    assert.equal(
      unsupported.some((item) => item.extension === ".ts" || item.extension === ".rs"),
      false,
    );
    assert.equal(
      unsupported.some((item) => [".rb", ".cpp", ".php", ".kt", ".swift"].includes(item.extension)),
      false,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
