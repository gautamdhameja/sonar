export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let logLevelOverride: LogLevel | null = null;

function currentLogLevel(): LogLevel {
  if (logLevelOverride) return logLevelOverride;
  const configured = process.env.SONAR_LOG_LEVEL?.toLowerCase();
  if (
    configured === "debug" ||
    configured === "info" ||
    configured === "warn" ||
    configured === "error" ||
    configured === "silent"
  ) {
    return configured;
  }
  return "info";
}

function shouldLog(level: Exclude<LogLevel, "silent">): boolean {
  const configured = currentLogLevel();
  if (configured === "silent") return false;
  return LEVELS[level] >= LEVELS[configured];
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog("debug")) console.debug(message, ...args);
  },
  info(message: string, ...args: unknown[]): void {
    if (shouldLog("info")) console.log(message, ...args);
  },
  warn(message: string, ...args: unknown[]): void {
    if (shouldLog("warn")) console.warn(message, ...args);
  },
  error(message: string, ...args: unknown[]): void {
    if (shouldLog("error")) console.error(message, ...args);
  },
};

export async function withLogLevel<T>(level: LogLevel, fn: () => Promise<T>): Promise<T> {
  const previous = logLevelOverride;
  logLevelOverride = level;
  try {
    return await fn();
  } finally {
    logLevelOverride = previous;
  }
}
