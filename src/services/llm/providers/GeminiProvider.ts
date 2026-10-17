import axios from "axios";
import { config } from "../../../config";
import { LLMOutputError } from "../errors";
import { LLMProvider, Model, UsageStats } from "../types";

// environment variable: GEMINI_API_KEY

interface GeminiModel {
  name: string;
  description?: string;
  displayName?: string;
  supportedGenerationMethods: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

export class GeminiProvider implements LLMProvider {
  private readonly apiKey = process.env.GEMINI_API_KEY || "";

  /**
   * List available models from Gemini API
   * @param apiKey - API key (optional, uses environment variable if not provided)
   * @returns Array of available models
   */
  async listModels(apiKey?: string): Promise<Model[]> {
    const key = apiKey || this.apiKey;
    try {
      const response = await axios.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        {
          // Key in a header, not the URL, so it cannot leak via logged URLs.
          headers: { "x-goog-api-key": key },
          timeout: config.llmRequestTimeoutMs,
        },
      );
      const models = (response.data.models || []) as GeminiModel[];

      return models
        .filter((m) => m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => ({
          name: m.name.replace("models/", ""),
          description: m.description || m.displayName || m.name,
          type: "assistant",
          ctx_len: m.inputTokenLimit || 32768,
          n_ctx: m.inputTokenLimit || 32768,
          max_tokens: m.outputTokenLimit || 8192,
        }));
    } catch {
      throw new Error(
        "Gemini model discovery failed; verify the API key and provider availability",
      );
    }
  }

  /**
   * Generate content using Gemini API
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const payload: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: prompt.user }] }],
      generationConfig: { maxOutputTokens: config.llmMaxOutputTokens },
    };

    if (prompt.system) {
      payload.system_instruction = {
        parts: [{ text: prompt.system }],
      };
    }

    const response = await axios.post(url, payload, {
      headers: { "x-goog-api-key": key },
      timeout: config.llmRequestTimeoutMs,
    });
    const data = response.data as {
      promptFeedback?: { blockReason?: string };
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    if (data.promptFeedback?.blockReason)
      throw new LLMOutputError(
        "Gemini",
        `prompt blocked (${data.promptFeedback.blockReason})`,
      );
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS")
      throw new LLMOutputError("Gemini", "truncated at maxOutputTokens");
    if (
      candidate?.finishReason &&
      !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason)
    )
      throw new LLMOutputError(
        "Gemini",
        `generation stopped (${candidate.finishReason})`,
      );
    const text = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    if (!text.trim()) throw new LLMOutputError("Gemini", "empty response");
    return text;
  }

  /**
   * Gemini does not expose account usage through this API
   * @param _apiKey - API key (unused for Gemini)
   * @returns Usage stats (always unavailable for Gemini)
   */
  async getUsage(_apiKey?: string): Promise<UsageStats> {
    return {
      available: false,
      message: "Gemini does not expose account usage through this API",
    };
  }
}
