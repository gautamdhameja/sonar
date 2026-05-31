import { RefreshCw, Save, Server, X } from "lucide-react";
import { dockerModelRunnerConfig } from "../app/constants";
import { stateLabel } from "../app/format";
import type { ActiveTask } from "../app/types";
import type { DesktopModelConfig, Project, ServiceSnapshot } from "../types";

interface SettingsDrawerProps {
  activeTask: ActiveTask | null;
  modelConfig: DesktopModelConfig;
  projects: Project[];
  selectedProjectId: string;
  snapshot: ServiceSnapshot | null;
  onBootstrap: () => void;
  onClose: () => void;
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
  onClose,
  onModelConfigChange,
  onRefreshProjects,
  onSaveModelConfig,
  onSelectProject,
}: SettingsDrawerProps) {
  const updateModelConfig = (patch: Partial<DesktopModelConfig>) => onModelConfigChange({ ...modelConfig, ...patch });

  return (
    <div className="drawer-backdrop" role="presentation">
      <aside className="drawer wide-drawer">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Advanced</p>
            <h2>Runtime and model settings</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </div>

        <section className="drawer-section">
          <div className="section-title-row">
            <h3>Local services</h3>
            <button className="secondary compact-button" onClick={onBootstrap} type="button">
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
            {(snapshot?.services ?? []).length === 0 && <p className="muted">No runtime checks have completed yet.</p>}
          </div>
        </section>

        <section className="drawer-section">
          <div className="section-title-row">
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
          <h3>Generation API</h3>
          <div className="settings-grid">
            <label className="field">
              <span>API endpoint</span>
              <input
                value={modelConfig.chatBaseUrl}
                onChange={(event) => updateModelConfig({ chatBaseUrl: event.target.value })}
                placeholder="http://localhost:12434/engines/llama.cpp/v1 or https://api.openai.com/v1"
              />
            </label>
            <label className="field">
              <span>Model</span>
              <input
                value={modelConfig.chatModel}
                onChange={(event) => updateModelConfig({ chatModel: event.target.value })}
                placeholder="local/model or gpt-4.1-mini"
              />
            </label>
            <label className="field">
              <span>API key</span>
              <input
                value={modelConfig.chatApiKey}
                onChange={(event) => updateModelConfig({ chatApiKey: event.target.value })}
                placeholder="not-needed for local servers"
                type="password"
              />
            </label>
            <label className="field">
              <span>Embedding API endpoint</span>
              <input
                value={modelConfig.embeddingBaseUrl}
                onChange={(event) => updateModelConfig({ embeddingBaseUrl: event.target.value })}
                placeholder="http://localhost:12434/engines/v1 or https://api.openai.com/v1"
              />
            </label>
            <label className="field">
              <span>Embedding model</span>
              <input
                value={modelConfig.embeddingModel}
                onChange={(event) => updateModelConfig({ embeddingModel: event.target.value })}
                placeholder="hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M"
              />
            </label>
            <label className="field">
              <span>Embedding API key</span>
              <input
                value={modelConfig.embeddingApiKey}
                onChange={(event) => updateModelConfig({ embeddingApiKey: event.target.value })}
                placeholder="not-needed for local servers"
                type="password"
              />
            </label>
          </div>
          <div className="preset-row">
            <button className="secondary" onClick={() => updateModelConfig(dockerModelRunnerConfig)} type="button">
              <Server size={16} />
              Docker local
            </button>
            <button
              className="secondary"
              onClick={() =>
                updateModelConfig({
                  chatBaseUrl: "https://api.openai.com/v1",
                  chatModel: "gpt-4.1-mini",
                  chatApiKey: "",
                  embeddingBaseUrl: "https://api.openai.com/v1",
                  embeddingApiKey: "",
                })
              }
              type="button"
            >
              <Server size={16} />
              OpenAI compatible
            </button>
            <button
              className="primary"
              disabled={activeTask?.kind === "settings"}
              onClick={onSaveModelConfig}
              type="button"
            >
              <Save size={16} />
              Save and restart API
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}
