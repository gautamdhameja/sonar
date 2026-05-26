import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  GitBranch,
  HardDrive,
  Loader2,
  MessageSquareText,
  Play,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  StopCircle,
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
  SourceRef,
} from "./types";
import "./styles.css";

const defaultQuestion =
  "How does the main product workflow work at a product level, and what should I ask engineering about it?";
const dockerModelRunnerConfig: DesktopModelConfig = {
  chatBaseUrl: "http://localhost:12434/engines/llama.cpp/v1",
  chatModel: "hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL",
  chatApiKey: "not-needed",
  embeddingModel: "hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M",
};
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

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) {
    return <p className="muted">No sources returned yet.</p>;
  }

  return (
    <div className="source-list">
      {sources.slice(0, 12).map((source, index) => (
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
  const [modelConfig, setModelConfig] = useState<DesktopModelConfig>(dockerModelRunnerConfig);
  const analysisAbortController = React.useRef<AbortController | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

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
      setError(err instanceof Error ? err.message : String(err));
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
    setActiveTask({ kind: "settings", label: "Applying model settings" });
    try {
      const result = await saveModelConfig(modelConfig);
      setSnapshot(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  async function handleAnalyze() {
    if (activeTask?.kind === "analyze") return;

    setError(null);
    setSession(null);
    setFollowups([]);
    setAnalysisStopRequested(false);
    const controller = new AbortController();
    analysisAbortController.current = controller;

    const stopIfRequested = () => {
      if (controller.signal.aborted) {
        throw new DOMException("Analysis stopped", "AbortError");
      }
    };

    try {
      let pathToIndex = repoPath;
      let nameToIndex = projectName || "Local Project";

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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Analysis stopped. Any partial index data was discarded.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
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
    setActiveTask({ kind: "brief", label: "Generating onboarding brief" });
    try {
      const result = await createOnboardingSession(selectedProjectId);
      setSession(result);
      setFollowups([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleFollowup() {
    if (!selectedProjectId || !session || !question.trim()) return;
    setError(null);
    setActiveTask({ kind: "followup", label: "Answering follow-up" });
    try {
      const result = await askFollowup(selectedProjectId, session.session.id, question);
      setFollowups((current) => [...current, result]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveTask(null);
    }
  }

  const latestSources = followups.at(-1)?.sources ?? session?.brief.sources ?? [];
  const citation = followups.at(-1)?.citationVerification ?? session?.brief.citationVerification;
  const canAnalyze = repositorySource === "github" ? githubRepository.trim().length > 0 : repoPath.trim().length > 0;
  const isAnalyzing = activeTask?.kind === "analyze";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <span />
          </div>
          <div>
            <h1>Sonar</h1>
            <p>Local codebase onboarding</p>
          </div>
        </div>

        <section className="panel">
          <div className="panel-title">
            <span>Runtime</span>
            <button
              className="icon-button"
              onClick={() => void bootstrap()}
              title="Restart service check"
              type="button"
            >
              <RefreshCw size={16} />
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
            {!snapshot && <p className="muted">Checking services…</p>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <span>Projects</span>
            <button
              className="icon-button"
              onClick={() => void refreshProjects()}
              title="Refresh projects"
              type="button"
            >
              <RefreshCw size={16} />
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
                  setSession(null);
                  setFollowups([]);
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
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Version One Desktop</p>
            <h2>Onboard to a codebase without opening the terminal.</h2>
          </div>
          <div className="topbar-actions">
            <button className="secondary" onClick={() => void refreshServices()} type="button">
              <ShieldCheck size={16} />
              Check services
            </button>
            <button
              className="primary"
              onClick={() => void handleCreateOnboarding()}
              disabled={!selectedProjectId || activeTask?.kind === "brief"}
              type="button"
            >
              <Sparkles size={16} />
              Generate brief
            </button>
          </div>
        </header>

        {error && (
          <div className="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        {activeTask && (
          <div className="busy-bar">
            <Loader2 className="spin" size={18} />
            <span>{activeTask.label}</span>
            {isAnalyzing && (
              <button
                className="stop-button"
                onClick={handleStopAnalysis}
                disabled={analysisStopRequested}
                type="button"
              >
                <StopCircle size={16} />
                Stop analysis
              </button>
            )}
          </div>
        )}

        <div className="grid">
          <section className="stage">
            <div className="section-head">
              <div>
                <p className="eyebrow">Step 1</p>
                <h3>Choose a repository</h3>
              </div>
              {repositorySource === "github" ? <GitBranch size={20} /> : <FolderOpen size={20} />}
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
                Local
              </button>
            </div>

            {repositorySource === "github" ? (
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
            ) : (
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
            )}

            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name"
            />
            <button
              className="primary wide"
              onClick={() => void handleAnalyze()}
              disabled={!canAnalyze || isAnalyzing}
              type="button"
            >
              {isAnalyzing ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {isAnalyzing ? "Analyzing repository" : "Analyze repository"}
            </button>
          </section>

          <section className="stage">
            <div className="section-head">
              <div>
                <p className="eyebrow">Step 2</p>
                <h3>Generate onboarding</h3>
              </div>
              <ArrowRight size={20} />
            </div>
            {selectedProject ? (
              <div className="selected-project">
                <strong>{selectedProject.name}</strong>
                <span>{selectedProject.repoPath}</span>
              </div>
            ) : (
              <p className="muted">Select or index a project first.</p>
            )}
            <button
              className="primary wide"
              onClick={() => void handleCreateOnboarding()}
              disabled={!selectedProjectId || activeTask?.kind === "brief"}
              type="button"
            >
              <Sparkles size={16} />
              Create first-week brief
            </button>
          </section>
        </div>

        <section className="settings-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Model Settings</p>
              <h3>Generation API</h3>
            </div>
            <SlidersHorizontal size={20} />
          </div>
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
                onChange={(event) => setModelConfig((current) => ({ ...current, embeddingModel: event.target.value }))}
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
              onClick={() => void handleSaveModelConfig()}
              disabled={activeTask?.kind === "settings"}
              type="button"
            >
              <Save size={16} />
              Save and restart API
            </button>
          </div>
        </section>

        <section className="document-layout">
          <article className="document">
            <div className="section-head">
              <div>
                <p className="eyebrow">Onboarding Brief</p>
                <h3>{session ? session.session.repoName : "No brief generated yet"}</h3>
              </div>
              {citation && (
                <span className={citation.valid ? "badge good" : "badge warn"}>
                  {citation.valid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {citation.valid ? "Verified" : `${citation.uncitedClaims.length} uncited`}
                </span>
              )}
            </div>
            <div className="markdownish">
              {session ? session.brief.brief : "Generate a brief to create a readable first-week onboarding document."}
            </div>
          </article>

          <aside className="inspector">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Evidence</p>
                <h3>Sources</h3>
              </div>
              <Search size={18} />
            </div>
            <SourceList sources={latestSources} />
          </aside>
        </section>

        <section className="chat-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Step 3</p>
              <h3>Ask follow-up questions</h3>
            </div>
            <MessageSquareText size={20} />
          </div>
          <div className="question-row">
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
            <button
              className="primary"
              onClick={() => void handleFollowup()}
              disabled={!session || activeTask?.kind === "followup"}
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
                  <span>{item.intent}</span>
                  <span>
                    {formatMs(item.retrievalTime)} retrieval · {formatMs(item.generationTime)} generation
                  </span>
                </div>
                <div className="markdownish">{item.answer}</div>
              </article>
            ))}
          </div>
        </section>
      </section>
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
