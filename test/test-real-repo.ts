import { parseRepository } from "../src/parser";
import { indexRepository } from "../src/indexer";

async function main() {
  const start = Date.now();
  console.log("Parsing tRPC repository (923 TypeScript files)...\n");

  const units = await parseRepository("/tmp/trpc-test");

  console.log("\n--- Parse Results ---");
  console.log(`Total units: ${units.length}`);

  const kinds: Record<string, number> = {};
  for (const u of units) {
    kinds[u.kind] = (kinds[u.kind] || 0) + 1;
  }
  console.log("By kind:", kinds);

  const withDocstring = units.filter((u) => u.docstring).length;
  const withCalls = units.filter((u) => u.calledFunctions.length > 0).length;
  const emptyCode = units.filter((u) => !u.code || u.code.trim() === "").length;
  console.log(`With docstrings: ${withDocstring}`);
  console.log(`With called functions: ${withCalls}`);
  console.log(`Empty code (should be 0): ${emptyCode}`);

  console.log(`\nParse time: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log("\nIndexing to Meilisearch + Qdrant...\n");

  await indexRepository(units);

  console.log(`\nTotal time: ${((Date.now() - start) / 1000).toFixed(1)}s`);
}
main().catch(console.error);
