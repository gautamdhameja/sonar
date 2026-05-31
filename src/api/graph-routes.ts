import { Express, Request, Response } from "express";
import { ApiState } from "./api-state";
import { buildDirectoryGraphResponse, buildFileGraphResponse } from "./graph-response";

export function registerGraphRoutes(app: Express, state: ApiState): void {
  const { repo } = state;

  app.get("/projects/:id/graph", (req: Request, res: Response) => {
    const project = repo.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const units = repo.getCodeUnitsByProject(project.id);
    const edges = repo.getDependencyEdges(project.id);

    res.json(buildFileGraphResponse(units, edges));
  });

  app.get("/projects/:id/graph/directory", (req: Request, res: Response) => {
    const project = repo.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const units = repo.getCodeUnitsByProject(project.id);
    const edges = repo.getDependencyEdges(project.id);

    res.json(buildDirectoryGraphResponse(units, edges));
  });
}
