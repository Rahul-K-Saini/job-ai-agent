import { config } from "./config.js";

export const providerConfig = {
  gemini: {
    // Each model is its own free-tier bucket. Order = priority. Set() removes duplicates.
    models: [...new Set([
      config.model,              // your main model
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.7-flash",
      "gemini-3.8-flash",
      "gemma-4-31b-it",          // last: may not support JSON mode, and is skipped automatically if it doesn't
    ])],
  },
  groq: {
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
  },
  cerebras: { models: ["gpt-oss-120b"] },   // ignored unless CEREBRAS_API_KEYS is set
  mistral: { models: ["mistral-small-latest"] },
  openrouter: { models: [] },
};