# Getting Started

Sonar runs as a desktop app backed by a local API and embedded SQLite project store. The app starts the local API for you;
you provide the model endpoint separately.

The product goal is simple: create a useful, cited briefing from a repository using a local or modest model. Sonar first builds a repository inventory, surveys selected source files into a small memory graph, and then writes the briefing from that map plus source excerpts. It is best for high-level project understanding: what the project does, who it serves, the main workflows, important systems, risks, and questions to ask the team. It is not meant to replace deep code review, debugging, refactoring, or implementation work.

Prerequisites:

- Git, if you want Sonar to clone GitHub repositories for you
- Node.js 22.x, 23.x, 24.x, or 25.x when running from source. Do not use Node 26+.
- Rust toolchain and platform dependencies for Tauri
- A local OpenAI-compatible model server, or an OpenAI-compatible API endpoint

Clone the repository and install dependencies:

```bash
git clone https://github.com/gautamdhameja/sonar.git
cd sonar
nvm use 24
npm install
```

Use the same supported Node version when installing, building, and running checks. If you change Node versions, rerun
`npm install` so native dependencies are rebuilt for that runtime.

Start your model server separately. For the default local setup, Sonar expects an OpenAI-compatible endpoint at
`http://127.0.0.1:8080/v1` that responds to `/models`.

Then build the production desktop app:

```bash
npm run desktop:build
```

On macOS, open the built app:

```bash
open src-tauri/target/release/bundle/macos/Sonar.app
```

On first launch, Sonar asks you to choose a model source:

- **Local llama.cpp** uses a local OpenAI-compatible generation server on your machine. The default endpoint is `http://127.0.0.1:8080/v1`, and you can edit it during setup.
- **API endpoint** uses your configured OpenAI-compatible cloud or self-hosted generation endpoint.

After you save the model source, future launches use the saved choice automatically.

The local runtime is:

- Sonar API on `http://127.0.0.1:3001`
- SQLite project store under `~/.sonar`

Sonar does not require Meilisearch or another external database/search service.

If you choose **Local llama.cpp**, Sonar expects:

- an OpenAI-compatible local model server at the endpoint configured in the app, or
- for the default endpoint, a future packaged sidecar binary at `~/.sonar/bin/llama-server` and a model at `~/.sonar/models/default.gguf`

This source-built alpha still uses the checkout to start the local workspace engine, so keep the cloned repository and
`node_modules` in place after building. `npm run desktop:dev` is only for contributors working on Sonar itself.

For local source builds, you can also point Sonar at a local sidecar binary and model with:

```bash
SONAR_LLAMA_SERVER_PATH=/path/to/llama-server
SONAR_LLAMA_MODEL_PATH=/path/to/model.gguf
```

The configured model endpoint must respond to the OpenAI-compatible `/models` check.

See [Setup from Source](setup.md) for a complete step-by-step guide and troubleshooting.

If you choose **API endpoint**, configure:

- Generation API endpoint, model, and API key

After setup, paste a GitHub repository URL or select a local repository folder, choose the closest briefing audience, then create a briefing.

## Supported Repositories

Sonar has full parser coverage for repositories written in TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, C#, Ruby, C++, PHP, Kotlin, and Swift. Markdown and MDX files are indexed as documentation, along with selected JSON and Prisma schema files as text evidence.

If a repository contains other source languages, Sonar shows a warning after indexing with the unsupported language names and file counts. Unsupported source files can still contribute inventory-level signals, but they are not fully parsed into code units. The generated briefing may be incomplete when those languages contain the central product logic.

## Privacy Boundary

Sonar indexes only the GitHub clone or local folder you explicitly choose in the desktop UI. It does not mount your home directory into a container because there is no container runtime in the default flow.

The desktop app starts a localhost API protected by a per-install token stored under `~/.sonar/runtime.env`. The desktop-managed API accepts selected local paths so the folder picker can analyze repositories outside the app cache. If you choose API endpoint mode, source excerpts required for generation are sent to that configured provider.
