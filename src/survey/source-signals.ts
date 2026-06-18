export type SourceSignalKind =
  | "entry_point"
  | "file_io"
  | "network"
  | "process"
  | "cli"
  | "database"
  | "config"
  | "test"
  | "ui"
  | "logging"
  | "error_handling"
  | "external_dependency"
  | "state";

export interface SourceSignal {
  kind: SourceSignalKind;
  score: number;
  reason: string;
}

interface SignalRule {
  kind: SourceSignalKind;
  score: number;
  reason: string;
  path?: RegExp;
  text?: RegExp;
}

const SIGNAL_RULES: SignalRule[] = [
  {
    kind: "entry_point",
    score: 32,
    reason: "common executable or application entry point",
    path: /(^|\/)(main|index|app|server|cli|cmd|program)\.[^.]+$/i,
  },
  {
    kind: "cli",
    score: 22,
    reason: "command-line arguments or terminal interface",
    text: /\b(argv|argc|commander|yargs|argparse|cobra|flag\.|process\.argv|std::env::args|System\.Console)\b/i,
  },
  {
    kind: "file_io",
    score: 24,
    reason: "file system reads or writes",
    text: /\b(fopen|fread|fwrite|readfile|writefile|readFile\w*|writeFile\w*|fs\.|open\(|File\.|Path\.|std::fs|os\.Open|ioutil\.|Files\.)\b/i,
  },
  {
    kind: "network",
    score: 24,
    reason: "network request, socket, route, or HTTP boundary",
    text: /\b(fetch|axios|http\.|https\.|socket|listen\(|connect\(|request\(|response|router|route|handler|controller|HttpClient|net\/http)\b/i,
  },
  {
    kind: "process",
    score: 18,
    reason: "process execution or background job behavior",
    text: /\b(spawn|exec|fork|worker|queue|job|cron|schedule|thread|pthread|goroutine|tokio|asyncio)\b/i,
  },
  {
    kind: "database",
    score: 22,
    reason: "database, query, migration, or persisted record boundary",
    text: /\b(select|insert|update|delete|transaction|migration|schema|model|repository|prisma|sequelize|typeorm|sqlx|jdbc|sqlite|postgres|mysql|redis)\b/i,
  },
  {
    kind: "config",
    score: 16,
    reason: "configuration or environment boundary",
    text: /\b(config|settings|env|ENV|dotenv|getenv|process\.env|yaml|toml|ini)\b/i,
  },
  {
    kind: "test",
    score: 12,
    reason: "test or specification evidence",
    path: /(^|\/)(tests?|__tests__)\/|(\.|-)(test|spec)\.[^.]+$|(^|\/)[^/]+_test\.[^.]+$/i,
  },
  {
    kind: "ui",
    score: 18,
    reason: "user interface, rendering, or event handling",
    text: /\b(render|component|view|screen|button|click|keydown|mousemove|canvas|window\.|document\.|React|Vue|Svelte|Widget|View)\b/i,
  },
  {
    kind: "logging",
    score: 12,
    reason: "logging or observability",
    text: /\b(console\.|logger|log\.|printf|fprintf|tracing|telemetry|metric|analytics|event)\b/i,
  },
  {
    kind: "error_handling",
    score: 14,
    reason: "error handling or recovery path",
    text: /\b(try|catch|except|throw|raise|Result<|panic|recover|error|errno|fallback|retry)\b/i,
  },
  {
    kind: "external_dependency",
    score: 12,
    reason: "external import, include, package, or service dependency",
    text: /^\s*(import|from|require|#include|use\s+|using\s+|package\s+|extern\s+crate)\b/im,
  },
  {
    kind: "state",
    score: 16,
    reason: "state mutation, cache, or in-memory data structure",
    text: /\b(state|store|cache|session|buffer|queue|map|set|struct|class|interface|type\s+|enum)\b/i,
  },
];

export function extractSourceSignals(filePath: string, text: string): SourceSignal[] {
  const signals = new Map<SourceSignalKind, SourceSignal>();

  for (const rule of SIGNAL_RULES) {
    const matchedPath = rule.path?.test(filePath) ?? false;
    const matchedText = rule.text?.test(text) ?? false;
    if (!matchedPath && !matchedText) continue;

    const existing = signals.get(rule.kind);
    if (!existing || existing.score < rule.score) {
      signals.set(rule.kind, {
        kind: rule.kind,
        score: rule.score,
        reason: rule.reason,
      });
    }
  }

  return [...signals.values()].sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind));
}
