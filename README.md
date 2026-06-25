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

Sonar currently indexes TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, C#, Ruby, C++, PHP, Kotlin, Swift,
Markdown/MDX, plus selected JSON and Prisma schema files as text evidence. The repository survey also scans common
source extensions for high-level signals such as entry points, file IO, network boundaries, config, logging, and state.
Repositories that mainly use unsupported source languages can still be imported, but briefings may be less complete
because full parser coverage is not available for those files.

See [Language Support and Limits](docs/language-support.md) for the current parser coverage and known limitations.

## Quick Start

Sonar is currently distributed as a source-built desktop app. The expected local setup is:

- Node.js 22.x, 23.x, 24.x, or 25.x. Do not use Node 26+ for source builds.
- Rust toolchain and platform dependencies for Tauri
- Git, if you want Sonar to clone GitHub repositories
- A local OpenAI-compatible model server, or an OpenAI-compatible API endpoint you explicitly configure

Clone the repository and install dependencies:

```bash
git clone https://github.com/gautamdhameja/sonar.git
cd sonar
nvm use 24
npm install
```

If you previously installed dependencies with a different Node major version, run `npm install` again after switching
Node versions. Native dependencies such as SQLite are compiled for the active Node runtime.

Start a model server separately. For local mode, Sonar expects an OpenAI-compatible endpoint such as llama.cpp
`llama-server` on `http://127.0.0.1:8080/v1`, and the endpoint must respond to `/models`.

Build the production desktop app:

```bash
npm run desktop:build
```

On macOS, open the built app:

```bash
open src-tauri/target/release/bundle/macos/Sonar.app
```

On first launch, Sonar starts its local workspace engine, asks whether you want a local model endpoint or an
OpenAI-compatible API endpoint, and stores project data in embedded SQLite under `~/.sonar`. It does not require
Meilisearch or any other external database/search service.

This source-built alpha still uses the checked-out repository to run the local workspace engine, so keep the checkout and
`node_modules` in place after building. `npm run desktop:dev` is for contributors who need the hot-reload development
shell, not for normal local use.

For detailed setup steps, see [Setup from Source](docs/setup.md).

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
- [Setup from Source](docs/setup.md)
- [Desktop App](docs/desktop.md)
- [Language Support and Limits](docs/language-support.md)

For a local macOS release build, run `npm run release:mac`. Public macOS distribution still requires Apple Developer ID signing and notarization.

Release notes live in [CHANGELOG.md](CHANGELOG.md).
