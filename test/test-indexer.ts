import { parseRepository } from "../src/parser";
import { indexRepository } from "../src/indexer";

async function main() {
  const units = await parseRepository("./test/test-repo");
  await indexRepository(units);
  console.log("Indexing complete. Verify with:");
  console.log("  curl http://localhost:7700/indexes/code-units/stats");
  console.log("  curl http://localhost:6333/collections/code-embeddings");
  console.log("  cat code-units.json | head -50");
}
main().catch(console.error);
