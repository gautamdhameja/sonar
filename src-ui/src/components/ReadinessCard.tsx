import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Server, Sparkles } from "lucide-react";
import type { ActiveTask } from "../app/types";
import { serviceCounts, serviceDetail } from "../app/format";
import type { ServiceSnapshot, ServiceState } from "../types";

interface ReadinessCardProps {
  snapshot: ServiceSnapshot | null;
  runtime: ServiceState;
  activeTask: ActiveTask | null;
  runtimeBlocker: string | null;
  onStart: () => void;
  onOpenSettings: () => void;
}

export function ReadinessCard({
  snapshot,
  runtime,
  activeTask,
  runtimeBlocker,
  onStart,
  onOpenSettings,
}: ReadinessCardProps) {
  const counts = serviceCounts(snapshot);
  const api = serviceDetail(snapshot, "sonar");
  const model = serviceDetail(snapshot, "chat") ?? serviceDetail(snapshot, "models");
  const isStarting = activeTask?.kind === "bootstrap";
  const dockerUnavailable =
    runtimeBlocker !== null ||
    (snapshot?.services ?? []).some((service) => service.detail.toLowerCase().includes("docker is not installed"));
  const title = dockerUnavailable
    ? runtimeBlocker?.includes("required")
      ? "Docker Desktop required"
      : "Docker Desktop not ready"
    : runtime === "ready"
      ? "Runtime ready"
      : runtime === "unknown" || runtime === "starting"
        ? "Checking runtime"
        : "Runtime needs attention";
  const body = dockerUnavailable
    ? (runtimeBlocker ??
      "Sonar needs Docker Desktop for the local API, search, and vector index. Install Docker Desktop, then restart Sonar.")
    : runtime === "ready"
      ? "Search, vectors, API, and model endpoints are available."
      : "Start the local services before creating a briefing. First run can take several minutes while Docker prepares models.";

  return (
    <section className={`readiness-card ${runtime}`}>
      <div>
        <p className="eyebrow">Status</p>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="readiness-checks">
        <span>
          <CheckCircle2 size={15} />
          {counts.total === 0 ? "Checking services" : `${counts.ready}/${counts.total} services ready`}
        </span>
        <span className={api?.state === "ready" ? "ready" : ""}>
          <Server size={15} />
          {api?.state === "ready" ? "API reachable" : "API pending"}
        </span>
        <span className={model?.state === "ready" ? "ready" : ""}>
          <Sparkles size={15} />
          {model?.state === "ready" ? "Model endpoint reachable" : "Model endpoint pending"}
        </span>
      </div>
      <div className="readiness-actions">
        {dockerUnavailable ? (
          <span className="setup-required">
            <AlertCircle size={16} />
            Install Docker Desktop and restart Sonar
          </span>
        ) : (
          <button className="primary" disabled={isStarting} onClick={onStart} type="button">
            {isStarting ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            {runtime === "ready" ? "Check again" : "Start local runtime"}
          </button>
        )}
        <button className="secondary" onClick={onOpenSettings} type="button">
          Settings
        </button>
      </div>
    </section>
  );
}
