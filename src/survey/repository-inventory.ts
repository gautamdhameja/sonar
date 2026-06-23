import fs from "fs/promises";
import path from "path";
import { CONFIG } from "../config";
import {
  EXCLUDED_REPOSITORY_DIRS,
  SUPPORTED_DOC_EXTENSIONS,
  SUPPORTED_INDEX_EXTENSIONS,
  SUPPORTED_TEXT_EXTENSIONS,
} from "../parser/language-support";
import { detectVendoredPaths } from "../parser/vendored-detector";
import { throwIfAborted } from "../utils/abort";
import { extractSourceSignals, SourceSignal, SourceSignalKind } from "./source-signals";
import { isSensitiveRepositoryPath, redactSensitiveText } from "../security/source-safety";

export interface InventoryFile {
  filePath: string;
  extension: string;
  language: string;
  bytes: number;
  supported: boolean;
  documentation: boolean;
  vendored: boolean;
  signals: SourceSignal[];
  entryScore: number;
  documentationScore: number;
  reasons: string[];
  documentationReasons: string[];
}

export interface InventoryLanguageSummary {
  language: string;
  supported: boolean;
  fileCount: number;
  bytes: number;
}

export interface RepositoryInventory {
  rootName: string;
  totalFiles: number;
  scannedFiles: number;
  skippedFiles: number;
  supportedFiles: number;
  unsupportedFiles: number;
  languages: InventoryLanguageSummary[];
  candidateFiles: InventoryFile[];
  documentationSources: InventoryFile[];
  files: InventoryFile[];
}

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
  [".md", "Markdown"],
  [".mdx", "Markdown"],
  [".json", "JSON"],
  [".prisma", "Prisma"],
  [".c", "C"],
  [".h", "C/C++"],
  [".cpp", "C++"],
  [".cc", "C++"],
  [".cxx", "C++"],
  [".hpp", "C++"],
  [".rb", "Ruby"],
  [".php", "PHP"],
  [".swift", "Swift"],
  [".kt", "Kotlin"],
  [".kts", "Kotlin"],
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

const SURVEY_EXTENSION_ALLOWLIST = new Set([
  ...SOURCE_EXTENSION_LABELS.keys(),
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".cfg",
]);

const ENTRY_FILE_NAMES = new Set(["main", "index", "app", "server", "cli", "cmd", "program", "run", "start"]);

function languageForExtension(extension: string): string {
  return SOURCE_EXTENSION_LABELS.get(extension) ?? extension.replace(/^\./, "").toUpperCase();
}

function isSkippedFile(fileName: string): boolean {
  return (
    /(^|\.)(lock|snap)\b/i.test(fileName) ||
    /^(package-lock\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb|cargo\.lock|pipfile\.lock)$/i.test(fileName) ||
    /\.(png|jpe?g|gif|webp|svg|ico|pdf|map|wasm|bin)$/i.test(fileName)
  );
}

function isUnderVendoredPath(filePath: string, vendoredPaths: Set<string>): boolean {
  for (const vendoredPath of vendoredPaths) {
    if (filePath === vendoredPath || filePath.startsWith(`${vendoredPath}/`)) return true;
  }
  return false;
}

function signalScore(signals: SourceSignal[], kind: SourceSignalKind): number {
  return signals.find((signal) => signal.kind === kind)?.score ?? 0;
}

function entryScoreForFile(
  filePath: string,
  signals: SourceSignal[],
  bytes: number,
): { score: number; reasons: string[] } {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const extension = path.extname(normalized);
  const base = path.basename(normalized, extension);
  const reasons: string[] = [];
  let score = 0;

  if (ENTRY_FILE_NAMES.has(base)) {
    score += 45;
    reasons.push("entry-like filename");
  }
  if (/^readme\.mdx?$/.test(normalized)) {
    score += 38;
    reasons.push("repository overview document");
  }
  if (/(^|\/)(src|app|cmd|bin|service|services|daemon|server|client|lib)\//.test(normalized)) {
    score += 16;
    reasons.push("common source area");
  }
  if (/(^|\/)(test|tests|__tests__|fixtures?)\//.test(normalized)) {
    score -= 28;
    reasons.push("test or fixture area");
  }
  if (/(^|\/)(docs?|examples?)\//.test(normalized)) {
    score -= 6;
    reasons.push("documentation or example area");
  }
  if (bytes > CONFIG.parser.maxFileBytes) {
    score -= 60;
    reasons.push("oversized for local-model inspection");
  }

  for (const signal of signals) {
    score += signal.score;
    reasons.push(signal.reason);
  }

  if (signalScore(signals, "entry_point") > 0 && signalScore(signals, "file_io") > 0) {
    score += 10;
    reasons.push("entry point with file IO");
  }
  if (signalScore(signals, "entry_point") > 0 && signalScore(signals, "network") > 0) {
    score += 10;
    reasons.push("entry point with network boundary");
  }

  return { score, reasons: [...new Set(reasons)].slice(0, 8) };
}

function hasModuleLevelComment(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    /^\/\*\*?[\s\S]{20,}?\*\//.test(trimmed) ||
    /^\/\/[^\n]{10,}(?:\n\/\/[^\n]{10,})?/.test(trimmed) ||
    /^#[^\n]{10,}(?:\n#[^\n]{10,})?/.test(trimmed) ||
    /^"""[\s\S]{20,}?"""/.test(trimmed) ||
    /^'''[\s\S]{20,}?'''/.test(trimmed) ||
    /^--[^\n]{10,}(?:\n--[^\n]{10,})?/.test(trimmed)
  );
}

function documentationScoreForFile(
  filePath: string,
  documentation: boolean,
  text: string,
  bytes: number,
): { score: number; reasons: string[] } {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const baseName = path.basename(normalized);
  const reasons: string[] = [];
  let score = 0;

  if (/^readme\.mdx?$/.test(normalized)) {
    score += 70;
    reasons.push("repository README");
  }
  if (/(^|\/)readme\.mdx?$/.test(normalized) && !/^readme\.mdx?$/.test(normalized)) {
    score += 56;
    reasons.push("module-level README");
  }
  if (/(^|\/)(docs?|documents?)\//.test(normalized)) {
    score += 42;
    reasons.push("documentation directory");
  }
  if (documentation) {
    score += 28;
    reasons.push("documentation file");
  }
  if (
    /(overview|introduction|getting-started|quick-start|architecture|design|concepts?|guide|manual|about)/.test(
      normalized,
    )
  ) {
    score += 28;
    reasons.push("broad context document");
  }
  if (/^(contributing|development|developer|setup|install|usage|configuration|security)\.mdx?$/.test(baseName)) {
    score += 18;
    reasons.push("operational context document");
  }
  if (/(^|\/)(functions?|methods?|reference|api|commands?|quick-reference)\//.test(normalized)) {
    score -= 30;
    reasons.push("narrow reference document");
  }
  if (!documentation && hasModuleLevelComment(text)) {
    score += 26;
    reasons.push("module-level source comment");
  }
  if (bytes > CONFIG.parser.maxFileBytes) {
    score -= 50;
    reasons.push("oversized for local-model inspection");
  }

  return { score, reasons: [...new Set(reasons)].slice(0, 8) };
}

async function readFilePreview(fullPath: string, bytes: number): Promise<string> {
  if (bytes > CONFIG.parser.maxFileBytes) return "";
  try {
    return await fs.readFile(fullPath, "utf-8");
  } catch {
    return "";
  }
}

async function walkSurveyFiles(
  repoRoot: string,
  signal?: AbortSignal,
): Promise<Array<{ fullPath: string; filePath: string }>> {
  const files: Array<{ fullPath: string; filePath: string }> = [];

  async function walk(dir: string, depth: number): Promise<void> {
    throwIfAborted(signal);
    if (depth > CONFIG.parser.maxDepth || files.length >= CONFIG.parser.maxFiles) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= CONFIG.parser.maxFiles) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_REPOSITORY_DIRS.has(entry.name)) await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || isSkippedFile(entry.name)) continue;
      const filePath = path.relative(repoRoot, fullPath).replace(/\\/g, "/");
      if (isSensitiveRepositoryPath(filePath)) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!SURVEY_EXTENSION_ALLOWLIST.has(extension)) continue;
      files.push({ fullPath, filePath });
    }
  }

  await walk(repoRoot, 0);
  return files.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

export async function buildRepositoryInventory(repoRoot: string, signal?: AbortSignal): Promise<RepositoryInventory> {
  const vendoredPaths = detectVendoredPaths(repoRoot);
  const walkedFiles = await walkSurveyFiles(repoRoot, signal);
  const files: InventoryFile[] = [];
  let skippedFiles = 0;

  for (const walked of walkedFiles) {
    throwIfAborted(signal);
    const stat = await fs.stat(walked.fullPath);
    const extension = path.extname(walked.filePath).toLowerCase();
    const supported = SUPPORTED_INDEX_EXTENSIONS.has(extension);
    const documentation = SUPPORTED_DOC_EXTENSIONS.has(extension);
    const textEvidence = SUPPORTED_TEXT_EXTENSIONS.has(extension);
    const vendored = isUnderVendoredPath(walked.filePath, vendoredPaths);
    const text = redactSensitiveText(walked.filePath, await readFilePreview(walked.fullPath, stat.size));
    if (!text && stat.size > CONFIG.parser.maxFileBytes) skippedFiles++;
    const signals = extractSourceSignals(walked.filePath, text);
    const scored = entryScoreForFile(walked.filePath, signals, stat.size);
    const documentationScored = documentationScoreForFile(
      walked.filePath,
      documentation || textEvidence,
      text,
      stat.size,
    );

    files.push({
      filePath: walked.filePath,
      extension,
      language: languageForExtension(extension),
      bytes: stat.size,
      supported,
      documentation: documentation || textEvidence,
      vendored,
      signals,
      entryScore: scored.score,
      documentationScore: documentationScored.score,
      reasons: scored.reasons,
      documentationReasons: documentationScored.reasons,
    });
  }

  const languages = [
    ...files
      .reduce((acc, file) => {
        const existing = acc.get(file.language) ?? {
          language: file.language,
          supported: file.supported,
          fileCount: 0,
          bytes: 0,
        };
        existing.fileCount += 1;
        existing.bytes += file.bytes;
        existing.supported = existing.supported || file.supported;
        acc.set(file.language, existing);
        return acc;
      }, new Map<string, InventoryLanguageSummary>())
      .values(),
  ].sort((a, b) => b.fileCount - a.fileCount || a.language.localeCompare(b.language));

  const candidateFiles = files
    .filter((file) => !file.vendored)
    .sort((a, b) => b.entryScore - a.entryScore || a.filePath.localeCompare(b.filePath))
    .slice(0, 80);

  const documentationSources = files
    .filter((file) => !file.vendored && file.documentationScore > 0)
    .sort((a, b) => b.documentationScore - a.documentationScore || a.filePath.localeCompare(b.filePath))
    .slice(0, 40);

  return {
    rootName: path.basename(repoRoot),
    totalFiles: walkedFiles.length,
    scannedFiles: files.length,
    skippedFiles,
    supportedFiles: files.filter((file) => file.supported).length,
    unsupportedFiles: files.filter((file) => !file.supported).length,
    languages,
    candidateFiles,
    documentationSources,
    files,
  };
}
