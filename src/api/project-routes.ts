import path from "path";
import { Request, Response, Express } from "express";
import { CONFIG } from "../config";
import { deleteProjectIndexes } from "../indexer";
import { generateAndStoreSummary } from "../summary";
import { isOperationAborted } from "../utils/abort";
import { ApiState } from "./api-state";
import { toErrorResponse } from "./errors";
import { ProjectIndexContext, indexProject } from "./project-indexer";
import { optionalTrimmedString } from "./request-validation";

export function registerProjectRoutes(app: Express, state: ApiState, indexContext: ProjectIndexContext): void {
  const { repo } = state;

  app.post("/projects/index", async (req: Request, res: Response) => {
    const controller = new AbortController();
    req.on("aborted", () => controller.abort());
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const { repoRoot: root, name } = req.body ?? {};
      if (!root || typeof root !== "string") {
        res.status(400).json({ error: "repoRoot is required and must be a string" });
        return;
      }
      if (name !== undefined && typeof name !== "string") {
        res.status(400).json({ error: "name must be a string when provided" });
        return;
      }
      const summarize = req.query.summarize === "true" || req.body?.summarize === true;
      const result = await indexProject(
        root,
        optionalTrimmedString(name, 200) ?? "",
        summarize,
        indexContext,
        controller.signal,
      );
      res.json({ success: true, ...result });
    } catch (err) {
      if (isOperationAborted(err)) {
        if (!res.headersSent && !res.writableEnded) {
          res.status(499).json({ error: "Indexing cancelled" });
        }
        return;
      }
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });

  app.get("/projects", (_req: Request, res: Response) => {
    res.json(repo.listProjects());
  });

  app.get("/projects/:id", (req: Request, res: Response) => {
    const project = repo.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  });

  app.delete("/projects/:id", async (req: Request, res: Response) => {
    const project = repo.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    repo.deleteProject(req.params.id);
    await deleteProjectIndexes(req.params.id);
    state.deleteProjectCache(req.params.id);
    res.json({ success: true });
  });

  app.post("/projects/:id/select", async (req: Request, res: Response) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const store = await state.getStore(project.id);

      state.setCurrentProjectId(project.id);
      res.json({ success: true, projectId: project.id, unitCount: store?.size ?? 0 });
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });

  app.post("/projects/:id/summarize", async (req: Request, res: Response) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const start = Date.now();
      const units = repo.getCodeUnitsByProject(project.id);
      const summary = await generateAndStoreSummary(project.id, project.name, units, repo);
      const timeSeconds = (Date.now() - start) / 1000;

      res.json({ success: true, summary, timeSeconds });
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });

  app.get("/projects/:id/summary", (req: Request, res: Response) => {
    const project = repo.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json({
      projectId: project.id,
      summary: project.summary,
      summaryGeneratedAt: project.summaryGeneratedAt,
      artifactPath: path.join(CONFIG.storage.dataDir, "projects", project.id, "codebase-summary.md"),
    });
  });

  app.post("/index", async (req: Request, res: Response) => {
    try {
      const { repoRoot: root } = req.body ?? {};
      if (!root || typeof root !== "string") {
        res.status(400).json({ error: "repoRoot is required and must be a string" });
        return;
      }
      const summarize = req.query.summarize === "true" || req.body?.summarize === true;
      const result = await indexProject(root, "", summarize, indexContext);
      res.json({ success: true, ...result });
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });
}
