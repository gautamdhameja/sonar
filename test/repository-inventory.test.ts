import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildRepositoryInventory } from "../src/survey/repository-inventory";

const fixtureRoot = (...parts: string[]) => path.join(process.cwd(), "test", "fixtures", ...parts);

test("buildRepositoryInventory extracts useful signals from a C project without docs", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-c-project"));
  const main = inventory.files.find((file) => file.filePath === "src/main.c");

  assert.ok(main);
  assert.equal(main.supported, false);
  assert.equal(main.language, "C");
  assert.ok(main.entryScore > 0);
  assert.ok(main.signals.some((signal) => signal.kind === "entry_point"));
  assert.ok(main.signals.some((signal) => signal.kind === "cli"));
  assert.ok(main.signals.some((signal) => signal.kind === "file_io"));
  assert.ok(main.signals.some((signal) => signal.kind === "error_handling"));
  assert.ok(inventory.languages.some((language) => language.language === "C" && language.fileCount === 2));
  assert.ok(inventory.candidateFiles.some((file) => file.filePath === "src/main.c"));
});

test("buildRepositoryInventory uses behavior signals when filenames are misleading", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-misleading-names"));
  const banana = inventory.files.find((file) => file.filePath === "src/banana.ts");
  const helper = inventory.files.find((file) => file.filePath === "src/readme-helper.ts");

  assert.ok(banana);
  assert.ok(helper);
  assert.ok(banana.entryScore > helper.entryScore);
  assert.ok(banana.signals.some((signal) => signal.kind === "network"));
  assert.ok(banana.signals.some((signal) => signal.kind === "file_io"));
  assert.ok(banana.signals.some((signal) => signal.kind === "config"));
  assert.ok(inventory.candidateFiles[0].filePath === "src/banana.ts");
});

test("buildRepositoryInventory identifies documentation and module comment context sources", async () => {
  const inventory = await buildRepositoryInventory(fixtureRoot("survey-doc-context"));
  const documentationPaths = inventory.documentationSources.map((file) => file.filePath);

  assert.ok(documentationPaths.includes("README.md"));
  assert.ok(documentationPaths.includes("docs/architecture.md"));
  assert.ok(documentationPaths.includes("src/importer/README.md"));
  assert.ok(documentationPaths.includes("src/importer/loader.ts"));

  const loader = inventory.files.find((file) => file.filePath === "src/importer/loader.ts");
  assert.ok(loader);
  assert.ok(loader.documentationReasons.includes("module-level source comment"));
});
