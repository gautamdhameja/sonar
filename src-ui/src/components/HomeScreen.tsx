import { BookOpen, FolderOpen, GitBranch, HardDrive, Loader2, Lock, Sparkles } from "lucide-react";
import type { ActiveTask, RepositorySource } from "../app/types";
import { demoRepository } from "../app/constants";
import type { Project, ServiceSnapshot, ServiceState } from "../types";
import { ReadinessCard } from "./ReadinessCard";

interface HomeScreenProps {
  activeTask: ActiveTask | null;
  canAnalyze: boolean;
  githubRepository: string;
  isCreatingBriefing: boolean;
  projectName: string;
  projects: Project[];
  repositorySource: RepositorySource;
  repoPath: string;
  runtime: ServiceState;
  runtimeBusy: boolean;
  runtimeReady: boolean;
  selectedProjectId: string;
  snapshot: ServiceSnapshot | null;
  onChooseDirectory: () => void;
  onCreateBriefing: () => void;
  onGithubRepositoryChange: (value: string) => void;
  onOpenSettings: () => void;
  onProjectNameChange: (value: string) => void;
  onRepositorySourceChange: (value: RepositorySource) => void;
  onRepoPathChange: (value: string) => void;
  onSelectProject: (project: Project) => void;
  onStartRuntime: () => void;
  onUseDemoRepository: () => void;
}

export function HomeScreen({
  activeTask,
  canAnalyze,
  githubRepository,
  isCreatingBriefing,
  projectName,
  projects,
  repositorySource,
  repoPath,
  runtime,
  runtimeBusy,
  runtimeReady,
  selectedProjectId,
  snapshot,
  onChooseDirectory,
  onCreateBriefing,
  onGithubRepositoryChange,
  onOpenSettings,
  onProjectNameChange,
  onRepositorySourceChange,
  onRepoPathChange,
  onSelectProject,
  onStartRuntime,
  onUseDemoRepository,
}: HomeScreenProps) {
  const createDisabled = (!canAnalyze && !selectedProjectId) || isCreatingBriefing || runtimeBusy || !runtimeReady;

  return (
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
          onOpenSettings={onOpenSettings}
          onStart={onStartRuntime}
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
          <button className="secondary compact-button" onClick={onUseDemoRepository} type="button">
            Try Excalidraw
          </button>
        </div>

        <div className="segmented" role="tablist" aria-label="Repository source">
          <button
            className={repositorySource === "github" ? "segment active" : "segment"}
            onClick={() => onRepositorySourceChange("github")}
            type="button"
          >
            <GitBranch size={16} />
            GitHub
          </button>
          <button
            className={repositorySource === "local" ? "segment active" : "segment"}
            onClick={() => onRepositorySourceChange("local")}
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
              onChange={(event) => onGithubRepositoryChange(event.target.value)}
              placeholder={demoRepository}
            />
          </label>
        ) : (
          <label className="field">
            <span>Repository folder</span>
            <div className="repo-picker">
              <input
                value={repoPath}
                onChange={(event) => onRepoPathChange(event.target.value)}
                placeholder="/Users/you/code/product"
              />
              <button className="secondary" onClick={onChooseDirectory} type="button">
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
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder="Product or team name"
          />
        </label>

        <button className="primary hero-action" disabled={createDisabled} onClick={onCreateBriefing} type="button">
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
                onClick={() => onSelectProject(project)}
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
              onClick={onCreateBriefing}
              type="button"
            >
              <BookOpen size={15} />
              Use selected
            </button>
          )}
        </div>
      )}
    </article>
  );
}
