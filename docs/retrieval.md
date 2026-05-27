# Retrieval And Quality

Sonar is optimized for medium local models running on a laptop. The query path avoids sending every question through embeddings and a large prompt.

## Onboarding Sessions

An onboarding session stores:

- The generated onboarding brief.
- The target audience and focus areas.
- The persona settings.
- The source files cited by the brief.
- User and assistant follow-up messages.
- A compact rolling conversation summary.

Follow-up questions use this session state to improve retrieval. Sonar boosts files already cited in the onboarding brief, classifies the follow-up intent, performs exact and lexical search for named files or concepts, uses vector retrieval when useful, and expands through the dependency graph for workflow questions.

Common follow-up shapes:

- "What does this term mean?"
- "How does this workflow work?"
- "Where is this implemented?"
- "What should I ask engineering?"
- "Explain this file or component."
- "Rewrite this for a PM, designer, or support lead."

The onboarding brief and prior messages are used for orientation. Concrete implementation claims should come from the retrieved source context.

## Routed Retrieval

Current routing:

- `exact`: file and symbol questions use local symbol/path lookup plus lexical search before any vector fallback.
- `literal`: errors, env vars, config keys, quoted strings, and debug questions use grep-like lexical search over indexed code units and skip vectors when matches are found.
- `hybrid`: general conceptual code questions use lexical retrieval plus Meilisearch/Qdrant reciprocal rank fusion.
- `graph_hybrid`: workflow, dependency, and risk questions use hybrid seeds plus graph expansion.
- `summary_graph`: architecture and onboarding questions include the stored codebase summary and pack a compact set of supporting code.

The context packer ranks snippets before prompting. It favors retrieval score, exact name/path matches, exported symbols, non-vendored code, and file diversity, then enforces the token budget. Smaller local models answer better from less context when that context is precise.

The dedicated onboarding flow adds another retrieval pass that favors product documentation, app/package boundaries, entry points, collaboration/sharing files, local persistence files, and privacy or operational evidence. Follow-up retrieval pins smaller relevant units from previously cited onboarding files so the session stays grounded in the material the user already saw.

## Citation And Quality Notes

Sonar asks the model to cite concrete claims in `[file:start-end]` form and runs a citation verifier on the generated answer. When the verifier finds problems, Sonar can run a repair prompt and keep the repaired answer if it improves citation quality.

Known V1 limitation: medium local models may still produce uncited introductory or summary sentences even when the core source claims are cited. Treat cited claims as the reliable parts of the answer and treat uncited summary language as guidance to verify.

## Recommended Next Work

- Store project, directory, file, and workflow summaries as first-class retrieval records in SQLite, Meilisearch, and Qdrant.
- Replace full-function embedding with structured embeddings: signature, docstring, imports, exports, and a short body preview; chunk large bodies separately.
- Move dependency extraction from the API server into `src/graph/` and store typed edges such as `imports_file`, `calls_symbol`, `exports_symbol`, and `defined_in_file`.
- Add an optional ripgrep backend for raw repository text and stack traces when `rg` is available, with the current indexed lexical search as the portable fallback.
- Add stricter post-generation citation enforcement that rewrites or removes uncited claims without another full model pass.
- Return richer retrieval traces in API responses, including route, scores, omitted files, and why each source was packed.
