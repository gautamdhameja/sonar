# Desktop App

The Sonar desktop app lets you analyze either a GitHub repository URL or an already-cloned local repository.

Sonar is built for high-level codebase briefings. It helps non-technical and semi-technical teammates understand the project, workflows, risks, and source landmarks using a local or OpenAI-compatible model. It is not designed to replace a frontier coding agent for debugging, refactoring, or fine-grained implementation analysis.

## Prerequisites

- Git installed locally if you want Sonar to clone GitHub repositories for you
- Node.js 22.x, 23.x, 24.x, or 25.x when running from source. Do not use Node 26+.
- Rust toolchain and platform dependencies for Tauri
- A local OpenAI-compatible model server or an OpenAI-compatible API endpoint

## First-Run Flow

1. Open Sonar.
2. On first launch, choose **Local llama.cpp** or **API endpoint**.
3. Let the app start the local Sonar API.
4. Paste a GitHub repository URL or select a local folder.
5. Create a codebase briefing. Sonar inventories the repository, surveys selected files into a memory graph, and writes a cited briefing from that map.
6. Ask follow-up questions in the same session.
7. Copy or export the briefing as Markdown if you want to share it.

## Local Runtime

- Sonar API on `http://127.0.0.1:3001`.
- SQLite project data under `~/.sonar`.
- No Meilisearch or external database/search service.

When running from a local source checkout, build the production desktop app with:

```bash
nvm use 24
npm install
npm run desktop:build
```

Use the same supported Node version for install, build, and checks. If you switch Node versions, rerun `npm install`
before rebuilding so native SQLite dependencies match the runtime used by the local API.

On macOS, open:

```bash
open src-tauri/target/release/bundle/macos/Sonar.app
```

The current source-built alpha does not yet package a standalone native workspace-engine sidecar inside the app bundle.
Keep the checkout and `node_modules` in place after building; the desktop service manager uses them to start the Sonar
API. If the app cannot locate the checkout, set `SONAR_APP_ROOT` to the cloned repository path. A packaged distribution
can provide a native API sidecar at `~/.sonar/bin/sonar-api` or through `SONAR_API_SERVER_PATH`.

`npm run desktop:dev` is only for contributors working on Sonar itself. It starts the Vite hot-reload UI and Tauri dev
shell instead of a production app bundle.

To use local generation, start an OpenAI-compatible model server separately, choose **Local llama.cpp**, and configure the
local endpoint. The default is `http://127.0.0.1:8080/v1`; if you use a different port or local runtime, update the
endpoint during setup. To use cloud generation or another hosted model, choose **API endpoint**.

Development builds can also use a llama.cpp sidecar when these paths are set:

```text
SONAR_LLAMA_SERVER_PATH=/path/to/llama-server
SONAR_LLAMA_MODEL_PATH=/path/to/model.gguf
```

The model runtime must expose an OpenAI-compatible `/models` endpoint.

## Desktop Configuration

The desktop config is stored at:

```text
~/.sonar/desktop-config.json
```

Do not commit this file. It may contain API keys.

The local runtime token is stored at:

```text
~/.sonar/runtime.env
```

This file is generated locally and ignored by git.

The desktop-managed API is intended for localhost use by the Tauri app. It is protected by `X-Sonar-Token` and CORS
allowlisting. Desktop API calls go through the Tauri command bridge, which attaches the local runtime token; treat the
desktop config and runtime files as local secrets.

When Sonar runs as the desktop app, local repository selection is intentionally trusted: the API is started with
`SONAR_ALLOW_ANY_REPO_ROOT=true` so a folder chosen in the native picker can be indexed without pre-registering allowed
roots. This override is only for the desktop-managed localhost engine; the process still binds to `127.0.0.1`, uses the
runtime token for protected API calls, and enforces the configured CORS allowlist.

Indexed repository content is untrusted input to the model. A repository can include text that attempts to steer the
briefing, so Sonar treats generated briefings as source-grounded drafts rather than executable instructions. Model output
is rendered as inert Markdown text in the desktop UI, raw HTML is not enabled, and Sonar does not run tools or code based
on model output. Use citations and unverifiable-claim flags to check important claims against the listed source files.

## Local Diagnostics

The settings drawer can create an opt-in diagnostics bundle under `~/.sonar/diagnostics`. The bundle stays on the local
machine; Sonar does not upload diagnostics, logs, repository contents, crash reports, or telemetry. The bundle includes
redacted runtime config, service status, and local Sonar/llama.cpp logs when present.

## Repository Options

- Paste a GitHub repository URL. Sonar clones it into `~/.sonar/repositories` and indexes that clone.
- Select an existing local repository with the native folder picker. Sonar indexes the selected path directly.

## Language Coverage Warning

When Sonar indexes a repository, it scans for common source file extensions outside the supported parser set. If it finds unsupported languages, the desktop app shows a warning with file counts. You can still create the briefing, and the survey may use lightweight signals from those files, but unsupported source files are not fully parsed into the code index.

Supported code parsers today cover TypeScript/TSX, JavaScript/JSX, Python, Rust, Go, Java, C#, Ruby, C++, PHP, Kotlin,
and Swift. Markdown and MDX are indexed as documentation.

## Release Build

Build a local production app bundle:

```bash
npm run desktop:build
```

Build, ad-hoc sign, and verify a local macOS app bundle:

```bash
npm run release:mac
```

By default this applies an ad-hoc signature so `codesign --verify --deep --strict` passes on the local machine. For public macOS distribution, sign with an Apple Developer ID Application certificate:

```bash
SONAR_MAC_SIGN_IDENTITY="Developer ID Application: Your Team Name (TEAMID)" npm run release:mac
```

After Developer ID signing, notarize and staple the app or installer using your Apple Developer account before distributing it outside your own machine.

Tagged releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed. The workflow runs the full
quality gate, builds the macOS app, signs it with a Developer ID Application certificate, notarizes and staples it,
verifies the signature, and attaches a zipped `.app` bundle to the GitHub Release.

The release workflow requires these GitHub Actions secrets:

- `APPLE_CERTIFICATE_P12_BASE64`: base64-encoded Developer ID Application certificate export.
- `APPLE_CERTIFICATE_PASSWORD`: password for the exported `.p12` certificate.
- `KEYCHAIN_PASSWORD`: temporary CI keychain password.
- `SONAR_MAC_SIGN_IDENTITY`: Developer ID Application identity name.
- `APPLE_ID`: Apple Developer account email for `notarytool`.
- `APPLE_TEAM_ID`: Apple Developer Team ID.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for `notarytool`.

Desktop auto-update is intentionally deferred for the public alpha. Users should install new releases manually from the
GitHub Release artifact until the Tauri updater is configured with signed update metadata.
