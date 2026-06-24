import fs from "fs/promises";
import path from "path";
import { CONFIG } from "../config";

export const SUPPORTED_CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".cs",
  ".rb",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".h",
  ".php",
  ".kt",
  ".kts",
  ".swift",
]);
export const SUPPORTED_DOC_EXTENSIONS = new Set([".md", ".mdx"]);
export const SUPPORTED_TEXT_EXTENSIONS = new Set([".json", ".prisma"]);
export const SUPPORTED_INDEX_EXTENSIONS = new Set([
  ...SUPPORTED_CODE_EXTENSIONS,
  ...SUPPORTED_DOC_EXTENSIONS,
  ...SUPPORTED_TEXT_EXTENSIONS,
]);

export const EXCLUDED_REPOSITORY_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  ".venv",
  "venv",
  "coverage",
]);

const SOURCE_EXTENSION_LABELS = new Map<string, string>([
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".py", "Python"],
  [".rs", "Rust"],
  [".go", "Go"],
  [".java", "Java"],
  [".cs", "C#"],
  [".php", "PHP"],
  [".rb", "Ruby"],
  [".swift", "Swift"],
  [".kt", "Kotlin"],
  [".kts", "Kotlin"],
  [".c", "C"],
  [".h", "C/C++"],
  [".cpp", "C++"],
  [".cc", "C++"],
  [".cxx", "C++"],
  [".hpp", "C++"],
  [".scala", "Scala"],
  [".lua", "Lua"],
  [".dart", "Dart"],
  [".ex", "Elixir"],
  [".exs", "Elixir"],
  [".erl", "Erlang"],
  [".hrl", "Erlang"],
  [".fs", "F#"],
  [".fsx", "F#"],
  [".clj", "Clojure"],
  [".cljs", "ClojureScript"],
  [".r", "R"],
  [".jl", "Julia"],
  [".m", "Objective-C"],
  [".mm", "Objective-C++"],
  [".sol", "Solidity"],
  [".zig", "Zig"],
  [".sh", "Shell"],
  [".bash", "Shell"],
  [".zsh", "Shell"],
  [".fish", "Shell"],
  [".sql", "SQL"],
]);

export interface UnsupportedLanguageSummary {
  extension: string;
  label: string;
  fileCount: number;
  sampleFiles: string[];
}

function isIgnoredUnsupportedSourcePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return (
    /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(normalized) ||
    /(^|\/)(migrations?|schema-migrations?)\/[^/]+\.sql$/.test(normalized)
  );
}

export function supportedLanguageDescription(): string {
  return "TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, C#, Ruby, C++, PHP, Kotlin, Swift, Markdown/MDX, and selected JSON/Prisma schema text";
}

export async function detectUnsupportedSourceLanguages(repoRoot: string): Promise<UnsupportedLanguageSummary[]> {
  const counts = new Map<string, { label: string; fileCount: number; sampleFiles: string[] }>();

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > CONFIG.parser.maxDepth) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDED_REPOSITORY_DIRS.has(entry.name)) {
          await scan(fullPath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      const label = SOURCE_EXTENSION_LABELS.get(extension);
      if (!label || SUPPORTED_INDEX_EXTENSIONS.has(extension)) continue;

      const relativePath = path.relative(repoRoot, fullPath);
      if (isIgnoredUnsupportedSourcePath(relativePath)) continue;

      const summary = counts.get(extension) ?? { label, fileCount: 0, sampleFiles: [] };
      summary.fileCount += 1;
      if (summary.sampleFiles.length < 3) summary.sampleFiles.push(relativePath);
      counts.set(extension, summary);
    }
  }

  await scan(repoRoot, 0);

  return [...counts.entries()]
    .map(([extension, summary]) => ({ extension, ...summary }))
    .sort((a, b) => b.fileCount - a.fileCount || a.label.localeCompare(b.label));
}
