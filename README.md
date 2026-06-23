# Sonar

Understand any codebase. Ask what matters.

Sonar creates local-first, source-grounded codebase briefings for people who need project context without a subscription to a frontier coding model. It helps product managers, founders, designers, support leads, operators, executives, and technical teammates understand what a repository does, where important workflows live, and what to ask next.

Sonar is optimized for high-level orientation. For fine-grained debugging, refactoring, line-by-line code explanation, or implementation work, use an engineer or a frontier coding tool with full repository context.

## What Sonar Does

- Generates source-grounded briefings for an indexed repository.
- Supports session-aware follow-up questions for orientation, risks, workflows, systems, and source navigation.
- Builds a deterministic repository inventory, asks the model to inspect selected source files, and stores a source-backed memory graph before writing the initial briefing.
- Uses exact lookup, grep-like lexical search, graph expansion, workflow planning, and briefing-specific ranking for follow-up questions and source lookup.
- Returns source lists and citation verification diagnostics with generated answers.
- Persists projects, source files, generated memory graphs, briefing sessions, and generated briefings in SQLite.
- Runs as a Tauri desktop app backed by a local workspace engine and embedded SQLite project store.
- Supports local llama.cpp/OpenAI-compatible generation or custom OpenAI-compatible cloud/local model endpoints.
- Lets users copy or export generated briefings as Markdown.

Sonar is intended to produce strong source-grounded briefing drafts, especially with local models. It is not a replacement for human-reviewed technical, compliance, security, or architecture documentation.

## Language Support

Sonar currently indexes TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, C#, Markdown/MDX, plus selected JSON and Prisma schema files as text evidence. The repository survey also scans common source extensions for high-level signals such as entry points, file IO, network boundaries, config, logging, and state. Repositories that mainly use unsupported source languages can still be imported, but briefings may be less complete because full parser coverage is not available for those files.

See [Language Support and Limits](docs/language-support.md) for the current parser coverage and known limitations.

## Quick Start

Prerequisites for running from source:

- Node.js 22.x, 23.x, 24.x, or 25.x
- Git, if you want Sonar to clone GitHub repositories
- A local OpenAI-compatible model server, or an OpenAI-compatible API endpoint

Install dependencies and run the desktop app:

```bash
npm install
npm run desktop:dev
```

On first launch, Sonar starts its local workspace engine and asks whether you want to use a local model endpoint or an OpenAI-compatible API endpoint. The default local endpoint is `http://127.0.0.1:8080/v1`, but you can change it in the setup screen. Then paste a GitHub repository URL or select a local repository folder and create a briefing.

## Local Privacy Boundary

Sonar indexes only the GitHub clone or local folder you explicitly select in the desktop UI. Project state, generated briefings, memory graphs, and runtime settings are stored locally under `~/.sonar`.

Desktop model settings are stored locally at:

```text
~/.sonar/desktop-config.json
```

Do not commit this file. It may contain API keys.

If you use API endpoint mode, source excerpts needed for generation are sent to the configured model provider. If you use a local model endpoint, repository analysis stays on your machine.

## Documentation

Detailed documentation lives in [docs/](docs/README.md).

- [Getting Started](docs/getting-started.md)
- [Desktop App](docs/desktop.md)
- [Language Support and Limits](docs/language-support.md)

For a local macOS release build, run `npm run release:mac`. Public macOS distribution still requires Apple Developer ID signing and notarization.

Release notes live in [CHANGELOG.md](CHANGELOG.md).
