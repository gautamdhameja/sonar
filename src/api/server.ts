import path from "path";
import http from "http";
import express, { Request, Response, NextFunction } from "express";
import { CodeUnitStore } from "../retriever/unit-store";
import { answerQuery } from "../generator";
import { generateOnboardingBrief } from "../generator/onboarding";
import { answerOnboardingFollowup, onboardingSessionSourceFiles } from "../generator/onboarding-followup";
import { ProjectRepo } from "../db/project-repo";
import { generateAndStoreSummary } from "../summary";
import { CONFIG } from "../config";
import { parsePersona } from "../persona/schema";
import { planQuery } from "../retriever/query-router";
import { checkDependencies } from "./dependency-health";
import { toErrorResponse } from "./errors";
import { buildDirectoryGraphResponse, buildFileGraphResponse } from "./graph-response";
import { indexProject, ProjectIndexContext } from "./project-indexer";
import { optionalStringList, optionalTrimmedString, requiredTrimmedString } from "./request-validation";
import { isOperationAborted } from "../utils/abort";
import { logger } from "../utils/logger";

const stores = new Map<string, CodeUnitStore>();
let currentProjectId: string | null = null;
let repo: ProjectRepo;

export interface RunningServer {
  app: express.Express;
  server: http.Server;
  repo: ProjectRepo;
  close(): Promise<void>;
}

async function getStore(projectId: string): Promise<CodeUnitStore | null> {
  const project = repo.getProject(projectId);
  if (!project) return null;
  const existing = stores.get(projectId);
  if (existing) return existing;

  const store = new CodeUnitStore();
  await store.loadFromDb(projectId, repo);
  stores.set(projectId, store);
  return store;
}

export async function startServer(port: number): Promise<RunningServer> {
  repo = new ProjectRepo();
  const app = express();
  const indexContext: ProjectIndexContext = {
    repo,
    stores,
    getCurrentProjectId: () => currentProjectId,
    setCurrentProjectId: (projectId) => {
      currentProjectId = projectId;
    },
  };

  app.use(express.json({ limit: "1mb" }));
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && typeof err === "object" && err !== null && "body" in err) {
      res.status(400).json({ error: "Request body must be valid JSON" });
      return;
    }
    next(err);
  });

  function isAllowedOrigin(origin: string | undefined): boolean {
    return !origin || CONFIG.api.corsAllowedOrigins.includes(origin);
  }

  function assertApiToken(req: Request, res: Response, next: NextFunction): void {
    if (!["POST", "DELETE", "PUT", "PATCH"].includes(req.method)) {
      next();
      return;
    }
    if (!isAllowedOrigin(req.headers.origin)) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }
    if (CONFIG.security.apiToken && req.header("X-Sonar-Token") !== CONFIG.security.apiToken) {
      res.status(401).json({ error: "Missing or invalid X-Sonar-Token" });
      return;
    }
    next();
  }

  // CORS
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const origin = _req.headers.origin;
    if (typeof origin === "string" && isAllowedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sonar-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    next();
  });

  // Preflight
  app.options("*", (_req: Request, res: Response) => {
    if (!isAllowedOrigin(_req.headers.origin)) {
      res.sendStatus(403);
      return;
    }
    res.sendStatus(204);
  });

  app.use(assertApiToken);

  // Request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  function parseOnboardingRequest(body: unknown): {
    audience?: string;
    focus?: string[];
    error?: string;
  } {
    const requestBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const audience = optionalTrimmedString(requestBody.audience, 1000);
    const focus = optionalStringList(requestBody.focus, "focus", 10);
    if (focus.error) return { error: focus.error };
    return { audience, focus: focus.value };
  }

  // --- Project endpoints ---

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
      const summarize = req.query.summarize === "true" || req.body?.summarize === true;
      const result = await indexProject(root, name, summarize, indexContext, controller.signal);
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

  app.delete("/projects/:id", (req: Request, res: Response) => {
    const project = repo.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    repo.deleteProject(req.params.id);
    stores.delete(req.params.id);
    if (currentProjectId === req.params.id) {
      currentProjectId = null;
    }
    res.json({ success: true });
  });

  app.post("/projects/:id/select", async (req: Request, res: Response) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const store = await getStore(project.id);

      currentProjectId = project.id;
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

  // --- Backward-compatible /index endpoint ---

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

  // --- Query endpoint ---

  async function handleQuery(req: Request, res: Response, routeProjectId?: string): Promise<void> {
    try {
      const body = req.body ?? {};
      const { query } = body;
      const parsedQuery = requiredTrimmedString(query, "query", 10000);
      if (parsedQuery.error || !parsedQuery.value) {
        res.status(400).json({ error: parsedQuery.error });
        return;
      }
      const requestProjectId = routeProjectId ?? body.projectId ?? currentProjectId;
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
      const store = await getStore(project.id);
      if (!store) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Inject codebase summary for architectural queries
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

      const store = await getStore(project.id);
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
        graphEnhanced: result.graphEnhanced,
        retrievalDiagnostics: result.retrievalDiagnostics,
        citationVerification: result.citationVerification,
      });
    } catch (err) {
      const { status, message } = toErrorResponse(err);
      res.status(status).json({ error: message });
    }
  });

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

      const store = await getStore(project.id);
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

      const store = await getStore(project.id);
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

      const store = await getStore(project.id);
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

  // --- Graph endpoints ---

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

  // --- Health & Stats ---

  app.get("/health", (_req: Request, res: Response) => {
    const project = currentProjectId ? repo.getProject(currentProjectId) : null;
    res.json({
      status: "ok",
      indexed: currentProjectId !== null,
      currentProjectId: currentProjectId,
      projectName: project?.name ?? null,
      unitCount: currentProjectId && stores.has(currentProjectId) ? stores.get(currentProjectId)!.size : 0,
    });
  });

  app.get("/health/dependencies", async (_req: Request, res: Response) => {
    const dependencies = await checkDependencies();
    const healthy = dependencies.every((dependency) => dependency.status === "ok");
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      dependencies,
    });
  });

  app.get("/stats", (_req: Request, res: Response) => {
    if (!currentProjectId) {
      res.status(400).json({ error: "No project selected" });
      return;
    }
    const stats = repo.getProjectStats(currentProjectId);
    res.json(stats);
  });

  const server = app.listen(port, CONFIG.api.host, () => {
    logger.info(`Sonar API server running on ${CONFIG.api.host}:${port}`);
  });

  return {
    app,
    server,
    repo,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          repo.close();
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
