# Language Support and Limits

Sonar indexes source code with tree-sitter parsers where available, then combines exact lookup, lexical search, vector search, and graph expansion to build briefings and answer follow-up questions.

## Supported Today

Code parsers:

- TypeScript and TSX
- JavaScript and JSX
- Python
- Rust
- Go
- Java
- C#

Documentation:

- Markdown
- MDX

## What Happens With Other Languages

Repositories can still be imported if they contain other languages. Sonar scans for common source extensions and shows a warning when it finds unsupported source languages.

Unsupported source files are skipped from code indexing. Documentation files may still be indexed, and supported source files in the same repository are still analyzed. The resulting briefing can be useful, but it may be incomplete or docs-heavy if the unsupported language is central to the project.

## Current Limits

- Dependency and graph expansion are strongest for TypeScript and JavaScript. Other supported languages provide parsed source units, imports, and best-effort call names, but cross-file dependency resolution is more limited.
- Generated briefings are source-grounded first drafts. They should be reviewed before being used as official onboarding, compliance, or architecture documentation.
- Very large files, generated files, vendored dependencies, and deeply nested directories may be skipped or down-ranked to keep indexing practical on a laptop.
- If a repository has little documentation and most of its code is in an unsupported language, Sonar should be treated as a partial overview rather than a complete codebase explanation.

## How to Read the Warning

The desktop app warning lists unsupported languages and file counts, for example:

```text
Limited language coverage: C++ (28), PHP (12). Unsupported source files are skipped, so this briefing may be incomplete.
```

That warning does not mean the import failed. It means Sonar will analyze the supported code and documentation it can parse, while being explicit about the parts it cannot fully cover yet.
