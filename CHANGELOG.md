# Changelog

## 0.1.0 Alpha

Initial public alpha for Sonar as a local-first codebase onboarding and explanation tool.

### Included

- Tauri desktop app for selecting a local repository or cloning a GitHub repository.
- Local-first runtime with a desktop-managed Sonar API, embedded SQLite store, and configurable OpenAI-compatible model endpoint.
- Role-aware codebase briefing generation for non-technical and mixed-technical audiences.
- Session-aware follow-up questions after the initial onboarding brief.
- Repository survey, source-backed memory graph generation, exact lookup, grep-like lexical search, graph expansion, and briefing-specific ranking.
- SQLite persistence for projects, code units, memory graphs, onboarding sessions, and generated briefings.
- Source citation verification and citation repair for generated answers.

### Known Limitations

- Local model startup and generation speed depend on the model runtime you configure.
- Medium local models can still produce incomplete or cautious language; cited line-range claims should be treated as the reliable output.
- Desktop packaging has been designed for macOS first and needs release-candidate testing on clean machines.
- Packaged local model sidecars are still an installation-path concern for distribution builds.
