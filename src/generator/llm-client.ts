import OpenAI from "openai";
import { CONFIG } from "../config";
import { logger } from "../utils/logger";

const client = new OpenAI({
  baseURL: CONFIG.chat.baseUrl,
  apiKey: CONFIG.chat.apiKey,
  timeout: 120_000,
  maxRetries: 1,
});

export interface LlmCompletion {
  content: string;
  finishReason: string | null;
  truncated: boolean;
}

type TokenLimitParam = "max_tokens" | "max_completion_tokens";

let preferredTokenLimitParam: TokenLimitParam = defaultTokenLimitParam();

function defaultTokenLimitParam(): TokenLimitParam {
  try {
    const host = new URL(CONFIG.chat.baseUrl).hostname;
    if (host === "api.openai.com" || host.endsWith(".openai.com")) return "max_completion_tokens";
  } catch {
    // Invalid URLs are rejected during config loading. Keep local-compatible behavior here.
  }

  return /^gpt-[5-9]/i.test(CONFIG.chat.model) || /^o[1-9]/i.test(CONFIG.chat.model)
    ? "max_completion_tokens"
    : "max_tokens";
}

function unsupportedParameter(err: unknown): string | null {
  const error = err as {
    param?: unknown;
    code?: unknown;
    message?: unknown;
    error?: { param?: unknown; code?: unknown };
  };
  const param =
    typeof error.param === "string"
      ? error.param
      : error.error && typeof error.error.param === "string"
        ? error.error.param
        : null;
  const code =
    typeof error.code === "string"
      ? error.code
      : error.error && typeof error.error.code === "string"
        ? error.error.code
        : null;
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "unsupported_parameter" || /unsupported parameter/i.test(message)) return param;
  return null;
}

export async function generateCompletion(system: string, user: string): Promise<LlmCompletion> {
  try {
    const request = {
      model: CONFIG.chat.model,
      messages: [
        { role: "system" as const, content: system },
        { role: "user" as const, content: user },
      ],
      temperature: CONFIG.generator.temperature,
    };
    const completion = await client.chat.completions
      .create({
        ...request,
        [preferredTokenLimitParam]: CONFIG.generator.maxResponseTokens,
      })
      .catch((err) => {
        const rejectedParam = unsupportedParameter(err);
        if (rejectedParam !== preferredTokenLimitParam) throw err;

        preferredTokenLimitParam = preferredTokenLimitParam === "max_tokens" ? "max_completion_tokens" : "max_tokens";
        logger.info(`Retrying LLM generation with ${preferredTokenLimitParam}`);
        return client.chat.completions.create({
          ...request,
          [preferredTokenLimitParam]: CONFIG.generator.maxResponseTokens,
        });
      });

    const choice = completion.choices[0];
    const finishReason = choice.finish_reason ?? null;
    return {
      content: choice.message.content ?? "",
      finishReason,
      truncated: finishReason === "length",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("LLM generation failed:", message);
    throw new Error(`LLM generation failed: ${message}`);
  }
}

export async function generateResponse(system: string, user: string): Promise<string> {
  const completion = await generateCompletion(system, user);
  return completion.content;
}

export async function generateCompletionWithLengthRetry(
  system: string,
  user: string,
  retryInstruction: string,
): Promise<LlmCompletion> {
  const completion = await generateCompletion(system, user);
  if (!completion.truncated && completion.content.trim() !== "") return completion;

  const retry = await generateCompletion(
    system,
    [user, "", "## Retry Constraint", retryInstruction, "Preserve valid source citations."].join("\n"),
  );
  return retry;
}
