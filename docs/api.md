# API Reference

The desktop app uses the same HTTP API that can be used for automation and development.

## Project Endpoints

- `POST /projects/index` — index a local repository; accepts `repoRoot`, optional `name`, and optional `summarize`.
- `GET /projects` — list indexed projects.
- `GET /projects/:id` — get project metadata.
- `DELETE /projects/:id` — delete a project and its indexed data.
- `POST /projects/:id/select` — select a project for backward-compatible `/query` calls.
- `POST /projects/:id/summarize` — regenerate and store the codebase summary.
- `GET /projects/:id/summary` — read the stored summary metadata.

## Query And Onboarding Endpoints

- `POST /query` — backward-compatible query endpoint using `projectId` or the selected project.
- `POST /projects/:id/query` — stateless source-grounded Q&A for a project.
- `POST /projects/:id/explain` — role-aware onboarding-style overview using the general query pipeline.
- `POST /projects/:id/onboarding` — generate a dedicated first-week onboarding brief without creating a session.
- `POST /projects/:id/onboarding/sessions` — generate a brief and persist an onboarding session.
- `GET /projects/:id/onboarding/sessions/:sessionId` — read a session and its messages.
- `POST /projects/:id/onboarding/sessions/:sessionId/messages` — ask a session-aware follow-up question.

## Graph And Health Endpoints

- `GET /projects/:id/graph` — file-level dependency graph.
- `GET /projects/:id/graph/directory` — directory-level dependency graph.
- `GET /health` — API health and current project status.
- `GET /health/dependencies` — SQLite, Meilisearch, Qdrant, embedding endpoint, and chat endpoint status.
- `GET /stats` — current project index statistics.

## Typical API Flow

1. Start Meilisearch, Qdrant, and an embedding endpoint, using Docker Compose or your own services.
2. Start Sonar API mode.
3. Ensure a generation endpoint is reachable at `SONAR_CHAT_BASE_URL`.
4. Index a local repository.
5. Create a persisted onboarding session.
6. Ask follow-up questions in that session.

Index a repository:

```bash
export SONAR_API_TOKEN="${SONAR_API_TOKEN:-$(openssl rand -hex 32)}"

curl -H "X-Sonar-Token: $SONAR_API_TOKEN" --json '{
  "repoRoot": "/Users/you/code/example-product",
  "name": "Example Product",
  "summarize": true
}' http://localhost:3001/projects/index
```

If `SONAR_API_HOST` is not a loopback address, `SONAR_API_TOKEN` is required. A token is recommended for local API mode as well.

Create an onboarding session:

```bash
curl -H "X-Sonar-Token: $SONAR_API_TOKEN" --json '{
  "audience": "A product manager joining the team in their first week",
  "focus": [
    "what the product does",
    "top user workflows",
    "local/offline behavior",
    "collaboration and sharing",
    "privacy and operational risks",
    "questions to ask engineering"
  ],
  "persona": {
    "role": "product_manager",
    "technicalBackground": "basic",
    "avoidJargon": true,
    "explanationDepth": "standard",
    "businessContext": "Create first-week onboarding documentation, not deep code analysis."
  }
}' http://localhost:3001/projects/<project-id>/onboarding/sessions
```

Ask a follow-up question in the session:

```bash
curl -H "X-Sonar-Token: $SONAR_API_TOKEN" --json '{
  "question": "How does collaboration and sharing work at a product level, and what should I ask engineering about it?"
}' http://localhost:3001/projects/<project-id>/onboarding/sessions/<session-id>/messages
```

## Querying With A Persona

`POST /query` still works with the selected project for backward compatibility, but new clients should pass an explicit `projectId` or use `POST /projects/:id/query`.

```json
{
  "projectId": "project-id",
  "query": "What does this app do?",
  "persona": {
    "role": "product_manager",
    "technicalBackground": "basic",
    "avoidJargon": true,
    "explanationDepth": "standard",
    "businessContext": "I need onboarding context for planning"
  }
}
```

Use `POST /projects/:id/onboarding/sessions` for the V1 onboarding flow. Use `POST /projects/:id/explain` only when you want the older role-aware overview shape from the general query pipeline.

Summaries and onboarding sessions are stored in SQLite and mirrored under Sonar's data directory where applicable. Sonar does not write generated artifacts into the repository being analyzed.
