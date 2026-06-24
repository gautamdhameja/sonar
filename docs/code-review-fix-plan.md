# Sonar — Code Review Fix Plan

> **For the implementing agent:** This plan addresses findings from a full-codebase
> review. You have no prior conversation context — everything you need is here. Read
> "Ground rules" first, then work the fixes in priority order. Each fix is an
> independent, reviewable commit/PR. Do not bundle unrelated fixes together.
>
> Findings are labelled with the IDs from the review (QUAL-1, SEC-1, …) so they can be
> cross-referenced.
>
> **This plan covers every finding from the review — nothing is deferred.** The
> traceability matrix below maps each finding to its task. Work all of them.

---

## Traceability matrix (every finding → task)

| Finding | Severity | Task | Outcome to reach |
|--------|----------|------|------------------|
| QUAL-1 — ranking heuristics overfit to foreign repos | High | 1.1–1.3 | Fix |
| SEC-1 — weak/divergent secret redaction in diagnostics bundle | Medium | 2.1–2.3 | Fix |
| BUG-2 — local-model timeout cut + timeouts retried | Medium | 3.1–3.3 | Fix |
| SEC-2 — repo-root sandbox disabled in desktop | Low | 4.1 | Document (intentional) |
| QUAL-3 — TCP-only API liveness + unguarded PID kill | Low | 4.2 | Fix |
| QUAL-4 — `repaired` status never emitted + fragile UI claim match | Low | 4.3 | Fix |
| SEC-3 — notarization password on `xcrun` argv | Low | 4.4 | Fix |
| QUAL-5a — `process.env` reads bypass central `CONFIG` | Info | 4.5 | Fix |
| QUAL-5b — `.h` headers hard-mapped to C++ | Info | 4.5 | Document + comment |
| QUAL-5c — shallow extraction for Ruby/PHP/Kotlin/Swift | Info | 4.5 | Fix (tune node-type maps) |
| QUAL-5d — redundant native `tree-sitter-*` deps | Info | 4.5 | Confirm intent; fix if vestigial |
| INHERENT — prompt injection from indexed source | By-design | 4.6 | Document the boundary |

If you find an issue not in this matrix while working, add a row and fix it rather than
silently skipping it.

---

## Ground rules (do not violate)

1. **Keep `npm run check` green** after every fix (`format:check` + `lint` + `typecheck` +
   `typecheck:ui` + `test:dev` + `test:integration` + `test:rust`, plus the new
   `check:version`). Run `npm run format` before committing.
2. **Match existing style.** Biome for TS, `cargo fmt` for Rust. Mirror surrounding idioms.
   The codebase has near-zero `as any` and centralizes config — keep it that way.
3. **Add/extend tests in the same `node:test` / `cargo test` style** for every behavior
   change. Tests live in `test/*.test.ts` and `#[cfg(test)]` modules.
4. **Preserve the security posture:** mandatory `SONAR_API_TOKEN`, `127.0.0.1` bind, CORS
   allowlist, and the redaction in `src/security/source-safety.ts` must stay intact or get
   *stronger*, never weaker.
5. **Do not regress retrieval quality blindly.** Fix QUAL-1 behind the retrieval eval
   harness (`npm run eval:retrieval`) so you can confirm rankings don't collapse — see that
   task for details.

---

## Priority 1 (High) — QUAL-1: Remove repo-specific overfit from ranking heuristics

**Why:** Sonar's pitch is "understand *any* codebase," but the scorers contain hardcoded
paths and domain terms from unrelated projects (a "daily-digest / arXiv / HackerNews
collect→classify→score→digest pipeline" and a collaborative editor). On arbitrary user
repos these are dead weight at best and **rank-skewing at worst** (any repo with a `digest`,
`socket`, or `runpipeline` file gets spurious boosts). This is a generalization bug, not
style.

### Confirmed locations
- [scoring-policy.ts:204](../src/retriever/scoring-policy.ts) — `…|arxiv|hacker|search…` inside `workflowEvidenceBonus`.
- [scoring-policy.ts:10-50](../src/retriever/scoring-policy.ts) — `ONBOARDING_WORKFLOW_TERMS` mixes generic terms with editor-app specifics (`collab`, `room`, `socket`, `keypress`, `indexeddb`, `lsp`, `tree-sitter`).
- [packer.ts:45-51](../src/context/packer.ts) — `queryPlanBonus` regexes `/src\/(main|runpipeline)\./`, `/src\/framework\/pipeline\//`, `/src\/(db|daily\/digest|pipelines\/.*renderer)/`.
- [local-retriever.ts:233](../src/retriever/local-retriever.ts) — `+24` boost for `/src\/(main|runpipeline)\.(…)$/`.

### Task 1.1 — Replace overfit signals with language-agnostic structural signals
- In `scoring-policy.ts` `workflowEvidenceBonus`: drop `arxiv|hacker` and any other
  domain-specific tokens. Keep only generic workflow structure (entry/pipeline/runner
  filenames, `src/db`-style persistence, classify/score/persist *verbs* that are genuinely
  generic). Re-examine each weight — several look tuned to one corpus.
- Prune `ONBOARDING_WORKFLOW_TERMS` / `ONBOARDING_PRODUCT_TERMS` to terms that generalize
  across domains. Remove app-specific ones (`collab`, `room`, `socket`, `keypress`,
  `indexeddb`, `localstorage`, `lsp`, `tree-sitter`, `encrypt/decrypt` unless justified).
  Document the curation rationale in a comment.
- In `packer.ts` `queryPlanBonus`: remove the `framework/pipeline`, `daily/digest`,
  `pipelines/.*renderer`, and `runpipeline` regexes. Keep generic entry-point matching
  (`main`, `index`, `app`, `server`) and the `preferredSources`/`requiredEvidence` logic
  that is repo-agnostic.
- In `local-retriever.ts:233`: replace the `runpipeline`-specific boost; if an entry-point
  boost is warranted, base it on generic entry filenames and use a defensible magnitude
  (the current `+24` is large — justify or reduce).

### Task 1.2 — Guard against regression with the eval harness
- Before changing weights, capture a baseline: `npm run eval:retrieval` (CLI at
  `src/eval/retrieval-cli.ts`). Record current scores.
- The eval corpus may itself be the source of the overfitting. **Treat eval repos as
  held-out** — do not tune weights to memorize their paths. If the eval fixtures *are* the
  arXiv/digest/editor projects, add at least one structurally different fixture repo so
  "generic" is actually measured.
- After the change, re-run the eval. Goal: comparable or better generalization, not a
  collapse. Document before/after in the PR description.

### Task 1.3 — Tests
- Extend `test/scoring-policy.test.ts`, `test/retrieval-reranker.test.ts`, and
  `test/context-packer.test.ts` to assert that generic repos rank sensibly and that the
  removed tokens no longer grant bonuses (e.g. a file named `socket.ts` in an unrelated repo
  gets no special boost).

**Acceptance:** No domain/path-specific literals from foreign repos remain in
`scoring-policy.ts`, `packer.ts`, `local-retriever.ts` (grep for
`arxiv|hacker|runpipeline|daily/digest|framework/pipeline` returns nothing in `src/`
outside tests). Eval scores documented. `npm run check` green.

---

## Priority 2 (Medium) — SEC-1: Unify on the strong secret-redaction logic

**Why:** There are **two** redaction implementations. The strong one
([source-safety.ts](../src/security/source-safety.ts)) uses regex assignment + PEM-block +
token patterns. The weak one in the Rust diagnostics bundle
([diagnostics.rs](../src-tauri/src/diagnostics.rs) `redact_sensitive_text`) is a fixed
keyword allowlist (`api_token`, `chat_api_key`, `sk-`, `bearer`…). A secret in
`runtime.env`/`desktop-config.json` that doesn't match those keywords (e.g.
`ANTHROPIC_API_KEY=`, `HF_TOKEN=`, a DB URL with an embedded password) lands in the bundle a
user may share.

### Task 2.1 — Make the Rust redactor value-based and pattern-driven
- Rewrite `redact_sensitive_text` in `diagnostics.rs` to redact the **value** of any
  `KEY=VALUE` or `"key": "value"` line whose key matches a broad secret pattern —
  `(?i)(api[_-]?key|token|secret|password|passwd|pwd|private[_-]?key|client[_-]?secret|access[_-]?key|refresh[_-]?token|connection[_-]?string|credential|auth)`
  — mirroring `SECRET_KEY_PATTERN` in `source-safety.ts`. Keep the existing `sk-` /
  `bearer ` / `authorization:` line redaction as an additional layer.
- Also redact PEM blocks (`-----BEGIN … PRIVATE KEY/CERTIFICATE-----` … `-----END …-----`)
  as `source-safety.ts` does.
- Keep redaction conservative: when in doubt, over-redact (replacing the whole line is
  acceptable; leaking is not).

### Task 2.2 — Reduce divergence (optional but recommended)
- Add a short comment in both files pointing at each other, noting they must stay in sync,
  OR factor the secret key-name list into a single shared source of truth referenced by
  both (a small constants file the Rust side reads, or a documented duplicated constant).

### Task 2.3 — Tests
- Extend the existing `#[test] diagnostics_redaction_removes_common_runtime_secrets` to
  cover the previously-missed cases: `ANTHROPIC_API_KEY=...`, `HF_TOKEN=...`,
  `DATABASE_URL=postgres://user:pass@host/db`, and a PEM block. Assert the secret values do
  not appear in the redacted output.

**Acceptance:** New test cases pass; non-`sk-` secrets in env/config files are redacted in
the bundle. `cargo test` green.

---

## Priority 3 (Medium) — BUG-2: Fix the local-model timeout/retry regression

**Why:** [llm-client.ts](../src/generator/llm-client.ts) lowered the default chat timeout
**300s → 60s** and raised `maxRetries` **1 → 2**. A slow-but-working local model can now
time out on a long briefing and have the **full generation re-issued up to 2×**, tripling
load on an already-struggling local server — directly hurting the headline local-first use
case. The new env vars are also undocumented.

### Task 3.1 — Don't retry timeouts; restore a sane local default
- Raise the default `SONAR_CHAT_TIMEOUT_MS` to ~120000–180000 (justify the number; local
  briefing generation is slow). Keep it overridable.
- Ensure **timeout** failures are not retried. The OpenAI SDK's `maxRetries` does not
  distinguish timeout from transport error, so either:
  - set the SDK `maxRetries: 0` and implement explicit retry only for connect/transport
    errors (reuse the `classifyLlmError` codes — retry `unreachable`/transient, never
    `timeout`/`rejected`/`rate_limited` unless intentionally backing off), or
  - keep SDK retries but document and verify they don't apply to timeouts.
- Confirm `LlmGenerationError` classification (`timeout`/`unreachable`/`rejected`/
  `rate_limited`/`provider`) still maps correctly to HTTP 502 in `src/api/errors.ts`.

### Task 3.2 — Document the env vars
- Add `SONAR_CHAT_TIMEOUT_MS` and `SONAR_CHAT_MAX_RETRIES` (and the existing
  `SONAR_DISABLE_MODEL_REASONING`) to `.env.example` with comments explaining defaults and
  when to change them. Note they also flow from the desktop app's model config.

### Task 3.3 — Tests
- Add a test asserting a timeout error is classified as `timeout` and is **not** retried
  (mock the client to count attempts). Extend `test/api-errors.test.ts` if needed.

**Acceptance:** Timeouts are not retried; default timeout is local-appropriate; env vars
documented. `npm run check` green.

---

## Priority 4 (Low) — Hardening and consistency

### Task 4.1 — SEC-2: Document the intentional repo-root trade-off
[services.rs](../src-tauri/src/services.rs) spawns the engine with
`SONAR_ALLOW_ANY_REPO_ROOT=true`, fully disabling the `assertRepoRootAllowed` guard in
[project-indexer.ts](../src/api/project-indexer.ts). This is defensible for a single-user
desktop app (the user picks the folder via native dialog), but it's currently undocumented.
- Add a code comment at the `env(...)` call in `services.rs` explaining the trade-off and
  the controls that remain (localhost bind + token + CORS).
- Note it in `docs/desktop.md` under the privacy/security boundary.
- **Do not** change the default behavior — just document it.

### Task 4.2 — QUAL-3: Harden API liveness and PID handling
In [services.rs](../src-tauri/src/services.rs):
- `is_api_ready()` is a bare TCP connect to `127.0.0.1:3001` — any process on that port
  reads as "ready." Strengthen by hitting `/health` and checking for the expected
  JSON/signature, not just a successful connect.
- `stop_managed_api_service()` `kill`s a PID read from `api.pid` with no ownership check
  (stale-PID reuse could kill an unrelated process). Verify the PID still corresponds to the
  Sonar API before killing (e.g. confirm the process command/args, or confirm `/health` on
  the port belongs to Sonar first).

### Task 4.3 — QUAL-4: Make citation-trust robust end-to-end
- [citation-verifier.ts](../src/generator/citation-verifier.ts): the `CitationClaimStatus`
  union includes `"repaired"` but the code only emits `verified`/`unverifiable`. Either emit
  `repaired` when a citation was auto-corrected, or remove it from the union and the UI.
- [MarkdownContent.tsx](../src-ui/src/components/MarkdownContent.tsx): claim flagging uses
  `renderedText.includes(item.text)` across two differently-normalized strings — an
  unverifiable claim can silently fail to be flagged. Normalize both sides identically (or
  pass claim offsets from the verifier) so the trust signal is reliable. This feature is
  what users are told to rely on, so correctness matters.
- Extend `test/citation-verifier.test.ts` for the `repaired` path and the
  normalization-mismatch case.

### Task 4.4 — SEC-3: Don't pass the notarization password on the argv
[sign-macos-app.mjs](../scripts/sign-macos-app.mjs) passes
`APPLE_APP_SPECIFIC_PASSWORD` via `xcrun notarytool --password`, visible in the process
table during the (multi-minute) `--wait`. Switch to `xcrun notarytool store-credentials`
into a temp keychain profile and pass `--keychain-profile`. Low severity on ephemeral CI
runners.

### Task 4.5 — QUAL-5: Minor consistency cleanups (batch into one PR)
- Three `process.env` reads in [llm-client.ts](../src/generator/llm-client.ts) bypass the
  central `CONFIG` object. Route them through `src/config.ts` like the rest of the engine.
- `.h` headers are hard-mapped to C++ in [generic-parser.ts](../src/parser/generic-parser.ts);
  acceptable, but add a comment noting the C/Obj-C ambiguity.
- Validate the new-language `declarations` maps against real repos — a 5-OO-file fixture
  currently yields only 2 classes / 1 method, suggesting shallow extraction for
  Ruby/PHP/Kotlin/Swift. Add fixtures with richer constructs and tune the node-type maps.
- Consider moving redundant native `tree-sitter-*` npm deps to `devDependencies` if they are
  only build-time grammar sources (runtime uses the committed `.wasm`). Confirm intent first.

### Task 4.6 — INHERENT: Document the prompt-injection boundary

**Why:** Indexed repository content flows into model prompts via the context packer, so a
repository can attempt to steer the model. This is inherent to the tool category and the
blast radius is already contained — model output is rendered as **markdown text** (no
`rehype-raw`, no `dangerouslySetInnerHTML` in
[MarkdownContent.tsx](../src-ui/src/components/MarkdownContent.tsx)) and is **never
executed**; there is no agentic tool-use driven by model output. No code change is required,
but it must be documented so it is a known, accepted boundary rather than a silent gap.

- Add a short subsection to `docs/desktop.md` (or the privacy/security boundary section)
  explaining that indexed source is treated as untrusted input to the model, that briefings
  are rendered as inert markdown, and that users should treat briefing claims as
  source-grounded drafts to verify (consistent with the existing citation-trust guidance).
- Before writing this, **re-confirm the rendering path stays inert**: verify no
  `rehype-raw`/`dangerouslySetInnerHTML`/raw-HTML pass-through has been added to
  `MarkdownContent.tsx` or any other component that renders model output. If any exists, that
  becomes a real fix, not a docs note.

**Acceptance:** Boundary documented; rendering path confirmed inert (grep for `rehype-raw`
and `dangerouslySetInnerHTML` in `src-ui/` returns nothing).

---

## Suggested sequencing

| Order | Fix | Why first |
|------|-----|-----------|
| 1 | QUAL-1 (de-overfit rankers) | Biggest impact on real-world briefing quality; gate with eval. |
| 2 | SEC-1 (unify redaction) | Closes a real secret-leak path; small and self-contained. |
| 3 | BUG-2 (timeout/retry) | Restores the local-first core path. |
| 4 | 4.1–4.6 (hardening + docs) | Independent low-risk follow-ups; can land in any order. |

## Definition of done (every fix)
- `npm run check` passes locally and in CI.
- Behavior change covered by tests in the existing style.
- Docs updated where user-facing (`.env.example`, `docs/`, `CHANGELOG.md`).
- Security posture intact or stronger.
- One focused PR per fix, with before/after notes (especially eval scores for QUAL-1).
