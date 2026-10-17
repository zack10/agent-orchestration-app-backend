import axios from "axios";
import { config } from "../../../config";
import { LLMOutputError } from "../errors";
import { LLMProvider, Model, UsageStats } from "../types";

interface OpenAIModel {
  id: string;
}

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider implements LLMProvider {
  private readonly apiKey = process.env.OPENAI_API_KEY || "";
  private readonly baseUrl = (
    process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/$/, "");

  /**
   * List available models from OpenAI API
   * @param apiKey - API key (optional, uses environment variable if not provided)
   * @returns Array of available models
   */
  async listModels(apiKey?: string): Promise<Model[]> {
    const key = apiKey || this.apiKey;
    try {
      const response = await axios.get(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: config.llmRequestTimeoutMs,
      });

      const commonModels: Record<string, { ctx: number; max: number }> = {
        "gpt-4o": { ctx: 128000, max: 4096 },
        "gpt-4o-mini": { ctx: 128000, max: 16384 },
        "gpt-4-turbo": { ctx: 128000, max: 4096 },
        "o1-preview": { ctx: 128000, max: 32768 },
      };

      return (response.data.data as OpenAIModel[])
        .filter(
          (model) => model.id.startsWith("gpt-") || model.id.startsWith("o1-"),
        )
        .map((model) => {
          const meta = commonModels[model.id] || { ctx: 8192, max: 4096 };
          return {
            name: model.id,
            description: `OpenAI ${model.id} model`,
            type: "assistant",
            ctx_len: meta.ctx,
            n_ctx: meta.ctx,
            max_tokens: meta.max,
          };
        });
    } catch {
      throw new Error(
        "OpenAI-compatible model discovery failed; verify the API key, base URL, and provider availability",
      );
    }
  }

  /**
   * Generate content using OpenAI API
   * @param model - Model name
   * @param prompt - System and user prompt
   * @param apiKey - API key (optional, uses environment variable if not provided)
   * @returns Generated content
   */
  async generateContent(
    model: string,
    prompt: { system?: string; user: string },
    apiKey?: string,
  ): Promise<string> {
    const key = apiKey || this.apiKey;
    const url = `${this.baseUrl}/chat/completions`;
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (prompt.system) {
      messages.push({ role: "system", content: prompt.system });
    }
    messages.push({ role: "user", content: prompt.user });

    const response = await axios.post(
      url,
      {
        model,
        messages,
      },
      {
        headers: { Authorization: `Bearer ${key}` },
        timeout: config.llmRequestTimeoutMs,
      },
    );
    const choice = response.data.choices?.[0] as
      | { finish_reason?: string; message?: { content?: string | null } }
      | undefined;
    if (choice?.finish_reason === "length")
      throw new LLMOutputError("OpenAI", "truncated at the token limit");
    if (choice?.finish_reason === "content_filter")
      throw new LLMOutputError("OpenAI", "blocked by content filter");
    const text = choice?.message?.content ?? "";
    if (!text.trim()) throw new LLMOutputError("OpenAI", "empty response");
    return text;
  }

  /**
   * Get usage information (not applicable for OpenAI)
   * @param _apiKey - API key (unused for OpenAI)
   * @returns Usage stats (always unavailable for OpenAI)
   */
  async getUsage(_apiKey?: string): Promise<UsageStats> {
    return {
      available: false,
      message: "Usage is not queried through inference requests",
    };
  }
}
