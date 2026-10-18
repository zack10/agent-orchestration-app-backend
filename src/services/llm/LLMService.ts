import dotenv from "dotenv";
import { config } from "../../config";
import { AnthropicProvider } from "./providers/AnthropicProvider";
import { GeminiProvider } from "./providers/GeminiProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";
import { withLLMRetry } from "./retry";
import { LLMProvider, Model, UsageStats } from "./types";

export type ProviderKey = "gemini" | "openai" | "anthropic";

dotenv.config();

/**
 * Main LLM Service handling provider discovery and routing
 */
export class LLMService {
  private readonly providers: Map<string, LLMProvider> = new Map();

  constructor() {
    // Register default providers
    this.providers.set("gemini", new GeminiProvider());
    this.providers.set("openai", new OpenAIProvider());
    this.providers.set("anthropic", new AnthropicProvider());
  }

  /**
   * List all available models for a specific provider
   */
  async listModels(providerKey: string, apiKey?: string): Promise<Model[]> {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new Error(`Provider ${providerKey} not found`);
    }
    return provider.listModels(apiKey);
  }

  /**
   * Generate content using specified model
   */
  async generateContent(
    providerKey: string,
    model: string,
    prompt: { system?: string; user: string },
    apiKey?: string,
  ): Promise<string> {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new Error(`Provider ${providerKey} not found`);
    }
    return withLLMRetry(
      () => provider.generateContent(model, prompt, apiKey),
      { retries: config.llmRateLimitRetries },
    );
  }

  /**
   * Test a provider key and discover available models/quotas
   */
  async discover(
    providerKey: string,
    apiKey: string,
  ): Promise<{ models: Model[]; usage: UsageStats }> {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new Error(`Provider ${providerKey} not found`);
    }

    const [models, usage] = await Promise.all([
      provider.listModels(apiKey),
      provider.getUsage(apiKey),
    ]);

    return { models, usage };
  }

  /**
   * Get usage statistics for a provider
   */
  async getUsage(providerKey: string, apiKey?: string): Promise<UsageStats> {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new Error(`Provider ${providerKey} not found`);
    }
    return provider.getUsage(apiKey);
  }
}
