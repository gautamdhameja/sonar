import { Cloud, RefreshCw, Save, Server, X } from "lucide-react";
import { dockerModelRunnerConfig, openAiCompatibleConfig } from "../app/constants";
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
  const useDockerLocal = () => onModelConfigChange({ ...dockerModelRunnerConfig, apiToken: modelConfig.apiToken });
  const useApiEndpoint = () => onModelConfigChange({ ...openAiCompatibleConfig, apiToken: modelConfig.apiToken });

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
          <h3>Model source</h3>
          <div className="model-mode-grid">
            <button
              className={modelConfig.modelMode === "local" ? "model-mode active" : "model-mode"}
              onClick={useDockerLocal}
              type="button"
            >
              <Server size={18} />
              <span>
                <strong>Local Docker model</strong>
                <small>Use Docker Model Runner for generation and embeddings.</small>
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
                <small>Use OpenAI-compatible cloud or self-hosted endpoints.</small>
              </span>
            </button>
          </div>

          <h3>{modelConfig.modelMode === "local" ? "Local model settings" : "API endpoint settings"}</h3>
          <div className="settings-grid">
            {modelConfig.modelMode === "api" && (
              <label className="field">
                <span>Generation endpoint</span>
                <input
                  value={modelConfig.chatBaseUrl}
                  onChange={(event) => updateModelConfig({ chatBaseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1 or http://localhost:8080/v1"
                />
              </label>
            )}
            <label className="field">
              <span>Generation model</span>
              <input
                value={modelConfig.chatModel}
                onChange={(event) => updateModelConfig({ chatModel: event.target.value })}
                placeholder={
                  modelConfig.modelMode === "local" ? "hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL" : "gpt-4.1-mini"
                }
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
            {modelConfig.modelMode === "api" && (
              <label className="field">
                <span>Embedding endpoint</span>
                <input
                  value={modelConfig.embeddingBaseUrl}
                  onChange={(event) => updateModelConfig({ embeddingBaseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1 or http://localhost:12434/engines/v1"
                />
              </label>
            )}
            <label className="field">
              <span>Embedding model</span>
              <input
                value={modelConfig.embeddingModel}
                onChange={(event) => updateModelConfig({ embeddingModel: event.target.value })}
                placeholder={
                  modelConfig.modelMode === "local"
                    ? "hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M"
                    : "text-embedding-3-small"
                }
              />
            </label>
            {modelConfig.modelMode === "api" && (
              <label className="field">
                <span>Embedding API key</span>
                <input
                  value={modelConfig.embeddingApiKey}
                  onChange={(event) => updateModelConfig({ embeddingApiKey: event.target.value })}
                  placeholder="Required for cloud APIs"
                  type="password"
                />
              </label>
            )}
            <label className="field">
              <span>Embedding vector size</span>
              <input
                min={1}
                step={1}
                type="number"
                value={modelConfig.embeddingVectorSize}
                onChange={(event) =>
                  updateModelConfig({ embeddingVectorSize: Number.parseInt(event.target.value, 10) || 768 })
                }
                placeholder="768 for Docker local, 1536 for text-embedding-3-small"
              />
            </label>
          </div>
          <div className="preset-row">
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
