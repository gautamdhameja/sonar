import fs from "fs";
import path from "path";
import { CONFIG } from "../config";
import { detectVendoredPaths } from "./vendored-detector";
import { EXCLUDED_REPOSITORY_DIRS, SUPPORTED_INDEX_EXTENSIONS } from "./language-support";

export interface WalkedFile {
  relativePath: string;
  isVendored: boolean;
}

function isSkippedIndexedFile(fileName: string): boolean {
  return (
    /(^|\.)(lock|snap)\b/i.test(fileName) ||
    /^(package-lock\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb)$/i.test(fileName)
  );
}

export async function walkRepository(repoRoot: string): Promise<WalkedFile[]> {
  const vendoredPaths = detectVendoredPaths(repoRoot);
  const results: WalkedFile[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > CONFIG.parser.maxDepth || results.length >= CONFIG.parser.maxFiles) return;

    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= CONFIG.parser.maxFiles) return;

      if (entry.isDirectory()) {
        if (!EXCLUDED_REPOSITORY_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        if (
          !isSkippedIndexedFile(entry.name) &&
          SUPPORTED_INDEX_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        ) {
          const relativePath = path.relative(repoRoot, path.join(dir, entry.name));
          const isVendored = isUnderVendoredPath(relativePath, vendoredPaths);
          results.push({ relativePath, isVendored });
        }
      }
    }
  }

  await walk(repoRoot, 0);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

/**
 * Check if a file path falls under any vendored directory.
 * A file at "contracts/lib/forge-std/src/Test.sol" is vendored
 * if "contracts/lib/forge-std" is in the vendored set.
 */
function isUnderVendoredPath(filePath: string, vendoredPaths: Set<string>): boolean {
  for (const vp of vendoredPaths) {
    if (filePath === vp || filePath.startsWith(vp + "/")) {
      return true;
    }
  }
  return false;
}
