import fs from "fs/promises";
import path from "path";
import { walkRepository } from "./file-walker";
import { parseTypeScript } from "./ts-parser";
import { parsePython } from "./py-parser";
import { parseMarkdown } from "./markdown-parser";
import { ensureFileModuleUnits } from "./file-units";
import { CodeUnit } from "./types";
import { logger } from "../utils/logger";

export { CodeUnit, CodeUnitKind } from "./types";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const PY_EXTENSIONS = new Set([".py"]);
const DOC_EXTENSIONS = new Set([".md", ".mdx"]);

export async function parseRepository(repoRoot: string): Promise<CodeUnit[]> {
  const walkedFiles = await walkRepository(repoRoot);
  const allUnits: CodeUnit[] = [];

  let vendoredFileCount = 0;

  for (let i = 0; i < walkedFiles.length; i++) {
    const { relativePath: filePath, isVendored } = walkedFiles[i];
    logger.info(`Parsing file ${i + 1} of ${walkedFiles.length}: ${filePath}${isVendored ? " [vendored]" : ""}`);

    if (isVendored) vendoredFileCount++;

    try {
      const fullPath = path.resolve(repoRoot, filePath);
      const source = await fs.readFile(fullPath, "utf-8");
      const ext = path.extname(filePath);

      let units: CodeUnit[];
      if (TS_EXTENSIONS.has(ext)) {
        units = await parseTypeScript(source, filePath);
      } else if (PY_EXTENSIONS.has(ext)) {
        units = await parsePython(source, filePath);
      } else if (DOC_EXTENSIONS.has(ext)) {
        units = parseMarkdown(source, filePath);
      } else {
        continue;
      }

      // Tag units with vendored status
      if (isVendored) {
        for (const unit of units) {
          unit.isVendored = true;
        }
      }

      allUnits.push(...units);
    } catch (err) {
      logger.warn(`Failed to parse ${filePath}: ${err}`);
    }
  }

  const counts: Record<string, number> = { function: 0, class: 0, method: 0, module: 0 };
  let vendoredUnitCount = 0;
  for (const u of allUnits) {
    counts[u.kind] = (counts[u.kind] ?? 0) + 1;
    if (u.isVendored) vendoredUnitCount++;
  }

  const enrichedUnits = ensureFileModuleUnits(allUnits);
  const addedFileUnits = enrichedUnits.length - allUnits.length;

  logger.info(
    `Parsed ${walkedFiles.length} files (${vendoredFileCount} vendored), extracted ${allUnits.length} code units ` +
      `(${counts.function} functions, ${counts.class} classes, ${counts.method} methods, ${counts.module} modules, ` +
      `${vendoredUnitCount} vendored, ${addedFileUnits} file anchors added)`,
  );

  return enrichedUnits;
}
