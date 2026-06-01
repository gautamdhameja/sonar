# Sonar

Understand any codebase. Ask what matters.

Sonar indexes a repository, retrieves the most relevant code and docs, and asks a local or OpenAI-compatible model to generate source-grounded briefings and follow-up answers. It helps product managers, designers, support leads, engineers, and other teammates understand what a codebase does, where important workflows live, and what to ask next.

## What Sonar Does

- Generates source-grounded briefings for an indexed repository.
- Supports session-aware follow-up questions after the initial briefing.
- Uses exact lookup, grep-like lexical search, BM25, vector retrieval, graph expansion, and briefing-specific ranking.
- Returns source lists and citation verification diagnostics with generated answers.
- Persists projects, sessions, messages, source files, and rolling conversation summaries in SQLite.
- Runs as a Tauri desktop app backed by a local HTTP API.
- Supports Docker Model Runner defaults or custom OpenAI-compatible cloud/local model endpoints.
- Lets users copy or export generated briefings as Markdown.

Sonar is intended to produce strong source-grounded first drafts. It is not a replacement for human-reviewed technical, security, or compliance documentation.

## Quick Start

Prerequisites:

- Docker Desktop with Docker Model Runner enabled
- Docker Compose 2.38 or newer
- Node.js 22.x, 23.x, 24.x, or 25.x
- Git, if you want Sonar to clone GitHub repositories from the desktop app
- Rust toolchain, if you are running or packaging the Tauri app locally

Install dependencies and run the desktop app in development:

```bash
npm install
npm run desktop:dev
```

The desktop app starts and repairs the local Docker services. This is the recommended V1 path; do not start Compose separately unless you are debugging the backend.

For backend debugging, use the service script instead of raw Compose. It creates `.sonar/runtime.env`, then starts Docker with the same token the desktop app reads:

```bash
npm run services:start
```

For shared machines or any custom network exposure, set your own token with `SONAR_API_TOKEN` before running the service script or starting the desktop app.

Then paste a GitHub repository URL or select a local repository folder in the desktop UI and create a briefing.

## Local Privacy Boundary

The Docker-first stack does not mount your home directory. Docker only sees repositories imported into Sonar's internal `/workspace/repos` volume. When you select a local folder in the desktop UI, Sonar copies that selected repository into the internal volume and indexes the copy.

Desktop model settings are stored locally at:

```text
~/.sonar/desktop-config.json
```

Do not commit this file. It may contain API keys.

## Documentation

Detailed documentation lives in [docs/](docs/README.md).

- [Getting Started](docs/getting-started.md)
- [Desktop App](docs/desktop.md)
- [API Reference](docs/api.md)
- [Retrieval And Quality](docs/retrieval.md)
- [Development](docs/development.md)
- [Launch Checklist](docs/launch-checklist.md)

Release notes live in [CHANGELOG.md](CHANGELOG.md).

The docs directory is structured as a small mdBook-style book with [docs/SUMMARY.md](docs/SUMMARY.md).

## Development Checks

Run the full local check suite:

```bash
npm run check
```

Useful focused checks:

```bash
npm run typecheck:ui
npm run build:ui
cargo check --manifest-path src-tauri/Cargo.toml
```

Formatting and linting:

```bash
npm run format
npm run format:check
npm run lint
```
