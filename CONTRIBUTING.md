# Contributing

## Development Setup

Use Node.js 22 and a Rust toolchain compatible with the minimum version declared in `src-tauri/Cargo.toml`.

```bash
npm install
npm run check
```

For the desktop app:

```bash
npm run desktop:dev
```

## Pull Requests

- Keep changes focused and covered by tests when behavior changes.
- Run `npm run check` before opening a PR.
- Do not commit local data, model files, `.env` files, API keys, or generated docs output.

## Continuous Integration

CI runs `npm run check` on pull requests and pushes to `main` with supported Node.js versions. The macOS job is the release-target gate; Linux runs as an exploratory compatibility check.
