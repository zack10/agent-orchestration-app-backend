import axios from "axios";
import { config } from "../../../config";
import { LLMOutputError } from "../errors";
import { LLMProvider, Model, UsageStats } from "../types";

interface OpenAIModel {
  id: string;
}

/** One configured OpenAI-compatible endpoint (OpenAI, Groq, Mistral, Ollama, ...). */
export interface OpenAICompatibleProfile {
  key: string;
  label: string;
  /** Validated by the registry; never taken from API input. */
  baseUrl: string;
  /** Server-side key; an agent's own key takes precedence. */
  apiKey: string;
  supportsTools: boolean;
  modelPrefixes?: string[];
}

// Context and output limits for well-known models; others get conservative defaults.
const KNOWN_MODELS: Record<string, { ctx: number; max: number }> = {
  "gpt-4o": { ctx: 128000, max: 4096 },
  "gpt-4o-mini": { ctx: 128000, max: 16384 },
  "gpt-4-turbo": { ctx: 128000, max: 4096 },
  "o1-preview": { ctx: 128000, max: 32768 },
};

/**
 * Provider for any API that speaks OpenAI's /models and /chat/completions
 * format. One instance per configured profile, so several vendors can be
 * used side by side without new code.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  constructor(private readonly profile: OpenAICompatibleProfile) {}

  private headers(apiKey?: string): Record<string, string> {
    const key = apiKey || this.profile.apiKey;
    // Keyless local servers (e.g. Ollama) get no Authorization header.
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  /**
   * List the models the endpoint offers
   * @param apiKey - API key (optional, uses the profile's key if not provided)
   * @returns Array of available models
   */
  async listModels(apiKey?: string): Promise<Model[]> {
    const { label, modelPrefixes } = this.profile;
    try {
      const response = await axios.get(`${this.profile.baseUrl}/models`, {
        headers: this.headers(apiKey),
        timeout: config.llmRequestTimeoutMs,
      });

      return (response.data.data as OpenAIModel[])
        .filter(
          (model) => !modelPrefixes || modelPrefixes.some((prefix) => model.id.startsWith(prefix)),
        )
        .map((model) => {
          const meta = KNOWN_MODELS[model.id] || { ctx: 8192, max: 4096 };
          return {
            name: model.id,
            description: `${label} ${model.id} model`,
            type: "assistant",
            ctx_len: meta.ctx,
            n_ctx: meta.ctx,
            max_tokens: meta.max,
          };
        });
    } catch {
      throw new Error(
        `${label} model discovery failed; verify the API key, base URL, and provider availability`,
      );
    }
  }

  /**
   * Generate content through the chat completions endpoint
   * @param model - Model name
   * @param prompt - System and user prompt
   * @param apiKey - API key (optional, uses the profile's key if not provided)
   * @returns Generated content
   */
  async generateContent(
    model: string,
    prompt: { system?: string; user: string },
    apiKey?: string,
  ): Promise<string> {
    const { label } = this.profile;
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (prompt.system) {
      messages.push({ role: "system", content: prompt.system });
    }
    messages.push({ role: "user", content: prompt.user });

    const response = await axios.post(
      `${this.profile.baseUrl}/chat/completions`,
      {
        model,
        messages,
      },
      {
        headers: this.headers(apiKey),
        timeout: config.llmRequestTimeoutMs,
      },
    );
    const choice = response.data.choices?.[0] as
      | { finish_reason?: string; message?: { content?: string | null } }
      | undefined;
    if (choice?.finish_reason === "length")
      throw new LLMOutputError(label, "truncated at the token limit");
    if (choice?.finish_reason === "content_filter")
      throw new LLMOutputError(label, "blocked by content filter");
    const text = choice?.message?.content ?? "";
    if (!text.trim()) throw new LLMOutputError(label, "empty response");
    return text;
  }

  /**
   * Get usage information (not exposed by OpenAI-compatible APIs)
   * @param _apiKey - API key (unused)
   * @returns Usage stats (always unavailable)
   */
  async getUsage(_apiKey?: string): Promise<UsageStats> {
    return {
      available: false,
      message: "Usage is not queried through inference requests",
    };
  }
}
