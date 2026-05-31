import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { askFollowup, createOnboardingSession, indexProject, listProjects, setApiToken } from "./api";
import { buildBriefingMarkdown } from "./app/briefingMarkdown";
import { defaultQuestion, demoRepository, dockerModelRunnerConfig } from "./app/constants";
import { saveMarkdownFile } from "./app/exportMarkdown";
import { friendlyErrorMessage, runtimeState, safeFileName } from "./app/format";
import {
  cloneGithubRepository,
  isTauriRuntime,
  loadModelConfig,
  prepareRepositoryForIndexing,
  saveModelConfig,
  serviceCommand,
} from "./app/runtime";
import type { ActiveTask, RepositorySource } from "./app/types";
import { AppHeader } from "./components/AppHeader";
import { BriefingView } from "./components/BriefingView";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { HomeScreen } from "./components/HomeScreen";
import { ProgressPanel } from "./components/ProgressPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { Toast } from "./components/Toast";
import type {
  DesktopModelConfig,
  FollowupResponse,
  OnboardingSessionResponse,
  Project,
  ServiceSnapshot,
} from "./types";

export function App() {
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
  const analysisAbortController = useRef<AbortController | null>(null);

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
    setApiToken(next.apiToken);
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
      setApiToken(modelConfig.apiToken);
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

  function handleGithubRepositoryChange(value: string) {
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

  function handleSelectProject(project: Project) {
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
      <AppHeader
        onOpenSettings={() => setAdvancedOpen(true)}
        onRefreshServices={() => void refreshServices()}
        runtime={runtime}
      />

      {error && <Toast>{error}</Toast>}
      {notice && <Toast tone="notice">{notice}</Toast>}

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
            onCreateOnboarding={() => void handleCreateOnboarding()}
            onExportBriefing={() => void handleExportBriefing()}
            onFollowup={() => void handleFollowup()}
            onOpenEvidence={() => setEvidenceOpen(true)}
            onQuestionChange={setQuestion}
            question={question}
            selectedProject={selectedProject}
            session={session}
            sourceFileCount={sourceFileCount}
          />
        ) : (
          <HomeScreen
            activeTask={activeTask}
            canAnalyze={canAnalyze}
            githubRepository={githubRepository}
            isCreatingBriefing={isCreatingBriefing}
            onChooseDirectory={() => void chooseDirectory()}
            onCreateBriefing={() => void handleCreateBriefing()}
            onGithubRepositoryChange={handleGithubRepositoryChange}
            onOpenSettings={() => setAdvancedOpen(true)}
            onProjectNameChange={setProjectName}
            onRepositorySourceChange={setRepositorySource}
            onRepoPathChange={setRepoPath}
            onSelectProject={handleSelectProject}
            onStartRuntime={() => void bootstrap()}
            onUseDemoRepository={handleUseDemoRepository}
            projectName={projectName}
            projects={projects}
            repositorySource={repositorySource}
            repoPath={repoPath}
            runtime={runtime}
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
          onModelConfigChange={setModelConfig}
          onRefreshProjects={() => void refreshProjects()}
          onSaveModelConfig={() => void handleSaveModelConfig()}
          onSelectProject={handleSelectProjectFromSettings}
          projects={projects}
          selectedProjectId={selectedProjectId}
          snapshot={snapshot}
        />
      )}
    </main>
  );
}
