import { Cloud, Loader2, Save, Server } from "lucide-react";
import { dockerModelRunnerConfig, openAiCompatibleConfig } from "../app/constants";
import type { ActiveTask } from "../app/types";
import type { DesktopModelConfig } from "../types";

interface ModelSetupDialogProps {
  activeTask: ActiveTask | null;
  modelConfig: DesktopModelConfig;
  onModelConfigChange: (config: DesktopModelConfig) => void;
  onSave: () => void;
}

export function ModelSetupDialog({ activeTask, modelConfig, onModelConfigChange, onSave }: ModelSetupDialogProps) {
  const updateModelConfig = (patch: Partial<DesktopModelConfig>) => onModelConfigChange({ ...modelConfig, ...patch });
  const useDockerLocal = () =>
    onModelConfigChange({
      ...dockerModelRunnerConfig,
      apiToken: modelConfig.apiToken,
      modelSetupComplete: modelConfig.modelSetupComplete,
    });
  const useApiEndpoint = () =>
    onModelConfigChange({
      ...openAiCompatibleConfig,
      apiToken: modelConfig.apiToken,
      modelSetupComplete: modelConfig.modelSetupComplete,
    });
  const isSaving = activeTask?.kind === "settings";

  return (
    <div className="drawer-backdrop setup-backdrop" role="presentation">
      <section className="setup-dialog">
        <div>
          <p className="eyebrow">First run</p>
          <h2>Choose your model source</h2>
          <p>
            Sonar starts the local index and search services first. Choose whether generation and embeddings should run
            through Docker Model Runner or an OpenAI-compatible API.
          </p>
        </div>

        <div className="model-mode-grid">
          <button
            className={modelConfig.modelMode === "local" ? "model-mode active" : "model-mode"}
            onClick={useDockerLocal}
            type="button"
          >
            <Server size={18} />
            <span>
              <strong>Local Docker model</strong>
              <small>Use Docker Model Runner. Best when the machine can run local models.</small>
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
              <small>Use OpenAI or another compatible API. Best for laptops without enough VRAM.</small>
            </span>
          </button>
        </div>

        <div className="settings-grid">
          {modelConfig.modelMode === "api" && (
            <label className="field">
              <span>Generation endpoint</span>
              <input
                value={modelConfig.chatBaseUrl}
                onChange={(event) => updateModelConfig({ chatBaseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>
          )}
          <label className="field">
            <span>Generation model</span>
            <input
              value={modelConfig.chatModel}
              onChange={(event) => updateModelConfig({ chatModel: event.target.value })}
              placeholder={modelConfig.modelMode === "local" ? dockerModelRunnerConfig.chatModel : "gpt-4.1-mini"}
            />
          </label>
          {modelConfig.modelMode === "api" && (
            <label className="field">
              <span>Generation API key</span>
              <input
                value={modelConfig.chatApiKey}
                onChange={(event) => updateModelConfig({ chatApiKey: event.target.value })}
                placeholder="OpenAI-compatible API key"
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
                placeholder="https://api.openai.com/v1"
              />
            </label>
          )}
          <label className="field">
            <span>Embedding model</span>
            <input
              value={modelConfig.embeddingModel}
              onChange={(event) => updateModelConfig({ embeddingModel: event.target.value })}
              placeholder={
                modelConfig.modelMode === "local" ? dockerModelRunnerConfig.embeddingModel : "text-embedding-3-small"
              }
            />
          </label>
          {modelConfig.modelMode === "api" && (
            <label className="field">
              <span>Embedding API key</span>
              <input
                value={modelConfig.embeddingApiKey}
                onChange={(event) => updateModelConfig({ embeddingApiKey: event.target.value })}
                placeholder="Usually the same key as generation"
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
            />
          </label>
        </div>

        <div className="setup-actions">
          <p>
            Cloud mode still uses Docker for Sonar's local API, search, and vector database. It only replaces the model
            server.
          </p>
          <button className="primary" disabled={isSaving} onClick={onSave} type="button">
            {isSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            Save and start
          </button>
        </div>
      </section>
    </div>
  );
}
