import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const apiBaseUrl = process.env.SONAR_API_BASE_URL || "http://127.0.0.1:3001";
const runtimeEnvPath = join(process.cwd(), ".sonar", "runtime.env");
const timeoutMs = Number(process.env.SONAR_SERVICES_TIMEOUT_MS || 180_000);
const intervalMs = 1_000;

function readRuntimeToken() {
  if (process.env.SONAR_API_TOKEN) return process.env.SONAR_API_TOKEN.trim();
  if (!existsSync(runtimeEnvPath)) {
    throw new Error(`Missing ${runtimeEnvPath}. Run npm run services:env first.`);
  }
  const match = readFileSync(runtimeEnvPath, "utf8").match(/^SONAR_API_TOKEN=(.+)$/m);
  if (!match?.[1]?.trim()) {
    throw new Error(`Missing SONAR_API_TOKEN in ${runtimeEnvPath}.`);
  }
  return match[1].trim();
}

async function checkDependencies(token) {
  const response = await fetch(`${apiBaseUrl}/health/dependencies`, {
    headers: { "X-Sonar-Token": token },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  const payload = JSON.parse(body);
  if (payload.status !== "ok") {
    throw new Error(body.slice(0, 300));
  }
}

const token = readRuntimeToken();
const started = Date.now();
let lastError = "not checked yet";

while (Date.now() - started < timeoutMs) {
  try {
    await checkDependencies(token);
    console.log("Sonar services are ready.");
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

console.error(`Timed out waiting for Sonar services: ${lastError}`);
process.exit(1);
