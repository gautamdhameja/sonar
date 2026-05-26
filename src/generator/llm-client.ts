import OpenAI from "openai";
import { CONFIG } from "../config";
import { logger } from "../utils/logger";

const client = new OpenAI({
  baseURL: CONFIG.chat.baseUrl,
  apiKey: CONFIG.chat.apiKey,
});

export async function generateResponse(system: string, user: string): Promise<string> {
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

    return completion.choices[0].message.content ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("LLM generation failed:", message);
    return "Error generating response: " + message;
  }
}
