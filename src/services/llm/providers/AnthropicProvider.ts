import axios from "axios";
import { config } from "../../../config";
import { LLMOutputError } from "../errors";
import { LLMProvider, Model, UsageStats } from "../types";

interface AnthropicModel {
  id: string;
  display_name?: string;
}

export class AnthropicProvider implements LLMProvider {
  private readonly apiKey = process.env.ANTHROPIC_API_KEY || "";

  async listModels(apiKey?: string): Promise<Model[]> {
    const key = apiKey || this.apiKey;
    try {
      const response = await axios.get("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        timeout: config.llmRequestTimeoutMs,
      });

      return ((response.data.data || []) as AnthropicModel[]).map((model) => ({
        name: model.id,
        description: model.display_name || `Anthropic ${model.id}`,
        type: "assistant",
        ctx_len: 200000,
        n_ctx: 200000,
        max_tokens: 4096,
      }));
    } catch {
      throw new Error(
        "Anthropic model discovery failed; verify the API key and provider availability",
      );
    }
  }

  async generateContent(
    model: string,
    prompt: { system?: string; user: string },
    apiKey?: string,
  ): Promise<string> {
    const key = apiKey || this.apiKey;
    const url = "https://api.anthropic.com/v1/messages";
    const payload: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt.user }],
      max_tokens: config.llmMaxOutputTokens,
    };

    if (prompt.system) {
      payload.system = prompt.system;
    }

    const response = await axios.post(url, payload, {
      timeout: config.llmRequestTimeoutMs,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    });
    const data = response.data as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    if (data.stop_reason === "max_tokens")
      throw new LLMOutputError("Anthropic", "truncated at max_tokens");
    if (data.stop_reason === "refusal")
      throw new LLMOutputError("Anthropic", "request was refused");
    const text = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (!text.trim()) throw new LLMOutputError("Anthropic", "empty response");
    return text;
  }

  async getUsage(_apiKey?: string): Promise<UsageStats> {
    return {
      available: false,
      message: "Usage is not queried through inference requests",
    };
  }
}
