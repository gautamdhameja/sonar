# ADR 0001: Local model distribution

## Status

Accepted

## Context

Sonar generates briefings through an OpenAI-compatible model endpoint. The desktop shell can start a local
`llama-server` process when a binary exists under `~/.sonar/bin/llama-server` and a model exists under
`~/.sonar/models/default.gguf`, but public alpha builds do not bundle large model artifacts or a platform-specific
llama.cpp binary.

The production-readiness plan considered three options:

- Bring your own server: keep runtime lookup and make missing local model setup actionable.
- First-run download: download pinned llama.cpp and GGUF artifacts with checksum verification after explicit consent.
- Bundled binary: ship llama.cpp via Tauri `externalBin` and still download the model separately.

## Decision

Use the bring-your-own-server strategy for the public alpha. Sonar keeps the local runtime lookup, surfaces missing
local model setup as a first-class recoverable state, and supports pointing the app at any OpenAI-compatible endpoint.
Generation paths run a model preflight before calling the model so an unreachable endpoint fails quickly with an
actionable setup message.

## Consequences

- The alpha stays small and avoids silent network downloads, preserving the local privacy boundary.
- Users can run Sonar with a local llama.cpp server, a self-hosted OpenAI-compatible server, or a cloud endpoint they
  configure explicitly.
- A future first-run acquisition flow can layer on top of this decision by adding explicit consent, pinned artifact
  versions, checksum verification, progress, and resume support.
- The alpha is not fully turnkey: users still need to provide a local model server or configure an API endpoint.
