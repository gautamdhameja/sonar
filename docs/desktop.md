# Desktop App

The Sonar desktop app lets you analyze either a GitHub repository URL or an already-cloned local repository.

Sonar is built for high-level codebase briefings. It helps non-technical and semi-technical teammates understand the project, workflows, risks, and source landmarks using a local or OpenAI-compatible model. It is not designed to replace a frontier coding agent for debugging, refactoring, or fine-grained implementation analysis.

## Prerequisites

- Docker Desktop
- Git installed locally if you want Sonar to clone GitHub repositories for you

## First-Run Flow

1. Open Sonar.
2. On first launch, choose **Local Docker model** or **API endpoint**.
3. Let the app start the local Docker services.
4. Paste a GitHub repository URL or select a local folder.
5. Create a codebase briefing. Sonar inventories the repository, surveys selected files into a memory graph, and writes a cited briefing from that map.
6. Ask follow-up questions in the same session.
7. Copy or export the briefing as Markdown if you want to share it.

## Local Services

- Meilisearch on `http://localhost:7700` for BM25 and keyword search.
- Sonar API on `http://localhost:3001`.

To use local generation, choose **Local Docker model**. To use cloud generation or a separately hosted OpenAI-compatible local model, choose **API endpoint**.

If the model server runs on the host machine and the API runs in Docker, the desktop app translates `localhost` and `127.0.0.1` model endpoints to `host.docker.internal` for the API container. Keep the URL shown in the UI as the normal desktop URL.

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

## Language Coverage Warning

When Sonar indexes a repository, it scans for common source file extensions outside the supported parser set. If it finds unsupported languages, the desktop app shows a warning with file counts. You can still create the briefing, and the survey may use lightweight signals from those files, but unsupported source files are not fully parsed into the code index.

Supported code parsers today cover TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, and C#. Markdown and MDX are indexed as documentation.
