# Contributing

## Development Setup

Use Node.js 22 and the Rust toolchain pinned by `rust-toolchain.toml`.

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
