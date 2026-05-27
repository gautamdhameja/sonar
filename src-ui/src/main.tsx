import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Download,
  FileText,
  FolderOpen,
  GitBranch,
  HardDrive,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  Sparkles,
  StopCircle,
  X,
} from "lucide-react";
import { askFollowup, apiBaseUrl, createOnboardingSession, indexProject, listProjects } from "./api";
import type {
  ClonedRepository,
  DesktopModelConfig,
  FollowupResponse,
  OnboardingSessionResponse,
  PreparedRepository,
  Project,
  ServiceSnapshot,
  ServiceState,
  ServiceStatus,
  SourceRef,
} from "./types";
import "./styles.css";

const defaultQuestion = "What should I understand first, and what should I ask engineering this week?";
const demoRepository = "https://github.com/excalidraw/excalidraw";
const dockerModelRunnerConfig: DesktopModelConfig = {
  chatBaseUrl: "http://localhost:12434/engines/llama.cpp/v1",
  chatModel: "hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL",
  chatApiKey: "not-needed",
  embeddingModel: "hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M",
};
const suggestedQuestions = [
  "What should I read first?",
  "Where does the main workflow start?",
  "What is risky or unclear?",
  "What should I ask engineering?",
];

type RepositorySource = "github" | "local";
type ActiveTaskKind = "bootstrap" | "settings" | "analyze" | "brief" | "followup";

interface ActiveTask {
  kind: ActiveTaskKind;
  label: string;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __SONAR_ROOT__?: ReturnType<typeof createRoot>;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

async function browserServiceSnapshot(): Promise<ServiceSnapshot> {
  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      apiBaseUrl,
      chatBaseUrl: "Configured on the desktop runtime",
      services: [
        {
          id: "sonar",
          label: "Sonar API",
          state: "ready",
          detail: "responding",
          url: `${apiBaseUrl}/health`,
          managed: false,
        },
        {
          id: "desktop",
          label: "Desktop service manager",
          state: "missing",
          detail: "open with Tauri to start local services",
          managed: true,
        },
      ],
    };
  } catch (err) {
    return {
      apiBaseUrl,
      chatBaseUrl: "Configured on the desktop runtime",
      services: [
        {
          id: "sonar",
          label: "Sonar API",
          state: "missing",
          detail: err instanceof Error ? err.message : String(err),
          url: `${apiBaseUrl}/health`,
          managed: false,
        },
        {
          id: "desktop",
          label: "Desktop service manager",
          state: "missing",
          detail: "open with Tauri to start local services",
          managed: true,
        },
      ],
    };
  }
}

async function serviceCommand(command: "service_snapshot" | "bootstrap_services"): Promise<ServiceSnapshot> {
  if (isTauriRuntime()) {
    return invoke<ServiceSnapshot>(command);
  }
  return browserServiceSnapshot();
}

async function cloneGithubRepository(repository: string): Promise<ClonedRepository> {
  if (!isTauriRuntime()) {
    throw new Error("Open Sonar as a desktop app to clone GitHub repositories automatically.");
  }
  return invoke<ClonedRepository>("clone_github_repository", { repository });
}

async function prepareRepositoryForIndexing(repoPath: string, projectName: string): Promise<PreparedRepository> {
  if (!isTauriRuntime()) {
    return { localPath: repoPath, indexedPath: repoPath, copiedToDocker: false };
  }
  return invoke<PreparedRepository>("prepare_repository_for_indexing", { repoPath, projectName });
}

async function loadModelConfig(): Promise<DesktopModelConfig> {
  if (!isTauriRuntime()) {
    return dockerModelRunnerConfig;
  }
  return invoke<DesktopModelConfig>("get_model_config");
}

async function saveModelConfig(config: DesktopModelConfig): Promise<ServiceSnapshot> {
  if (!isTauriRuntime()) {
    window.localStorage.setItem("sonar.modelConfig", JSON.stringify(config));
    return browserServiceSnapshot();
  }
  return invoke<ServiceSnapshot>("save_model_config", { config });
}

function stateLabel(state: ServiceState): string {
  if (state === "ready") return "Ready";
  if (state === "starting") return "Starting";
  if (state === "missing") return "Needs attention";
  if (state === "error") return "Error";
  return "Checking";
}

function runtimeState(snapshot: ServiceSnapshot | null): ServiceState {
  if (!snapshot) return "unknown";
  if (snapshot.services.some((service) => service.state === "error")) return "error";
  if (snapshot.services.some((service) => service.state === "missing")) return "missing";
  if (snapshot.services.some((service) => service.state === "starting" || service.state === "unknown"))
    return "starting";
  return "ready";
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes("cannot connect to the docker daemon") ||
    lower.includes("docker daemon") ||
    lower.includes("is the docker daemon running") ||
    lower.includes("connection refused")
  ) {
    return "Docker Desktop or the local model runtime is not ready yet. Start Docker Desktop, wait for it to finish starting, then check again.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Sonar could not reach its local API. Start the local runtime, then try again.";
  }
  return raw;
}

function serviceCounts(snapshot: ServiceSnapshot | null) {
  const services = snapshot?.services ?? [];
  return {
    ready: services.filter((service) => service.state === "ready").length,
    total: services.length,
  };
}

function serviceDetail(snapshot: ServiceSnapshot | null, id: string): ServiceStatus | null {
  return snapshot?.services.find((service) => service.id === id) ?? null;
}

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "sonar-briefing"
  );
}

function sourceToMarkdown(source: SourceRef, index: number): string {
  return `${index + 1}. ${source.filePath} (${source.kind} ${source.name}, lines ${source.lines})`;
}

function buildBriefingMarkdown(
  session: OnboardingSessionResponse,
  followups: FollowupResponse[],
  selectedProject: Project | null,
): string {
  const lines = [
    `# ${session.session.repoName} - First-Week Briefing`,
    "",
    `Generated: ${new Date(session.session.createdAt).toLocaleString()}`,
    `Project: ${selectedProject?.name ?? session.session.repoName}`,
    "",
    "## Briefing",
    "",
    session.brief.brief.trim(),
    "",
    "## Sources",
    "",
    ...(session.brief.sources.length > 0
      ? session.brief.sources.map(sourceToMarkdown)
      : ["No sources were returned for this briefing."]),
  ];

  if (followups.length > 0) {
    lines.push("", "## Follow-up Questions", "");
    followups.forEach((followup, index) => {
      lines.push(`### ${index + 1}. ${followup.intent.replaceAll("_", " ")}`, "", followup.answer.trim(), "");
      if (followup.sources.length > 0) {
        lines.push("Sources:", "", ...followup.sources.map(sourceToMarkdown), "");
      }
    });
  }

  return `${lines.join("\n").trim()}\n`;
}

async function saveMarkdownFile(defaultPath: string, contents: string): Promise<void> {
  if (isTauriRuntime()) {
    const target = await save({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (typeof target === "string") {
      await invoke("export_markdown", { path: target, contents });
    }
    return;
  }

  const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultPath;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReadinessCard({
  snapshot,
  runtime,
  activeTask,
  onStart,
  onOpenSettings,
}: {
  snapshot: ServiceSnapshot | null;
  runtime: ServiceState;
  activeTask: ActiveTask | null;
  onStart: () => void;
  onOpenSettings: () => void;
}) {
  const counts = serviceCounts(snapshot);
  const api = serviceDetail(snapshot, "sonar");
  const model = serviceDetail(snapshot, "chat") ?? serviceDetail(snapshot, "models");
  const isStarting = activeTask?.kind === "bootstrap";
  const title =
    runtime === "ready"
      ? "Local runtime is ready"
      : runtime === "unknown" || runtime === "starting"
        ? "Checking local runtime"
        : "Finish local setup";
  const body =
    runtime === "ready"
      ? "Sonar can index a selected repository and ask the configured model for a grounded briefing."
      : "Sonar uses Docker for search, vectors, embeddings, and the API. The first run can download models in Docker Desktop and may take several minutes.";

  return (
    <section className={`readiness-card ${runtime}`}>
      <div>
        <p className="eyebrow">Readiness</p>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="readiness-checks">
        <span>
          <CheckCircle2 size={15} />
          {counts.total === 0 ? "Checking services" : `${counts.ready}/${counts.total} services ready`}
        </span>
        <span className={api?.state === "ready" ? "ready" : ""}>
          <Server size={15} />
          {api?.state === "ready" ? "API reachable" : "API pending"}
        </span>
        <span className={model?.state === "ready" ? "ready" : ""}>
          <Sparkles size={15} />
          {model?.state === "ready" ? "Model endpoint reachable" : "Model endpoint pending"}
        </span>
      </div>
      <div className="readiness-actions">
        <button className="primary" disabled={isStarting} onClick={onStart} type="button">
          {isStarting ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {runtime === "ready" ? "Check again" : "Start local runtime"}
        </button>
        <button className="secondary" onClick={onOpenSettings} type="button">
          Details
        </button>
      </div>
    </section>
  );
}

function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) {
    return <p className="muted">No sources returned yet.</p>;
  }

  return (
    <div className="source-list">
      {sources.slice(0, 18).map((source, index) => (
        <div className="source-row" key={`${source.filePath}-${source.kind}-${source.name}-${source.lines}`}>
          <span className="source-index">{index + 1}</span>
          <div>
            <strong>{source.filePath}</strong>
            <span>
              {source.kind} · {source.name} · lines {source.lines}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProgressPanel({
  activeTask,
  onStop,
  stopDisabled,
}: {
  activeTask: ActiveTask;
  onStop: () => void;
  stopDisabled: boolean;
}) {
  const steps = [
    {
      label: "Import repository",
      active: activeTask.label.includes("Cloning") || activeTask.label.includes("Preparing"),
      done: activeTask.kind === "brief",
    },
    {
      label: "Build local index",
      active: activeTask.label.includes("Indexing"),
      done: activeTask.kind === "brief",
    },
    {
      label: "Write first-week briefing",
      active: activeTask.kind === "brief",
      done: false,
    },
  ];

  return (
    <section className="progress-panel">
      <div>
        <p className="eyebrow">Preparing Briefing</p>
        <h2>{activeTask.label}</h2>
      </div>
      <div className="progress-steps">
        {steps.map((step) => (
          <div
            className={step.active ? "progress-step active" : step.done ? "progress-step done" : "progress-step"}
            key={step.label}
          >
            <span>
              {step.done ? <CheckCircle2 size={14} /> : step.active ? <Loader2 className="spin" size={14} /> : null}
            </span>
            <strong>{step.label}</strong>
          </div>
        ))}
      </div>
      {activeTask.kind === "analyze" && (
        <button className="quiet-danger" disabled={stopDisabled} onClick={onStop} type="button">
          <StopCircle size={16} />
          Stop analysis
        </button>
      )}
    </section>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<ServiceSnapshot | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [repositorySource, setRepositorySource] = useState<RepositorySource>("github");
  const [githubRepository, setGithubRepository] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [session, setSession] = useState<OnboardingSessionResponse | null>(null);
  const [followups, setFollowups] = useState<FollowupResponse[]>([]);
  const [question, setQuestion] = useState(defaultQuestion);
  const [activeTask, setActiveTask] = useState<ActiveTask | null>({
    kind: "bootstrap",
    label: "Starting local services",
  });
  const [analysisStopRequested, setAnalysisStopRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelConfig, setModelConfig] = useState<DesktopModelConfig>(dockerModelRunnerConfig);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const analysisAbortController = React.useRef<AbortController | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const latestSources = followups.at(-1)?.sources ?? session?.brief.sources ?? [];
  const citation = followups.at(-1)?.citationVerification ?? session?.brief.citationVerification;
  const sourceFileCount = new Set(latestSources.map((source) => source.filePath)).size;
  const canAnalyze = repositorySource === "github" ? githubRepository.trim().length > 0 : repoPath.trim().length > 0;
  const isCreatingBriefing = activeTask?.kind === "analyze" || activeTask?.kind === "brief";
  const runtime = runtimeState(snapshot);
  const runtimeReady = runtime === "ready";
  const runtimeBusy = activeTask?.kind === "bootstrap" || activeTask?.kind === "settings";
  const hasBrief = session !== null;
  const briefingMarkdown = session ? buildBriefingMarkdown(session, followups, selectedProject) : "";

  async function refreshServices() {
    const result = await serviceCommand("service_snapshot");
    setSnapshot(result);
  }

  async function refreshProjects() {
    const next = await listProjects();
    setProjects(next);
    if (!selectedProjectId && next[0]) setSelectedProjectId(next[0].id);
  }

  async function refreshModelConfig() {
    const next = await loadModelConfig();
    setModelConfig(next);
  }

  async function bootstrap() {
    setError(null);
    setNotice(null);
    setActiveTask({ kind: "bootstrap", label: "Starting local services" });
    try {
      const result = await serviceCommand("bootstrap_services");
      setSnapshot(result);
      await refreshModelConfig();
      if (isTauriRuntime()) {
        await refreshProjects();
      } else {
        await refreshProjects().catch(() => undefined);
      }
    } catch (err) {
      setError(friendlyErrorMessage(err));
      await refreshServices().catch(() => undefined);
    } finally {
      setActiveTask(null);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: startup bootstrap should run once on mount.
  useEffect(() => {
    void bootstrap();
  }, []);

  async function handleSaveModelConfig() {
    setError(null);
    setNotice(null);
    setActiveTask({ kind: "settings", label: "Applying model settings" });
    try {
      const result = await saveModelConfig(modelConfig);
      setSnapshot(result);
      setNotice("Model settings saved. Sonar restarted the local API with the new configuration.");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setActiveTask(null);
    }
  }

  async function chooseDirectory() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setRepoPath(selected);
      setProjectName(selected.split(/[\\/]/).filter(Boolean).at(-1) ?? "Local Project");
    }
  }

  async function indexSelectedRepository(controller: AbortController): Promise<string> {
    let pathToIndex = repoPath;
    let nameToIndex = projectName || "Local Project";

    const stopIfRequested = () => {
      if (controller.signal.aborted) {
        throw new DOMException("Analysis stopped", "AbortError");
      }
    };

    if (repositorySource === "github") {
      setActiveTask({ kind: "analyze", label: "Cloning GitHub repository" });
      const cloned = await cloneGithubRepository(githubRepository);
      stopIfRequested();
      pathToIndex = cloned.localPath;
      nameToIndex = projectName || `${cloned.owner}/${cloned.repo}`;
      setRepoPath(cloned.localPath);
      setProjectName(nameToIndex);
    }

    setActiveTask({ kind: "analyze", label: "Preparing selected repository" });
    const prepared = await prepareRepositoryForIndexing(pathToIndex, nameToIndex);
    stopIfRequested();
    pathToIndex = prepared.indexedPath;

    setActiveTask({ kind: "analyze", label: "Indexing repository" });
    const indexed = await indexProject(pathToIndex, nameToIndex, controller.signal);
    stopIfRequested();
    await refreshProjects();
    setSelectedProjectId(indexed.projectId);
    return indexed.projectId;
  }

  async function handleCreateBriefing() {
    if (isCreatingBriefing) return;
    if (!canAnalyze && !selectedProjectId) return;
    if (!runtimeReady) {
      setError("Start the local runtime before creating a briefing.");
      return;
    }

    setError(null);
    setNotice(null);
    setSession(null);
    setFollowups([]);
    setAnalysisStopRequested(false);
    const controller = new AbortController();
    analysisAbortController.current = controller;

    try {
      const projectId = canAnalyze ? await indexSelectedRepository(controller) : selectedProjectId;
      setActiveTask({ kind: "brief", label: "Writing first-week briefing" });
      const result = await createOnboardingSession(projectId);
      setSession(result);
      setQuestion(defaultQuestion);
      setEvidenceOpen(false);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Analysis stopped. Any partial index data was discarded.");
      } else {
        setError(friendlyErrorMessage(err));
      }
    } finally {
      if (analysisAbortController.current === controller) {
        analysisAbortController.current = null;
      }
      setAnalysisStopRequested(false);
      setActiveTask(null);
    }
  }

  function handleStopAnalysis() {
    analysisAbortController.current?.abort();
    setAnalysisStopRequested(true);
    setActiveTask({ kind: "analyze", label: "Stopping analysis after the current step" });
  }

  async function handleCreateOnboarding() {
    if (!selectedProjectId) return;
    setError(null);
    setNotice(null);
    setActiveTask({ kind: "brief", label: "Writing first-week briefing" });
    try {
      const result = await createOnboardingSession(selectedProjectId);
      setSession(result);
      setFollowups([]);
      setEvidenceOpen(false);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleFollowup() {
    if (!selectedProjectId || !session || !question.trim()) return;
    setError(null);
    setNotice(null);
    setActiveTask({ kind: "followup", label: "Answering follow-up" });
    try {
      const result = await askFollowup(selectedProjectId, session.session.id, question);
      setFollowups((current) => [...current, result]);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setActiveTask(null);
    }
  }

  function handleUseDemoRepository() {
    setRepositorySource("github");
    setGithubRepository(demoRepository);
    setProjectName("excalidraw/excalidraw");
    setSelectedProjectId("");
    setSession(null);
    setFollowups([]);
    setNotice("Demo repository selected. Click Create briefing when you are ready to index it.");
  }

  async function handleCopyBriefing() {
    if (!briefingMarkdown) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(briefingMarkdown);
      setNotice("Briefing copied as Markdown.");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }

  async function handleExportBriefing() {
    if (!session || !briefingMarkdown) return;
    setError(null);
    try {
      await saveMarkdownFile(`${safeFileName(session.session.repoName)}-sonar-briefing.md`, briefingMarkdown);
      setNotice("Briefing exported as Markdown.");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">
            <span />
          </div>
          <div>
            <h1>Sonar</h1>
            <p>First-week codebase briefing</p>
          </div>
        </div>
        <div className="header-actions">
          <button className={`status-pill ${runtime}`} onClick={() => void refreshServices()} type="button">
            <span />
            {stateLabel(runtime)}
          </button>
          <button className="ghost-button" onClick={() => setAdvancedOpen(true)} type="button">
            <Settings size={16} />
            Settings
          </button>
        </div>
      </header>

      {error && (
        <div className="toast-alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="toast-alert notice">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
        </div>
      )}

      {activeTask && activeTask.kind !== "bootstrap" && activeTask.kind !== "settings" && (
        <ProgressPanel activeTask={activeTask} onStop={handleStopAnalysis} stopDisabled={analysisStopRequested} />
      )}

      <section className={hasBrief ? "briefing-shell" : "start-shell"}>
        {!hasBrief ? (
          <article className="start-card">
            <div className="start-copy">
              <p className="eyebrow">Local Onboarding</p>
              <h2>Prepare a briefing for your first week in this codebase.</h2>
              <p>
                Sonar reads the selected repository locally, builds a compact evidence map, and turns it into a
                source-grounded onboarding document.
              </p>
              <ReadinessCard
                activeTask={activeTask}
                onOpenSettings={() => setAdvancedOpen(true)}
                onStart={() => void bootstrap()}
                runtime={runtime}
                snapshot={snapshot}
              />
            </div>

            <div className="repo-card">
              <div className="repo-card-head">
                <div>
                  <p className="eyebrow">Repository</p>
                  <h3>Choose what Sonar should brief</h3>
                </div>
                <button className="secondary compact-button" onClick={handleUseDemoRepository} type="button">
                  Try Excalidraw
                </button>
              </div>

              <div className="segmented" role="tablist" aria-label="Repository source">
                <button
                  className={repositorySource === "github" ? "segment active" : "segment"}
                  onClick={() => setRepositorySource("github")}
                  type="button"
                >
                  <GitBranch size={16} />
                  GitHub
                </button>
                <button
                  className={repositorySource === "local" ? "segment active" : "segment"}
                  onClick={() => setRepositorySource("local")}
                  type="button"
                >
                  <HardDrive size={16} />
                  Local folder
                </button>
              </div>

              {repositorySource === "github" ? (
                <label className="field">
                  <span>Repository</span>
                  <input
                    value={githubRepository}
                    onChange={(event) => {
                      setGithubRepository(event.target.value);
                      if (!projectName.trim()) {
                        const parts = event.target.value
                          .replace(/\.git$/, "")
                          .split("/")
                          .filter(Boolean);
                        const repo = parts.at(-1);
                        const owner = parts.at(-2);
                        if (owner && repo) setProjectName(`${owner}/${repo}`);
                      }
                    }}
                    placeholder="https://github.com/excalidraw/excalidraw"
                  />
                </label>
              ) : (
                <label className="field">
                  <span>Repository folder</span>
                  <div className="repo-picker">
                    <input
                      value={repoPath}
                      onChange={(event) => setRepoPath(event.target.value)}
                      placeholder="/Users/you/code/product"
                    />
                    <button className="secondary" onClick={() => void chooseDirectory()} type="button">
                      <FolderOpen size={16} />
                      Browse
                    </button>
                  </div>
                </label>
              )}

              <label className="field">
                <span>Briefing name</span>
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="Product or team name"
                />
              </label>

              <button
                className="primary hero-action"
                disabled={(!canAnalyze && !selectedProjectId) || isCreatingBriefing || runtimeBusy || !runtimeReady}
                onClick={() => void handleCreateBriefing()}
                type="button"
              >
                {isCreatingBriefing ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
                Create briefing
              </button>

              <div className="privacy-note">
                <Lock size={15} />
                <span>
                  {runtimeReady
                    ? "Only the selected repository is imported into Sonar's local workspace."
                    : "Start the local runtime first. Sonar will only import the repository you choose."}
                </span>
              </div>
            </div>

            {projects.length > 0 && (
              <div className="recent-projects">
                <span>Recent briefings</span>
                <div>
                  {projects.slice(0, 3).map((project) => (
                    <button
                      className={project.id === selectedProjectId ? "recent-project active" : "recent-project"}
                      key={project.id}
                      onClick={() => {
                        setSelectedProjectId(project.id);
                        setProjectName(project.name);
                        setGithubRepository("");
                        setRepoPath("");
                        setSession(null);
                        setFollowups([]);
                      }}
                      type="button"
                    >
                      {project.name}
                    </button>
                  ))}
                </div>
                {selectedProjectId && !canAnalyze && (
                  <button
                    className="secondary compact-button"
                    disabled={isCreatingBriefing || runtimeBusy || !runtimeReady}
                    onClick={() => void handleCreateBriefing()}
                    type="button"
                  >
                    <BookOpen size={15} />
                    Use selected
                  </button>
                )}
              </div>
            )}
          </article>
        ) : (
          <div className="briefing-layout">
            <article className="brief-document">
              <div className="document-head">
                <div>
                  <p className="eyebrow">First-Week Briefing</p>
                  <h2>{session.session.repoName}</h2>
                </div>
                <div className="document-actions">
                  <button className="secondary" onClick={() => void handleCopyBriefing()} type="button">
                    <Clipboard size={16} />
                    Copy
                  </button>
                  <button className="secondary" onClick={() => void handleExportBriefing()} type="button">
                    <Download size={16} />
                    Export
                  </button>
                  <button className="secondary" onClick={() => setEvidenceOpen(true)} type="button">
                    <Search size={16} />
                    Evidence
                  </button>
                  <button className="secondary" onClick={() => void handleCreateOnboarding()} type="button">
                    <RefreshCw size={16} />
                    Regenerate
                  </button>
                </div>
              </div>

              <div className="confidence-row">
                <span>
                  <BookOpen size={15} />
                  {sourceFileCount} source files
                </span>
                <span>
                  <FileText size={15} />
                  {latestSources.length} cited units
                </span>
                {citation && (
                  <span className={citation.valid ? "confidence-good" : "confidence-warn"}>
                    {citation.valid ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                    {citation.valid ? "Grounded" : `${citation.uncitedClaims.length} open claims`}
                  </span>
                )}
              </div>

              <div className="markdownish briefing-text">{session.brief.brief}</div>

              <section className="followup-card">
                <div>
                  <p className="eyebrow">Ask Next</p>
                  <h3>Continue from this briefing</h3>
                </div>
                <div className="suggestion-row">
                  {suggestedQuestions.map((item) => (
                    <button key={item} onClick={() => setQuestion(item)} type="button">
                      {item}
                    </button>
                  ))}
                </div>
                <div className="question-row">
                  <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
                  <button
                    className="primary"
                    disabled={!session || activeTask?.kind === "followup"}
                    onClick={() => void handleFollowup()}
                    type="button"
                  >
                    Ask
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="answers">
                  {followups.map((item) => (
                    <article
                      className="answer"
                      key={`${item.intent}-${item.retrievalTime}-${item.generationTime}-${item.answer.slice(0, 48)}`}
                    >
                      <div className="answer-meta">
                        <span>{item.intent.replaceAll("_", " ")}</span>
                        <span>
                          {formatMs(item.retrievalTime)} retrieval · {formatMs(item.generationTime)} generation
                        </span>
                      </div>
                      <div className="markdownish">{item.answer}</div>
                    </article>
                  ))}
                </div>
              </section>
            </article>

            <aside className="brief-aside">
              <section>
                <p className="eyebrow">Confidence</p>
                <h3>{citation?.valid ? "Evidence looks grounded" : "Review suggested"}</h3>
                <p>
                  {citation?.valid
                    ? "The briefing cites concrete files from the repository."
                    : "Some summary language may need a human check before sharing."}
                </p>
              </section>
              <section>
                <p className="eyebrow">Selected Repository</p>
                <h3>{selectedProject?.name ?? session.session.repoName}</h3>
                <p>{selectedProject?.fileCount ?? 0} files indexed locally.</p>
              </section>
            </aside>
          </div>
        )}
      </section>

      {evidenceOpen && (
        <div className="drawer-backdrop" role="presentation">
          <aside className="drawer">
            <div className="drawer-head">
              <div>
                <p className="eyebrow">Evidence</p>
                <h2>Sources Sonar used</h2>
              </div>
              <button className="icon-button" onClick={() => setEvidenceOpen(false)} type="button">
                <X size={17} />
              </button>
            </div>
            {citation && (
              <div className={citation.valid ? "evidence-summary good" : "evidence-summary warn"}>
                {citation.valid ? <CheckCircle2 size={18} /> : <Info size={18} />}
                <span>
                  {citation.valid
                    ? "All cited source references match the retrieved context."
                    : `${citation.uncitedClaims.length} generated claims should be reviewed.`}
                </span>
              </div>
            )}
            <SourceList sources={latestSources} />
          </aside>
        </div>
      )}

      {advancedOpen && (
        <div className="drawer-backdrop" role="presentation">
          <aside className="drawer wide-drawer">
            <div className="drawer-head">
              <div>
                <p className="eyebrow">Advanced</p>
                <h2>Runtime and model settings</h2>
              </div>
              <button className="icon-button" onClick={() => setAdvancedOpen(false)} type="button">
                <X size={17} />
              </button>
            </div>

            <section className="drawer-section">
              <div className="section-title-row">
                <h3>Local services</h3>
                <button className="secondary compact-button" onClick={() => void bootstrap()} type="button">
                  <RefreshCw size={15} />
                  Check
                </button>
              </div>
              <div className="service-list">
                {(snapshot?.services ?? []).map((service) => (
                  <div className={`service ${service.state}`} key={service.id}>
                    <span className="service-dot" />
                    <div>
                      <strong>{service.label}</strong>
                      <small>
                        {stateLabel(service.state)} · {service.detail}
                      </small>
                    </div>
                  </div>
                ))}
                {(snapshot?.services ?? []).length === 0 && (
                  <p className="muted">No runtime checks have completed yet.</p>
                )}
              </div>
            </section>

            <section className="drawer-section">
              <div className="section-title-row">
                <h3>Indexed projects</h3>
                <button className="secondary compact-button" onClick={() => void refreshProjects()} type="button">
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>
              <div className="project-list">
                {projects.map((project) => (
                  <button
                    className={project.id === selectedProjectId ? "project active" : "project"}
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setProjectName(project.name);
                      setGithubRepository("");
                      setRepoPath("");
                      setSession(null);
                      setFollowups([]);
                      setAdvancedOpen(false);
                    }}
                  >
                    <span>{project.name}</span>
                    <small>
                      {project.fileCount} files · {project.unitCount} units
                    </small>
                  </button>
                ))}
                {projects.length === 0 && <p className="muted">No indexed projects yet.</p>}
              </div>
            </section>

            <section className="drawer-section">
              <h3>Generation API</h3>
              <div className="settings-grid">
                <label className="field">
                  <span>API endpoint</span>
                  <input
                    value={modelConfig.chatBaseUrl}
                    onChange={(event) => setModelConfig((current) => ({ ...current, chatBaseUrl: event.target.value }))}
                    placeholder="http://localhost:12434/engines/llama.cpp/v1 or https://api.openai.com/v1"
                  />
                </label>
                <label className="field">
                  <span>Model</span>
                  <input
                    value={modelConfig.chatModel}
                    onChange={(event) => setModelConfig((current) => ({ ...current, chatModel: event.target.value }))}
                    placeholder="local/model or gpt-4.1-mini"
                  />
                </label>
                <label className="field">
                  <span>API key</span>
                  <input
                    value={modelConfig.chatApiKey}
                    onChange={(event) => setModelConfig((current) => ({ ...current, chatApiKey: event.target.value }))}
                    placeholder="not-needed for local servers"
                    type="password"
                  />
                </label>
                <label className="field">
                  <span>Embedding model</span>
                  <input
                    value={modelConfig.embeddingModel}
                    onChange={(event) =>
                      setModelConfig((current) => ({ ...current, embeddingModel: event.target.value }))
                    }
                    placeholder="hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M"
                  />
                </label>
              </div>
              <div className="preset-row">
                <button
                  className="secondary"
                  onClick={() =>
                    setModelConfig((current) => ({
                      ...current,
                      ...dockerModelRunnerConfig,
                    }))
                  }
                  type="button"
                >
                  <Server size={16} />
                  Docker local
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    setModelConfig((current) => ({
                      ...current,
                      chatBaseUrl: "https://api.openai.com/v1",
                      chatModel: "gpt-4.1-mini",
                      chatApiKey: "",
                    }))
                  }
                  type="button"
                >
                  <Server size={16} />
                  OpenAI compatible
                </button>
                <button
                  className="primary"
                  disabled={activeTask?.kind === "settings"}
                  onClick={() => void handleSaveModelConfig()}
                  type="button"
                >
                  <Save size={16} />
                  Save and restart API
                </button>
              </div>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

const container = document.getElementById("root")!;
const root = window.__SONAR_ROOT__ ?? createRoot(container);
window.__SONAR_ROOT__ = root;

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
