# Desktop App

The Sonar desktop app lets you analyze either a GitHub repository URL or an already-cloned local repository.

Sonar is built for high-level codebase briefings. It helps non-technical and semi-technical teammates understand the project, workflows, risks, and source landmarks using a local or OpenAI-compatible model. It is not designed to replace a frontier coding agent for debugging, refactoring, or fine-grained implementation analysis.

## Prerequisites

- Git installed locally if you want Sonar to clone GitHub repositories for you
- Node.js 22.x, 23.x, 24.x, or 25.x when running from source
- A local OpenAI-compatible model server or an OpenAI-compatible API endpoint

## First-Run Flow

1. Open Sonar.
2. On first launch, choose **Local llama.cpp** or **API endpoint**.
3. Let the app start the local Sonar API.
4. Paste a GitHub repository URL or select a local folder.
5. Create a codebase briefing. Sonar inventories the repository, surveys selected files into a memory graph, and writes a cited briefing from that map.
6. Ask follow-up questions in the same session.
7. Copy or export the briefing as Markdown if you want to share it.

## Local Runtime

- Sonar API on `http://127.0.0.1:3001`.
- SQLite project data under `~/.sonar`.

When running from source, the desktop shell starts the API through `npm run dev`. A packaged build can provide a native API sidecar at `~/.sonar/bin/sonar-api` or through `SONAR_API_SERVER_PATH`.

To use local generation, choose **Local llama.cpp** and configure the local OpenAI-compatible endpoint. The default is `http://127.0.0.1:8080/v1`; if you use a different port or local runtime, update the endpoint during setup. To use cloud generation or another hosted model, choose **API endpoint**.

## Desktop Configuration

The desktop config is stored at:

```text
~/.sonar/desktop-config.json
```

Do not commit this file. It may contain API keys.

The local runtime token is stored at:

```text
~/.sonar/runtime.env
```

This file is generated locally and ignored by git.

## Repository Options

- Paste a GitHub repository URL. Sonar clones it into `~/.sonar/repositories` and indexes that clone.
- Select an existing local repository with the native folder picker. Sonar indexes the selected path directly.

## Language Coverage Warning

When Sonar indexes a repository, it scans for common source file extensions outside the supported parser set. If it finds unsupported languages, the desktop app shows a warning with file counts. You can still create the briefing, and the survey may use lightweight signals from those files, but unsupported source files are not fully parsed into the code index.

Supported code parsers today cover TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, and C#. Markdown and MDX are indexed as documentation.

## Release Build

Build and verify a local macOS app bundle:

```bash
npm run release:mac
```

By default this applies an ad-hoc signature so `codesign --verify --deep --strict` passes on the local machine. For public macOS distribution, sign with an Apple Developer ID Application certificate:

```bash
SONAR_MAC_SIGN_IDENTITY="Developer ID Application: Your Team Name (TEAMID)" npm run release:mac
```

After Developer ID signing, notarize and staple the app or installer using your Apple Developer account before distributing it outside your own machine.
