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
  const workspaceReady = api?.state === "ready" && serviceDetail(snapshot, "meilisearch")?.state === "ready";
  const isStarting = activeTask?.kind === "bootstrap";
  const isPreparingModel = activeTask?.kind === "settings";
  const isWorking = isStarting || isPreparingModel;
  const dockerUnavailable =
    runtimeBlocker !== null ||
    (snapshot?.services ?? []).some((service) => service.detail.toLowerCase().includes("docker is not installed"));
  const title = dockerUnavailable
    ? runtimeBlocker?.includes("required")
      ? "Docker Desktop required"
      : "Docker Desktop not ready"
    : isPreparingModel
      ? "Preparing Sonar"
      : !modelConfigured
        ? "Choose a model source"
        : runtime === "ready"
          ? "Runtime ready"
          : runtime === "unknown" || runtime === "starting"
            ? "Preparing workspace"
            : "Runtime needs attention";
  const body = dockerUnavailable
    ? (runtimeBlocker ??
      "Sonar needs Docker Desktop for the local API and search service. Install Docker Desktop, then restart Sonar.")
    : isPreparingModel
      ? (activeTask.detail ?? "Starting the selected Docker stack and validating model endpoints.")
      : !modelConfigured
        ? "Select local Docker models or API models. Sonar will start the right Docker stack once after your choice."
        : runtime === "ready"
          ? "Workspace services and model endpoints are available."
          : "First startup can take a few minutes while Docker pulls images, prepares services, and validates models.";

  return (
    <section className={`readiness-card ${runtime}`}>
      <div>
        <p className="eyebrow">Status</p>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="readiness-checks">
        <span className={!modelConfigured ? "ready" : workspaceReady ? "ready" : ""}>
          {(!modelConfigured && !isPreparingModel) || workspaceReady ? (
            <CheckCircle2 size={15} />
          ) : (
            <CircleDashed size={15} />
          )}
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
        {dockerUnavailable ? (
          <span className="setup-required">
            <AlertCircle size={16} />
            Install Docker Desktop and restart Sonar
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
