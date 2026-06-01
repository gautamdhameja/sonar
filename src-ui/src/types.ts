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
  copiedToDocker: boolean;
}

export interface DesktopModelConfig {
  modelMode: "local" | "api";
  chatBaseUrl: string;
  chatModel: string;
  chatApiKey: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingApiKey: string;
  embeddingVectorSize: number;
  apiToken: string;
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

export interface CitationVerification {
  valid: boolean;
  citations: string[];
  invalidCitations: string[];
  uncitedClaims: string[];
  sourceKeys: string[];
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
    sourceFiles: string[];
    createdAt: string;
  };
  brief: {
    brief: string;
    sources: SourceRef[];
    citationVerification: CitationVerification;
    retrievalTime: number;
    generationTime: number;
    generationTruncated?: boolean;
  };
}

export interface FollowupResponse {
  answer: string;
  intent: string;
  sources: SourceRef[];
  citationVerification: CitationVerification;
  retrievalTime: number;
  generationTime: number;
  generationTruncated?: boolean;
  graphEnhanced: boolean;
}
