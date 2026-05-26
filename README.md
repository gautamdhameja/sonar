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

- **Docker-first mode** for normal V1 use. Docker Compose starts Sonar API, Meilisearch, Qdrant, and Docker Model Runner models for both generation and embeddings.
- **Desktop mode** for the native V1 UI. The Tauri shell connects to the local Sonar API on `http://127.0.0.1:3001` and supports both GitHub URLs and local folders.
- **API mode** for development and automation. You start the API and dependencies yourself and use environment variables.

Docker-first prerequisites:

- Docker Desktop with Docker Model Runner enabled
- Docker Compose 2.38 or newer
- Git installed locally if you want the desktop app to clone GitHub repositories for you

Start the full local runtime:

```bash
docker compose up -d
```

This starts:

- Sonar API on `http://localhost:3001`
- Meilisearch on `http://localhost:7700`
- Qdrant on `localhost:6333`
- A Docker Model Runner chat model, defaulting to `hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL`
- A Docker Model Runner embedding model, defaulting to `hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M`

The first run downloads the model artifacts and can take a while. After the runtime is up, open the native app with `npm run desktop:dev` during development or launch the packaged Sonar app. The app uses the Compose-managed API on `http://127.0.0.1:3001`.

The Docker-first stack does not mount your home directory. Docker can only see repositories imported into Sonar's internal `/workspace/repos` volume. When you select a local folder in the desktop UI, Sonar copies that selected repository into the volume and indexes the copied path.

API mode prerequisites:

- Node.js 22 or newer
- Meilisearch reachable at `SONAR_MEILI_HOST`
- Qdrant reachable at `SONAR_QDRANT_HOST:SONAR_QDRANT_PORT`
- An Ollama or OpenAI-compatible embedding endpoint
- A llama-server, vLLM, OpenAI, or other OpenAI-compatible generation endpoint at `SONAR_CHAT_BASE_URL`

The legacy Compose file can start only retrieval dependencies plus Ollama embeddings for API mode:

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

The V1 desktop app is the primary user experience. In Docker-first mode, Compose owns Sonar API, retrieval services, and model serving. The desktop shell is the native UI that talks to the local API and lets the user analyze either a GitHub repository URL or an already-cloned local repository.

Desktop prerequisites:

- Docker Desktop with Docker Model Runner enabled
- Git installed locally if you want Sonar to clone GitHub repositories for you.
- Rust toolchain for development builds

Desktop first-run flow:

1. Run `docker compose up -d`.
2. Open Sonar.
3. Paste a GitHub repository URL or select a local folder, then click **Analyze repository**.
4. Generate the onboarding brief and ask follow-up questions.

Docker-managed services:

- Meilisearch on `http://localhost:7700` for BM25/keyword search.
- Qdrant on `localhost:6333` for vector search.
- Docker Model Runner for chat generation through an OpenAI-compatible API.
- Docker Model Runner for embeddings through an OpenAI-compatible embeddings API.

The default Docker-first stack is intentionally local and self-contained. To use cloud generation or a separately hosted local model, run API mode and override the endpoint environment variables instead of the default Compose model bindings.

The generated desktop config is stored at:

```text
~/.sonar/desktop-config.json
```

Do not commit this file. It may contain API keys.

Desktop repository options:

- Paste a GitHub repository URL such as `https://github.com/excalidraw/excalidraw` and click Analyze. Sonar clones it locally, imports that selected repository into Docker's internal Sonar repository volume, and indexes the imported copy.
- Select an existing local repository with the native folder picker and click Analyze. Only that selected repository is copied into Docker's internal Sonar repository volume.

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

The desktop-managed API allows repositories selected through the local native app. Do not expose the managed API to a browser-accessible network.

API-mode endpoint overrides:

Most desktop users should not need an env file. Desktop model settings are configured from the UI and stored in `~/.sonar/desktop-config.json`. For API mode, start with endpoint overrides only:

```bash
SONAR_CHAT_BASE_URL=http://localhost:8080/v1
SONAR_EMBEDDING_BASE_URL=http://localhost:12434/engines/v1
SONAR_MEILI_HOST=http://localhost:7700
SONAR_QDRANT_HOST=localhost
SONAR_QDRANT_PORT=6333
```

Everything else has a code default for local development. Advanced settings such as model name, API key, storage paths, token budgets, allowed repository roots, CORS origins, and API tokens are still supported by the API, but they are intentionally omitted from `.env.example` to keep the default setup understandable.

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

Formatting and linting:

```bash
npm run format
npm run format:check
npm run lint
```

`npm run format` applies Biome formatting to TypeScript, React, CSS, JSON, and HTML files, then runs Rustfmt on the Tauri shell. `npm run lint` runs Biome linting and Rust Clippy.

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
