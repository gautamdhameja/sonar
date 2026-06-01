import type { ServiceSnapshot, ServiceState, ServiceStatus } from "../types";

export function stateLabel(state: ServiceState): string {
  if (state === "ready") return "Ready";
  if (state === "starting") return "Starting";
  if (state === "missing") return "Needs attention";
  if (state === "error") return "Error";
  return "Checking";
}

export function runtimeState(snapshot: ServiceSnapshot | null): ServiceState {
  if (!snapshot) return "unknown";
  if (snapshot.services.some((service) => service.state === "error")) return "error";
  if (snapshot.services.some((service) => service.state === "missing")) return "missing";
  if (snapshot.services.some((service) => service.state === "starting" || service.state === "unknown"))
    return "starting";
  return "ready";
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("docker is not installed") || lower.includes("not available on path")) {
    return "Docker Desktop is required to run Sonar's local indexing services. Install Docker Desktop, then restart Sonar.";
  }
  if (
    lower.includes("cannot connect to the docker daemon") ||
    lower.includes("docker daemon") ||
    lower.includes("is the docker daemon running") ||
    lower.includes("connection refused")
  ) {
    return "Docker Desktop is not ready. Start Docker Desktop, wait for it to finish starting, then restart Sonar.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Sonar could not reach its local API. Start the local runtime, then try again.";
  }
  return raw;
}

export function serviceCounts(snapshot: ServiceSnapshot | null) {
  const services = snapshot?.services ?? [];
  return {
    ready: services.filter((service) => service.state === "ready").length,
    total: services.length,
  };
}

export function serviceDetail(snapshot: ServiceSnapshot | null, id: string): ServiceStatus | null {
  return snapshot?.services.find((service) => service.id === id) ?? null;
}

export function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "sonar-briefing"
  );
}
