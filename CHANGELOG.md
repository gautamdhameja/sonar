# Changelog

## 0.1.0 Alpha

Initial public alpha for Sonar as a local-first codebase onboarding and explanation tool.

### Included

- Tauri desktop app for selecting a local repository or cloning a GitHub repository.
- Docker-first runtime with Sonar API, Meilisearch, Qdrant, and Docker Model Runner models.
- First-week onboarding brief generation for non-technical and mixed-technical audiences.
- Session-aware follow-up questions after the initial onboarding brief.
- Hybrid retrieval using exact lookup, grep-like lexical search, BM25, vector search, graph expansion, and onboarding-specific ranking.
- SQLite persistence for projects, code units, summaries, onboarding sessions, and messages.
- Source citation verification and citation repair for generated answers.

### Known Limitations

- The first Docker Model Runner start can take a long time while models are downloaded.
- Medium local models can still produce uncited summary language; cited line-range claims should be treated as the reliable output.
- Desktop packaging has been designed for macOS first and needs release-candidate testing on clean machines.
- Docker Model Runner availability and model support depend on the user's Docker Desktop version.
