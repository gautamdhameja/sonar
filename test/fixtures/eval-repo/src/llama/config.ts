import { LlamaEnvSchema } from "./schema.js";

export function getLlamaConfig() {
  return {
    serverUrl: process.env.LLAMA_SERVER_URL,
    schema: LlamaEnvSchema,
  };
}
