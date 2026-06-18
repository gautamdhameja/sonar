import { Request, Response, Express } from "express";
import { answerOnboardingFollowup, onboardingSessionSourceFiles } from "../generator/onboarding-followup";
import type { OnboardingFollowupHistoryItem } from "../generator/onboarding-followup";
import { generateOnboardingBrief } from "../generator/onboarding";
import { parsePersona } from "../persona/schema";
import type { OnboardingSession } from "../db/project-repo";
import { ApiState } from "./api-state";
import { toErrorResponse } from "./errors";
import { parseOnboardingRequest } from "./onboarding-request";
import { requiredTrimmedString } from "./request-validation";

function sessionResponse(session: OnboardingSession): {
  success: true;
  session: {
    id: string;
    projectId: string;
    repoName: string;
    audience: string | null;
    focus: string[];
    sourceFiles: string[];
    createdAt: string;
  };
  brief: {
    brief: string;
    sources: OnboardingSession["sources"];
    citationVerification: OnboardingSession["citationVerification"];
    retrievalTime: number;
    generationTime: number;
    generationTruncated: boolean;
  };
} {
  const sources =
    session.sources.length > 0
      ? session.sources
      : session.sourceFiles.map((filePath) => ({
          filePath,
          name: filePath.split("/").at(-1) ?? filePath,
          kind: "file",
          lines: "unknown",
        }));

  return {
    success: true,
    session: {
      id: session.id,
      projectId: session.projectId,
      repoName: session.repoName,
      audience: session.audience,
      focus: session.focus,
      sourceFiles: session.sourceFiles,
      createdAt: session.createdAt,
    },
    brief: {
      brief: session.brief,
      sources,
      citationVerification: session.citationVerification,
      retrievalTime: session.retrievalTime,
      generationTime: session.generationTime,
      generationTruncated: session.generationTruncated,
    },
  };
}

function parseFollowupHistory(value: unknown): OnboardingFollowupHistoryItem[] {
  if (!Array.isArray(value)) return [];
  const history: OnboardingFollowupHistoryItem[] = [];
  for (const item of value.slice(-6)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const question = typeof record.question === "string" ? record.question.trim() : "";
    const answer = typeof record.answer === "string" ? record.answer.trim() : "";
    const intent = typeof record.intent === "string" ? record.intent : null;
    if (!question || !answer) continue;
    history.push({
      question: question.slice(0, 1200),
      answer: answer.slice(0, 2400),
      intent,
    });
  }
  return history;
}

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
        repoRoot: project.repoPath,
      });
      if (result.memoryGraph) repo.saveMemoryGraph(project.id, result.memoryGraph);
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
        repoRoot: project.repoPath,
      });
      if (briefResult.memoryGraph) repo.saveMemoryGraph(project.id, briefResult.memoryGraph);
      const session = repo.createOnboardingSession({
        projectId: project.id,
        repoName: project.name,
        audience: onboardingRequest.audience,
        focus: onboardingRequest.focus,
        persona,
        brief: briefResult.brief,
        sourceFiles: onboardingSessionSourceFiles(briefResult.sources),
        sources: briefResult.sources,
        citationVerification: briefResult.citationVerification,
        retrievalTime: briefResult.retrievalTime,
        generationTime: briefResult.generationTime,
        generationTruncated: briefResult.generationTruncated,
      });

      res.json({
        ...sessionResponse(session),
        survey: {
          timeMs: briefResult.surveyTime ?? 0,
          fallbackUsed: briefResult.surveyFallbackUsed ?? false,
          graphNodeCount: briefResult.memoryGraph?.nodes.length ?? 0,
          graphEdgeCount: briefResult.memoryGraph?.edges.length ?? 0,
        },
      });
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });

  app.get("/projects/:id/onboarding/sessions/latest", (req: Request, res: Response) => {
    const project = repo.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const session = repo.getLatestOnboardingSessionForProject(project.id);
    if (!session) {
      res.status(404).json({ error: "No saved briefing found for this project" });
      return;
    }

    res.json(sessionResponse(session));
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

    res.json(sessionResponse(session));
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
      const history = parseFollowupHistory(req.body?.history);

      const store = await state.getStore(project.id);
      if (!store) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const result = await answerOnboardingFollowup({
        session,
        question: parsedQuestion.value,
        history,
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
