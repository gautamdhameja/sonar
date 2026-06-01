# Getting Started

Sonar runs as a desktop app backed by local indexing services. The app manages those services for you.

Prerequisites:

- Docker Desktop
- Docker Compose 2.38 or newer
- Git, if you want Sonar to clone GitHub repositories for you

Start the desktop app:

```bash
npm install
npm run desktop:dev
```

On first launch, Sonar starts the non-model local services first and asks you to choose a model source:

- **Local Docker model** starts Docker Model Runner for generation and embeddings.
- **API endpoint** skips Docker Model Runner and uses your configured OpenAI-compatible cloud or self-hosted endpoints.

After you save the model source, future launches use the saved choice automatically.

The local services are:

- Sonar API on `http://localhost:3001`
- Meilisearch on `http://localhost:7700`
- Qdrant on `localhost:6333`

If you choose **Local Docker model**, Docker Model Runner also starts:

- a chat model, defaulting to `hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL`
- an embedding model, defaulting to `hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M`

If you choose **API endpoint**, configure:

- Generation API endpoint, model, and API key
- Embedding API endpoint, model, API key, and vector size

The embedding vector size must match the embedding model output. For example, Docker's default local embedding model uses `768`, while OpenAI `text-embedding-3-small` uses `1536` unless a compatible server is configured to return a different dimension.

After setup, paste a GitHub repository URL or select a local repository folder, then create a briefing.

## Privacy Boundary

The Docker-first stack does not mount your home directory. Docker can only see repositories imported into Sonar's private `/workspace/repos` volume. When you select a local folder in the desktop UI, Sonar copies that selected repository into the volume and indexes the copied path.
