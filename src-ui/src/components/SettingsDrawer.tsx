import { Bug, Cloud, RefreshCw, Save, Server, Trash2, X } from "lucide-react";
import { localLlamaConfig, openAiCompatibleConfig } from "../app/constants";
import { stateLabel } from "../app/format";
import type { ActiveTask } from "../app/types";
import { useDialog } from "../app/useDialog";
import type { DesktopModelConfig, Project, ServiceSnapshot } from "../types";

interface SettingsDrawerProps {
  activeTask: ActiveTask | null;
  modelConfig: DesktopModelConfig;
  projects: Project[];
  selectedProjectId: string;
  snapshot: ServiceSnapshot | null;
  onBootstrap: () => void;
  onClearLocalAppState: () => void;
  onClose: () => void;
  onCreateDiagnostics: () => void;
  onModelConfigChange: (config: DesktopModelConfig) => void;
  onRefreshProjects: () => void;
  onSaveModelConfig: () => void;
  onSelectProject: (project: Project) => void;
}

export function SettingsDrawer({
  activeTask,
  modelConfig,
  projects,
  selectedProjectId,
  snapshot,
  onBootstrap,
  onClearLocalAppState,
  onClose,
  onCreateDiagnostics,
  onModelConfigChange,
  onRefreshProjects,
  onSaveModelConfig,
  onSelectProject,
}: SettingsDrawerProps) {
  const updateModelConfig = (patch: Partial<DesktopModelConfig>) => onModelConfigChange({ ...modelConfig, ...patch });
  const useLocalModel = () => onModelConfigChange(localLlamaConfig);
  const useApiEndpoint = () => onModelConfigChange(openAiCompatibleConfig);
  const runtimeBusy = activeTask?.kind === "bootstrap" || activeTask?.kind === "settings";
  const panelRef = useDialog<HTMLElement>(onClose);

  return (
    <div className="drawer-backdrop" role="presentation">
      <button aria-label="Close settings panel" className="drawer-scrim" onClick={onClose} type="button" />
      <aside
        aria-labelledby="settings-title"
        aria-modal="true"
        className="drawer wide-drawer"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Advanced</p>
            <h2 id="settings-title">Runtime and model settings</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </div>

        <section className="drawer-section">
          <div className="section-title-row">
            <h3>Local services</h3>
            <div className="button-row">
              <button
                className="secondary compact-button"
                disabled={runtimeBusy}
                onClick={onCreateDiagnostics}
                type="button"
              >
                <Bug size={15} />
                Diagnostics
              </button>
              <button className="secondary compact-button" disabled={runtimeBusy} onClick={onBootstrap} type="button">
                <RefreshCw size={15} />
                Check
              </button>
            </div>
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
            {(snapshot?.services ?? []).length === 0 && <p className="muted">No runtime checks have completed yet.</p>}
          </div>
        </section>

        <section className="drawer-section">
          <div className="section-title-row local-data-row">
            <h3>Indexed projects</h3>
            <button className="secondary compact-button" onClick={onRefreshProjects} type="button">
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
                onClick={() => onSelectProject(project)}
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
          <h3>Model source</h3>
          <div className="model-mode-grid">
            <button
              className={modelConfig.modelMode === "local" ? "model-mode active" : "model-mode"}
              onClick={useLocalModel}
              type="button"
            >
              <Server size={18} />
              <span>
                <strong>Local llama.cpp</strong>
                <small>Use a local OpenAI-compatible llama.cpp server.</small>
              </span>
            </button>
            <button
              className={modelConfig.modelMode === "api" ? "model-mode active" : "model-mode"}
              onClick={useApiEndpoint}
              type="button"
            >
              <Cloud size={18} />
              <span>
                <strong>API endpoint</strong>
                <small>Use an OpenAI-compatible cloud or self-hosted generation API.</small>
              </span>
            </button>
          </div>

          <h3>{modelConfig.modelMode === "local" ? "Local model settings" : "API endpoint settings"}</h3>
          <div className="settings-grid">
            <label className="field">
              <span>Generation endpoint</span>
              <input
                value={modelConfig.chatBaseUrl}
                onChange={(event) => updateModelConfig({ chatBaseUrl: event.target.value })}
                placeholder={
                  modelConfig.modelMode === "local" ? "http://127.0.0.1:8080/v1" : "https://api.openai.com/v1"
                }
              />
            </label>
            <label className="field">
              <span>Generation model</span>
              <input
                value={modelConfig.chatModel}
                onChange={(event) => updateModelConfig({ chatModel: event.target.value })}
                placeholder={modelConfig.modelMode === "local" ? "local-model" : "gpt-4.1-mini"}
              />
            </label>
            {modelConfig.modelMode === "api" && (
              <label className="field">
                <span>Generation API key</span>
                <input
                  value={modelConfig.chatApiKey}
                  onChange={(event) => updateModelConfig({ chatApiKey: event.target.value })}
                  placeholder="Required for cloud APIs"
                  type="password"
                />
              </label>
            )}
          </div>
          <div className="preset-row">
            <button className="primary" disabled={runtimeBusy} onClick={onSaveModelConfig} type="button">
              <Save size={16} />
              Save and restart runtime
            </button>
          </div>
        </section>

        <section className="drawer-section">
          <div className="section-title-row">
            <div>
              <h3>Local data</h3>
              <p className="muted">
                Remove saved briefings, indexed projects, cached GitHub clones, runtime settings, and logs from this
                machine.
              </p>
            </div>
            <button
              className="quiet-danger compact-button"
              disabled={activeTask !== null}
              onClick={onClearLocalAppState}
              type="button"
            >
              <Trash2 size={15} />
              Clear local app state
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}
