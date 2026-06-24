import fs from "fs";
import path from "path";
import { CONFIG } from "../config";
import { detectVendoredPaths } from "./vendored-detector";
import { EXCLUDED_REPOSITORY_DIRS, SUPPORTED_INDEX_EXTENSIONS } from "./language-support";
import { isSensitiveRepositoryPath } from "../security/source-safety";

export interface WalkedFile {
  relativePath: string;
  isVendored: boolean;
}

export interface WalkRepositoryResult {
  files: WalkedFile[];
  hitMaxFiles: boolean;
  hitMaxDepth: boolean;
}

function isSkippedIndexedFile(fileName: string): boolean {
  return (
    /(^|\.)(lock|snap)\b/i.test(fileName) ||
    /^(package-lock\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb)$/i.test(fileName)
  );
}

export async function walkRepositoryWithStats(repoRoot: string): Promise<WalkRepositoryResult> {
  const vendoredPaths = detectVendoredPaths(repoRoot);
  const results: WalkedFile[] = [];
  let hitMaxFiles = false;
  let hitMaxDepth = false;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > CONFIG.parser.maxDepth) {
      hitMaxDepth = true;
      return;
    }
    if (results.length >= CONFIG.parser.maxFiles) {
      hitMaxFiles = true;
      return;
    }

    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= CONFIG.parser.maxFiles) {
        hitMaxFiles = true;
        return;
      }

      if (entry.isDirectory()) {
        if (!EXCLUDED_REPOSITORY_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const relativePath = path.relative(repoRoot, path.join(dir, entry.name));
        if (
          !isSkippedIndexedFile(entry.name) &&
          !isSensitiveRepositoryPath(relativePath) &&
          SUPPORTED_INDEX_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        ) {
          const isVendored = isUnderVendoredPath(relativePath, vendoredPaths);
          results.push({ relativePath, isVendored });
        }
      }
    }
  }

  await walk(repoRoot, 0);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files: results, hitMaxFiles, hitMaxDepth };
}

export async function walkRepository(repoRoot: string): Promise<WalkedFile[]> {
  return (await walkRepositoryWithStats(repoRoot)).files;
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
