import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("retrieval eval CLI runs fixture and reports all cases passing", () => {
  const output = execFileSync(
    "npx",
    ["ts-node", "src/eval/retrieval-cli.ts", "test/fixtures/retrieval-eval/eval-repo.json"],
    { cwd: process.cwd(), encoding: "utf-8" },
  );
  const result = JSON.parse(output);

  assert.equal(result.passed, 3);
  assert.equal(result.total, 3);
});

test("retrieval eval CLI default fixture runs", () => {
  const output = execFileSync("npx", ["ts-node", "src/eval/retrieval-cli.ts"], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  const result = JSON.parse(output);

  assert.equal(result.passed, 3);
  assert.equal(result.total, 3);
});
