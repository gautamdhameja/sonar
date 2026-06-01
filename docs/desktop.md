# Desktop App

The V1 desktop app is the primary user experience. In Docker-first mode, Compose owns Sonar API, retrieval services, and model serving. The desktop shell is the native UI that talks to the local API and lets the user analyze either a GitHub repository URL or an already-cloned local repository.

## Prerequisites

- Docker Desktop with Docker Model Runner enabled
- Git installed locally if you want Sonar to clone GitHub repositories for you
- Rust toolchain for development builds

## First-Run Flow

1. Open Sonar.
2. Let the app start the local Docker services.
3. Paste a GitHub repository URL or select a local folder.
4. Create a codebase briefing.
5. Ask follow-up questions in the same session.
6. Copy or export the briefing as Markdown if you want to share it.

## Docker-Managed Services

- Meilisearch on `http://localhost:7700` for BM25 and keyword search.
- Qdrant on `localhost:6333` for vector search.
- Docker Model Runner for chat generation through an OpenAI-compatible API.
- Docker Model Runner for embeddings through an OpenAI-compatible embeddings API.

The default Docker-first stack is intentionally local and self-contained. To use cloud generation or a separately hosted local model, run API mode and override endpoint environment variables instead of the default Compose model bindings.

When the desktop app starts Docker services, it creates `.sonar/runtime.env` and uses that generated local runtime token for both the app and Compose. If a stale Docker stack is running with a different token, the app recreates the Compose containers while preserving named volumes.

If you start services manually for backend debugging, use the service script instead of raw Compose:

```bash
npm run services:start
```

For shared machines or any custom network exposure, set your own token with `SONAR_API_TOKEN` before running the service script or starting the desktop app.

## Desktop Configuration

The desktop config is stored at:

```text
~/.sonar/desktop-config.json
```

Do not commit this file. It may contain API keys.

The Docker runtime env is stored at:

```text
.sonar/runtime.env
```

This file is generated locally and ignored by git.

## Repository Options

- Paste a GitHub repository URL. Sonar clones it locally, imports that selected repository into Docker's internal Sonar repository volume, and indexes the imported copy.
- Select an existing local repository with the native folder picker. Only that selected repository is copied into Docker's internal Sonar repository volume.

## Development Commands

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
