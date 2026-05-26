import fs from "fs";
import path from "path";
import { detectVendoredPaths } from "./vendored-detector";

const VALID_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".md", ".mdx"]);
const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__", ".next", ".venv", "venv", "coverage",
]);

export interface WalkedFile {
  relativePath: string;
  isVendored: boolean;
}

export async function walkRepository(repoRoot: string): Promise<WalkedFile[]> {
  const vendoredPaths = detectVendoredPaths(repoRoot);
  const results: WalkedFile[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        if (VALID_EXTENSIONS.has(path.extname(entry.name))) {
          const relativePath = path.relative(repoRoot, path.join(dir, entry.name));
          const isVendored = isUnderVendoredPath(relativePath, vendoredPaths);
          results.push({ relativePath, isVendored });
        }
      }
    }
  }

  await walk(repoRoot);
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
