import { AlertCircle, CheckCircle2, CircleDashed, Loader2, RefreshCw, Server, Sparkles } from "lucide-react";
import type { ActiveTask } from "../app/types";
import { serviceCounts, serviceDetail } from "../app/format";
import type { DesktopModelConfig, ServiceSnapshot, ServiceState } from "../types";

interface ReadinessCardProps {
  snapshot: ServiceSnapshot | null;
  modelConfig: DesktopModelConfig;
  runtime: ServiceState;
  activeTask: ActiveTask | null;
  runtimeBlocker: string | null;
  onStart: () => void;
  onOpenSettings: () => void;
}

export function ReadinessCard({
  snapshot,
  modelConfig,
  runtime,
  activeTask,
  runtimeBlocker,
  onStart,
  onOpenSettings,
}: ReadinessCardProps) {
  const counts = serviceCounts(snapshot);
  const api = serviceDetail(snapshot, "sonar");
  const model = serviceDetail(snapshot, "chat") ?? serviceDetail(snapshot, "models");
  const modelConfigured = modelConfig.modelSetupComplete;
  const workspaceReady = api?.state === "ready";
  const isStarting = activeTask?.kind === "bootstrap";
  const isPreparingModel = activeTask?.kind === "settings";
  const isWorking = isStarting || isPreparingModel;
  const runtimeUnavailable = runtimeBlocker !== null;
  const title = runtimeUnavailable
    ? "Runtime needs attention"
    : isPreparingModel
      ? "Preparing Sonar"
      : !modelConfigured
        ? "Choose a model source"
        : runtime === "ready"
          ? "Runtime ready"
          : runtime === "unknown" || runtime === "starting"
            ? "Preparing workspace"
            : "Runtime needs attention";
  const body = runtimeUnavailable
    ? (runtimeBlocker ?? "Sonar could not start its local runtime. Check the service details, then try again.")
    : isPreparingModel
      ? (activeTask.detail ?? "Starting the local runtime and validating the model endpoint.")
      : !modelConfigured
        ? "Select a local llama.cpp server or an OpenAI-compatible API endpoint."
        : runtime === "ready"
          ? "Workspace services and model endpoints are available."
          : "Start Sonar's local API, then validate the selected model endpoint.";

  return (
    <section className={`readiness-card ${runtime}`}>
      <div>
        <p className="eyebrow">Status</p>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="readiness-checks">
        <span className={workspaceReady ? "ready" : ""}>
          {workspaceReady ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}
          {isPreparingModel
            ? "Workspace starting"
            : !modelConfigured
              ? "Workspace starts after setup"
              : workspaceReady
                ? "Workspace ready"
                : `${counts.ready}/${counts.total} checks ready`}
        </span>
        <span className={api?.state === "ready" ? "ready" : ""}>
          <Server size={15} />
          {isPreparingModel
            ? "API starting"
            : !modelConfigured
              ? "API not started yet"
              : api?.state === "ready"
                ? "API reachable"
                : "API pending"}
        </span>
        <span className={!modelConfigured ? "" : model?.state === "ready" ? "ready" : ""}>
          {!modelConfigured || isPreparingModel ? <CircleDashed size={15} /> : <Sparkles size={15} />}
          {isPreparingModel
            ? modelConfig.modelMode === "local"
              ? "Local models preparing"
              : "Model API validating"
            : !modelConfigured
              ? "Model source not selected"
              : model?.state === "ready"
                ? modelConfig.modelMode === "local"
                  ? "Local models ready"
                  : "Model API ready"
                : modelConfig.modelMode === "local"
                  ? "Local models preparing"
                  : "Model API pending"}
        </span>
      </div>
      <div className="readiness-actions">
        {runtimeUnavailable ? (
          <span className="setup-required">
            <AlertCircle size={16} />
            Check runtime details
          </span>
        ) : (
          <button className="primary" disabled={isWorking} onClick={onStart} type="button">
            {isWorking ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            {!modelConfigured ? "Choose model source" : runtime === "ready" ? "Check again" : "Start Sonar"}
          </button>
        )}
        <button className="secondary" onClick={onOpenSettings} type="button">
          Settings
        </button>
      </div>
    </section>
  );
}
