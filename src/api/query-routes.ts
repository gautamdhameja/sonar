import { Request, Response, Express } from "express";
import { answerQuery } from "../generator";
import { parsePersona } from "../persona/schema";
import { planQuery } from "../retriever/query-router";
import { ApiState } from "./api-state";
import { toErrorResponse } from "./errors";
import { optionalStringList, requiredTrimmedString } from "./request-validation";

export function registerQueryRoutes(app: Express, state: ApiState): void {
  const { repo } = state;

  async function handleQuery(req: Request, res: Response, routeProjectId?: string): Promise<void> {
    try {
      const body = req.body ?? {};
      const { query } = body;
      const parsedQuery = requiredTrimmedString(query, "query", 10000);
      if (parsedQuery.error || !parsedQuery.value) {
        res.status(400).json({ error: parsedQuery.error });
        return;
      }
      const requestProjectId = routeProjectId ?? body.projectId ?? state.getCurrentProjectId();
      if (!requestProjectId || typeof requestProjectId !== "string") {
        res.status(400).json({ error: "No project selected" });
        return;
      }

      const persona = parsePersona(body.persona);
      const project = repo.getProject(requestProjectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const store = await state.getStore(project.id);
      if (!store) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      let codebaseSummary: string | null = null;
      const queryPlan = planQuery(parsedQuery.value);
      if (queryPlan.includeSummary && project.summary) {
        codebaseSummary = project.summary;
      }

      const result = await answerQuery(
        parsedQuery.value,
        store,
        project.name,
        project.id,
        codebaseSummary,
        repo,
        persona,
      );
      res.json(result);
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  }

  app.post("/query", async (req: Request, res: Response) => {
    await handleQuery(req, res);
  });

  app.post("/projects/:id/query", async (req: Request, res: Response) => {
    await handleQuery(req, res, req.params.id);
  });

  app.post("/projects/:id/explain", async (req: Request, res: Response) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const body = req.body ?? {};
      const persona = parsePersona(body.persona);
      const focusInput = optionalStringList(body.focus, "focus", 8);
      if (focusInput.error) {
        res.status(400).json({ error: focusInput.error });
        return;
      }
      const focus = focusInput.value ?? ["purpose", "main components", "main workflows", "risks and questions"];

      const store = await state.getStore(project.id);
      if (!store) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const onboardingQuery = [
        "Create a role-aware onboarding overview of this codebase.",
        `Focus areas: ${focus.join(", ")}.`,
        "Explain what the code shows, what is inferred, and what questions this audience should ask engineering next.",
      ].join(" ");

      const result = await answerQuery(
        onboardingQuery,
        store,
        project.name,
        project.id,
        project.summary,
        repo,
        persona,
      );

      res.json({
        projectId: project.id,
        persona,
        sections: [
          {
            title: "Codebase onboarding",
            content: result.answer,
            sources: result.sources,
          },
        ],
        sources: result.sources,
        retrievalTime: result.retrievalTime,
        generationTime: result.generationTime,
        generationTruncated: result.generationTruncated,
        graphEnhanced: result.graphEnhanced,
        retrievalDiagnostics: result.retrievalDiagnostics,
        citationVerification: result.citationVerification,
      });
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });
}
