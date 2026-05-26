import fs from "fs/promises";
import path from "path";
import { CodeUnit } from "../parser/types";
import { ProjectRepo } from "../db/project-repo";
import { analyzeCodebaseStructure } from "./directory-analyzer";
import { generateCodebaseSummary } from "./summary-generator";
import { CONFIG } from "../config";

export { analyzeCodebaseStructure } from "./directory-analyzer";
export { generateCodebaseSummary } from "./summary-generator";
export type { CodebaseStructure, DirectoryProfile } from "./directory-analyzer";

export async function generateAndStoreSummary(
  projectId: string,
  projectName: string,
  units: CodeUnit[],
  repo: ProjectRepo,
): Promise<string> {
  const edges = repo.getDependencyEdges(projectId);
  const structure = analyzeCodebaseStructure(units, edges, projectName);
  const summary = await generateCodebaseSummary(structure);

  repo.updateProjectSummary(projectId, summary);

  const summaryDir = path.join(CONFIG.storage.dataDir, "projects", projectId);
  await fs.mkdir(summaryDir, { recursive: true });
  await fs.writeFile(path.join(summaryDir, "codebase-summary.md"), summary, "utf-8");

  return summary;
}
