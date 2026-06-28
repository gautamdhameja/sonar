# Setup from Source

This guide is for users who clone Sonar from GitHub, build the production desktop app locally, and run that app.

Sonar has two runtime pieces:

- The Sonar desktop app and local workspace engine, which the app starts for you.
- A model endpoint, which you provide separately unless you configure the optional llama.cpp sidecar paths.

There is no Meilisearch, Postgres, Redis, Docker, or external search service in the default setup. Sonar stores project
state, indexed source units, generated memory graphs, and briefing sessions in embedded SQLite under `~/.sonar`.

## Requirements

- Node.js 22.x, 23.x, 24.x, or 25.x. Do not use Node 26+ for source builds.
- npm 10 or newer
- Git
- Rust toolchain with `cargo`
- A local OpenAI-compatible model server, or an OpenAI-compatible API endpoint
- Platform dependencies required by Tauri. On macOS, install Xcode Command Line Tools.

## 1. Clone and Install

```bash
git clone https://github.com/gautamdhameja/sonar.git
cd sonar
nvm use 24
npm install
```

Use the same supported Node major version for `npm install`, `npm run desktop:build`, and future `npm run check`
commands. If you switch Node versions after installing dependencies, run `npm install` again. Sonar uses native SQLite
dependencies that are compiled for the active Node runtime.

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

If the server also exposes llama.cpp-style props, Sonar uses them to adapt briefing context size:

```text
GET /props
```

The `/props` response should include `n_ctx`. Sonar treats this as the model context window and allocates a capped
fraction to repository evidence, leaving room for instructions and the generated answer while keeping local generation
interactive. If `/props` is missing, Sonar falls back to its default source-context budget. You can still force a fixed
budget with `SONAR_MAX_CONTEXT_TOKENS`.

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
curl http://127.0.0.1:8080/props
```

When you choose **Local llama.cpp**, Sonar tries `http://127.0.0.1:8080/v1/models` automatically and fills the model
name from the first returned model. If you use a different localhost port, enter it in the endpoint field and use
**Fetch** to read the model name.

If you use a different local runtime or port, keep it running and enter that base URL in Sonar's first-run setup screen.

Sonar's citation harness is enabled by default for local briefings. These optional environment flags are available for
measurement or rollback when launching the workspace engine:

```text
SONAR_CITATION_MENU=true
SONAR_SECTION_EVIDENCE_LIMIT=12
SONAR_CITATION_REPAIR_SELECTION=true
SONAR_CITATION_REPAIR_MAX_CALLS=12
SONAR_TWO_STAGE_BRIEFING=false
```

The first four settings keep citation generation as a closed-set copy task and repair remaining uncited claims by
selection. `SONAR_TWO_STAGE_BRIEFING=true` enables the experimental evidence-first path for non-synthesis sections.

## 3. Build Sonar

```bash
npm run desktop:build
```

This creates a production Tauri app bundle for your current platform. On macOS, the app is written to:

```text
src-tauri/target/release/bundle/macos/Sonar.app
```

This source-built alpha does not yet ship a standalone native workspace-engine sidecar inside the app bundle. Keep the
checkout and `node_modules` in place after building; the desktop app uses them to start the local workspace engine. If
you launch the app from somewhere that cannot locate the checkout, set `SONAR_APP_ROOT` to the cloned repository path
when launching the app executable.

## 4. Open Sonar

On macOS:

```bash
open src-tauri/target/release/bundle/macos/Sonar.app
```

If you need to pass environment variables on macOS, launch the app executable directly:

```bash
SONAR_APP_ROOT=/path/to/sonar src-tauri/target/release/bundle/macos/Sonar.app/Contents/MacOS/Sonar
```

On other platforms, open the app artifact created under:

```text
src-tauri/target/release/bundle/
```

The managed local runtime is:

- Sonar API: `http://127.0.0.1:3001`
- Project store: `~/.sonar/projects.db`
- Runtime token: `~/.sonar/runtime.env`
- Desktop model config: `~/.sonar/desktop-config.json`

Do not start the Sonar API manually for normal desktop use. Run the desktop app, and let it manage the API process.

`npm run desktop:dev` is only for contributors working on Sonar itself. It starts the Vite hot-reload UI and Tauri dev
shell; normal users should run the production build above.

## 5. First-Run Model Setup

On first launch, choose one model source:

- **Local llama.cpp** for a local OpenAI-compatible endpoint such as `http://127.0.0.1:8080/v1`.
- **API endpoint** for a cloud or self-hosted OpenAI-compatible API.

For local mode, leave the default endpoint if your model server is on `127.0.0.1:8080`, or edit it to match your server.
The app checks the configured `/models` endpoint before it marks the runtime ready.

For API endpoint mode, enter the endpoint, model name, and API key. Source excerpts required for generation are sent to
that provider.

## 6. Analyze a Repository

After the runtime is ready:

1. Paste a GitHub repository URL, or choose an existing local repository folder.
2. Choose the closest briefing audience.
3. Create a briefing.
4. Use the source list and citation diagnostics to verify important claims.

Sonar indexes only the repository you select. GitHub clones are stored under `~/.sonar/repositories`; selected local
folders are read directly.

## Optional llama.cpp Sidecar

For local source builds, Sonar can try to start a local llama.cpp sidecar if these environment variables point to a
server binary and model:

```bash
SONAR_LLAMA_SERVER_PATH=/path/to/llama-server \
SONAR_LLAMA_MODEL_PATH=/path/to/model.gguf \
src-tauri/target/release/bundle/macos/Sonar.app/Contents/MacOS/Sonar
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

- Make sure you built the app with `npm run desktop:build` and opened the built desktop app, not only the Vite UI.
- Keep the cloned checkout and `node_modules` in place, or set `SONAR_APP_ROOT` to the cloned repository path.
- Check `~/.sonar/api.log`.
- Make sure port `3001` is available on `127.0.0.1`.

If dependency installation fails, confirm your Node and npm versions match the supported range in `package.json`.
If the local API fails with a native module error such as `NODE_MODULE_VERSION`, switch back to Node 24 or another
supported Node version and run `npm install` again before rebuilding.
