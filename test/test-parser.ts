import { parseRepository } from "../src/parser";

async function main() {
  const units = await parseRepository("./test/test-repo");
  console.log(`Total units: ${units.length}`);
  for (const unit of units) {
    console.log(`  [${unit.kind}] ${unit.name} in ${unit.filePath} (lines ${unit.startLine}-${unit.endLine})`);
    if (unit.parentName) console.log(`    parent: ${unit.parentName}`);
    if (unit.docstring) console.log(`    docstring: ${unit.docstring.slice(0, 50)}...`);
    if (unit.imports.length) console.log(`    imports: ${unit.imports.length}`);
    if (unit.calledFunctions.length) console.log(`    calls: ${unit.calledFunctions.join(", ")}`);
  }
}
main().catch(console.error);
