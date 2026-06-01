import { CodeUnit } from "../parser/types";
import {
  BriefingEvidenceBucket,
  classifyBriefingEvidence,
  isBriefingNoiseFile,
  isDocumentationFile,
  isTestFile,
} from "./source-classifier";
import { CodeUnitStore } from "./unit-store";

export interface BriefingDomainEntity {
  name: string;
  category: string;
  filePath: string;
  lines: string;
  score: number;
}

export interface BriefingWorkflowTrace {
  id: string;
  name: string;
  priority: number;
  description: string;
  signals: string[];
  evidence: CodeUnit[];
}

export interface BriefingWorkflowPlan {
  productHypothesis: string;
  productSignals: string[];
  domainEntities: BriefingDomainEntity[];
  workflows: BriefingWorkflowTrace[];
  lifecycleEvidence: CodeUnit[];
  centralEvidence: CodeUnit[];
}

interface WorkflowBlueprint {
  id: string;
  name: string;
  description: string;
  terms: string[];
  pathPatterns: RegExp[];
  buckets: BriefingEvidenceBucket[];
  coreEntityTerms: string[];
}

const WORKFLOW_BLUEPRINTS: WorkflowBlueprint[] = [
  {
    id: "content-lifecycle",
    name: "Create, process, and manage core content",
    description:
      "How users create or upload the central object in the product and how the application stores or prepares it.",
    terms: ["item", "record", "document", "upload", "file", "content", "process", "convert", "asset", "resource"],
    pathPatterns: [
      /items?/,
      /records?/,
      /documents?/,
      /uploads?/,
      /files?/,
      /process/,
      /convert|conversion/,
      /resources?/,
    ],
    buckets: ["routes_pages", "api_handlers", "data_model", "storage_files", "workflow_jobs"],
    coreEntityTerms: ["item", "record", "document", "file", "asset", "content", "resource"],
  },
  {
    id: "sharing-access",
    name: "Share with recipients and control access",
    description:
      "How a user exposes content to someone else, and how the app decides whether the recipient can access it.",
    terms: ["share", "sharing", "link", "access", "verify", "verification", "viewer", "recipient", "portal", "space"],
    pathPatterns: [/links?/, /share/, /access/, /verify|verification/, /viewer?/, /recipients?/, /portal/, /space/],
    buckets: ["routes_pages", "api_handlers", "data_model", "auth_security", "enterprise_features"],
    coreEntityTerms: ["link", "share", "viewer", "view", "recipient", "portal", "space", "access"],
  },
  {
    id: "viewer-analytics",
    name: "Track recipient activity and report analytics",
    description:
      "How the product records recipient behavior and turns those events into insight for the account owner.",
    terms: ["view", "visit", "analytics", "tracking", "event", "metric", "activity", "report"],
    pathPatterns: [/views?/, /visits?/, /analytics/, /tracking/, /events?/, /metrics?/, /activity/, /reports?/],
    buckets: ["api_handlers", "data_model", "analytics_tracking", "routes_pages"],
    coreEntityTerms: ["view", "visit", "event", "analytics", "tracking"],
  },
  {
    id: "team-account-billing",
    name: "Manage teams, plans, limits, and billing",
    description: "How account-level ownership, plan limits, subscriptions, and billing affect what users can do.",
    terms: ["team", "teams", "billing", "stripe", "limit", "limits", "plan", "subscription", "checkout", "invoice"],
    pathPatterns: [/teams?/, /billing/, /stripe/, /limits?/, /plans?/, /subscription/, /checkout|invoice/],
    buckets: ["data_model", "api_handlers", "billing_limits", "enterprise_features"],
    coreEntityTerms: ["team", "plan", "subscription", "billing", "limit", "invoice"],
  },
  {
    id: "auth-security",
    name: "Authenticate users and protect sensitive routes",
    description: "How sign-in, middleware, permissions, and security checks protect product workflows.",
    terms: ["auth", "login", "user", "permission", "permissions", "middleware", "security", "token", "oauth", "ssrf"],
    pathPatterns: [/auth/, /middleware/, /permissions?/, /security/, /tokens?/, /oauth/, /ssrf/],
    buckets: ["auth_security", "api_handlers", "data_model", "operations_config"],
    coreEntityTerms: ["user", "auth", "account", "session", "oauth", "token"],
  },
  {
    id: "automation-integrations",
    name: "Run automations, jobs, and external integrations",
    description: "How background jobs, workflow engines, webhooks, or integrations extend the core product.",
    terms: ["workflow", "workflows", "job", "jobs", "queue", "trigger", "webhook", "integration", "incoming"],
    pathPatterns: [/workflows?/, /jobs?/, /queue/, /trigger/, /webhooks?/, /integrations?/],
    buckets: ["workflow_jobs", "api_handlers", "enterprise_features", "operations_config"],
    coreEntityTerms: ["workflow", "job", "webhook", "integration", "trigger"],
  },
  {
    id: "ai-assistance",
    name: "Use AI assistance where the product supports it",
    description:
      "How AI features are exposed and connected to the rest of the product without treating them as the whole product.",
    terms: ["ai", "chat", "conversation", "model", "embedding", "openai", "google"],
    pathPatterns: [/(^|\/)ai(\/|$)/, /chat/, /conversation/, /openai|google/, /embedding|model/],
    buckets: ["ai_features", "api_handlers", "data_model"],
    coreEntityTerms: ["ai", "chat", "conversation", "message", "model"],
  },
];

const PRODUCT_SIGNAL_TERMS = [
  "document",
  "link",
  "item",
  "record",
  "view",
  "analytics",
  "team",
  "billing",
  "storage",
  "workflow",
  "ai",
  "auth",
  "security",
  "file",
  "share",
  "viewer",
  "portal",
  "space",
];

interface LifecycleEvidenceRule {
  label: string;
  pathTerms: string[];
  codeTerms: string[];
  buckets: BriefingEvidenceBucket[];
  max: number;
}

const LIFECYCLE_EVIDENCE_RULES: LifecycleEvidenceRule[] = [
  {
    label: "upload/create content",
    pathTerms: [
      "create",
      "new",
      "upload",
      "import",
      "ingest",
      "submit",
      "process",
      "convert",
      "file",
      "asset",
      "content",
    ],
    codeTerms: ["create", "upload", "import", "ingest", "submit", "process", "convert", "store", "save"],
    buckets: ["api_handlers", "routes_pages", "storage_files", "workflow_jobs"],
    max: 4,
  },
  {
    label: "share and access",
    pathTerms: ["share", "link", "invite", "access", "public", "view", "viewer", "portal", "room", "space"],
    codeTerms: [
      "share",
      "invite",
      "access",
      "verify",
      "authorize",
      "permission",
      "password",
      "email",
      "token",
      "public",
    ],
    buckets: ["api_handlers", "routes_pages", "auth_security", "data_model"],
    max: 6,
  },
  {
    label: "track analytics",
    pathTerms: ["analytics", "tracking", "event", "metric", "report", "dashboard", "visit", "view", "activity"],
    codeTerms: ["track", "record", "event", "analytics", "metric", "report", "dashboard", "notify", "webhook"],
    buckets: ["analytics_tracking", "api_handlers", "routes_pages", "data_model"],
    max: 4,
  },
  {
    label: "limits and billing",
    pathTerms: ["billing", "plan", "limit", "subscription", "checkout", "invoice", "usage", "quota", "payment"],
    codeTerms: ["billing", "plan", "limit", "subscription", "checkout", "invoice", "quota", "usage", "payment"],
    buckets: ["billing_limits", "api_handlers", "data_model", "enterprise_features"],
    max: 3,
  },
];

function usableUnits(units: CodeUnit[]): CodeUnit[] {
  return units.filter((unit) => !unit.isVendored && !isBriefingNoiseFile(unit.filePath) && !isTestFile(unit.filePath));
}

function sourceKey(unit: CodeUnit): string {
  return `${unit.filePath}:${unit.startLine}-${unit.endLine}`;
}

function normalizedText(unit: CodeUnit): string {
  return `${unit.filePath}\n${unit.name}\n${unit.exportedNames.join(" ")}\n${unit.calledFunctions.join(" ")}\n${unit.code}`.toLowerCase();
}

function lineRange(unit: CodeUnit): string {
  return `${unit.startLine}-${unit.endLine}`;
}

function titleizeTerm(term: string): string {
  return term
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function entityCategory(name: string): string {
  const normalized = name.toLowerCase();
  if (/(user|account|session|team|member|invite)/.test(normalized)) return "account";
  if (/(document|file|asset|content|page)/.test(normalized)) return "content";
  if (/(link|share|view|viewer|visit|recipient|portal|space|access)/.test(normalized)) return "sharing";
  if (/(workflow|job|webhook|integration|trigger)/.test(normalized)) return "automation";
  if (/(plan|subscription|invoice|price|billing|limit)/.test(normalized)) return "commercial";
  if (/(conversation|message|chat|ai|model)/.test(normalized)) return "ai";
  return "domain";
}

function entityScore(entityName: string, unit: CodeUnit): number {
  const normalized = `${entityName} ${unit.filePath}`.toLowerCase();
  let score = 20;
  if (/prisma\/schema\//.test(unit.filePath.toLowerCase())) score += 35;
  if (/(item|record|document|link|team|user|view|viewer|recipient|portal|space)/.test(normalized)) score += 25;
  if (/(conversation|message|oauth)/.test(normalized)) score += 8;
  if (/(billing|subscription|plan|limit|workflow)/.test(normalized)) score += 14;
  return score;
}

function extractDomainEntities(units: CodeUnit[]): BriefingDomainEntity[] {
  const entities = new Map<string, BriefingDomainEntity>();

  for (const unit of units) {
    const modelMatches = unit.code.matchAll(/\bmodel\s+([A-Z][A-Za-z0-9_]*)\s*\{/g);
    for (const match of modelMatches) {
      const name = match[1];
      const score = entityScore(name, unit);
      const existing = entities.get(name);
      if (!existing || score > existing.score) {
        entities.set(name, {
          name,
          category: entityCategory(name),
          filePath: unit.filePath,
          lines: lineRange(unit),
          score,
        });
      }
    }

    const typeMatches = unit.code.matchAll(/\b(?:interface|type|class)\s+([A-Z][A-Za-z0-9_]*)\b/g);
    for (const match of typeMatches) {
      const name = match[1];
      if (name.length < 3) continue;
      const score = entityScore(name, unit) - 12;
      const existing = entities.get(name);
      if (!existing || score > existing.score) {
        entities.set(name, {
          name,
          category: entityCategory(name),
          filePath: unit.filePath,
          lines: lineRange(unit),
          score,
        });
      }
    }
  }

  return [...entities.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 14);
}

function collectProductSignals(units: CodeUnit[], entities: BriefingDomainEntity[]): string[] {
  const scores = new Map<string, number>();

  for (const term of PRODUCT_SIGNAL_TERMS) scores.set(term, 0);
  for (const unit of units) {
    const text = normalizedText(unit);
    const pathBoost = isDocumentationFile(unit.filePath) ? 4 : 1;
    for (const term of PRODUCT_SIGNAL_TERMS) {
      const matches = text.match(new RegExp(`\\b${term}s?\\b`, "g"))?.length ?? 0;
      scores.set(term, (scores.get(term) ?? 0) + Math.min(12, matches) * pathBoost);
    }
  }

  for (const entity of entities) {
    const normalized = entity.name.toLowerCase();
    for (const term of PRODUCT_SIGNAL_TERMS) {
      if (normalized.includes(term)) scores.set(term, (scores.get(term) ?? 0) + 20);
    }
  }

  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([term]) => titleizeTerm(term));
}

function buildProductHypothesis(signals: string[], entities: BriefingDomainEntity[]): string {
  const entityNames = entities.slice(0, 7).map((entity) => entity.name);
  const signalText = signals.length > 0 ? signals.join(", ") : "application structure";
  const entityText = entityNames.length > 0 ? ` Core entities include ${entityNames.join(", ")}.` : "";
  return `The repository appears to center on ${signalText}.${entityText}`;
}

function workflowUnitScore(unit: CodeUnit, blueprint: WorkflowBlueprint, entities: BriefingDomainEntity[]): number {
  const text = normalizedText(unit);
  const filePath = unit.filePath.toLowerCase();
  const buckets = classifyBriefingEvidence(unit.filePath);
  let score = 0;

  for (const bucket of blueprint.buckets) {
    if (buckets.includes(bucket)) score += 18;
  }
  for (const pattern of blueprint.pathPatterns) {
    if (pattern.test(filePath)) score += 22;
  }
  for (const term of blueprint.terms) {
    if (filePath.includes(term)) score += 12;
    if (unit.name.toLowerCase().includes(term)) score += 8;
    if (text.includes(term)) score += 2;
  }
  for (const entity of entities) {
    const entityName = entity.name.toLowerCase();
    if (blueprint.coreEntityTerms.some((term) => entityName.includes(term))) {
      if (filePath.includes(entityName) || text.includes(entityName)) score += 12;
    }
  }
  if (unit.kind === "module") score += 4;
  if (/^readme\.mdx?$/i.test(unit.filePath)) score += 5;
  if (/\/export-[^/]+/.test(filePath) && blueprint.id !== "viewer-analytics") score -= 30;

  return score;
}

function termMatches(text: string, terms: string[]): number {
  return terms.reduce((count, term) => (text.includes(term) ? count + 1 : count), 0);
}

function lifecycleEvidenceScore(unit: CodeUnit, rule: LifecycleEvidenceRule): number {
  const normalized = unit.filePath.toLowerCase();
  const text = normalizedText(unit);
  const buckets = classifyBriefingEvidence(unit.filePath);
  let score = 0;

  const pathMatches = termMatches(normalized, rule.pathTerms);
  const codeMatches = termMatches(text, rule.codeTerms);
  score += pathMatches * 22;
  score += Math.min(6, codeMatches) * 5;

  for (const bucket of rule.buckets) {
    if (buckets.includes(bucket)) score += 16;
  }
  if (unit.kind === "module") score += 8;
  if (/(^|\/)(index|route|handler|controller|service|manager|processor|workflow|pipeline)\.[^.]+$/.test(normalized)) {
    score += 12;
  }
  if (/schema\.prisma$|models?\//.test(normalized) && rule.buckets.includes("data_model")) score += 10;
  if (/\/(demo|test|spec|fixture|mock|export-[^/]+)\./.test(normalized)) score -= 35;
  return score;
}

function selectLifecycleEvidence(units: CodeUnit[]): CodeUnit[] {
  const selected: CodeUnit[] = [];
  const seen = new Set<string>();

  for (const rule of LIFECYCLE_EVIDENCE_RULES) {
    const matches = units
      .map((unit) => ({ unit, score: lifecycleEvidenceScore(unit, rule) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath))
      .slice(0, rule.max);

    for (const match of matches) {
      if (seen.has(match.unit.id)) continue;
      selected.push(match.unit);
      seen.add(match.unit.id);
    }
  }

  return selected;
}

function evidenceLayer(unit: CodeUnit): string {
  const buckets = classifyBriefingEvidence(unit.filePath);
  if (buckets.includes("routes_pages")) return "route";
  if (buckets.includes("api_handlers")) return "api";
  if (buckets.includes("data_model")) return "model";
  if (buckets.includes("storage_files")) return "storage";
  if (buckets.includes("analytics_tracking")) return "analytics";
  if (buckets.includes("auth_security")) return "security";
  if (buckets.includes("billing_limits")) return "billing";
  if (buckets.includes("workflow_jobs")) return "job";
  if (buckets.includes("ai_features")) return "ai";
  return "support";
}

function selectWorkflowEvidence(
  units: CodeUnit[],
  blueprint: WorkflowBlueprint,
  entities: BriefingDomainEntity[],
): { evidence: CodeUnit[]; score: number; signals: string[] } {
  const scored = units
    .map((unit) => ({ unit, score: workflowUnitScore(unit, blueprint, entities) }))
    .filter((entry) => entry.score > 12)
    .sort((a, b) => b.score - a.score || a.unit.filePath.localeCompare(b.unit.filePath));

  const evidence: CodeUnit[] = [];
  const seenFiles = new Set<string>();
  const seenLayers = new Set<string>();

  for (const entry of scored) {
    const layer = evidenceLayer(entry.unit);
    if (seenFiles.has(entry.unit.filePath) && seenLayers.has(layer)) continue;
    evidence.push(entry.unit);
    seenFiles.add(entry.unit.filePath);
    seenLayers.add(layer);
    if (evidence.length >= 6) break;
  }

  const score = scored.slice(0, 8).reduce((total, entry) => total + entry.score, 0);
  const signals = [...seenLayers].sort();
  return { evidence, score, signals };
}

function workflowPriority(id: string, score: number, productSignals: string[]): number {
  let priority = score;
  const normalizedSignals = productSignals.join(" ").toLowerCase();
  if (id === "ai-assistance" && !/\b(ai|chat|conversation)\b/.test(normalizedSignals)) priority -= 60;
  if (id === "content-lifecycle" && /\b(document|file|content)\b/.test(normalizedSignals)) priority += 45;
  if (id === "sharing-access" && /\b(link|share|viewer|portal|space)\b/.test(normalizedSignals)) priority += 45;
  if (id === "viewer-analytics" && /\b(view|analytics)\b/.test(normalizedSignals)) priority += 35;
  return priority;
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

export function buildBriefingWorkflowPlan(store: CodeUnitStore): BriefingWorkflowPlan {
  const units = usableUnits(store.getAllUnits());
  const entities = extractDomainEntities(units);
  const productSignals = collectProductSignals(units, entities);
  const lifecycleEvidence = selectLifecycleEvidence(units);
  const workflows = WORKFLOW_BLUEPRINTS.map((blueprint) => {
    const selected = selectWorkflowEvidence(units, blueprint, entities);
    return {
      id: blueprint.id,
      name: blueprint.name,
      priority: workflowPriority(blueprint.id, selected.score, productSignals),
      description: blueprint.description,
      signals: selected.signals,
      evidence: selected.evidence,
    };
  })
    .filter((workflow) => workflow.evidence.length >= 2 && workflow.priority > 25)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
    .slice(0, 6);

  const centralEvidence = uniqueUnits([
    ...units.filter((unit) => /^readme\.mdx?$/i.test(unit.filePath) || /^package\.json$/i.test(unit.filePath)),
    ...lifecycleEvidence,
    ...entities
      .map((entity) => units.find((unit) => unit.filePath === entity.filePath && lineRange(unit) === entity.lines))
      .filter((unit): unit is CodeUnit => Boolean(unit)),
    ...workflows.flatMap((workflow) => workflow.evidence),
  ]).slice(0, 36);

  return {
    productHypothesis: buildProductHypothesis(productSignals, entities),
    productSignals,
    domainEntities: entities,
    workflows,
    lifecycleEvidence,
    centralEvidence,
  };
}

export function workflowPlanToPrompt(plan: BriefingWorkflowPlan): string {
  const lines: string[] = [
    "## Internal Workflow Map",
    "Use this map to decide what matters before writing. It is derived from repository structure and source evidence; cite the source context, not this map alone.",
    "",
    `Product hypothesis: ${plan.productHypothesis}`,
  ];

  if (plan.productSignals.length > 0) {
    lines.push(`Product signals: ${plan.productSignals.join(", ")}`);
  }

  if (plan.domainEntities.length > 0) {
    lines.push("", "Domain entities:");
    for (const entity of plan.domainEntities.slice(0, 10)) {
      lines.push(`- ${entity.name} (${entity.category}) [${entity.filePath}:${entity.lines}]`);
    }
  }

  if (plan.workflows.length > 0) {
    lines.push("", "Ranked workflows:");
    for (const workflow of plan.workflows) {
      const refs = workflow.evidence
        .slice(0, 5)
        .map((unit) => `[${sourceKey(unit)}]`)
        .join(" ");
      const signals = workflow.signals.length > 0 ? ` Layers: ${workflow.signals.join(", ")}.` : "";
      lines.push(`- ${workflow.name}: ${workflow.description}${signals} Evidence: ${refs}`);
    }
  }

  if (plan.lifecycleEvidence.length > 0) {
    lines.push("", "Mandatory lifecycle evidence:");
    for (const unit of plan.lifecycleEvidence.slice(0, 14)) {
      lines.push(`- ${unit.filePath} [${sourceKey(unit)}]`);
    }
  }

  return lines.join("\n");
}
