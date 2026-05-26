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
