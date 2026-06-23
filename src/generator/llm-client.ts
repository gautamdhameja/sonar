import OpenAI from "openai";
import { CONFIG } from "../config";
import { isOperationAborted } from "../utils/abort";
import { logger } from "../utils/logger";

const client = new OpenAI({
  baseURL: CONFIG.chat.baseUrl,
  apiKey: CONFIG.chat.apiKey,
  timeout: chatTimeoutMs(),
  maxRetries: 1,
});

export interface LlmCompletion {
  content: string;
  finishReason: string | null;
  truncated: boolean;
}

export interface LlmCompletionOptions {
  label?: string;
  signal?: AbortSignal;
}

type TokenLimitParam = "max_tokens" | "max_completion_tokens";

let preferredTokenLimitParam: TokenLimitParam = defaultTokenLimitParam();

function chatTimeoutMs(): number {
  const raw = process.env.SONAR_CHAT_TIMEOUT_MS;
  if (!raw || raw.trim() === "") return 300_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

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

function roughTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function defaultLabel(system: string): string {
  const firstLine = system.split(/\r?\n/, 1)[0]?.trim();
  return firstLine ? firstLine.slice(0, 90) : "LLM generation";
}

function shouldDisableLocalReasoning(): boolean {
  if (process.env.SONAR_DISABLE_MODEL_REASONING?.toLowerCase() === "false") return false;
  try {
    const hostname = new URL(CONFIG.chat.baseUrl).hostname;
    return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

export async function generateCompletion(
  system: string,
  user: string,
  options: LlmCompletionOptions = {},
): Promise<LlmCompletion> {
  const label = options.label ?? defaultLabel(system);
  const disableLocalReasoning = shouldDisableLocalReasoning();
  const started = Date.now();
  const promptChars = system.length + user.length;
  logger.info(
    `LLM start: ${label}; model=${CONFIG.chat.model}; promptChars=${promptChars}; promptTokens≈${roughTokens(
      `${system}\n${user}`,
    )}; maxResponseTokens=${CONFIG.generator.maxResponseTokens}; tokenParam=${preferredTokenLimitParam}; reasoningDisabled=${disableLocalReasoning}`,
  );
  try {
    const localReasoningOptions = disableLocalReasoning
      ? {
          chat_template_kwargs: {
            enable_thinking: false,
          },
        }
      : {};
    const request = {
      model: CONFIG.chat.model,
      messages: [
        { role: "system" as const, content: system },
        { role: "user" as const, content: user },
      ],
      temperature: CONFIG.generator.temperature,
      ...localReasoningOptions,
    };
    const completion = await client.chat.completions
      .create(
        {
          ...request,
          [preferredTokenLimitParam]: CONFIG.generator.maxResponseTokens,
        },
        { signal: options.signal },
      )
      .catch((err) => {
        const rejectedParam = unsupportedParameter(err);
        if (rejectedParam !== preferredTokenLimitParam) throw err;

        preferredTokenLimitParam = preferredTokenLimitParam === "max_tokens" ? "max_completion_tokens" : "max_tokens";
        logger.info(`Retrying LLM generation with ${preferredTokenLimitParam}`);
        return client.chat.completions.create(
          {
            ...request,
            [preferredTokenLimitParam]: CONFIG.generator.maxResponseTokens,
          },
          { signal: options.signal },
        );
      });

    const choice = completion.choices[0];
    const finishReason = choice.finish_reason ?? null;
    const content = choice.message.content ?? "";
    const messageWithReasoning = choice.message as unknown as { reasoning_content?: unknown };
    const reasoningContent =
      typeof messageWithReasoning.reasoning_content === "string" ? messageWithReasoning.reasoning_content : "";
    logger.info(
      `LLM done: ${label}; durationMs=${Date.now() - started}; finish=${finishReason ?? "unknown"}; contentChars=${
        content.length
      }; reasoningChars=${reasoningContent.length}; visibleEmpty=${content.trim() === ""}`,
    );
    return {
      content,
      finishReason,
      truncated: finishReason === "length",
    };
  } catch (err) {
    if (isOperationAborted(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`LLM failed: ${label}; durationMs=${Date.now() - started}; error=${message}`);
    throw new Error("LLM generation failed");
  }
}

export async function generateResponse(
  system: string,
  user: string,
  options: LlmCompletionOptions = {},
): Promise<string> {
  const completion = await generateCompletion(system, user, options);
  return completion.content;
}

export async function generateCompletionWithLengthRetry(
  system: string,
  user: string,
  retryInstruction: string,
  options: LlmCompletionOptions = {},
): Promise<LlmCompletion> {
  const completion = await generateCompletion(system, user, options);
  if (!completion.truncated && completion.content.trim() !== "") return completion;

  const retry = await generateCompletion(
    system,
    [user, "", "## Retry Constraint", retryInstruction, "Preserve valid source citations."].join("\n"),
    options,
  );
  return retry;
}
