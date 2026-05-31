import type { DesktopModelConfig } from "../types";

export const defaultQuestion = "What should I understand first, and what should I ask engineering this week?";
export const demoRepository = "https://github.com/excalidraw/excalidraw";

export const dockerModelRunnerConfig: DesktopModelConfig = {
  chatBaseUrl: "http://localhost:12434/engines/llama.cpp/v1",
  chatModel: "hf.co/unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL",
  chatApiKey: "not-needed",
  embeddingBaseUrl: "http://localhost:12434/engines/v1",
  embeddingModel: "hf.co/nomic-ai/nomic-embed-text-v1.5-GGUF:Q4_K_M",
  embeddingApiKey: "not-needed",
  apiToken: "",
};

export const suggestedQuestions = [
  "What should I read first?",
  "Where does the main workflow start?",
  "What is risky or unclear?",
  "What should I ask engineering?",
];
