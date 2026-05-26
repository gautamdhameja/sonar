import { CodebaseStructure } from "./directory-analyzer";
import { generateResponse } from "../generator/llm-client";
import { logger } from "../utils/logger";

interface DirectorySummary {
  path: string;
  summary: string;
}

const DIR_SYSTEM =
  "Summarize what this code module does in 1-2 sentences. Base your answer only on the function/class names and documentation provided. Do not speculate beyond what is given.";

const OVERVIEW_SYSTEM = [
  "You are writing a technical overview of a software project for an engineer who has never seen the code.",
  "Structure your answer as:",
  "1. **Purpose**: What the application does (1-2 sentences)",
  "2. **Architecture**: The main layers/components and how they connect",
  "3. **Data Flow**: How a request moves through the system from entry to output",
  "4. **Key Modules**: One-line description of each major module",
  "Be concise. Use bullet points. No code. Base everything on the provided module summaries and dependency data.",
].join("\n");

export async function generateCodebaseSummary(structure: CodebaseStructure): Promise<string> {
  // Step 1: Generate directory summaries
  const directoriesWithContent = structure.directories.filter(
    (d) => d.unitCounts.function + d.unitCounts.class + d.unitCounts.method + d.unitCounts.module > 2,
  );

  // Skip vendored-looking directories (heuristic: deep paths with "lib/" or "test/" from dependencies)
  const projectDirs = directoriesWithContent.filter((d) => {
    const parts = d.path.split("/");
    // Skip directories 4+ levels deep that contain "lib" or "test" — likely vendored deps
    if (parts.length >= 4 && (parts.includes("lib") || parts.includes("test"))) return false;
    return true;
  });

  const dirSummaries: DirectorySummary[] = [];

  for (let i = 0; i < projectDirs.length; i++) {
    const dir = projectDirs[i];
    logger.info(`Summarizing directory ${i + 1} of ${projectDirs.length}: ${dir.path}`);

    const userPrompt = [
      `Module: ${dir.path}`,
      `Functions/classes: ${dir.unitNames.join(", ")}`,
      dir.sampleDocstrings.length > 0 ? `Docs: ${dir.sampleDocstrings.join(" | ")}` : "",
      `Imported by: ${dir.importedBy.join(", ") || "(nothing)"}`,
      `Imports from: ${dir.importsFrom.join(", ") || "(nothing)"}`,
    ]
      .filter(Boolean)
      .join("\n");

    const summary = await generateResponse(DIR_SYSTEM, userPrompt);
    dirSummaries.push({ path: dir.path, summary });
  }

  // Step 2: Generate overall codebase summary
  // If too many directories, batch them into a condensed form
  logger.info("Generating overall codebase summary...");

  const dirLines = dirSummaries.map((ds) => `- ${ds.path}: ${ds.summary}`).join("\n");

  const depLines = structure.dependencyGraph.map((e) => `${e.from} → ${e.to}`).join(", ");

  // Keep the overall prompt compact to fit 8K context
  const overallUser = [
    `Project: ${structure.projectName} (${structure.totalFiles} files, ${structure.totalUnits} code units)`,
    `Entry points: ${structure.entryPoints.join(", ") || "(none detected)"}`,
    "",
    "Modules:",
    dirLines,
    "",
    `Dependencies: ${depLines || "(none)"}`,
  ].join("\n");

  const overallSummary = await generateResponse(OVERVIEW_SYSTEM, overallUser);

  // Step 3: Build formatted output
  const dirDetails = dirSummaries.map((ds) => `### ${ds.path}\n${ds.summary}`).join("\n\n");

  const depMap = structure.dependencyGraph.map((e) => `- ${e.from} depends on ${e.to}`).join("\n");

  const result = [
    `# Codebase Overview: ${structure.projectName}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    overallSummary,
    "",
    "## Module Details",
    "",
    dirDetails,
    "",
    "## Dependency Map",
    depMap || "No cross-directory dependencies detected.",
    "",
  ].join("\n");

  logger.info(`Summary generation complete (${result.length} characters)`);

  return result;
}
