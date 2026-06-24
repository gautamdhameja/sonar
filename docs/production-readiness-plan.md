# Sonar — Production Readiness Implementation Plan

> **For the implementing agent:** This is a standalone work plan. You have no prior
> conversation context. Read the "Orientation" and "Ground rules" sections first,
> then execute phases in order. Each task has concrete steps and acceptance criteria.
> Do **not** attempt all phases in one pass — land them as separate, reviewable commits/PRs.

---

## Orientation

**Sonar** is a local-first, source-grounded codebase briefing tool. It is a Tauri
(Rust) desktop app wrapping a React 19 + Vite UI, backed by a local Node/Express API
engine that indexes a repository (tree-sitter), surveys it into a "memory graph",
retrieves evidence, and generates citation-backed briefings via an OpenAI-compatible
model endpoint (local llama.cpp or a remote API). State persists in embedded SQLite.

Key layout:
- `src/` — Node/Express engine (api, indexer, parser, survey, retriever, generator, db, security, eval)
- `src-tauri/src/` — Rust desktop shell (`api_proxy.rs`, `llama_sidecar.rs`, `export.rs`, `config.rs`, `paths.rs`, …)
- `src-ui/` — React/Vite frontend
- `test/` — 36 `*.test.ts` unit tests + `*.integration.ts` + Rust tests
- `scripts/` — build/clean, integration runner, macOS sign/verify
- `docs/` — mdBook-style documentation

Current state: version `0.1.0`, self-described "public alpha". Code hygiene is good
(real tests, DB migrations at `user_version = 4`, mandatory API-token auth, CORS
allowlist, secret redaction). The gaps are in **automation, distribution, and output
trust**, not core code quality.

### Existing quality command (your north star)
`package.json` already defines a full gate:
```
npm run check
  = format:check (biome + cargo fmt --check)
  && lint        (biome lint + cargo clippy -D warnings)
  && typecheck   (tsc --noEmit)
  && typecheck:ui (tsc --noEmit -p tsconfig.ui.json)
  && test:dev    (node --test -r ts-node/register test/*.test.ts)
  && test:integration (node scripts/run-integration-tests.mjs)
  && test:rust   (cargo test --manifest-path src-tauri/Cargo.toml)
```
Supported Node: `>=22 <26`. Package manager: `npm@11.12.1`.

---

## Ground rules (do not violate)

1. **Preserve the local privacy boundary.** Sonar only touches the repo the user
   selects, and stores state under `~/.sonar`. Do not add telemetry, network calls,
   crash reporting, or analytics that send data off-machine **by default**. Anything
   of that nature must be strictly opt-in and documented.
2. **Match existing code style.** Biome governs TS formatting; `cargo fmt` governs Rust.
   Run `npm run format` before committing. Mirror surrounding naming/idioms.
3. **Every change must keep `npm run check` green.** If you add code, add/extend tests
   in the same style as `test/*.test.ts` (node:test).
4. **Land work in small, reviewable units.** One phase ≈ one PR. Do not bundle CI setup
   with parser expansion with packaging.
5. **Don't weaken security defaults.** The API must keep refusing to start without
   `SONAR_API_TOKEN` (`src/api/server.ts`), keep binding to `127.0.0.1`, keep the CORS
   allowlist, and keep `src/security/source-safety.ts` redaction intact.

---

## Phase 1 — Continuous Integration (HIGHEST PRIORITY, release blocker)

**Why:** `.github/workflows/` is empty. All quality tooling is manual. Nothing gates merges.

### Task 1.1 — Add a CI workflow that runs the full check on PR + main
Create `.github/workflows/ci.yml`:
- Triggers: `pull_request` and `push` to `main`.
- Job matrix over Node `22.x` and `24.x` (representative ends of the supported `>=22 <26` range).
- Runner: `macos-latest` (primary target). Add `ubuntu-latest` to the matrix for the
  Node/TS portion if it passes; allow it to be `continue-on-error` initially if native
  deps (`better-sqlite3`, `tree-sitter`) cause friction.
- Steps:
  1. Checkout.
  2. Setup Node (matrix version) with npm cache.
  3. Install the Rust toolchain (`dtolnay/rust-toolchain@stable`) with `rustfmt` + `clippy`
     components, and cache cargo (`Swatinem/rust-cache`).
  4. Install Tauri system deps on Linux runners (webkit2gtk etc.) — only needed if you
     include a Linux Rust job.
  5. `npm ci`.
  6. `npm run check`.
- Concurrency group keyed on ref to cancel superseded runs.

**Acceptance criteria:**
- A PR shows the CI check running and passing on a clean checkout.
- `npm run check` reproduces the CI result locally.
- The workflow does not require any secrets to run the check.

### Task 1.2 — Split slow vs. fast jobs (optional refinement)
If `test:rust` + Tauri toolchain dominates runtime, split into two jobs
(`node-checks` and `rust-checks`) that run in parallel. Keep a single required
status by using a `needs:`-gated `ci-success` aggregator job.

### Task 1.3 — Document the gate
Add a short "Continuous Integration" subsection to `CONTRIBUTING.md` stating that
`npm run check` must pass and that CI enforces it. (Do not assert branch-protection
settings in docs — that is a repo-admin action, not code.)

---

## Phase 2 — Local model distribution (release blocker)

**Why:** `src-tauri/src/llama_sidecar.rs` looks up a llama-server binary and a GGUF model
at runtime under `~/.sonar` and silently no-ops if absent (`start_llama_sidecar_if_available`).
There is no bundling and no first-run acquisition flow, so the "local-first" promise has a
manual install cliff. `tauri.conf.json` has no `externalBin` and no updater.

> **Decision required before coding.** Pick ONE distribution strategy and record it as a
> short ADR in `docs/` (e.g. `docs/adr/0001-local-model-distribution.md`). Options:
> - **(A) Bring-your-own-server (smallest scope):** Keep the runtime lookup, but make the
>   missing-sidecar state a first-class, actionable UI flow instead of a silent no-op.
> - **(B) First-run download:** App downloads a pinned llama-server build + a default GGUF
>   model on first launch, with checksum verification and a progress UI.
> - **(C) Bundled binary:** Ship llama-server via Tauri `externalBin`; model still downloaded
>   (GGUFs are too large to bundle).
>
> Recommended default: **(A) now, designed so (B) can layer on later.** (A) unblocks a
> trustworthy release without shipping large binaries; (B) is the follow-up that makes it
> turnkey.

### Task 2.1 — Make the missing-sidecar / unreachable-endpoint state first-class (strategy A)
- The Rust side already has `missing_llama_sidecar_message()`. Ensure that when the model
  endpoint is unreachable, the UI surfaces a clear, actionable message (expected binary path,
  expected model path, and the "or point me at an OpenAI-compatible server" alternative),
  not a generic failure or silent hang.
- Add a health/preflight check the UI runs before generation: confirm the configured
  endpoint answers at `…/v1` (reuse existing health plumbing in `src/api/health-routes.ts`
  and `src/api/dependency-health.ts`). Show endpoint status in the setup screen.

**Acceptance criteria:** With no local server running, the app shows a specific,
recoverable error naming both options; with a server running, preflight passes and
generation proceeds.

### Task 2.2 — (If strategy B/C) Implement pinned acquisition with verification
- Pin llama-server version and model URL + SHA-256 in config.
- Download to `~/.sonar`, verify checksum before use, show progress, handle resume/failure.
- Never auto-download without explicit user consent (privacy + bandwidth).

---

## Phase 3 — Signed, automated release pipeline (release blocker for public distribution)

**Why:** `scripts/sign-macos-app.mjs` and `verify-macos-app.mjs` exist and `npm run release:mac`
chains build→sign→verify, but it is all local/manual. `tauri.conf.json` bundles `targets: "all"`
at version `0.1.0` with no updater.

### Task 3.1 — Release workflow on tag
Create `.github/workflows/release.yml` triggered on `v*` tags:
- Build the macOS app via `npm run desktop:build`.
- Sign + notarize using `scripts/sign-macos-app.mjs` (Developer ID cert, app-specific
  password / notarytool creds supplied as GitHub Actions **secrets** — reference them by
  name, never hardcode).
- Run `verify-macos-app.mjs` as a gate.
- Attach the signed artifact to a GitHub Release.
- Document required secrets in the workflow header comments and in `docs/desktop.md`.

### Task 3.2 — Wire the Tauri updater (or explicitly defer)
- Either configure the Tauri updater (signing keys, update endpoint, `tauri.conf.json`
  `plugins.updater` block) so shipped apps can self-update, **or** add a documented
  "manual update" note. If deferring, record it as a known limitation in `CHANGELOG.md`.

### Task 3.3 — Version bump discipline
- Ensure `package.json` `version` and `src-tauri/tauri.conf.json` `version` stay in sync.
  Add a small `scripts/check-version-sync.mjs` invoked in CI (or in `check`) that fails if
  they diverge.

---

## Phase 4 — Output trust & runtime robustness

**Why:** The project's own caveat is that smaller local models produce incomplete/cautious
prose and that **only cited line-ranges should be treated as reliable.** There is already a
`src/generator/citation-verifier.ts` with repair — surface it. There are ~89 catch/throw
sites; audit the user-facing ones.

### Task 4.1 — Surface citation verification in the UI
- Ensure every briefing/answer returned to the UI includes per-claim citation-verification
  status (verified / repaired / unverifiable) from `citation-verifier.ts`.
- In `src-ui/`, visibly flag or suppress unverifiable claims so users can trust what renders.
- Add/extend tests in `test/citation-verifier.test.ts` for the unverifiable-claim path.

**Acceptance criteria:** A briefing containing an unverifiable claim renders that claim as
flagged (not as plain trusted prose).

### Task 4.2 — Robust endpoint failure handling
- Add timeouts + bounded retries around model calls in `src/generator/llm-client.ts`
  (and any other fetch to the model endpoint). On timeout/refusal, return a structured,
  user-actionable error rather than a hang or stack trace.
- Audit catch blocks in `src/api/*` and `src/generator/*` for silently swallowed errors;
  ensure failures reach the UI as typed errors (see `src/api/errors.ts`).

### Task 4.3 — Desktop crash resilience
- Confirm the Rust shell handles engine/sidecar process death gracefully (restart or clear
  error). Review `src-tauri/src/process.rs` and `api_proxy.rs` for unhandled exits.

---

## Phase 5 — Language coverage & completeness

**Why:** Full tree-sitter parsing covers ~7 languages (`src/parser/`); others fall back to
signal-level scanning (`docs/language-support.md`). Repos centered on unsupported languages
get degraded briefings.

### Task 5.1 — Add the next tier of parsers
- Prioritize by likely user demand: **Ruby, C++, PHP, Kotlin, Swift** (validate against your
  target audience before committing).
- For each: add the tree-sitter grammar dependency, wire a parser module mirroring
  `src/parser/py-parser.ts` / `ts-parser.ts`, register it in `src/parser/language-support.ts`,
  and add a `test/` fixture + parser test mirroring `parser-modules.test.ts`.
- Update `docs/language-support.md` coverage table.

### Task 5.2 — Graceful degradation messaging
- Confirm the "Limited language coverage: …" warning is accurate and prominent in the UI
  whenever unsupported languages are central to a repo.

---

## Phase 6 — Operability & UX polish (post-blocker hardening)

### Task 6.1 — Opt-in local diagnostics
- Add an opt-in, **local-only** debug log bundle (writes under `~/.sonar`) to help diagnose
  briefing-quality issues. No network egress. Document in `docs/desktop.md`.

### Task 6.2 — First-run / setup UX
- Validate the model-endpoint setup screen: test the endpoint, advise when a model is too
  small/slow for good briefings, and confirm the local privacy boundary copy is clear.

### Task 6.3 — Large-repo guardrails
- The survey is token-budgeted (`src/survey/survey-budget.ts`), and indexing has
  `maxFileBytes` / `maxTotalBytes` limits (`src/config.ts`). Validate behavior on a very
  large monorepo: ensure indexing/SQLite writes stream or chunk and surface a clear limit
  message rather than failing opaquely.

---

## Suggested sequencing

| Order | Phase | Rationale |
|------|-------|-----------|
| 1 | Phase 1 (CI) | Cheapest, highest leverage; protects everything after. |
| 2 | Phase 4 (trust + robustness) | Makes the core output shippable and honest. |
| 3 | Phase 2 (model distribution, strategy A) | Removes the install cliff for the headline feature. |
| 4 | Phase 3 (release pipeline) | Needed for any public binary. |
| 5 | Phase 5 (languages) | Broadens applicability once the core is solid. |
| 6 | Phase 6 (operability/UX) | Hardening and polish. |

## Definition of done (per phase)
- `npm run check` passes locally and in CI.
- New behavior has tests in the existing `node:test` / `cargo test` style.
- Docs updated (`README.md`, `docs/`, `CHANGELOG.md`) where user-facing.
- Privacy boundary and security defaults verified intact.
- Change is a focused, self-contained PR.
