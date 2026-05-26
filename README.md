# Sonar

Local-first codebase onboarding and explanation engine for teams using laptop-scale local models.

Sonar indexes a repository, retrieves the most relevant code/docs with deterministic and semantic search, and asks a local or OpenAI-compatible model to generate source-grounded explanations. The V1 focus is first-week onboarding: helping a product manager, designer, support lead, or new engineer understand what a product does, where the main workflows live, and what questions to ask the engineering team.

Current V1 capabilities:

- Generate first-week onboarding briefs for an indexed repository.
- Ask session-aware follow-up questions after the onboarding brief.
- Persist onboarding sessions, messages, source files, and rolling conversation summaries in SQLite.
- Route queries through exact lookup, grep-like lexical search, hybrid retrieval, graph expansion, and onboarding-specific ranking.
- Return source lists and citation verification diagnostics with generated answers.
- Run as a Tauri desktop app that starts Sonar's local support services and API automatically.

Sonar is intended to produce strong source-grounded first drafts. It is not yet a replacement for human-reviewed technical, security, or compliance documentation.

## Architecture

- **parser/** — tree-sitter code parsing into symbols and imports
- **indexer/** — indexes parsed data into Meilisearch (keyword) and Qdrant (vector)
- **retriever/** — local exact search, grep-like lexical search, hybrid search, graph retrieval, onboarding retrieval, and reranking
- **context/** — expands search results with related symbols and packs context into a local-model-friendly token budget
- **generator/** — assembles prompts, calls the chat model, verifies citations, and repairs citation issues when possible
- **db/** — SQLite persistence for projects, code units, dependency edges, embeddings, onboarding sessions, and onboarding messages
- **api/** — Express HTTP server exposing indexing, querying, onboarding, session follow-up, graph, health, and stats endpoints

## Setup

Sonar has two supported run modes:

- **Desktop mode** for normal V1 use. The app starts retrieval and embedding services through Docker, lets the user configure generation from the UI, and supports both GitHub URLs and local folders.
- **API mode** for development and automation. You start the API and dependencies yourself and use environment variables.

API mode prerequisites:

- Node.js 22 or newer
- Meilisearch reachable at `SONAR_MEILI_HOST`
- Qdrant reachable at `SONAR_QDRANT_HOST:SONAR_QDRANT_PORT`
- Ollama reachable at `SONAR_OLLAMA_BASE_URL` with `SONAR_OLLAMA_EMBEDDING_MODEL` available
- A llama-server, vLLM, OpenAI, or other OpenAI-compatible generation endpoint at `SONAR_CHAT_BASE_URL`

The bundled Compose file can start the retrieval and embedding dependencies for API mode too:

```bash
docker compose -f docker-compose.sonar.yml up -d meilisearch qdrant ollama
docker compose -f docker-compose.sonar.yml exec ollama ollama pull nomic-embed-text
```

```bash
npm install
npm run build
npm start
```

## Desktop App

The V1 desktop app is the primary user experience. It starts Meilisearch, Qdrant, and Ollama embeddings through Docker Compose, starts the Sonar API locally, then lets the user analyze either a GitHub repository URL or an already-cloned local repository.

Desktop prerequisites:

- Docker Desktop or a compatible `docker compose` installation
- A local OpenAI-compatible chat model server, for example llama-server or vLLM, or a cloud-hosted OpenAI-compatible endpoint. The desktop app checks `SONAR_CHAT_BASE_URL`, then `http://localhost:8080/v1`, then `http://localhost:8000/v1`.
- Git installed locally if you want Sonar to clone GitHub repositories for you.
- Rust toolchain for development builds

Desktop first-run flow:

1. Open Sonar.
2. In **Model Settings**, choose a generation endpoint:
   - Local model server: `http://localhost:8080/v1` or another OpenAI-compatible local URL.
   - Cloud model endpoint: for example `https://api.openai.com/v1`.
3. Enter the model name and API key. Use `not-needed` for local servers with no auth.
4. Keep the default embedding model, `nomic-embed-text`, unless you know the replacement vector size is compatible with `SONAR_QDRANT_VECTOR_SIZE`.
5. Click **Save and restart API**.
6. Paste a GitHub repository URL or select a local folder, then click **Analyze repository**.
7. Generate the onboarding brief and ask follow-up questions.

Desktop-managed Docker services:

- Meilisearch on `http://localhost:7700` for BM25/keyword search.
- Qdrant on `localhost:6333` for vector search.
- Ollama on `http://localhost:11434` for embeddings. Sonar pulls the configured embedding model from the desktop app, defaulting to `nomic-embed-text`.

If compatible services are already running on those ports, Sonar uses them instead of starting duplicate containers.

Generation model configuration is done inside the desktop UI. Users can set:

- Generation API endpoint, such as `http://localhost:8080/v1` or `https://api.openai.com/v1`.
- Model name.
- API key, using `not-needed` for local servers that do not require one.
- Embedding model used by the Dockerized Ollama service.

These settings are stored locally under Sonar's data directory and applied by restarting Sonar's managed local API from the desktop app.

The generated desktop config is stored at:

```text
~/.sonar/desktop-config.json
```

Do not commit this file. It may contain API keys.

Desktop repository options:

- Paste a GitHub repository URL such as `https://github.com/excalidraw/excalidraw` and click Analyze. Sonar clones it into `~/.sonar/repositories` and indexes that local cache.
- Select an existing local repository with the native folder picker and click Analyze.

Run the desktop app in development:

```bash
npm install
npm run desktop:dev
```

Build a packaged desktop app:

```bash
npm run desktop:build
```

On macOS this creates `src-tauri/target/release/bundle/macos/Sonar.app`. `npm run desktop:bundle` also attempts installer bundles such as a DMG.

The desktop-managed API sets `SONAR_ALLOW_ANY_REPO_ROOT=true` because repository selection happens through the local native app. Do not use that setting for a browser-accessible API server.

Implementation plan and remaining launch tasks live in [`docs/desktop-v1-implementation-plan.md`](docs/desktop-v1-implementation-plan.md).

Useful environment variables:

Most desktop users should not need these. They are primarily for API mode, tests, and development. Desktop model settings are configured from the UI and stored in `~/.sonar/desktop-config.json`.

```bash
SONAR_CHAT_BASE_URL=http://localhost:8080/v1
SONAR_CHAT_MODEL=Qwen/Qwen3.5-9B
SONAR_CHAT_API_KEY=not-needed
SONAR_API_HOST=127.0.0.1
SONAR_CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3111,http://tauri.localhost,tauri://localhost
SONAR_API_TOKEN=
SONAR_EMBEDDING_PROVIDER=ollama
SONAR_OLLAMA_BASE_URL=http://localhost:11434
SONAR_OLLAMA_EMBEDDING_MODEL=nomic-embed-text
SONAR_MEILI_HOST=http://localhost:7700
SONAR_MEILI_API_KEY=masterKey
SONAR_QDRANT_HOST=localhost
SONAR_QDRANT_PORT=6333
SONAR_QDRANT_VECTOR_SIZE=768
SONAR_DATA_DIR=$HOME/.sonar
SONAR_DB_PATH=$HOME/.sonar/projects.db
SONAR_MAX_CONTEXT_TOKENS=5000
SONAR_MAX_RESPONSE_TOKENS=2000
SONAR_ALLOWED_REPO_ROOTS=/Users/you/code,/Users/you/work
SONAR_ALLOW_ANY_REPO_ROOT=false
```

By default Sonar binds to `127.0.0.1` and only indexes repositories under the process working directory. Set `SONAR_ALLOWED_REPO_ROOTS` to the explicit local roots you want Sonar to index. `SONAR_ALLOW_ANY_REPO_ROOT=true` restores the early-development behavior of accepting any local directory path and should not be used for a browser-accessible server.

If `SONAR_API_TOKEN` is set, every mutating request (`POST`, `DELETE`, `PUT`, `PATCH`) must include `X-Sonar-Token: <token>`. Browser callers must also use an origin listed in `SONAR_CORS_ALLOWED_ORIGINS`.

Health checks:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/health/dependencies
```

## Typical V1 Flow

Desktop flow:

1. Start the desktop app.
2. Configure the generation endpoint in **Model Settings**.
3. Paste a GitHub repository URL or select an existing local repository.
4. Click **Analyze repository**.
5. Generate a first-week onboarding brief.
6. Ask follow-up questions in the same session.

API flow:

1. Start Meilisearch, Qdrant, and Ollama embeddings, using Docker Compose or your own services.
2. Start Sonar API mode.
3. Ensure a generation endpoint is reachable at `SONAR_CHAT_BASE_URL`.
4. Index a local repository.
5. Create a persisted onboarding session.
6. Ask follow-up questions in that session.

Index a repository:

```bash
curl --json '{
  "repoRoot": "/Users/you/code/example-product",
  "name": "Example Product",
  "summarize": true
}' http://localhost:3001/projects/index
```

If `SONAR_API_TOKEN` is configured, add `-H 'X-Sonar-Token: <token>'` to mutating `curl` requests.

Create an onboarding session:

```bash
curl --json '{
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
curl --json '{
  "question": "How does collaboration and sharing work at a product level, and what should I ask engineering about it?"
}' http://localhost:3001/projects/<project-id>/onboarding/sessions/<session-id>/messages
```

## Development

```bash
npm run dev
```

Start local retrieval and embedding dependencies:

```bash
docker compose -f docker-compose.sonar.yml up -d meilisearch qdrant ollama
docker compose -f docker-compose.sonar.yml exec ollama ollama pull nomic-embed-text
```

Run the fast local checks:

```bash
npm run check
```

Desktop checks:

```bash
npm run typecheck:ui
npm run build:ui
cargo check --manifest-path src-tauri/Cargo.toml
```

Integration-style scripts that require external services are kept separate from `npm run check`.

## API Overview

Project endpoints:

- `POST /projects/index` — index a local repository; accepts `repoRoot`, optional `name`, and optional `summarize`.
- `GET /projects` — list indexed projects.
- `GET /projects/:id` — get project metadata.
- `DELETE /projects/:id` — delete a project and its indexed data.
- `POST /projects/:id/select` — select a project for backward-compatible `/query` calls.
- `POST /projects/:id/summarize` — regenerate and store the codebase summary.
- `GET /projects/:id/summary` — read the stored summary metadata.

Query and onboarding endpoints:

- `POST /query` — backward-compatible query endpoint using `projectId` or the selected project.
- `POST /projects/:id/query` — stateless source-grounded Q&A for a project.
- `POST /projects/:id/explain` — role-aware onboarding-style overview using the general query pipeline.
- `POST /projects/:id/onboarding` — generate a dedicated first-week onboarding brief without creating a session.
- `POST /projects/:id/onboarding/sessions` — generate a brief and persist an onboarding session.
- `GET /projects/:id/onboarding/sessions/:sessionId` — read a session and its messages.
- `POST /projects/:id/onboarding/sessions/:sessionId/messages` — ask a session-aware follow-up question.

Graph and health endpoints:

- `GET /projects/:id/graph` — file-level dependency graph.
- `GET /projects/:id/graph/directory` — directory-level dependency graph.
- `GET /health` — API health and current project status.
- `GET /health/dependencies` — SQLite, Meilisearch, Qdrant, Ollama, and chat endpoint status.
- `GET /stats` — current project index statistics.

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

## Onboarding Sessions

An onboarding session stores:

- The generated onboarding brief.
- The target audience and focus areas.
- The persona settings.
- The source files cited by the brief.
- User and assistant follow-up messages.
- A compact rolling conversation summary.

Follow-up questions use this session state to improve retrieval. Sonar boosts files already cited in the onboarding brief, classifies the follow-up intent, performs exact and lexical search for named files or concepts, uses vector retrieval when useful, and expands through the dependency graph for workflow questions.

Common follow-up shapes:

- "What does this term mean?"
- "How does this workflow work?"
- "Where is this implemented?"
- "What should I ask engineering?"
- "Explain this file or component."
- "Rewrite this for a PM, designer, or support lead."

The onboarding brief and prior messages are used for orientation. Concrete implementation claims should come from the retrieved source context.

## Routed Retrieval For Local Models

Sonar is optimized for medium local models running on a laptop. The query path avoids sending every question through embeddings and a large prompt.

Current routing:

- `exact`: file and symbol questions use local symbol/path lookup plus lexical search before any vector fallback.
- `literal`: errors, env vars, config keys, quoted strings, and debug questions use grep-like lexical search over indexed code units and skip vectors when matches are found.
- `hybrid`: general conceptual code questions use lexical retrieval plus Meilisearch/Qdrant reciprocal rank fusion.
- `graph_hybrid`: workflow, dependency, and risk questions use hybrid seeds plus graph expansion.
- `summary_graph`: architecture and onboarding questions include the stored codebase summary and pack a compact set of supporting code.

The context packer ranks snippets before prompting. It favors retrieval score, exact name/path matches, exported symbols, non-vendored code, and file diversity, then enforces the token budget. This is intentional: smaller local models answer better from less context when that context is precise.

The dedicated onboarding flow adds another retrieval pass that favors product documentation, app/package boundaries, entry points, collaboration/sharing files, local persistence files, and privacy or operational evidence. Follow-up retrieval pins smaller relevant units from previously cited onboarding files so the session stays grounded in the material the user already saw.

## Citation And Quality Notes

Sonar asks the model to cite concrete claims in `[file:start-end]` form and runs a citation verifier on the generated answer. When the verifier finds problems, Sonar can run a repair prompt and keep the repaired answer if it improves citation quality.

Known V1 limitation: medium local models may still produce uncited introductory or summary sentences even when the core source claims are cited. Treat cited claims as the reliable parts of the answer and treat uncited summary language as guidance to verify.

Recommended next work:

- Store project, directory, file, and workflow summaries as first-class retrieval records in SQLite, Meilisearch, and Qdrant.
- Replace full-function embedding with structured embeddings: signature, docstring, imports, exports, and a short body preview; chunk large bodies separately.
- Move dependency extraction from the API server into `src/graph/` and store typed edges such as `imports_file`, `calls_symbol`, `exports_symbol`, and `defined_in_file`.
- Add an optional ripgrep backend for raw repository text and stack traces when `rg` is available, with the current indexed lexical search as the portable fallback.
- Add stricter post-generation citation enforcement that rewrites or removes uncited claims without another full model pass.
- Return richer retrieval traces in API responses, including route, scores, omitted files, and why each source was packed.
