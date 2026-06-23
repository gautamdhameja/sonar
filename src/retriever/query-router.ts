import {
  classifyQueryIntent,
  QueryIntent,
  shouldIncludeSummaryForIntent,
  shouldUseGraphForIntent,
} from "./query-intent";

export type RetrievalMode = "exact" | "literal" | "hybrid" | "graph_hybrid" | "summary_graph";

export interface QueryPlan {
  intent: QueryIntent;
  mode: RetrievalMode;
  requiredEvidence: string[];
  preferredSources: Array<"code" | "docs" | "tests" | "config" | "schema" | "graph">;
  graphDirection: "none" | "upstream" | "downstream" | "bidirectional";
  sourceBudget: {
    code: number;
    docs: number;
    tests: number;
  };
  useLocalExact: boolean;
  useLexical: boolean;
  useGraph: boolean;
  includeSummary: boolean;
  maxContextRatio: number;
  reason: string;
}

function baseBudget() {
  return { code: 8, docs: 1, tests: 1 };
}

function hasQuotedLiteral(query: string): boolean {
  return /[`'"][^`'"]{4,}[`'"]/.test(query);
}

function hasErrorOrConfigShape(query: string): boolean {
  return (
    /\b(error|exception|failed|stack trace|env|config|setting|key|token|url)\b/i.test(query) ||
    /\b[A-Z][A-Z0-9_]{3,}\b/.test(query) ||
    /\b\d{3,}\b/.test(query)
  );
}

export function planQuery(query: string): QueryPlan {
  const intent = classifyQueryIntent(query);

  if (intent === "file_explanation" || intent === "specific_symbol") {
    return {
      intent,
      mode: "exact",
      requiredEvidence: ["exact_file_or_symbol"],
      preferredSources: ["code"],
      graphDirection: "none",
      sourceBudget: { code: 9, docs: 0, tests: 1 },
      useLocalExact: true,
      useLexical: true,
      useGraph: false,
      includeSummary: false,
      maxContextRatio: 0.8,
      reason: "file or symbol query should prefer exact local matches before broader local search",
    };
  }

  if (hasQuotedLiteral(query) || hasErrorOrConfigShape(query)) {
    return {
      intent,
      mode: "literal",
      requiredEvidence: ["literal_match", "definition_or_config", "validation_or_tests"],
      preferredSources: ["config", "schema", "tests", "code"],
      graphDirection: "upstream",
      sourceBudget: { code: 6, docs: 0, tests: 2 },
      useLocalExact: false,
      useLexical: true,
      useGraph: false,
      includeSummary: false,
      maxContextRatio: 0.7,
      reason: "literal/debug query should search exact text and configuration-adjacent code first",
    };
  }

  if (intent === "architecture_overview" || intent === "business_overview") {
    return {
      intent,
      mode: "summary_graph",
      requiredEvidence: ["overview_docs", "entry_points", "central_modules"],
      preferredSources: ["docs", "code", "graph"],
      graphDirection: "bidirectional",
      sourceBudget: { code: 6, docs: 3, tests: 0 },
      useLocalExact: false,
      useLexical: true,
      useGraph: true,
      includeSummary: true,
      maxContextRatio: 0.65,
      reason: "overview query should use summaries, workflow planning, graph context, and compact supporting code",
    };
  }

  if (shouldUseGraphForIntent(intent)) {
    return {
      intent,
      mode: "graph_hybrid",
      requiredEvidence:
        intent === "workflow_trace"
          ? ["workflow_entry", "stage_functions", "persistence_or_output"]
          : ["lexical_seed", "graph_neighbors"],
      preferredSources: ["code", "graph"],
      graphDirection: "bidirectional",
      sourceBudget: { code: 8, docs: 1, tests: 1 },
      useLocalExact: false,
      useLexical: true,
      useGraph: true,
      includeSummary: shouldIncludeSummaryForIntent(intent),
      maxContextRatio: 0.8,
      reason: "workflow/dependency/risk query needs lexical seeds plus graph neighbors",
    };
  }

  return {
    intent,
    mode: "hybrid",
    requiredEvidence: ["relevant_code"],
    preferredSources: ["code"],
    graphDirection: "none",
    sourceBudget: baseBudget(),
    useLocalExact: false,
    useLexical: true,
    useGraph: false,
    includeSummary: false,
    maxContextRatio: 1,
    reason: "general code question uses lexical retrieval with local code scoring",
  };
}
