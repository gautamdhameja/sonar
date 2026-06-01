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

Sonar is intended to produce strong source-grounded first drafts. It is not a replacement for human-reviewed technical or compliance documentation.

## Language Support

Sonar currently indexes TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, C#, and Markdown/MDX. Repositories that mainly use other source languages can still be imported, but unsupported source files are skipped from code indexing. In those cases, briefings may be incomplete or more dependent on README and documentation files.

See [Language Support and Limits](docs/language-support.md) for the current parser coverage and known limitations.

## Quick Start

Prerequisites for running from source:

- Docker Desktop
- Docker Compose 2.38 or newer
- Node.js 22.x, 23.x, 24.x, or 25.x
- Git, if you want Sonar to clone GitHub repositories

Install dependencies and run the desktop app:

```bash
npm install
npm run desktop:dev
```

On first launch, Sonar starts the local indexing services and asks whether you want to use a local Docker model or an OpenAI-compatible API endpoint. Then paste a GitHub repository URL or select a local repository folder and create a briefing.

## Local Privacy Boundary

The Docker-first stack does not mount your home directory. Docker only sees repositories imported into Sonar's private `/workspace/repos` volume. When you select a local folder in the desktop UI, Sonar copies that selected repository into the private volume and indexes the copy.

Desktop model settings are stored locally at:

```text
~/.sonar/desktop-config.json
```

Do not commit this file. It may contain API keys.

## Documentation

Detailed documentation lives in [docs/](docs/README.md).

- [Getting Started](docs/getting-started.md)
- [Desktop App](docs/desktop.md)
- [Language Support and Limits](docs/language-support.md)

Release notes live in [CHANGELOG.md](CHANGELOG.md).
