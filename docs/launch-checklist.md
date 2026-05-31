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
docker compose -f compose.yml config
docker compose -f docker-compose.sonar.yml config
npm audit --audit-level=moderate
```

## Docker End-To-End

```bash
docker compose up -d
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/health/dependencies
```

Acceptance criteria:

- Docker Desktop shows the configured Docker Model Runner models.
- Sonar API, Meilisearch, Qdrant, chat model, and embedding model are healthy.
- Docker does not mount the user's home directory.
- A selected repository is copied into Sonar's internal Docker volume before indexing.

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
- Onboarding brief generation produces cited source lists.
- Follow-up questions stay grounded in the existing onboarding session.
- Markdown export writes only the user-selected `.md` file.

## Release Notes

- Update `CHANGELOG.md`.
- Attach screenshots or a short demo video to the GitHub release.
- Mention Docker Desktop with Docker Model Runner as a prerequisite.
- Mention that first model download can take a while.
- Mention known local-model citation limitations.
