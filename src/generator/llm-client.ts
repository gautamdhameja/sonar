import OpenAI from "openai";
import { CONFIG } from "../config";
import { isOperationAborted } from "../utils/abort";
import { logger } from "../utils/logger";
import { LlmGenerationError } from "./errors";

const client = new OpenAI({
  baseURL: CONFIG.chat.baseUrl,
  apiKey: CONFIG.chat.apiKey,
  timeout: CONFIG.chat.timeoutMs,
  maxRetries: 0,
});

export interface LlmCompletion {
  content: string;
  finishReason: string | null;
  truncated: boolean;
}

export interface LlmCompletionOptions {
  label?: string;
  signal?: AbortSignal;
  maxResponseTokens?: number;
  temperature?: number;
  responseFormat?: Record<string, unknown>;
  grammar?: string;
}

type TokenLimitParam = "max_tokens" | "max_completion_tokens";
type ChatCompletionResult = {
  choices: Array<{
    finish_reason?: string | null;
    message: {
      content?: string | null;
      reasoning_content?: unknown;
    };
  }>;
};
type ChatCompletionCreate = (
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<ChatCompletionResult>;

let preferredTokenLimitParam: TokenLimitParam = defaultTokenLimitParam();
let loggedConstrainedFallback = false;

let createChatCompletion: ChatCompletionCreate = async (body, options) =>
  (await client.chat.completions.create(body as never, options)) as ChatCompletionResult;

export function __setChatCompletionCreateForTest(create: ChatCompletionCreate): () => void {
  const previous = createChatCompletion;
  createChatCompletion = create;
  return () => {
    createChatCompletion = previous;
  };
}

export function __resetPreferredTokenLimitParamForTest(): void {
  preferredTokenLimitParam = defaultTokenLimitParam();
  loggedConstrainedFallback = false;
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

function constrainedOutputRejected(err: unknown): boolean {
  const rejectedParam = unsupportedParameter(err);
  if (rejectedParam && ["grammar", "response_format", "json_schema"].includes(rejectedParam)) return true;

  const status = errorStatus(err);
  const message = err instanceof Error ? err.message : String(err);
  return (
    status === 400 &&
    /(grammar|response[_ -]?format|json[_ -]?schema|unsupported|unknown|unrecognized|invalid request)/i.test(message)
  );
}

function stripConstrainedOutputFields(request: Record<string, unknown>): Record<string, unknown> {
  const { grammar: _grammar, response_format: _responseFormat, json_schema: _jsonSchema, ...rest } = request;
  return rest;
}

function hasConstrainedOutputFields(request: Record<string, unknown>): boolean {
  return request.grammar !== undefined || request.response_format !== undefined || request.json_schema !== undefined;
}

function roughTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function defaultLabel(system: string): string {
  const firstLine = system.split(/\r?\n/, 1)[0]?.trim();
  return firstLine ? firstLine.slice(0, 90) : "LLM generation";
}

function shouldDisableLocalReasoning(): boolean {
  if (CONFIG.chat.disableModelReasoning !== null) return CONFIG.chat.disableModelReasoning;
  try {
    const hostname = new URL(CONFIG.chat.baseUrl).hostname;
    return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

function errorStatus(err: unknown): number | null {
  const status = (err as { status?: unknown })?.status;
  return typeof status === "number" ? status : null;
}

export function classifyLlmError(err: unknown): LlmGenerationError {
  const message = err instanceof Error ? err.message : String(err);
  const status = errorStatus(err);
  if (status === 408 || status === 504 || /timeout|timed out/i.test(message)) {
    return new LlmGenerationError(
      "timeout",
      "Model request timed out. Check that the model server is running and responsive, or choose a smaller or faster model.",
      message,
    );
  }
  if (/ECONNREFUSED|ECONNRESET|fetch failed|connection refused|connect/i.test(message)) {
    return new LlmGenerationError(
      "unreachable",
      "Model endpoint is unreachable. Start the local model server or update the OpenAI-compatible endpoint in settings.",
      message,
    );
  }
  if (status === 401 || status === 403) {
    return new LlmGenerationError(
      "rejected",
      "Model endpoint rejected the request. Check the API key and OpenAI-compatible endpoint settings.",
      message,
    );
  }
  if (status === 429) {
    return new LlmGenerationError(
      "rate_limited",
      "Model provider rate-limited the request. Wait briefly or use a local endpoint with available capacity.",
      message,
    );
  }
  return new LlmGenerationError(
    "provider",
    "Model provider request failed. Check the configured model endpoint and try again.",
    message,
  );
}

async function createChatCompletionWithTokenParamFallback(
  request: Record<string, unknown>,
  signal?: AbortSignal,
  maxResponseTokens = CONFIG.generator.maxResponseTokens,
): Promise<ChatCompletionResult> {
  try {
    return await createChatCompletion(
      {
        ...request,
        [preferredTokenLimitParam]: maxResponseTokens,
      },
      { signal },
    );
  } catch (err) {
    const rejectedParam = unsupportedParameter(err);
    if (rejectedParam === preferredTokenLimitParam) {
      preferredTokenLimitParam = preferredTokenLimitParam === "max_tokens" ? "max_completion_tokens" : "max_tokens";
      logger.info(`Retrying LLM generation with ${preferredTokenLimitParam}`);
      return createChatCompletion(
        {
          ...request,
          [preferredTokenLimitParam]: maxResponseTokens,
        },
        { signal },
      );
    }

    if (hasConstrainedOutputFields(request) && constrainedOutputRejected(err)) {
      if (!loggedConstrainedFallback) {
        logger.info("Retrying LLM generation without constrained output fields after model endpoint rejection");
        loggedConstrainedFallback = true;
      }
      return createChatCompletionWithTokenParamFallback(
        stripConstrainedOutputFields(request),
        signal,
        maxResponseTokens,
      );
    }

    throw err;
  }
}

function shouldRetryLlmRequest(err: unknown, attempt: number): boolean {
  if (attempt >= CONFIG.chat.maxRetries) return false;
  return classifyLlmError(err).code === "unreachable";
}

async function createChatCompletionWithRetries(
  request: Record<string, unknown>,
  label: string,
  signal?: AbortSignal,
  maxResponseTokens?: number,
): Promise<ChatCompletionResult> {
  let attempt = 0;
  while (true) {
    try {
      return await createChatCompletionWithTokenParamFallback(request, signal, maxResponseTokens);
    } catch (err) {
      if (isOperationAborted(err) || !shouldRetryLlmRequest(err, attempt)) throw err;
      attempt += 1;
      logger.info(`Retrying LLM generation after transient model connection failure: ${label}; attempt=${attempt}`);
    }
  }
}

export async function generateCompletion(
  system: string,
  user: string,
  options: LlmCompletionOptions = {},
): Promise<LlmCompletion> {
  const label = options.label ?? defaultLabel(system);
  const disableLocalReasoning = shouldDisableLocalReasoning();
  const maxResponseTokens = options.maxResponseTokens ?? CONFIG.generator.maxResponseTokens;
  const temperature = options.temperature ?? CONFIG.generator.temperature;
  const started = Date.now();
  const promptChars = system.length + user.length;
  logger.info(
    `LLM start: ${label}; model=${CONFIG.chat.model}; promptChars=${promptChars}; promptTokens≈${roughTokens(
      `${system}\n${user}`,
    )}; maxResponseTokens=${maxResponseTokens}; tokenParam=${preferredTokenLimitParam}; reasoningDisabled=${disableLocalReasoning}`,
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
      temperature,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      ...(options.grammar ? { grammar: options.grammar } : {}),
      ...localReasoningOptions,
    };
    const completion = await createChatCompletionWithRetries(request, label, options.signal, maxResponseTokens);

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
    const modelError = classifyLlmError(err);
    logger.error(
      `LLM failed: ${label}; durationMs=${Date.now() - started}; code=${modelError.code}; error=${modelError.detail}`,
    );
    throw modelError;
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
