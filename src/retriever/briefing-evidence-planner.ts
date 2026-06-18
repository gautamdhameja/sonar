import path from "path";
import { CodeUnit } from "../parser/types";
import {
  BriefingEvidenceBucket,
  classifyBriefingEvidence,
  isBriefingNoiseFile,
  isDocumentationFile,
  isNarrowReferenceDoc,
  isProductOverviewDoc,
  isTestFile,
} from "./source-classifier";
import { CodeUnitStore } from "./unit-store";

export interface BriefingBucketSummary {
  bucket: BriefingEvidenceBucket;
  unitCount: number;
  fileCount: number;
  sampleFiles: string[];
}

export interface RepositoryCensus {
  totalUnits: number;
  totalFiles: number;
  usableUnits: number;
  noiseFiles: number;
  buckets: BriefingBucketSummary[];
}

export interface BriefingEvidenceDiagnostic {
  unitId: string;
  filePath: string;
  name: string;
  score: number;
  reasons: string[];
  buckets: BriefingEvidenceBucket[];
}

export interface BriefingEvidencePlan {
  units: CodeUnit[];
  diagnostics: BriefingEvidenceDiagnostic[];
  census: RepositoryCensus;
  missingBuckets: BriefingEvidenceBucket[];
}

const SECTION_BUCKETS: Record<string, BriefingEvidenceBucket[]> = {
  "Product In One Paragraph": ["overview_docs", "stack_config", "operations_config", "data_model", "routes_pages"],
  "Who Uses It And Why": [
    "overview_docs",
    "operations_config",
    "data_model",
    "routes_pages",
    "billing_limits",
    "analytics_tracking",
  ],
  "Codebase Product Map": [
    "operations_config",
    "data_model",
    "routes_pages",
    "api_handlers",
    "auth_security",
    "storage_files",
    "analytics_tracking",
    "billing_limits",
    "enterprise_features",
    "workflow_jobs",
    "ai_features",
  ],
  "Top User Workflows": [
    "operations_config",
    "routes_pages",
    "api_handlers",
    "data_model",
    "storage_files",
    "analytics_tracking",
    "billing_limits",
    "workflow_jobs",
    "ai_features",
  ],
  "Main Systems And Ownership Areas": [
    "auth_security",
    "routes_pages",
    "api_handlers",
    "data_model",
    "storage_files",
    "operations_config",
    "billing_limits",
    "enterprise_features",
  ],
  "Data, Privacy, And Operational Notes": [
    "data_model",
    "auth_security",
    "analytics_tracking",
    "storage_files",
    "operations_config",
    "workflow_jobs",
    "ai_features",
  ],
  "Risks Or Open Questions": [
    "auth_security",
    "api_handlers",
    "routes_pages",
    "storage_files",
    "analytics_tracking",
    "billing_limits",
    "enterprise_features",
    "workflow_jobs",
    "ai_features",
  ],
  "Glossary For A Non-Deeply-Technical Reader": ["data_model", "overview_docs", "routes_pages", "api_handlers"],
};

const BUCKET_BUDGETS: Record<BriefingEvidenceBucket, number> = {
  overview_docs: 2,
  stack_config: 2,
  data_model: 5,
  routes_pages: 4,
  api_handlers: 6,
  auth_security: 3,
  storage_files: 3,
  analytics_tracking: 2,
  billing_limits: 2,
  enterprise_features: 3,
  workflow_jobs: 2,
  ai_features: 2,
  operations_config: 2,
};

function directoryKey(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return ".";
  if (["app", "pages", "routes", "controllers", "handlers", "views", "screens"].includes(parts[0])) {
    return parts.slice(0, Math.min(parts.length - 1, 3)).join("/");
  }
  return parts.slice(0, Math.min(parts.length - 1, 2)).join("/");
}

function baseWorkflowKey(filePath: string): string {
  return path
    .basename(filePath)
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

function highSignalPathScore(filePath: string, bucket: BriefingEvidenceBucket): number {
  const normalized = filePath.toLowerCase();
  let score = 0;
  const coreEntityFile =
    /(^|\/)(memo|note|post|entry|document|record|item)(?:_service|service)?\.[^.]+$/.test(normalized) ||
    /(^|\/)(memo|note|post|entry|document|record|item)\.[^.]+$/.test(normalized);

  if (isProductOverviewDoc(filePath)) score += 120;
  if (isNarrowReferenceDoc(filePath)) score -= bucket === "overview_docs" ? 75 : 45;
  if (/^readme\.mdx?$/.test(normalized)) score += 90;
  if (
    /^(package\.json|go\.mod|cargo\.toml|pyproject\.toml|requirements\.txt|pom\.xml|build\.gradle|settings\.gradle|cmakelists\.txt|makefile|[^/]+\.csproj|[^/]+\.sln)$/.test(
      normalized,
    )
  ) {
    score += 85;
  }
  if (/^middleware\.[tj]s$/.test(normalized)) score += 80;
  if (
    /prisma\/schema\/|schema\.prisma$|(^|\/)(models?|store|stores|domain|entities|repository|repositories|db|database)\//.test(
      normalized,
    ) ||
    /(^|\/)(models?|store|schema|repository)\.[^.]+$/.test(normalized)
  ) {
    score += 75;
  }
  if (/^(pages|app)\/view\//.test(normalized) || /(^|\/)(views?|pages|screens|portal)\//.test(normalized)) {
    score += 55;
  }
  if (/^(pages|app)\/(dashboard|admin|settings|account|reports?)/.test(normalized)) score += 42;
  if (
    /^(pages|app)\/api\//.test(normalized) ||
    /\/api\//.test(normalized) ||
    /(^|\/)(controllers?|handlers?|endpoints?|resources?|services?)\//.test(normalized) ||
    /(^|\/)([^/]+_service|[^/]+service|[^/]+_handler|[^/]+handler|[^/]+_controller|[^/]+controller|router|routes?|server)\.[^.]+$/.test(
      normalized,
    )
  ) {
    score += 56;
  }
  if (/(^|\/)(main|server|application|program|router|routes?)\.[^.]+$/.test(normalized)) score += 58;
  if (/(^|\/)(cmd|cli|commands?)\//.test(normalized)) score += 64;
  if (/(^|\/)(build|builder|site|sites?|engine|orchestrat|pipeline)/.test(normalized)) score += 44;
  if (/(create|new|upload|import|submit|process|convert|ingest|sync)/.test(normalized)) score += 35;
  if (/(memo|note|post|entry|item|record|document|content)/.test(normalized)) score += 32;
  if (coreEntityFile) score += bucket === "data_model" || bucket === "api_handlers" ? 80 : 36;
  if (bucket === "data_model" && /(^|\/)([^/]+_share|[^/]+_relation|attachment)\.[^.]+$/.test(normalized)) {
    score -= 28;
  }
  if (/(share|link|invite|viewer|public|portal|room|space)/.test(normalized)) score += 35;
  if (/(^|\/)(access|token|tokens|api-?key|credentials?)\b/.test(normalized) && bucket === "auth_security") {
    score += 24;
  }
  if (/(analytics|tracking|event|metric|dashboard|report|visit|view)/.test(normalized)) score += 35;
  if (/(auth|session|login|permission|security|token|oauth|middleware)/.test(normalized)) score += 35;
  if (/(storage|file|asset|blob|s3|upload|download|import|attachment)/.test(normalized)) score += 35;
  if (/(billing|plan|limit|subscription|checkout|invoice|stripe|usage)/.test(normalized)) score += 35;
  if (/(workflow|job|queue|trigger|webhook|integration|automation)/.test(normalized)) score += 30;
  if (/(ai|chat|assistant|embedding|vector|model)/.test(normalized)) score += bucket === "ai_features" ? 35 : 8;
  if (/\/export-[^/]+\.[cm]?[jt]sx?$/.test(normalized)) score -= 65;
  if (/\/demo\.[tj]sx?$|_demo\.[tj]sx?$/.test(normalized)) score -= 30;
  if (/(^|\/)([^/]+_service|[^/]+service)\.[^.]+$/.test(normalized)) score += 24;
  if (/(^|\/)([^/]+_converter|[^/]+converter|[^/]+_helpers?|[^/]+helpers?)\.[^.]+$/.test(normalized)) score -= 24;

  return score;
}

function scoreForBucket(unit: CodeUnit, bucket: BriefingEvidenceBucket): number {
  const buckets = classifyBriefingEvidence(unit.filePath);
  if (!buckets.includes(bucket)) return Number.NEGATIVE_INFINITY;

  let score = 100 + highSignalPathScore(unit.filePath, bucket);
  if (unit.kind === "module") score += 20;
  if (isDocumentationFile(unit.filePath)) score += bucket === "overview_docs" ? 20 : -12;
  if (isTestFile(unit.filePath)) score -= 55;
  if (unit.isVendored) score -= 100;
  score -= Math.min(25, Math.max(0, unit.filePath.split("/").length - 4) * 3);
  return score;
}

function usableUnits(units: CodeUnit[]): CodeUnit[] {
  return units.filter((unit) => !unit.isVendored && !isBriefingNoiseFile(unit.filePath) && !isTestFile(unit.filePath));
}

export function buildRepositoryCensus(units: CodeUnit[]): RepositoryCensus {
  const files = new Set(units.map((unit) => unit.filePath));
  const noiseFiles = new Set(units.filter((unit) => isBriefingNoiseFile(unit.filePath)).map((unit) => unit.filePath));
  const bucketStats = new Map<BriefingEvidenceBucket, { units: number; files: Set<string>; sampleFiles: string[] }>();
  const usable = usableUnits(units);

  for (const unit of usable) {
    for (const bucket of classifyBriefingEvidence(unit.filePath)) {
      const stat = bucketStats.get(bucket) ?? { units: 0, files: new Set<string>(), sampleFiles: [] };
      stat.units += 1;
      if (!stat.files.has(unit.filePath) && stat.sampleFiles.length < 5) stat.sampleFiles.push(unit.filePath);
      stat.files.add(unit.filePath);
      bucketStats.set(bucket, stat);
    }
  }

  const buckets = [...bucketStats.entries()]
    .map(([bucket, stat]) => ({
      bucket,
      unitCount: stat.units,
      fileCount: stat.files.size,
      sampleFiles: stat.sampleFiles,
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.bucket.localeCompare(b.bucket));

  return {
    totalUnits: units.length,
    totalFiles: files.size,
    usableUnits: usable.length,
    noiseFiles: noiseFiles.size,
    buckets,
  };
}

function selectBucketUnits(units: CodeUnit[], bucket: BriefingEvidenceBucket, budget: number): CodeUnit[] {
  const scored = units
    .map((unit) => ({ unit, score: scoreForBucket(unit, bucket) }))
    .filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath));

  const selected: CodeUnit[] = [];
  const directoryCounts = new Map<string, number>();
  const workflowCounts = new Map<string, number>();

  for (const entry of scored) {
    const dir = directoryKey(entry.unit.filePath);
    const workflow = baseWorkflowKey(entry.unit.filePath);
    const directoryLimit = bucket === "api_handlers" || bucket === "data_model" ? 4 : 2;
    if ((directoryCounts.get(dir) ?? 0) >= directoryLimit) continue;
    const workflowLimit = workflow.startsWith("export-") ? 1 : 2;
    if ((workflowCounts.get(workflow) ?? 0) >= workflowLimit) continue;

    selected.push(entry.unit);
    directoryCounts.set(dir, (directoryCounts.get(dir) ?? 0) + 1);
    workflowCounts.set(workflow, (workflowCounts.get(workflow) ?? 0) + 1);
    if (selected.length >= budget) break;
  }

  return selected;
}

function needsProductGrounding(sections: string[]): boolean {
  return sections.some((section) => /product|who uses|map|workflow|glossary/i.test(section));
}

function selectProductOverviewUnits(units: CodeUnit[], sections: string[]): CodeUnit[] {
  if (!needsProductGrounding(sections)) return [];

  return units
    .filter((unit) => isProductOverviewDoc(unit.filePath))
    .map((unit) => ({ unit, score: scoreForBucket(unit, "overview_docs") }))
    .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath))
    .slice(0, 2)
    .map((entry) => entry.unit);
}

function selectCodeGroundingUnits(units: CodeUnit[], requiredBuckets: BriefingEvidenceBucket[]): CodeUnit[] {
  const groundingBuckets = requiredBuckets.filter((bucket) =>
    ["routes_pages", "api_handlers", "data_model", "operations_config", "storage_files", "workflow_jobs"].includes(
      bucket,
    ),
  );
  if (groundingBuckets.length === 0) return [];

  return units
    .filter((unit) => !isDocumentationFile(unit.filePath))
    .map((unit) => ({
      unit,
      score: Math.max(...groundingBuckets.map((bucket) => scoreForBucket(unit, bucket))),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath))
    .slice(0, 4)
    .map((entry) => entry.unit);
}

function uniqueBucketsForSections(sections: string[]): BriefingEvidenceBucket[] {
  const buckets = new Set<BriefingEvidenceBucket>();
  for (const section of sections) {
    for (const bucket of SECTION_BUCKETS[section] ?? []) buckets.add(bucket);
  }
  return [...buckets];
}

function uniqueUnits(units: CodeUnit[]): CodeUnit[] {
  const seen = new Set<string>();
  const output: CodeUnit[] = [];
  for (const unit of units) {
    if (seen.has(unit.id)) continue;
    seen.add(unit.id);
    output.push(unit);
  }
  return output;
}

export function planBriefingEvidence(store: CodeUnitStore, sections: string[]): BriefingEvidencePlan {
  const allUnits = store.getAllUnits();
  const census = buildRepositoryCensus(allUnits);
  const candidates = usableUnits(allUnits);
  const requiredBuckets = uniqueBucketsForSections(sections);
  const selectedByBucket = new Map<BriefingEvidenceBucket, CodeUnit[]>();

  for (const bucket of requiredBuckets) {
    const budget = BUCKET_BUDGETS[bucket] ?? 2;
    const selected = selectBucketUnits(candidates, bucket, budget);
    if (selected.length > 0) selectedByBucket.set(bucket, selected);
  }

  const productOverviewUnits = selectProductOverviewUnits(candidates, sections);
  const codeGroundingUnits = selectCodeGroundingUnits(candidates, requiredBuckets);
  const units = uniqueUnits([...productOverviewUnits, ...codeGroundingUnits, ...selectedByBucket.values()].flat());
  const coveredBuckets = new Set<BriefingEvidenceBucket>();
  for (const unit of units) {
    for (const bucket of classifyBriefingEvidence(unit.filePath)) {
      if (requiredBuckets.includes(bucket)) coveredBuckets.add(bucket);
    }
  }

  const diagnostics = units.map((unit) => {
    const buckets = classifyBriefingEvidence(unit.filePath).filter((bucket) => requiredBuckets.includes(bucket));
    const topScore = Math.max(...buckets.map((bucket) => scoreForBucket(unit, bucket)));
    return {
      unitId: unit.id,
      filePath: unit.filePath,
      name: unit.name,
      score: Number.isFinite(topScore) ? topScore : 0,
      reasons: buckets.map((bucket) => `planned ${bucket} evidence`),
      buckets,
    };
  });

  return {
    units,
    diagnostics,
    census,
    missingBuckets: requiredBuckets.filter((bucket) => !coveredBuckets.has(bucket)),
  };
}
