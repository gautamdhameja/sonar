import { Cloud, Loader2, RefreshCw, Save, Server } from "lucide-react";
import { openAiCompatibleConfig } from "../app/constants";
import type { ActiveTask } from "../app/types";
import { useDialog } from "../app/useDialog";
import type { DesktopModelConfig } from "../types";

interface ModelSetupDialogProps {
  activeTask: ActiveTask | null;
  modelDiscoveryBusy: boolean;
  modelConfig: DesktopModelConfig;
  onDiscoverLocalModel: () => void;
  onModelConfigChange: (config: DesktopModelConfig) => void;
  onUseLocalModel: () => void;
  onSave: () => void;
}

export function ModelSetupDialog({
  activeTask,
  modelDiscoveryBusy,
  modelConfig,
  onDiscoverLocalModel,
  onModelConfigChange,
  onUseLocalModel,
  onSave,
}: ModelSetupDialogProps) {
  const updateModelConfig = (patch: Partial<DesktopModelConfig>) => onModelConfigChange({ ...modelConfig, ...patch });
  const useApiEndpoint = () =>
    onModelConfigChange({
      ...openAiCompatibleConfig,
      modelSetupComplete: modelConfig.modelSetupComplete,
    });
  const isSaving = activeTask?.kind === "settings";
  const panelRef = useDialog<HTMLElement>();

  return (
    <div className="drawer-backdrop setup-backdrop" role="presentation">
      <section
        aria-labelledby="setup-title"
        aria-modal="true"
        className="setup-dialog"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div>
          <p className="eyebrow">First run</p>
          <h2 id="setup-title">Choose your model source</h2>
          <p>
            Sonar needs a model to write briefings. Run one locally with llama.cpp so nothing leaves your machine, or
            connect any OpenAI-compatible API endpoint.
          </p>
        </div>

        <div className="model-mode-grid">
          <button
            className={modelConfig.modelMode === "local" ? "model-mode active" : "model-mode"}
            onClick={onUseLocalModel}
            type="button"
          >
            <Server size={18} />
            <span>
              <strong>Local llama.cpp</strong>
              <small>Use a local OpenAI-compatible server on this machine.</small>
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

        <div className="settings-grid">
          <label className="field">
            <span>Generation endpoint</span>
            <input
              value={modelConfig.chatBaseUrl}
              onChange={(event) => updateModelConfig({ chatBaseUrl: event.target.value })}
              placeholder={modelConfig.modelMode === "local" ? "http://127.0.0.1:8080/v1" : "https://api.openai.com/v1"}
            />
          </label>
          <label className="field">
            <span>Generation model</span>
            <div className="inline-field-action">
              <input
                value={modelConfig.chatModel}
                onChange={(event) => updateModelConfig({ chatModel: event.target.value })}
                placeholder={modelConfig.modelMode === "local" ? "Fetch from local server" : "gpt-4.1-mini"}
              />
              {modelConfig.modelMode === "local" && (
                <button
                  className="secondary compact-button"
                  disabled={modelDiscoveryBusy}
                  onClick={onDiscoverLocalModel}
                  type="button"
                >
                  {modelDiscoveryBusy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                  Fetch
                </button>
              )}
            </div>
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
        </div>

        <div className="setup-actions">
          <p>Sonar remembers this and starts the workspace automatically next time.</p>
          <button className="primary" disabled={isSaving} onClick={onSave} type="button">
            {isSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            Save and start
          </button>
        </div>
      </section>
    </div>
  );
}
