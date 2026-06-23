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
  if (lower.includes("node_module_version") || lower.includes("better_sqlite3.node")) {
    return "Sonar could not start its workspace engine because native dependencies were built for a different Node.js version. Use any supported Node.js version from package.json, run `npm install` again, then restart the desktop app.";
  }
  if (lower.includes("no bundled api sidecar") || lower.includes("npm is not available")) {
    return "Sonar could not start its workspace engine. Install dependencies and run the desktop app from the project checkout.";
  }
  if (lower.includes("not available on path")) {
    return raw;
  }
  if (lower.includes("local llama.cpp is not running")) {
    return raw;
  }
  if (lower.includes("connection refused")) {
    return "Sonar could not reach the selected local endpoint. Start the local runtime or update the model settings.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Sonar could not reach its workspace engine. Start the local runtime, then try again.";
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
