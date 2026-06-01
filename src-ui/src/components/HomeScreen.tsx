import { BookOpen, FolderOpen, GitBranch, HardDrive, Loader2, Lock, Sparkles } from "lucide-react";
import { briefingRoleProfiles } from "../app/constants";
import type { ActiveTask, BriefingRole, RepositorySource } from "../app/types";
import type { Project, ServiceSnapshot, ServiceState } from "../types";
import { ReadinessCard } from "./ReadinessCard";

interface HomeScreenProps {
  activeTask: ActiveTask | null;
  briefingRole: BriefingRole;
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
  onBriefingRoleChange: (value: BriefingRole) => void;
  onChooseDirectory: () => void;
  onCreateBriefing: () => void;
  onGithubRepositoryChange: (value: string) => void;
  onOpenSettings: () => void;
  onProjectNameChange: (value: string) => void;
  onRepositorySourceChange: (value: RepositorySource) => void;
  onRepoPathChange: (value: string) => void;
  onSelectProject: (project: Project) => void;
  onStartRuntime: () => void;
}

export function HomeScreen({
  activeTask,
  briefingRole,
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
  onBriefingRoleChange,
  onChooseDirectory,
  onCreateBriefing,
  onGithubRepositoryChange,
  onOpenSettings,
  onProjectNameChange,
  onRepositorySourceChange,
  onRepoPathChange,
  onSelectProject,
  onStartRuntime,
}: HomeScreenProps) {
  const createDisabled = (!canAnalyze && !selectedProjectId) || isCreatingBriefing || runtimeBusy || !runtimeReady;
  const briefingRoles = Object.entries(briefingRoleProfiles) as [
    BriefingRole,
    (typeof briefingRoleProfiles)[BriefingRole],
  ][];

  return (
    <article className="start-card">
      <div className="repo-card">
        <div className="repo-card-head">
          <div>
            <p className="eyebrow">Get started</p>
            <h2>Analyze a repository</h2>
            <p>Create a concise, cited briefing from a GitHub repository or a local folder on this machine.</p>
          </div>
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
              placeholder="https://github.com/owner/repository"
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

        <div className="field">
          <span>Briefing audience</span>
          <div className="role-grid">
            {briefingRoles.map(([value, profile]) => (
              <label className={briefingRole === value ? "role-option active" : "role-option"} key={value}>
                <input
                  checked={briefingRole === value}
                  className="role-radio"
                  name="briefing-role"
                  onChange={() => onBriefingRoleChange(value)}
                  type="radio"
                  value={value}
                />
                <strong>{profile.label}</strong>
                <small>{profile.description}</small>
              </label>
            ))}
          </div>
        </div>

        <button className="primary hero-action" disabled={createDisabled} onClick={onCreateBriefing} type="button">
          {isCreatingBriefing ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          Create briefing
        </button>

        <div className="privacy-note">
          <Lock size={15} />
          <span>
            {runtimeReady
              ? "Only the repository you choose is imported into Sonar's local workspace."
              : "Start the local runtime first. Sonar will import only the repository you choose."}
          </span>
        </div>
      </div>

      <aside className="start-copy">
        <div className="intro-panel">
          <p className="eyebrow">Sonar</p>
          <h2>Understand any codebase. Ask what matters.</h2>
          <p>Create a source-grounded briefing, then ask follow-up questions as you explore.</p>
        </div>

        <ReadinessCard
          activeTask={activeTask}
          onOpenSettings={onOpenSettings}
          onStart={onStartRuntime}
          runtime={runtime}
          snapshot={snapshot}
        />

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
      </aside>
    </article>
  );
}
