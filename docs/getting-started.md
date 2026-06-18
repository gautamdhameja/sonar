# Getting Started

Sonar runs as a desktop app backed by local indexing services. The app manages those services for you.

The product goal is simple: create a useful, cited briefing from a repository using a local or modest model. Sonar first builds a repository inventory, surveys selected source files into a small memory graph, and then writes the briefing from that map plus source excerpts. It is best for high-level project understanding: what the project does, who it serves, the main workflows, important systems, risks, and questions to ask the team. It is not meant to replace deep code review, debugging, refactoring, or implementation work.

Prerequisites:

- Docker Desktop
- Docker Compose 2.38 or newer
- Git, if you want Sonar to clone GitHub repositories for you

Start the desktop app:

```bash
npm install
npm run desktop:dev
```

On first launch, Sonar asks you to choose a model source:

- **Local Docker model** starts Docker Model Runner for generation.
- **API endpoint** uses your configured OpenAI-compatible cloud or self-hosted generation endpoint.

After you save the model source, future launches use the saved choice automatically.

The local services are:

- Sonar API on `http://localhost:3001`
- Meilisearch on `http://localhost:7700`

If you choose **Local Docker model**, Docker Model Runner also starts:

- a chat model, defaulting to `hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL`

If you choose **API endpoint**, configure:

- Generation API endpoint, model, and API key

After setup, paste a GitHub repository URL or select a local repository folder, choose the closest briefing audience, then create a briefing.

## Supported Repositories

Sonar has the best code coverage for repositories written in TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, and C#. Markdown and MDX files are indexed as documentation.

If a repository contains other source languages, Sonar shows a warning after indexing with the unsupported language names and file counts. Unsupported source files can still contribute inventory-level signals, but they are not fully parsed into code units. The generated briefing may be incomplete when those languages contain the central product logic.

## Privacy Boundary

The Docker-first stack does not mount your home directory. Docker can only see repositories imported into Sonar's private `/workspace/repos` volume. When you select a local folder in the desktop UI, Sonar copies that selected repository into the volume and indexes the copied path.
