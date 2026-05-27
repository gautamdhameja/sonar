import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const testDir = join(process.cwd(), "test");
const files = readdirSync(testDir)
  .filter((file) => file.endsWith(".integration.ts"))
  .map((file) => join("test", file));

if (files.length === 0) {
  console.error("No integration tests found. Add test/*.integration.ts or skip this script explicitly.");
  process.exit(1);
}

const result = spawnSync("node", ["--test", "-r", "ts-node/register", ...files], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
