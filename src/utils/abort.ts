export class OperationAbortedError extends Error {
  constructor(message = "Operation aborted") {
    super(message);
    this.name = "OperationAbortedError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new OperationAbortedError();
  }
}

export function isOperationAborted(error: unknown): boolean {
  return error instanceof OperationAbortedError || (error instanceof Error && error.name === "AbortError");
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if (signal?.aborted) {
    clearTimeout(timeout);
    controller.abort();
    return { signal: controller.signal, cleanup: () => clearTimeout(timeout) };
  }

  signal?.addEventListener(
    "abort",
    () => {
      clearTimeout(timeout);
      controller.abort();
    },
    { once: true },
  );
  controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  return { signal: controller.signal, cleanup: () => clearTimeout(timeout) };
}

export async function withTimeout<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const scoped = timeoutSignal(signal, timeoutMs);
  try {
    return await operation(scoped.signal);
  } finally {
    scoped.cleanup();
  }
}
