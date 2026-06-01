# Launch Checklist

Use this checklist before tagging a public alpha release.

## Required Checks

```bash
npm ci
npm run check
npm run test:integration
npm run build
npm run build:ui
mdbook build docs
npm run services:env
docker compose -f compose.yml config
docker compose -f docker-compose.sonar.yml config
npm audit --audit-level=moderate
(cd src-tauri && cargo audit)
```

## Docker End-To-End

```bash
npm run services:start
TOKEN="$(grep '^SONAR_API_TOKEN=' .sonar/runtime.env | cut -d= -f2-)"
curl -H "X-Sonar-Token: $TOKEN" http://127.0.0.1:3001/health
curl -H "X-Sonar-Token: $TOKEN" http://127.0.0.1:3001/health/dependencies
```

Acceptance criteria:

- Docker Desktop shows the configured Docker Model Runner models.
- Sonar API, Meilisearch, Qdrant, chat model, and embedding model are healthy.
- Docker does not mount the user's home directory.
- A selected repository is copied into Sonar's internal Docker volume before indexing.
- Service startup creates `.sonar/runtime.env` and uses the same token as the desktop app.
- Shared-machine or custom-network startup sets explicit `SONAR_API_TOKEN` and `SONAR_MEILI_MASTER_KEY` values.

## Dependency Audit Notes

`npm audit --audit-level=moderate` must pass with zero vulnerabilities.

`cargo audit` currently reports transitive GTK/WebKit/Tauri ecosystem warnings for Linux desktop dependencies. These are upstream warnings pulled through Tauri/wry rather than direct Sonar code. Before a Linux release, re-run `cargo audit`, update Tauri/wry when available, and document any remaining upstream warnings in release notes.

## Desktop Release Candidate

```bash
npm run desktop:build
```

Acceptance criteria:

- The packaged app launches without requiring terminal commands.
- The first-run service state is understandable.
- GitHub URL import works for a public repository.
- Local folder selection works for an already-cloned repository.
- Stop analysis cancels an in-progress indexing request.
- Briefing generation produces cited source lists.
- Follow-up questions stay grounded in the existing briefing session.
- Markdown export writes only the user-selected `.md` file.

## Release Notes

- Update `CHANGELOG.md`.
- Attach screenshots or a short demo video to the GitHub release.
- Mention Docker Desktop with Docker Model Runner as a prerequisite.
- Mention that first model download can take a while.
- Mention known local-model citation limitations.
