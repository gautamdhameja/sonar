# Development

## Architecture

- **parser/** — tree-sitter code parsing into symbols and imports
- **indexer/** — indexes parsed data into Meilisearch for keyword search and Qdrant for vector search
- **retriever/** — local exact search, grep-like lexical search, hybrid search, graph retrieval, onboarding retrieval, and reranking
- **context/** — expands search results with related symbols and packs context into a local-model-friendly token budget
- **generator/** — assembles prompts, calls the chat model, verifies citations, and repairs citation issues when possible
- **db/** — SQLite persistence for projects, code units, dependency edges, embeddings, onboarding sessions, and onboarding messages
- **api/** — Express HTTP server exposing indexing, querying, onboarding, session follow-up, graph, health, and stats endpoints

## Local Development

Run the API in development:

```bash
npm run dev
```

Start local retrieval and embedding dependencies:

```bash
docker compose -f docker-compose.sonar.yml up -d meilisearch qdrant ollama
docker compose -f docker-compose.sonar.yml exec ollama ollama pull nomic-embed-text
```

## Checks

Run the fast local checks:

```bash
npm run check
```

Formatting and linting:

```bash
npm run format
npm run format:check
npm run lint
```

`npm run format` applies Biome formatting to TypeScript, React, CSS, JSON, and HTML files, then runs Rustfmt on the Tauri shell. `npm run lint` runs Biome linting and Rust Clippy.

Desktop checks:

```bash
npm run typecheck:ui
npm run build:ui
cargo check --manifest-path src-tauri/Cargo.toml
```

Integration-style scripts that require external services are kept separate from `npm run check`.
