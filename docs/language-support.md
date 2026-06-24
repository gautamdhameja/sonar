# Language Support and Limits

Sonar indexes source code with tree-sitter parsers where available. For the first briefing, it now starts with a deterministic repository inventory, surveys selected source files into a source-backed memory graph, and writes from that graph plus compact source excerpts. Follow-up questions continue to use exact lookup, lexical search, BM25, graph expansion, and source retrieval.

## Supported Today

Code parsers:

- TypeScript and TSX
- JavaScript and JSX
- Python
- Rust
- Go
- Java
- C#
- Ruby
- C++
- PHP
- Kotlin
- Swift

Documentation:

- Markdown
- MDX

Text evidence for briefings:

- JSON manifests and configuration files, excluding lockfiles
- Prisma schema files

## What Happens With Other Languages

Repositories can still be imported if they contain other languages. Sonar scans for common source extensions and shows a warning when it finds unsupported source languages.

Unsupported source files are skipped from full code indexing, but Sonar still scans common source extensions for high-level signals such as entry points, file IO, network calls, config, logging, state, tests, and external boundaries. Documentation files, selected configuration files, and Prisma schema files may still be indexed, and supported source files in the same repository are still analyzed. The resulting briefing can be useful, but it may be incomplete if the unsupported language is central to the project.

## Current Limits

- Dependency and graph expansion are strongest for TypeScript and JavaScript. Other supported languages provide parsed source units, imports, and best-effort call names, but cross-file dependency resolution is more limited.
- JSON and Prisma files are indexed as text modules for briefing evidence. Sonar does not currently build full dependency graphs from them.
- Generated briefings are source-grounded first drafts for project orientation. They should be reviewed before being used as official onboarding, compliance, security, or architecture documentation.
- Sonar intentionally stays at briefing depth. For low-level debugging, refactoring, line-by-line code explanation, or implementation decisions, use an engineer or a dedicated coding agent with full repository context.
- Very large files, generated files, vendored dependencies, and deeply nested directories may be skipped or down-ranked to keep indexing practical on a laptop.
- If a repository has little documentation and most of its code is in an unsupported language, Sonar should be treated as a partial overview. The survey may detect high-level behavioral signals, but it cannot provide full parser-backed source understanding for that language yet.

## How to Read the Warning

The desktop app warning lists unsupported languages and file counts, for example:

```text
Limited language coverage: Scala (28), Lua (12). Unsupported source files are skipped, so this briefing may be incomplete.
```

That warning does not mean the import failed. It means Sonar will analyze the supported code and documentation it can parse, survey unsupported files only at a lighter signal level, and stay explicit about the parts it cannot fully cover yet.
