import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  askFollowup,
  checkDependencyHealth,
  createOnboardingSession,
  getLatestOnboardingSession,
  indexProject,
  listProjects,
} from "./api";
import { buildBriefingMarkdown } from "./app/briefingMarkdown";
import { defaultBriefingRole, defaultQuestion, localLlamaConfig } from "./app/constants";
import { saveMarkdownFile } from "./app/exportMarkdown";
import { friendlyErrorMessage, runtimeState, safeFileName } from "./app/format";
import {
  cloneGithubRepository,
  createDiagnosticsBundle,
  isTauriRuntime,
  loadModelConfig,
  prepareRepositoryForIndexing,
  saveModelConfig,
  serviceCommand,
} from "./app/runtime";
import type { ActiveTask, BriefingRole, RepositorySource } from "./app/types";
import { AppHeader } from "./components/AppHeader";
import { BriefingView } from "./components/BriefingView";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { HomeScreen } from "./components/HomeScreen";
import { ModelSetupDialog } from "./components/ModelSetupDialog";
import { ProgressPanel } from "./components/ProgressPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { Toast } from "./components/Toast";
import type {
  DesktopModelConfig,
  FollowupResponse,
  OnboardingSessionResponse,
  Project,
  ServiceSnapshot,
  UnsupportedLanguageSummary,
} from "./types";

function unsupportedLanguageNotice(languages: UnsupportedLanguageSummary[] | undefined): string | null {
  const meaningfulLanguages = (languages ?? []).filter((item) => {
    if ((item.label === "Shell" || item.label === "SQL") && item.fileCount < 10) return false;
    return true;
  });
  if (!meaningfulLanguages.length) return null;
  const topLanguages = meaningfulLanguages
    .slice(0, 4)
    .map((item) => `${item.label} (${item.fileCount})`)
    .join(", ");
  const suffix = meaningfulLanguages.length > 4 ? ` and ${meaningfulLanguages.length - 4} more` : "";
  return `Limited language coverage: ${topLanguages}${suffix}. Sonar indexes TypeScript, JavaScript, Python, Rust, Go, Java, C#, Ruby, C++, PHP, Kotlin, Swift, Markdown, JSON config, and Prisma schema files today; unsupported source files are skipped, so this briefing may be incomplete.`;
}

function indexingNotice(indexed: {
  unsupportedLanguages?: UnsupportedLanguageSummary[];
  indexWarnings?: string[];
}): string | null {
  const messages = [unsupportedLanguageNotice(indexed.unsupportedLanguages), ...(indexed.indexWarnings ?? [])].filter(
    (message): message is string => Boolean(message),
  );
  return messages.length ? messages.join(" ") : null;
}

const ERROR_TOAST_TIMEOUT_MS = 12000;
const NOTICE_TOAST_TIMEOUT_MS = 5000;

export function App() {
  const [snapshot, setSnapshot] = useState<ServiceSnapshot | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [repositorySource, setRepositorySource] = useState<RepositorySource>("github");
  const [briefingRole, setBriefingRole] = useState<BriefingRole>(defaultBriefingRole);
  const [githubRepository, setGithubRepository] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [session, setSession] = useState<OnboardingSessionResponse | null>(null);
  const [followups, setFollowups] = useState<FollowupResponse[]>([]);
  const [question, setQuestion] = useState(defaultQuestion);
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);
  const [analysisStopRequested, setAnalysisStopRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelConfig, setModelConfig] = useState<DesktopModelConfig>(localLlamaConfig);
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const analysisAbortController = useRef<AbortController | null>(null);
  const followupInFlight = useRef(false);

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
  const runtimeBlocker = error?.includes("Sonar could not start") || error?.includes("local llama.cpp") ? error : null;
  const runtimeReady = modelConfig.modelSetupComplete && runtime === "ready";
  const runtimeBusy = activeTask?.kind === "bootstrap" || activeTask?.kind === "settings";
  const hasBrief = session !== null;
  const briefingMarkdown = session ? buildBriefingMarkdown(session, followups, selectedProject) : "";

  useEffect(() => {
    if (!error) return undefined;
    const timeout = window.setTimeout(() => setError(null), ERROR_TOAST_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), NOTICE_TOAST_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function refreshServices() {
    setError(null);
    setNotice(null);
    try {
      const result = await serviceCommand("service_snapshot");
      setSnapshot(result);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }

  async function refreshProjects() {
    setError(null);
    setNotice(null);
    try {
      const next = await listProjects();
      setProjects(next);
      if (selectedProjectId && !next.some((project) => project.id === selectedProjectId)) {
        setSelectedProjectId("");
      }
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }

  async function refreshModelConfig(): Promise<DesktopModelConfig> {
    const next = await loadModelConfig();
    setModelConfig(next);
    return next;
  }

  async function preflightModelEndpoint() {
    const [dependencies, services] = await Promise.all([checkDependencyHealth(), serviceCommand("service_snapshot")]);
    setSnapshot(services);

    const workspace = services.services.find((service) => service.id === "sonar");
    if (workspace?.state !== "ready") {
      throw new Error(workspace?.detail ?? "Workspace engine is not ready.");
    }

    const modelService = services.services.find((service) => service.id === "chat" || service.id === "models");
    const chatDependency = dependencies.dependencies.find((dependency) => dependency.name === "chat");
    if (dependencies.status === "ok" && (!modelService || modelService.state === "ready")) return;

    const detail =
      modelService && modelService.state !== "ready"
        ? modelService.detail
        : (chatDependency?.message ?? "The configured model endpoint did not pass the preflight check.");
    throw new Error(`Model endpoint is not ready. ${detail}`);
  }

  async function bootstrap() {
    setError(null);
    setNotice(null);
    try {
      const nextConfig = await refreshModelConfig();
      if (!nextConfig.modelSetupComplete) {
        setSnapshot(null);
        setModelSetupOpen(true);
        return;
      }

      setActiveTask({ kind: "bootstrap", label: "Preparing Sonar" });
      const result = await serviceCommand("bootstrap_services");
      setSnapshot(result);
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
    setActiveTask({
      kind: "settings",
      label:
        modelConfig.modelMode === "local" ? "Preparing Sonar with local models" : "Preparing Sonar with API models",
      detail:
        modelConfig.modelMode === "local"
          ? "Checking the local model endpoint and starting the Sonar workspace."
          : "Starting the workspace and validating your model endpoints.",
      progress: 20,
    });
    try {
      const result = await saveModelConfig(modelConfig);
      setSnapshot(result);
      const nextConfig = await refreshModelConfig();
      setModelSetupOpen(!nextConfig.modelSetupComplete);
      setNotice("Model settings saved. Sonar restarted the workspace engine with the new configuration.");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleCreateDiagnosticsBundle() {
    setError(null);
    setNotice(null);
    setActiveTask({ kind: "settings", label: "Creating diagnostics bundle" });
    try {
      const bundle = await createDiagnosticsBundle();
      setNotice(`Diagnostics bundle created locally: ${bundle.directoryPath}`);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setActiveTask(null);
    }
  }

  async function chooseDirectory() {
    setError(null);
    setNotice(null);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setSelectedProjectId("");
        setRepoPath(selected);
        setProjectName(selected.split(/[\\/]/).filter(Boolean).at(-1) ?? "Local Project");
      }
    } catch (err) {
      setError(friendlyErrorMessage(err));
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
      setActiveTask({
        kind: "analyze",
        label: "Importing GitHub repository",
        detail: "Cloning the selected repository into Sonar's local workspace.",
        progress: 12,
        canStop: false,
      });
      const cloned = await cloneGithubRepository(githubRepository);
      stopIfRequested();
      pathToIndex = cloned.localPath;
      nameToIndex = projectName || `${cloned.owner}/${cloned.repo}`;
      setRepoPath(cloned.localPath);
      setProjectName(nameToIndex);
    }

    setActiveTask({
      kind: "analyze",
      label: "Preparing selected repository",
      detail: "Preparing the selected repository for local indexing.",
      progress: repositorySource === "github" ? 28 : 18,
      canStop: false,
    });
    const prepared = await prepareRepositoryForIndexing(pathToIndex, nameToIndex);
    stopIfRequested();
    pathToIndex = prepared.indexedPath;

    setActiveTask({
      kind: "analyze",
      label: "Indexing repository",
      detail: "Parsing files, building the search index, and preparing workflow evidence.",
      progress: 48,
      canStop: true,
    });
    const indexed = await indexProject(pathToIndex, nameToIndex, controller.signal);
    stopIfRequested();
    await refreshProjects();
    setSelectedProjectId(indexed.projectId);
    const notice = indexingNotice(indexed);
    if (notice) setNotice(notice);
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
      if (!canAnalyze) {
        setActiveTask({
          kind: "brief",
          label: "Opening saved briefing",
          detail: "Loading the latest briefing already stored for this repository.",
          progress: 35,
        });
        const saved = await getLatestOnboardingSession(projectId);
        if (saved) {
          setSession(saved);
          setFollowups([]);
          setQuestion(defaultQuestion);
          setEvidenceOpen(false);
          return;
        }
      }

      setActiveTask({
        kind: "brief",
        label: "Surveying repository and writing briefing",
        detail: "Building a source-backed project map, then turning it into a role-aware briefing.",
        progress: canAnalyze ? 64 : 35,
        canStop: true,
      });
      await preflightModelEndpoint();
      const result = await createOnboardingSession(projectId, briefingRole, controller.signal);
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
    const currentKind = activeTask?.kind === "brief" ? "brief" : "analyze";
    setActiveTask({
      kind: currentKind,
      label: currentKind === "brief" ? "Cancelling briefing generation" : "Stopping analysis after the current step",
      detail:
        currentKind === "brief"
          ? "Cancelling the current generation request. Already saved briefings are not changed."
          : "Waiting for the current repository operation to release cleanly.",
      progress: 92,
    });
  }

  async function handleReindexCurrentProject() {
    if (!selectedProject || isCreatingBriefing) return;
    setError(null);
    setNotice(null);
    setAnalysisStopRequested(false);
    const controller = new AbortController();
    analysisAbortController.current = controller;

    try {
      setActiveTask({
        kind: "analyze",
        label: "Re-indexing selected repository",
        detail: "Parsing the current repository copy and rebuilding local search evidence.",
        progress: 45,
        canStop: true,
      });
      const indexed = await indexProject(selectedProject.repoPath, selectedProject.name, controller.signal);
      await refreshProjects();
      setSelectedProjectId(indexed.projectId);
      const notice = indexingNotice(indexed);
      if (notice) setNotice(notice);

      setActiveTask({
        kind: "brief",
        label: "Surveying repository and writing fresh briefing",
        detail: "Rebuilding the project map from source evidence, then generating a new briefing.",
        progress: 64,
        canStop: true,
      });
      await preflightModelEndpoint();
      const result = await createOnboardingSession(indexed.projectId, briefingRole, controller.signal);
      setSession(result);
      setFollowups([]);
      setQuestion(defaultQuestion);
      setEvidenceOpen(false);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Fresh briefing cancelled. Any partial index data was discarded.");
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

  async function handleFollowup() {
    if (!selectedProjectId || !session || !question.trim()) return;
    if (followupInFlight.current) return;
    followupInFlight.current = true;
    setError(null);
    setNotice(null);
    setActiveTask({ kind: "followup", label: "Answering follow-up" });
    try {
      await preflightModelEndpoint();
      const result = await askFollowup(selectedProjectId, session.session.id, question, followups);
      setFollowups((current) => [...current, result]);
      setQuestion("");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      followupInFlight.current = false;
      setActiveTask(null);
    }
  }

  function handleGithubRepositoryChange(value: string) {
    setSelectedProjectId("");
    setGithubRepository(value);
    if (!projectName.trim()) {
      const parts = value
        .replace(/\.git$/, "")
        .split("/")
        .filter(Boolean);
      const repo = parts.at(-1);
      const owner = parts.at(-2);
      if (owner && repo) setProjectName(`${owner}/${repo}`);
    }
  }

  function handleRepoPathChange(value: string) {
    setSelectedProjectId("");
    setRepoPath(value);
  }

  function handleRepositorySourceChange(value: RepositorySource) {
    setSelectedProjectId("");
    setRepositorySource(value);
  }

  function handleSelectProject(project: Project) {
    setError(null);
    setNotice(null);
    setSelectedProjectId(project.id);
    setProjectName(project.name);
    setGithubRepository("");
    setRepoPath("");
    setSession(null);
    setFollowups([]);
  }

  function handleSelectProjectFromSettings(project: Project) {
    handleSelectProject(project);
    setAdvancedOpen(false);
  }

  function handleStartNewBriefing() {
    setError(null);
    setNotice(null);
    setSession(null);
    setFollowups([]);
    setQuestion(defaultQuestion);
    setEvidenceOpen(false);
    setGithubRepository("");
    setRepoPath("");
    setProjectName("");
    setSelectedProjectId("");
    setRepositorySource("github");
  }

  async function handleCopyBriefing() {
    if (!briefingMarkdown) return;
    setError(null);
    setNotice(null);
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
    setNotice(null);
    try {
      const exported = await saveMarkdownFile(
        `${safeFileName(session.session.repoName)}-sonar-briefing.md`,
        briefingMarkdown,
      );
      if (exported) setNotice("Briefing exported as Markdown.");
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }

  return (
    <main className="app-shell">
      <AppHeader
        onOpenSettings={() => setAdvancedOpen(true)}
        onRefreshServices={() => void refreshServices()}
        runtime={runtime}
      />

      {(error || notice) && (
        <div className="toast-stack">
          {error && <Toast onDismiss={() => setError(null)}>{error}</Toast>}
          {notice && (
            <Toast onDismiss={() => setNotice(null)} tone="notice">
              {notice}
            </Toast>
          )}
        </div>
      )}

      {activeTask && activeTask.kind !== "bootstrap" && activeTask.kind !== "settings" && (
        <ProgressPanel activeTask={activeTask} onStop={handleStopAnalysis} stopDisabled={analysisStopRequested} />
      )}

      <section className={hasBrief ? "briefing-shell" : "start-shell"}>
        {session ? (
          <BriefingView
            activeTask={activeTask}
            citation={citation}
            followups={followups}
            latestSources={latestSources}
            onCopyBriefing={() => void handleCopyBriefing()}
            onExportBriefing={() => void handleExportBriefing()}
            onFollowup={() => void handleFollowup()}
            onOpenEvidence={() => setEvidenceOpen(true)}
            onReindexCurrentProject={() => void handleReindexCurrentProject()}
            onStartNewBriefing={handleStartNewBriefing}
            onQuestionChange={setQuestion}
            question={question}
            selectedProject={selectedProject}
            session={session}
            sourceFileCount={sourceFileCount}
          />
        ) : (
          <HomeScreen
            activeTask={activeTask}
            briefingRole={briefingRole}
            canAnalyze={canAnalyze}
            githubRepository={githubRepository}
            isCreatingBriefing={isCreatingBriefing}
            modelConfig={modelConfig}
            onChooseDirectory={() => void chooseDirectory()}
            onBriefingRoleChange={setBriefingRole}
            onCreateBriefing={() => void handleCreateBriefing()}
            onGithubRepositoryChange={handleGithubRepositoryChange}
            onOpenSettings={() => setAdvancedOpen(true)}
            onProjectNameChange={setProjectName}
            onReindexSelectedProject={() => void handleReindexCurrentProject()}
            onRepositorySourceChange={handleRepositorySourceChange}
            onRepoPathChange={handleRepoPathChange}
            onSelectProject={handleSelectProject}
            onStartRuntime={() => void bootstrap()}
            projectName={projectName}
            projects={projects}
            repositorySource={repositorySource}
            repoPath={repoPath}
            runtime={runtime}
            runtimeBlocker={runtimeBlocker}
            runtimeBusy={runtimeBusy}
            runtimeReady={runtimeReady}
            selectedProjectId={selectedProjectId}
            snapshot={snapshot}
          />
        )}
      </section>

      {evidenceOpen && (
        <EvidenceDrawer citation={citation} onClose={() => setEvidenceOpen(false)} sources={latestSources} />
      )}

      {advancedOpen && (
        <SettingsDrawer
          activeTask={activeTask}
          modelConfig={modelConfig}
          onBootstrap={() => void bootstrap()}
          onClose={() => setAdvancedOpen(false)}
          onCreateDiagnostics={handleCreateDiagnosticsBundle}
          onModelConfigChange={setModelConfig}
          onRefreshProjects={() => void refreshProjects()}
          onSaveModelConfig={() => void handleSaveModelConfig()}
          onSelectProject={handleSelectProjectFromSettings}
          projects={projects}
          selectedProjectId={selectedProjectId}
          snapshot={snapshot}
        />
      )}

      {modelSetupOpen && !modelConfig.modelSetupComplete && (
        <ModelSetupDialog
          activeTask={activeTask}
          modelConfig={modelConfig}
          onModelConfigChange={setModelConfig}
          onSave={() => void handleSaveModelConfig()}
        />
      )}
    </main>
  );
}
