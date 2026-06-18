# Getting Started

Sonar runs as a desktop app backed by a local API and embedded SQLite project store. The app starts the local API for you.

The product goal is simple: create a useful, cited briefing from a repository using a local or modest model. Sonar first builds a repository inventory, surveys selected source files into a small memory graph, and then writes the briefing from that map plus source excerpts. It is best for high-level project understanding: what the project does, who it serves, the main workflows, important systems, risks, and questions to ask the team. It is not meant to replace deep code review, debugging, refactoring, or implementation work.

Prerequisites:

- Git, if you want Sonar to clone GitHub repositories for you
- Node.js 22.x, 23.x, 24.x, or 25.x when running from source
- A local OpenAI-compatible model server, or an OpenAI-compatible API endpoint

Start the desktop app:

```bash
npm install
npm run desktop:dev
```

On first launch, Sonar asks you to choose a model source:

- **Local llama.cpp** uses a local OpenAI-compatible generation server on your machine. The default endpoint is `http://127.0.0.1:8080/v1`, and you can edit it during setup.
- **API endpoint** uses your configured OpenAI-compatible cloud or self-hosted generation endpoint.

After you save the model source, future launches use the saved choice automatically.

The local runtime is:

- Sonar API on `http://127.0.0.1:3001`
- SQLite project store under `~/.sonar`

If you choose **Local llama.cpp**, Sonar expects:

- an OpenAI-compatible local model server at the endpoint configured in the app, or
- for the default endpoint, a future packaged sidecar binary at `~/.sonar/bin/llama-server` and a model at `~/.sonar/models/default.gguf`

If you choose **API endpoint**, configure:

- Generation API endpoint, model, and API key

After setup, paste a GitHub repository URL or select a local repository folder, choose the closest briefing audience, then create a briefing.

## Supported Repositories

Sonar has the best code coverage for repositories written in TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, and C#. Markdown and MDX files are indexed as documentation.

If a repository contains other source languages, Sonar shows a warning after indexing with the unsupported language names and file counts. Unsupported source files can still contribute inventory-level signals, but they are not fully parsed into code units. The generated briefing may be incomplete when those languages contain the central product logic.

## Privacy Boundary

Sonar indexes only the GitHub clone or local folder you explicitly choose in the desktop UI. It does not mount your home directory into a container because there is no container runtime in the default flow.
