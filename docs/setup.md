# Setup from Source

This guide is for users who clone Sonar from GitHub and run the desktop app locally.

Sonar has two runtime pieces:

- The Sonar desktop app and local workspace engine, which the app starts for you.
- A model endpoint, which you provide separately unless you configure the optional llama.cpp sidecar paths.

There is no Meilisearch, Postgres, Redis, Docker, or external search service in the default setup. Sonar stores project
state, indexed source units, generated memory graphs, and briefing sessions in embedded SQLite under `~/.sonar`.

## Requirements

- Node.js 22.x, 23.x, 24.x, or 25.x
- npm 10 or newer
- Git
- Rust toolchain with `cargo`
- A local OpenAI-compatible model server, or an OpenAI-compatible API endpoint
- Platform dependencies required by Tauri. On macOS, install Xcode Command Line Tools.

## 1. Clone and Install

```bash
git clone https://github.com/gautamdhameja/sonar.git
cd sonar
npm install
```

## 2. Start a Model Endpoint

Sonar sends generation requests to an OpenAI-compatible API. For local use, run your model server before starting or
configuring the app.

The default local endpoint is:

```text
http://127.0.0.1:8080/v1
```

The endpoint must expose:

```text
GET /v1/models
POST /v1/chat/completions
```

If you use llama.cpp, start `llama-server` with a model that can handle long repository-context prompts. The exact flags
depend on your local llama.cpp build and model, but the server should listen on `127.0.0.1:8080` and provide the
OpenAI-compatible API.

Example shape:

```bash
llama-server --model /path/to/model.gguf --host 127.0.0.1 --port 8080
```

You can verify the model endpoint before launching Sonar:

```bash
curl http://127.0.0.1:8080/v1/models
```

If you use a different local runtime or port, keep it running and enter that base URL in Sonar's first-run setup screen.

## 3. Start Sonar

```bash
npm run desktop:dev
```

This starts the Tauri desktop app. In source mode, the desktop service manager starts the local Sonar workspace engine
for you through `npm run dev`, and Tauri starts the Vite UI through `npm run dev:ui`.

The managed local runtime is:

- Sonar API: `http://127.0.0.1:3001`
- Project store: `~/.sonar/sonar.db`
- Runtime token: `~/.sonar/runtime.env`
- Desktop model config: `~/.sonar/desktop-config.json`

Do not start the Sonar API manually for normal desktop use. Run the desktop app, and let it manage the API process.

## 4. First-Run Model Setup

On first launch, choose one model source:

- **Local llama.cpp** for a local OpenAI-compatible endpoint such as `http://127.0.0.1:8080/v1`.
- **API endpoint** for a cloud or self-hosted OpenAI-compatible API.

For local mode, leave the default endpoint if your model server is on `127.0.0.1:8080`, or edit it to match your server.
The app checks the configured `/models` endpoint before it marks the runtime ready.

For API endpoint mode, enter the endpoint, model name, and API key. Source excerpts required for generation are sent to
that provider.

## 5. Analyze a Repository

After the runtime is ready:

1. Paste a GitHub repository URL, or choose an existing local repository folder.
2. Choose the closest briefing audience.
3. Create a briefing.
4. Use the source list and citation diagnostics to verify important claims.

Sonar indexes only the repository you select. GitHub clones are stored under `~/.sonar/repositories`; selected local
folders are read directly.

## Optional llama.cpp Sidecar

For development builds, Sonar can try to start a local llama.cpp sidecar if these environment variables point to a
server binary and model:

```bash
SONAR_LLAMA_SERVER_PATH=/path/to/llama-server
SONAR_LLAMA_MODEL_PATH=/path/to/model.gguf
npm run desktop:dev
```

If those variables are not set, Sonar also checks:

```text
~/.sonar/bin/llama-server
~/.sonar/models/default.gguf
```

This sidecar path is optional. The simpler setup is to run any OpenAI-compatible model server yourself and configure its
base URL in the app.

## Troubleshooting

If Sonar says the model endpoint is unavailable:

- Confirm the model server is running.
- Confirm `curl http://127.0.0.1:8080/v1/models` works, or use your configured base URL.
- Confirm the app's configured endpoint includes `/v1` when your server expects it.
- Use a model with enough context for repository briefings; very small or slow models may produce incomplete output.

If Sonar says the workspace engine is unavailable:

- Run the app with `npm run desktop:dev`, not only `npm run dev:ui`.
- Check `~/.sonar/sonar-api.log`.
- Make sure port `3001` is available on `127.0.0.1`.

If dependency installation fails, confirm your Node and npm versions match the supported range in `package.json`.
