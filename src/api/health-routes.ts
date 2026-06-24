import { Express, Request, Response } from "express";
import { ApiState } from "./api-state";
import { checkDependencies } from "./dependency-health";

export function registerHealthRoutes(app: Express, state: ApiState): void {
  const { repo } = state;

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
    });
  });

  app.get("/health/project", (_req: Request, res: Response) => {
    const currentProjectId = state.getCurrentProjectId();
    const project = currentProjectId ? repo.getProject(currentProjectId) : null;
    res.json({
      indexed: currentProjectId !== null,
      currentProjectId,
      projectName: project?.name ?? null,
      unitCount: currentProjectId && state.stores.has(currentProjectId) ? state.stores.get(currentProjectId)!.size : 0,
    });
  });

  app.get("/health/dependencies", async (_req: Request, res: Response) => {
    const dependencies = await checkDependencies();
    const healthy = dependencies.every((dependency) => dependency.status === "ok");
    res.json({
      status: healthy ? "ok" : "degraded",
      dependencies,
    });
  });

  app.get("/stats", (_req: Request, res: Response) => {
    const currentProjectId = state.getCurrentProjectId();
    if (!currentProjectId) {
      res.status(400).json({ error: "No project selected" });
      return;
    }
    const stats = repo.getProjectStats(currentProjectId);
    res.json(stats);
  });
}
