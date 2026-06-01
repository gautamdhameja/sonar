import fs from "fs/promises";
import path from "path";
import { walkRepository } from "./file-walker";
import { parseTypeScript } from "./ts-parser";
import { parsePython } from "./py-parser";
import { parseMarkdown } from "./markdown-parser";
import { isGenericSourceFile, parseGenericSource } from "./generic-parser";
import { parseTextModule } from "./text-module-parser";
import { ensureFileModuleUnits } from "./file-units";
import { CodeUnit } from "./types";
import { logger } from "../utils/logger";
import { throwIfAborted } from "../utils/abort";
import { CONFIG } from "../config";

export { CodeUnit, CodeUnitKind } from "./types";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const PY_EXTENSIONS = new Set([".py"]);
const DOC_EXTENSIONS = new Set([".md", ".mdx"]);
const TEXT_MODULE_EXTENSIONS = new Set([".json", ".prisma"]);

export async function parseRepository(repoRoot: string, signal?: AbortSignal): Promise<CodeUnit[]> {
  throwIfAborted(signal);
  const walkedFiles = await walkRepository(repoRoot);
  const allUnits: CodeUnit[] = [];
  const sourceByFile = new Map<string, string>();

  let vendoredFileCount = 0;
  let skippedOversizedFiles = 0;
  let totalBytes = 0;

  for (let i = 0; i < walkedFiles.length; i++) {
    throwIfAborted(signal);
    const { relativePath: filePath, isVendored } = walkedFiles[i];
    logger.info(`Parsing file ${i + 1} of ${walkedFiles.length}: ${filePath}${isVendored ? " [vendored]" : ""}`);

    if (isVendored) vendoredFileCount++;

    try {
      const fullPath = path.resolve(repoRoot, filePath);
      const stat = await fs.stat(fullPath);
      if (stat.size > CONFIG.parser.maxFileBytes) {
        skippedOversizedFiles++;
        logger.warn(`Skipping ${filePath}: file exceeds ${CONFIG.parser.maxFileBytes} bytes`);
        continue;
      }
      if (totalBytes + stat.size > CONFIG.parser.maxTotalBytes) {
        skippedOversizedFiles++;
        logger.warn(`Skipping ${filePath}: index byte budget exceeded`);
        continue;
      }
      totalBytes += stat.size;
      const source = await fs.readFile(fullPath, "utf-8");
      sourceByFile.set(filePath, source);
      throwIfAborted(signal);
      const ext = path.extname(filePath);

      let units: CodeUnit[];
      if (TS_EXTENSIONS.has(ext)) {
        units = await parseTypeScript(source, filePath);
      } else if (PY_EXTENSIONS.has(ext)) {
        units = await parsePython(source, filePath);
      } else if (DOC_EXTENSIONS.has(ext)) {
        units = parseMarkdown(source, filePath);
      } else if (TEXT_MODULE_EXTENSIONS.has(ext)) {
        units = parseTextModule(source, filePath);
      } else if (isGenericSourceFile(filePath)) {
        units = await parseGenericSource(source, filePath);
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

  const enrichedUnits = ensureFileModuleUnits(allUnits, sourceByFile);
  const addedFileUnits = enrichedUnits.length - allUnits.length;

  logger.info(
    `Parsed ${walkedFiles.length} files (${vendoredFileCount} vendored), extracted ${allUnits.length} code units ` +
      `(${counts.function} functions, ${counts.class} classes, ${counts.method} methods, ${counts.module} modules, ` +
      `${vendoredUnitCount} vendored, ${addedFileUnits} file anchors added, ${skippedOversizedFiles} skipped)`,
  );

  return enrichedUnits;
}
