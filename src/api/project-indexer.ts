import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { CONFIG } from "../config";
import { ProjectRepo } from "../db/project-repo";
import { deleteProjectIndexes, indexRepository } from "../indexer";
import { parseRepository } from "../parser";
import { extractDependencyEdges } from "../parser/dependency-resolver";
import { CodeUnitStore } from "../retriever/unit-store";
import { generateAndStoreSummary } from "../summary";
import { throwIfAborted } from "../utils/abort";
import { logger } from "../utils/logger";
import { HttpError } from "./errors";

export interface ProjectIndexContext {
  repo: ProjectRepo;
  stores: Map<string, CodeUnitStore>;
  getCurrentProjectId(): string | null;
  setCurrentProjectId(projectId: string | null): void;
}

const activeIndexingRoots = new Set<string>();

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
  let realRoot: string;
  try {
    realRoot = await fs.promises.realpath(resolved);
    const stat = await fs.promises.stat(realRoot);
    if (!stat.isDirectory()) {
      throw new HttpError(400, "repoRoot must be an existing directory");
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "repoRoot must be an existing directory");
  }
  if (activeIndexingRoots.has(realRoot)) {
    throw new HttpError(409, "This repository is already being indexed");
  }
  activeIndexingRoots.add(realRoot);

  const start = Date.now();
  const rawName = name || path.basename(realRoot);
  const sanitizedName = [...rawName]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .slice(0, 200);
  const projectName = sanitizedName.trim() || path.basename(realRoot) || "repository";

  try {
    await assertRepoRootAllowed(realRoot);

    const existing = context.repo.getProjectByPath(realRoot);
    const projectId = uuidv4();

    try {
      throwIfAborted(signal);
      const units = await parseRepository(realRoot, signal);
      throwIfAborted(signal);
      await indexRepository(units, projectId, signal);
      throwIfAborted(signal);
      const edges = extractDependencyEdges(units);
      const project = context.repo.replaceProjectIndex({
        id: projectId,
        name: projectName,
        repoPath: realRoot,
        units,
        edges,
      });

      const store = new CodeUnitStore();
      await store.loadFromDb(project.id, context.repo);
      context.stores.set(project.id, store);
      context.setCurrentProjectId(project.id);
      if (existing) {
        context.stores.delete(existing.id);
        if (existing.id !== project.id) {
          await deleteProjectIndexes(existing.id);
        }
      }

      if (summarize) {
        throwIfAborted(signal);
        try {
          await generateAndStoreSummary(project.id, projectName, units, context.repo);
        } catch (err) {
          logger.warn(`Summary generation failed after indexing ${project.id}: ${String(err)}`);
        }
      }

      const timeSeconds = (Date.now() - start) / 1000;
      return { projectId: project.id, unitCount: store.size, timeSeconds };
    } catch (err) {
      await deleteProjectIndexes(projectId);
      context.repo.deleteProject(projectId);
      context.stores.delete(projectId);
      if (context.getCurrentProjectId() === projectId) {
        context.setCurrentProjectId(null);
      }
      throw err;
    }
  } finally {
    activeIndexingRoots.delete(realRoot);
  }
}
