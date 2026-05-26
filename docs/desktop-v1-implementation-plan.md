# Sonar Desktop V1 Implementation Plan

Sonar V1 is a local-first desktop app for first-week codebase onboarding. The target user should be able to open the app, configure a generation API endpoint from the UI, analyze a GitHub or local repository, generate an onboarding brief, and ask follow-up questions without starting Sonar services manually.

## Task 1: Desktop Shell And Build Pipeline

Status: implemented

- Add a Tauri 2 desktop wrapper around the existing Sonar API.
- Add a Vite/React UI build that emits static assets for Tauri packaging.
- Add desktop scripts for development and release builds.
- Add Tauri bundle configuration, native window defaults, and icon assets.
- Verify TypeScript UI compilation, UI production build, and Rust desktop compilation.

## Task 2: Managed Local Services

Status: implemented

- Start Meilisearch, Qdrant, and Ollama embeddings through the included Docker Compose file when they are not already running.
- Pull the configured embedding model into the Dockerized Ollama service.
- Start the local Sonar API automatically on `127.0.0.1:3001`.
- Detect the configured OpenAI-compatible generation endpoint and show its health in the UI.
- Restrict the browser-facing API to local/Tauri origins while allowing desktop-selected repository paths.

## Task 3: V1 Onboarding User Interface

Status: implemented

- Build the first screen as the actual working onboarding experience, not a marketing page.
- Show runtime service status, indexed projects, repository picker, index action, onboarding generation, cited sources, and follow-up Q&A.
- Use a GitHub URL input and native folder selection for repository onboarding.
- Configure generation endpoint, generation model, API key, and embedding model directly in the desktop UI.
- Keep the UI dense and operational so it fits product-manager onboarding work rather than developer-only diagnostics.
- Surface service errors inline so users can see what needs attention without using the terminal.

## Task 4: Project Indexing And Onboarding Flow

Status: implemented

- Support GitHub URL analysis by cloning public repositories into Sonar-managed local storage.
- Support existing local repositories through a native folder picker.
- Wire the desktop UI to `POST /projects/index` with summarization enabled.
- Wire the onboarding brief flow to persisted onboarding sessions.
- Wire follow-up questions to the session-aware follow-up endpoint.
- Preserve source evidence and citation verification details in the desktop experience.

## Task 5: Packaging, Defaults, And Documentation

Status: implemented

- Document desktop prerequisites and the one-command development flow.
- Document what the desktop app manages automatically and what still requires a generation model endpoint.
- Configure generation endpoint, generation model, API key, and embedding model from the desktop UI only.
- Document Docker-managed Meilisearch, Qdrant, and Ollama embeddings.
- Document GitHub URL and local folder analysis paths.
- Keep generated UI, Rust targets, local vector/index data, SQLite databases, logs, and secrets out of git.
- Run the full local validation suite after desktop integration.

## Task 6: Launch Readiness Checks

Status: implemented

- Run backend typecheck.
- Run UI typecheck.
- Run backend tests.
- Run UI production build.
- Run Tauri Rust compilation.
- Run a final git status review before commit.

## Follow-Up Scope Inside V1

These items remain V1 work, not a future-version bucket:

- Add a guided first-run readiness checklist for Docker, Ollama, embeddings, and chat server.
- Add service logs or last-error details for failed managed startup.
- Add cancellation and progress feedback for long indexing and generation jobs.
- Add export actions for onboarding briefs and follow-up answers.
