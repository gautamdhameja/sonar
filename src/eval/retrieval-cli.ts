import fs from "fs/promises";
import path from "path";
import { parseRepository } from "../parser";
import { CodeUnitStore } from "../retriever/unit-store";
import { evaluateRetrievalCases, RetrievalEvalCase } from "./retrieval-eval";
import { withLogLevel } from "../utils/logger";

interface EvalFixture {
  repoRoot: string;
  cases: RetrievalEvalCase[];
}

async function loadStore(repoRoot: string): Promise<CodeUnitStore> {
  const units = await withLogLevel("silent", () => parseRepository(repoRoot));
  const store = new CodeUnitStore();
  await store.loadFromUnits(units);
  return store;
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2] ?? "test/fixtures/retrieval-eval/birbal.json";
  const raw = await fs.readFile(fixturePath, "utf-8");
  const fixture = JSON.parse(raw) as EvalFixture;
  const repoRoot = path.resolve(path.dirname(fixturePath), fixture.repoRoot);
  const store = await loadStore(repoRoot);
  const results = evaluateRetrievalCases(fixture.cases, store);
  const passed = results.filter((result) => result.passed).length;

  process.stdout.write(
    JSON.stringify(
      {
        fixture: fixturePath,
        repoRoot,
        passed,
        total: results.length,
        results,
      },
      null,
      2,
    ) + "\n",
  );

  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
