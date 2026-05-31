import { CheckCircle2, Loader2, RefreshCw, Server, Sparkles } from "lucide-react";
import type { ActiveTask } from "../app/types";
import { serviceCounts, serviceDetail } from "../app/format";
import type { ServiceSnapshot, ServiceState } from "../types";

interface ReadinessCardProps {
  snapshot: ServiceSnapshot | null;
  runtime: ServiceState;
  activeTask: ActiveTask | null;
  onStart: () => void;
  onOpenSettings: () => void;
}

export function ReadinessCard({ snapshot, runtime, activeTask, onStart, onOpenSettings }: ReadinessCardProps) {
  const counts = serviceCounts(snapshot);
  const api = serviceDetail(snapshot, "sonar");
  const model = serviceDetail(snapshot, "chat") ?? serviceDetail(snapshot, "models");
  const isStarting = activeTask?.kind === "bootstrap";
  const title =
    runtime === "ready"
      ? "Local runtime is ready"
      : runtime === "unknown" || runtime === "starting"
        ? "Checking local runtime"
        : "Finish local setup";
  const body =
    runtime === "ready"
      ? "Sonar can index a selected repository and ask the configured model for a grounded briefing."
      : "Sonar uses Docker for search, vectors, embeddings, and the API. The first run can download models in Docker Desktop and may take several minutes.";

  return (
    <section className={`readiness-card ${runtime}`}>
      <div>
        <p className="eyebrow">Readiness</p>
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
        <button className="primary" disabled={isStarting} onClick={onStart} type="button">
          {isStarting ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {runtime === "ready" ? "Check again" : "Start local runtime"}
        </button>
        <button className="secondary" onClick={onOpenSettings} type="button">
          Details
        </button>
      </div>
    </section>
  );
}
