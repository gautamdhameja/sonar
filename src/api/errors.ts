import { PersonaValidationError } from "../persona/schema";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function toErrorResponse(err: unknown): { status: number; message: string } {
  if (err instanceof HttpError) {
    return { status: err.status, message: err.message };
  }
  if (err instanceof PersonaValidationError) {
    return { status: 400, message: err.message };
  }
  return { status: 500, message: err instanceof Error ? err.message : String(err) };
}
