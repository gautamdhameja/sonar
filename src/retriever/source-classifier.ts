import { CodeUnit } from "../parser/types";

export type BriefingEvidenceBucket =
  | "overview_docs"
  | "stack_config"
  | "data_model"
  | "routes_pages"
  | "api_handlers"
  | "auth_security"
  | "storage_files"
  | "analytics_tracking"
  | "billing_limits"
  | "enterprise_features"
  | "workflow_jobs"
  | "ai_features"
  | "operations_config";

export function isTestFile(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/|(\.|-)(test|spec)\.[tj]sx?$|(^|\/)test_[^/]+\.py$|(^|\/)[^/]+_test\.py$/.test(
    filePath,
  );
}

export function isDocumentationFile(filePath: string): boolean {
  return /^(readme|docs\/|.*\.mdx?$)/i.test(filePath);
}

export function isBriefingNoiseFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return (
    /(^|\/)(\.agents|\.cursor|\.github|node_modules|public\/vendor|vendor|dist|build|coverage)\//.test(normalized) ||
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|cargo\.lock|pipfile\.lock)$/.test(normalized) ||
    /\.min\.[cm]?[jt]sx?$/.test(normalized) ||
    /\.(png|jpe?g|gif|webp|svg|ico|pdf|map)$/.test(normalized)
  );
}

export function classifyBriefingEvidence(filePath: string): BriefingEvidenceBucket[] {
  const normalized = filePath.toLowerCase();
  const buckets = new Set<BriefingEvidenceBucket>();

  if (/^(readme\.mdx?|docs\/.*\.mdx?|security\.mdx?)$/.test(normalized)) buckets.add("overview_docs");
  if (
    /(^|\/)(package\.json|.*config\.[cm]?[jt]s|.*config\.json|tsconfig\.json|vercel\.json|dockerfile|compose.*\.ya?ml)$/.test(
      normalized,
    )
  ) {
    buckets.add("stack_config");
    buckets.add("operations_config");
  }
  if (/prisma\/schema\/|schema\.prisma|models?\//.test(normalized)) buckets.add("data_model");
  if (
    (/^(app|pages)\//.test(normalized) && !/^(app|pages)\/api\//.test(normalized)) ||
    /(^|\/)(routes?|views?|pages|screens|ui|components)\//.test(normalized)
  ) {
    buckets.add("routes_pages");
  }
  if (
    /^(app|pages)\/api\//.test(normalized) ||
    /\/api\//.test(normalized) ||
    /(^|\/)(controllers?|handlers?|endpoints?|resources?)\//.test(normalized)
  ) {
    buckets.add("api_handlers");
  }
  if (
    /(^|\/)(auth|middleware|security|permissions?|tokens?|oauth|saml|scim|ssrf|rate-limit|verify|verification)/.test(
      normalized,
    ) ||
    /(auth|security|permission|token|oauth|saml|scim|ssrf|verify|verification)/.test(normalized)
  ) {
    buckets.add("auth_security");
  }
  if (/(upload|storage|blob|object-store|files?|assets?|process|convert|conversion)/.test(normalized)) {
    buckets.add("storage_files");
  }
  if (/(analytics|tracking|views?|visits?|events?|metrics?|activity|reports?)/.test(normalized)) {
    buckets.add("analytics_tracking");
  }
  if (/(billing|stripe|limits?|plans?|subscription|checkout|invoice)/.test(normalized)) {
    buckets.add("billing_limits");
  }
  if (/^ee\//.test(normalized) || /(enterprise|saml|scim|directory-sync)/.test(normalized)) {
    buckets.add("enterprise_features");
  }
  if (/(workflow|jobs?|queue|trigger|cron|webhooks?|incoming-webhooks?)/.test(normalized)) {
    buckets.add("workflow_jobs");
  }
  if (/(^|\/)(ai|chat|vector-store|vector|embedding|agent)/.test(normalized)) {
    buckets.add("ai_features");
  }

  return [...buckets];
}

export function isVendored(unit: CodeUnit): boolean {
  return unit.isVendored;
}

export function queryNeedsTestEvidence(query: string): boolean {
  return /\b(test|tests|spec|coverage|validated|validation|schema|config|configured|env)\b/i.test(query);
}
