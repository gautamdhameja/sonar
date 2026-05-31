import { Request, Response, Express } from "express";
import { answerOnboardingFollowup, onboardingSessionSourceFiles } from "../generator/onboarding-followup";
import { generateOnboardingBrief } from "../generator/onboarding";
import { parsePersona } from "../persona/schema";
import { ApiState } from "./api-state";
import { toErrorResponse } from "./errors";
import { parseOnboardingRequest } from "./onboarding-request";
import { requiredTrimmedString } from "./request-validation";

export function registerOnboardingRoutes(app: Express, state: ApiState): void {
  const { repo } = state;

  app.post("/projects/:id/onboarding", async (req: Request, res: Response) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const body = req.body ?? {};
      const persona = parsePersona(body.persona);
      const onboardingRequest = parseOnboardingRequest(body);
      if (onboardingRequest.error) {
        res.status(400).json({ error: onboardingRequest.error });
        return;
      }

      const store = await state.getStore(project.id);
      if (!store) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const result = await generateOnboardingBrief(store, {
        projectId: project.id,
        repoName: project.name,
        audience: onboardingRequest.audience,
        focus: onboardingRequest.focus,
        persona,
      });
      res.json(result);
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });

  app.post("/projects/:id/onboarding/sessions", async (req: Request, res: Response) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const body = req.body ?? {};
      const persona = parsePersona(body.persona);
      const onboardingRequest = parseOnboardingRequest(body);
      if (onboardingRequest.error) {
        res.status(400).json({ error: onboardingRequest.error });
        return;
      }

      const store = await state.getStore(project.id);
      if (!store) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const briefResult = await generateOnboardingBrief(store, {
        projectId: project.id,
        repoName: project.name,
        audience: onboardingRequest.audience,
        focus: onboardingRequest.focus,
        persona,
      });
      const session = repo.createOnboardingSession({
        projectId: project.id,
        repoName: project.name,
        audience: onboardingRequest.audience,
        focus: onboardingRequest.focus,
        persona,
        brief: briefResult.brief,
        sourceFiles: onboardingSessionSourceFiles(briefResult.sources),
      });

      res.json({
        success: true,
        session,
        brief: briefResult,
      });
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });

  app.get("/projects/:id/onboarding/sessions/:sessionId", (req: Request, res: Response) => {
    const project = repo.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const session = repo.getOnboardingSessionForProject(project.id, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Onboarding session not found" });
      return;
    }

    res.json({
      session,
      messages: repo.listOnboardingMessages(session.id, 50),
    });
  });

  app.post("/projects/:id/onboarding/sessions/:sessionId/messages", async (req: Request, res: Response) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const session = repo.getOnboardingSessionForProject(project.id, req.params.sessionId);
      if (!session) {
        res.status(404).json({ error: "Onboarding session not found" });
        return;
      }

      const { question } = req.body ?? {};
      const parsedQuestion = requiredTrimmedString(question, "question", 10000);
      if (parsedQuestion.error || !parsedQuestion.value) {
        res.status(400).json({ error: parsedQuestion.error });
        return;
      }

      const store = await state.getStore(project.id);
      if (!store) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const result = await answerOnboardingFollowup({
        session,
        question: parsedQuestion.value,
        store,
        repo,
      });

      res.json(result);
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });
}
