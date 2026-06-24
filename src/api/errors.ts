import { PersonaValidationError } from "../persona/schema";
import { LlmGenerationError } from "../generator/errors";
import { logger } from "../utils/logger";

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
  if (err instanceof LlmGenerationError) {
    return { status: 502, message: err.userMessage };
  }
  if (err instanceof Error && err.message.startsWith("LLM generation failed:")) {
    return { status: 502, message: "Model provider request failed" };
  }
  if (err instanceof Error && err.message === "LLM generation failed") {
    return { status: 502, message: "Model provider request failed" };
  }
  logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  return { status: 500, message: "Internal server error" };
}
