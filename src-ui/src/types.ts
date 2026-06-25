export type ServiceState = "ready" | "starting" | "missing" | "error" | "unknown";

export interface ServiceStatus {
  id: string;
  label: string;
  state: ServiceState;
  detail: string;
  url?: string;
  managed: boolean;
}

export interface ServiceSnapshot {
  services: ServiceStatus[];
  apiBaseUrl: string;
  chatBaseUrl: string;
}

export interface DependencyHealth {
  name: string;
  status: "ok" | "error";
  message?: string;
}

export interface DependencyHealthResponse {
  status: "ok" | "degraded";
  dependencies: DependencyHealth[];
}

export interface ClonedRepository {
  owner: string;
  repo: string;
  cloneUrl: string;
  localPath: string;
  updatedExisting: boolean;
}

export interface PreparedRepository {
  localPath: string;
  indexedPath: string;
}

export interface DiagnosticsBundle {
  directoryPath: string;
  manifestPath: string;
}

export interface DesktopModelConfig {
  modelSetupComplete: boolean;
  modelMode: "local" | "api";
  chatBaseUrl: string;
  chatModel: string;
  chatApiKey: string;
}

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  indexedAt: string;
  unitCount: number;
  fileCount: number;
  summary: string | null;
  summaryGeneratedAt: string | null;
}

export interface UnsupportedLanguageSummary {
  extension: string;
  label: string;
  fileCount: number;
  sampleFiles: string[];
}

export interface IndexProjectResponse {
  projectId: string;
  unitCount: number;
  timeSeconds: number;
  unsupportedLanguages?: UnsupportedLanguageSummary[];
  indexWarnings?: string[];
}

export type PersonaRole =
  | "product_manager"
  | "sales"
  | "customer_success"
  | "support"
  | "operations"
  | "executive"
  | "engineer"
  | "other";

export type TechnicalBackground = "none" | "basic" | "some_coding" | "technical";

export type ExplanationDepth = "quick" | "standard" | "deep";

export interface Persona {
  role: PersonaRole;
  roleDescription?: string;
  technicalBackground: TechnicalBackground;
  businessContext?: string;
  preferredAnalogies?: string[];
  avoidJargon: boolean;
  explanationDepth: ExplanationDepth;
}

export interface OnboardingSessionRequest {
  audience?: string;
  focus?: string[];
  persona: Persona;
}

export interface CitationVerification {
  valid: boolean;
  citations: string[];
  invalidCitations: string[];
  uncitedClaims: string[];
  sourceKeys: string[];
  claims?: CitationClaimVerification[];
}

export interface CitationClaimVerification {
  text: string;
  status: "verified" | "repaired" | "unverifiable" | "synthesis";
  citations: string[];
  invalidCitations: string[];
}

export interface SourceRef {
  filePath: string;
  name: string;
  kind: string;
  lines: string;
}

export interface OnboardingSessionResponse {
  success: boolean;
  session: {
    id: string;
    projectId: string;
    repoName: string;
    audience: string | null;
    focus: string[];
    persona: Persona;
    sourceFiles: string[];
    createdAt: string;
  };
  brief: {
    brief: string;
    sources: SourceRef[];
    citationVerification: CitationVerification | null;
    retrievalTime: number;
    generationTime: number;
    generationTruncated?: boolean;
  };
  survey?: {
    timeMs: number;
    fallbackUsed: boolean;
    graphNodeCount: number;
    graphEdgeCount: number;
  };
}

export interface FollowupResponse {
  question: string;
  answer: string;
  intent: string;
  sources: SourceRef[];
  citationVerification: CitationVerification;
  retrievalTime: number;
  generationTime: number;
  generationTruncated?: boolean;
  graphEnhanced: boolean;
}
