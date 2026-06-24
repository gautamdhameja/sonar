export type LlmGenerationErrorCode = "timeout" | "unreachable" | "rejected" | "rate_limited" | "provider";

export class LlmGenerationError extends Error {
  constructor(
    public code: LlmGenerationErrorCode,
    public userMessage: string,
    public detail: string,
  ) {
    super(`LLM generation failed: ${detail}`);
    this.name = "LlmGenerationError";
  }
}
