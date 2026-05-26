import fs from "fs";
import path from "path";
import { CONFIG } from "../config";
import { ProjectRepo } from "../db/project-repo";
import { indexRepository } from "../indexer";
import { parseRepository } from "../parser";
import { extractDependencyEdges } from "../parser/dependency-resolver";
import { CodeUnitStore } from "../retriever/unit-store";
import { generateAndStoreSummary } from "../summary";
import { throwIfAborted } from "../utils/abort";
import { HttpError } from "./errors";

export interface ProjectIndexContext {
  repo: ProjectRepo;
  stores: Map<string, CodeUnitStore>;
  getCurrentProjectId(): string | null;
  setCurrentProjectId(projectId: string | null): void;
}

async function assertRepoRootAllowed(repoRoot: string): Promise<void> {
  if (CONFIG.security.allowAnyRepoRoot) return;

  const actualRoot = await fs.promises.realpath(repoRoot);
  const allowedRoots = (
    await Promise.all(
      CONFIG.security.allowedRepoRoots.map(async (root) => {
        try {
          return await fs.promises.realpath(root);
        } catch {
          return null;
        }
      }),
    )
  ).filter((root): root is string => root !== null);

  const allowed = allowedRoots.some((allowedRoot) => {
    const relative = path.relative(allowedRoot, actualRoot);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });

  if (!allowed) {
    throw new HttpError(403, "repoRoot is outside SONAR_ALLOWED_REPO_ROOTS");
  }
}

export async function indexProject(
  repoRoot: string,
  name: string,
  summarize: boolean,
  context: ProjectIndexContext,
  signal?: AbortSignal,
): Promise<{ projectId: string; unitCount: number; timeSeconds: number }> {
  throwIfAborted(signal);
  const resolved = path.resolve(repoRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("repoRoot must be an existing directory");
  }
  await assertRepoRootAllowed(resolved);

  const start = Date.now();
  const rawName = name || path.basename(resolved);
  const projectName = [...rawName]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .slice(0, 200);

  const existing = context.repo.getProjectByPath(resolved);
  if (existing) {
    context.repo.deleteProject(existing.id);
    context.stores.delete(existing.id);
    if (context.getCurrentProjectId() === existing.id) {
      context.setCurrentProjectId(null);
    }
  }

  const project = context.repo.createProject(projectName, resolved);

  try {
    throwIfAborted(signal);
    const units = await parseRepository(resolved, signal);
    throwIfAborted(signal);
    await indexRepository(units, project.id, signal);
    throwIfAborted(signal);
    context.repo.insertCodeUnits(project.id, units);

    const edges = extractDependencyEdges(units);
    if (edges.length > 0) {
      context.repo.insertDependencyEdges(project.id, edges);
    }

    const filesSet = new Set(units.map((unit) => unit.filePath));
    context.repo.updateProjectStats(project.id, units.length, filesSet.size);

    const store = new CodeUnitStore();
    await store.loadFromDb(project.id, context.repo);
    context.stores.set(project.id, store);
    context.setCurrentProjectId(project.id);

    if (summarize) {
      throwIfAborted(signal);
      await generateAndStoreSummary(project.id, projectName, units, context.repo);
    }

    const timeSeconds = (Date.now() - start) / 1000;
    return { projectId: project.id, unitCount: store.size, timeSeconds };
  } catch (err) {
    context.repo.deleteProject(project.id);
    context.stores.delete(project.id);
    if (context.getCurrentProjectId() === project.id) {
      context.setCurrentProjectId(null);
    }
    throw err;
  }
}
