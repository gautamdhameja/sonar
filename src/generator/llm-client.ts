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

export async function generateCompletion(system: string, user: string): Promise<LlmCompletion> {
  try {
    const completion = await client.chat.completions.create({
      model: CONFIG.chat.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: CONFIG.generator.temperature,
      max_tokens: CONFIG.generator.maxResponseTokens,
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
