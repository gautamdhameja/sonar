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
            Sonar will start the right Docker stack after this choice. Local mode prepares the app services and
            generation model together; API mode starts only the app services and validates your configured endpoint.
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
              <small>Pull app images and the local generation model in one startup.</small>
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
              <small>Start only Sonar's local services and use an OpenAI-compatible generation API.</small>
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
        </div>

        <div className="setup-actions">
          <p>First startup can take a few minutes. Future launches reuse the saved choice and start automatically.</p>
          <button className="primary" disabled={isSaving} onClick={onSave} type="button">
            {isSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            Save and start
          </button>
        </div>
      </section>
    </div>
  );
}
