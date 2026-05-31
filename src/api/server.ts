import http from "http";
import { timingSafeEqual } from "crypto";
import express, { NextFunction, Request, Response } from "express";
import { CONFIG } from "../config";
import { ProjectRepo } from "../db/project-repo";
import { logger } from "../utils/logger";
import { ApiState } from "./api-state";
import { registerGraphRoutes } from "./graph-routes";
import { registerHealthRoutes } from "./health-routes";
import { registerOnboardingRoutes } from "./onboarding-routes";
import { registerProjectRoutes } from "./project-routes";
import { ProjectIndexContext } from "./project-indexer";
import { registerQueryRoutes } from "./query-routes";

export function isApiRequestAuthorized(
  method: string,
  origin: string | undefined,
  requestToken: string | undefined,
  configuredToken: string | null,
  allowedOrigins: string[],
): { authorized: boolean; status?: number; error?: string } {
  if (method === "OPTIONS") return { authorized: true };
  if (origin && !allowedOrigins.includes(origin)) {
    return { authorized: false, status: 403, error: "Origin is not allowed" };
  }
  if (configuredToken && !tokensMatch(requestToken, configuredToken)) {
    return { authorized: false, status: 401, error: "Missing or invalid X-Sonar-Token" };
  }
  return { authorized: true };
}

function tokensMatch(requestToken: string | undefined, configuredToken: string): boolean {
  if (!requestToken) return false;
  const request = Buffer.from(requestToken);
  const configured = Buffer.from(configuredToken);
  return request.length === configured.length && timingSafeEqual(request, configured);
}

export interface RunningServer {
  app: express.Express;
  server: http.Server;
  repo: ProjectRepo;
  close(): Promise<void>;
}

export async function startServer(port: number): Promise<RunningServer> {
  assertSafeApiBinding();
  const state = new ApiState(new ProjectRepo());
  const { repo } = state;
  const app = express();
  let closed = false;
  const indexContext: ProjectIndexContext = {
    repo,
    stores: state.stores,
    getCurrentProjectId: () => state.getCurrentProjectId(),
    setCurrentProjectId: (projectId) => state.setCurrentProjectId(projectId),
  };

  configureMiddleware(app);
  registerProjectRoutes(app, state, indexContext);
  registerQueryRoutes(app, state);
  registerOnboardingRoutes(app, state);
  registerGraphRoutes(app, state);
  registerHealthRoutes(app, state);

  const server = app.listen(port, CONFIG.api.host, () => {
    logger.info(`Sonar API server running on ${CONFIG.api.host}:${port}`);
  });

  return {
    app,
    server,
    repo,
    close: () =>
      new Promise((resolve, reject) => {
        if (closed) {
          resolve();
          return;
        }
        server.close((err) => {
          closed = true;
          repo.close();
          if (err && (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
}

function assertSafeApiBinding(): void {
  if (CONFIG.security.apiToken || isLoopbackHost(CONFIG.api.host)) return;
  throw new Error("SONAR_API_TOKEN is required when SONAR_API_HOST is not a loopback address.");
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function configureMiddleware(app: express.Express): void {
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(jsonSyntaxErrorHandler);
  app.use(securityHeaders);
  app.use(corsHeaders);
  app.options("*", preflight);
  app.use(assertApiAccess);
  app.use(requestLogger);
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
}

function jsonSyntaxErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof SyntaxError && typeof err === "object" && err !== null && "body" in err) {
    res.status(400).json({ error: "Request body must be valid JSON" });
    return;
  }
  next(err);
}

function isAllowedOrigin(origin: string | undefined): boolean {
  return !origin || CONFIG.api.corsAllowedOrigins.includes(origin);
}

function corsHeaders(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sonar-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  next();
}

function preflight(req: Request, res: Response): void {
  if (!isAllowedOrigin(req.headers.origin)) {
    res.sendStatus(403);
    return;
  }
  res.sendStatus(204);
}

function assertApiAccess(req: Request, res: Response, next: NextFunction): void {
  const decision = isApiRequestAuthorized(
    req.method,
    req.headers.origin,
    req.header("X-Sonar-Token"),
    CONFIG.security.apiToken,
    CONFIG.api.corsAllowedOrigins,
  );
  if (!decision.authorized) {
    res.status(decision.status ?? 403).json({ error: decision.error ?? "Request is not allowed" });
    return;
  }
  next();
}

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    logger.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
}
