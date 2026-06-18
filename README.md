# Sonar

Understand any codebase. Ask what matters.

Sonar creates local-first, source-grounded codebase briefings for people who need project context without a subscription to a frontier coding model. It helps product managers, founders, designers, support leads, operators, executives, and technical teammates understand what a repository does, where important workflows live, and what to ask next.

Sonar is optimized for high-level orientation. For fine-grained debugging, refactoring, line-by-line code explanation, or implementation work, use an engineer or a frontier coding tool with full repository context.

## What Sonar Does

- Generates source-grounded briefings for an indexed repository.
- Supports session-aware follow-up questions for orientation, risks, workflows, systems, and source navigation.
- Builds a deterministic repository inventory, asks the model to inspect selected source files, and stores a source-backed memory graph before writing the initial briefing.
- Uses exact lookup, grep-like lexical search, BM25, graph expansion, workflow planning, and briefing-specific ranking for follow-up questions and source lookup.
- Returns source lists and citation verification diagnostics with generated answers.
- Persists projects, sessions, source files, generated memory graphs, and rolling conversation summaries in SQLite.
- Runs as a Tauri desktop app backed by a local HTTP API.
- Supports Docker Model Runner defaults or custom OpenAI-compatible cloud/local model endpoints.
- Lets users copy or export generated briefings as Markdown.

Sonar is intended to produce strong source-grounded briefing drafts, especially with local models. It is not a replacement for human-reviewed technical, compliance, security, or architecture documentation.

## Language Support

Sonar currently indexes TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, C#, Markdown/MDX, plus selected JSON and Prisma schema files as text evidence. The repository survey also scans common source extensions for high-level signals such as entry points, file IO, network boundaries, config, logging, and state. Repositories that mainly use unsupported source languages can still be imported, but briefings may be less complete because full parser coverage is not available for those files.

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
