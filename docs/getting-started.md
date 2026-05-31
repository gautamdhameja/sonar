# Getting Started

Sonar has three supported run modes:

- **Docker-first mode** for normal V1 use. Docker Compose starts Sonar API, Meilisearch, Qdrant, and Docker Model Runner models for both generation and embeddings.
- **Desktop mode** for the native V1 UI. The Tauri shell connects to the local Sonar API on `http://127.0.0.1:3001` and supports both GitHub URLs and local folders.
- **API mode** for development and automation. You start the API and dependencies yourself and use environment variables.

## Docker-First Mode

Prerequisites:

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

The first run downloads model artifacts and can take a while. After the runtime is up, open the native app with `npm run desktop:dev` during development or launch the packaged Sonar app. The app uses the Compose-managed API on `http://127.0.0.1:3001`.

## Privacy Boundary

The Docker-first stack does not mount your home directory. Docker can only see repositories imported into Sonar's internal `/workspace/repos` volume. When you select a local folder in the desktop UI, Sonar copies that selected repository into the volume and indexes the copied path.

## API Mode

API mode prerequisites:

- Node.js 22.x, 23.x, 24.x, or 25.x
- Meilisearch reachable at `SONAR_MEILI_HOST`
- Qdrant reachable at `SONAR_QDRANT_HOST:SONAR_QDRANT_PORT`
- An OpenAI-compatible embedding endpoint, native Ollama embedding endpoint, or another supported embedding provider
- A llama-server, vLLM, OpenAI, or other OpenAI-compatible generation endpoint at `SONAR_CHAT_BASE_URL`

Most desktop users should not need an env file. Desktop model settings are configured from the UI and stored in `~/.sonar/desktop-config.json`. For API mode, start with endpoint overrides only:

```bash
SONAR_CHAT_BASE_URL=http://localhost:8080/v1
SONAR_EMBEDDING_BASE_URL=http://localhost:12434/engines/v1
SONAR_MEILI_HOST=http://localhost:7700
SONAR_QDRANT_HOST=localhost
SONAR_QDRANT_PORT=6333
```

Everything else has a code default for local development. Advanced settings such as model name, API key, storage paths, token budgets, allowed repository roots, CORS origins, and API tokens are still supported by the API, but they are intentionally omitted from `.env.example` to keep the default setup understandable.

The infra-only Compose file can start just the retrieval dependencies for API mode. Use this when you want to run the API with your own generation and embedding endpoints:

```bash
docker compose -f docker-compose.sonar.yml up -d meilisearch qdrant
```

Start the API:

```bash
npm install
npm run build
npm start
```

## Health Checks

```bash
curl http://localhost:3001/health
curl http://localhost:3001/health/dependencies
```
