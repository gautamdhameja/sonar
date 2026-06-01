# Desktop App

The Sonar desktop app lets you analyze either a GitHub repository URL or an already-cloned local repository.

## Prerequisites

- Docker Desktop
- Git installed locally if you want Sonar to clone GitHub repositories for you

## First-Run Flow

1. Open Sonar.
2. On first launch, choose **Local Docker model** or **API endpoint**.
3. Let the app start the local Docker services.
4. Paste a GitHub repository URL or select a local folder.
5. Create a codebase briefing.
6. Ask follow-up questions in the same session.
7. Copy or export the briefing as Markdown if you want to share it.

## Local Services

- Meilisearch on `http://localhost:7700` for BM25 and keyword search.
- Qdrant on `localhost:6333` for vector search.
- Sonar API on `http://localhost:3001`.

To use local generation and embeddings, choose **Local Docker model**. To use cloud generation, cloud embeddings, or a separately hosted OpenAI-compatible local model, choose **API endpoint**.

If the model server runs on the host machine and the API runs in Docker, the desktop app translates `localhost` and `127.0.0.1` model endpoints to `host.docker.internal` for the API container. Keep the URL shown in the UI as the normal desktop URL.

Embedding vector size matters. Use `768` for Sonar's default Docker embedding model. Use `1536` for OpenAI `text-embedding-3-small` unless your compatible endpoint is configured to return another dimension.

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

- Paste a GitHub repository URL. Sonar clones it locally, imports that selected repository into Docker's private Sonar repository volume, and indexes the imported copy.
- Select an existing local repository with the native folder picker. Only that selected repository is copied into Docker's private Sonar repository volume.
