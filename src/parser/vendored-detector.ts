import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

/**
 * Detects vendored/third-party dependency directories in a repository.
 *
 * Signals checked (in priority order):
 * 1. .gitmodules — lists submodule paths (Foundry/Solidity projects)
 * 2. Nested .git directories — vendored deps often have their own .git
 * 3. foundry.toml remappings — maps import aliases to lib/ paths
 *
 * Returns a Set of relative directory paths that are vendored.
 */
export function detectVendoredPaths(repoRoot: string): Set<string> {
  const vendored = new Set<string>();

  parseGitmodules(repoRoot, vendored);
  parseFoundryRemappings(repoRoot, vendored);
  scanForNestedGitDirs(repoRoot, vendored, 0);

  if (vendored.size > 0) {
    logger.info(`Detected ${vendored.size} vendored paths: ${[...vendored].join(", ")}`);
  }

  return vendored;
}

/**
 * Parse .gitmodules to find submodule paths.
 * Format:
 *   [submodule "contracts/lib/forge-std"]
 *     path = contracts/lib/forge-std
 *     url = https://github.com/foundry-rs/forge-std
 */
function parseGitmodules(repoRoot: string, vendored: Set<string>): void {
  const gitmodulesPath = path.join(repoRoot, ".gitmodules");
  if (!fs.existsSync(gitmodulesPath)) return;

  try {
    const content = fs.readFileSync(gitmodulesPath, "utf-8");
    const pathRegex = /^\s*path\s*=\s*(.+)$/gm;
    let match;
    while ((match = pathRegex.exec(content)) !== null) {
      const submodulePath = match[1].trim();
      vendored.add(submodulePath);
    }
  } catch {
    // Ignore read errors
  }
}

/**
 * Parse foundry.toml for remappings that point to lib/ directories.
 * Format:
 *   remappings = [
 *     "@openzeppelin/=lib/openzeppelin-contracts/",
 *     "forge-std/=lib/forge-std/src/",
 *   ]
 * Also checks remappings.txt (one remapping per line).
 */
function parseFoundryRemappings(repoRoot: string, vendored: Set<string>): void {
  // Check foundry.toml
  const foundryPath = path.join(repoRoot, "foundry.toml");
  if (fs.existsSync(foundryPath)) {
    try {
      const content = fs.readFileSync(foundryPath, "utf-8");
      // Match remapping values like "lib/openzeppelin-contracts/" or "lib/forge-std/src/"
      const remapRegex = /=\s*(lib\/[^/'"]+)/g;
      let match;
      while ((match = remapRegex.exec(content)) !== null) {
        vendored.add(match[1]);
      }
    } catch {
      // Ignore
    }
  }

  // Also check for foundry.toml in subdirectories (e.g., contracts/foundry.toml)
  for (const subdir of ["contracts", "packages/contracts", "packages/foundry"]) {
    const subFoundryPath = path.join(repoRoot, subdir, "foundry.toml");
    if (fs.existsSync(subFoundryPath)) {
      try {
        const content = fs.readFileSync(subFoundryPath, "utf-8");
        const remapRegex = /=\s*(lib\/[^/'"]+)/g;
        let match;
        while ((match = remapRegex.exec(content)) !== null) {
          // Prefix with the subdirectory
          vendored.add(path.join(subdir, match[1]));
        }
      } catch {
        // Ignore
      }
    }
  }

  // Check remappings.txt
  const remappingsPath = path.join(repoRoot, "remappings.txt");
  if (fs.existsSync(remappingsPath)) {
    try {
      const content = fs.readFileSync(remappingsPath, "utf-8");
      const remapRegex = /=\s*(lib\/[^/\s]+)/gm;
      let match;
      while ((match = remapRegex.exec(content)) !== null) {
        vendored.add(match[1]);
      }
    } catch {
      // Ignore
    }
  }
}

/**
 * Scan for directories that contain a .git directory (indicating a vendored submodule).
 * Only scans 3 levels deep to avoid deep traversal.
 * Skips node_modules and the repo's own .git.
 */
function scanForNestedGitDirs(
  dir: string,
  vendored: Set<string>,
  depth: number,
): void {
  if (depth > 3) return;

  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next"]);

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      // If this subdirectory has its own .git, it's vendored
      if (entry.name !== ".git" && fs.existsSync(path.join(fullPath, ".git"))) {
        const repoRoot = findRepoRoot(dir);
        if (repoRoot) {
          vendored.add(path.relative(repoRoot, fullPath));
        }
        // Don't recurse into vendored dirs
        continue;
      }

      scanForNestedGitDirs(fullPath, vendored, depth + 1);
    }
  } catch {
    // Ignore permission errors
  }
}

/**
 * Walk up to find the repo root (directory containing .git).
 */
function findRepoRoot(dir: string): string | null {
  let current = dir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
