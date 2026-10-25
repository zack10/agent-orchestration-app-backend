import dotenv from "dotenv";
import { config } from "../../config";
import { NonRetryableError } from "../../utils/safeError";
import { ProviderRegistry, getProviderRegistry } from "./registry";
import { withLLMRetry } from "./retry";
import { LLMProvider, Model, ToolRequest, ToolTurn, UsageStats } from "./types";

dotenv.config();

/**
 * Main LLM Service handling provider discovery and routing
 */
export class LLMService {
  // Resolved on first use, so importing this module never reads provider config.
  constructor(private readonly customRegistry?: ProviderRegistry) {}

  private get registry(): ProviderRegistry {
    return this.customRegistry ?? getProviderRegistry();
  }

  private provider(providerKey: string): LLMProvider {
    return this.registry.get(providerKey);
  }

  /**
   * The provider and model an agent runs on. An agent without a provider uses
   * the configured default; one with a provider but no model is a setup
   * error, since the default model belongs to the default provider.
   */
  resolveModel(agent: {
    provider?: string | null;
    model?: string | null;
  }): { provider: string; model: string } {
    const provider = agent.provider || this.registry.defaultProvider;
    if (!this.registry.has(provider))
      throw new NonRetryableError(`Agent provider "${provider}" is not configured`);
    if (agent.model) return { provider, model: agent.model };
    if (provider === this.registry.defaultProvider)
      return { provider, model: this.registry.defaultModel };
    throw new NonRetryableError(`Agent uses provider "${provider}" but has no model set`);
  }

  /**
   * List all available models for a specific provider
   */
  async listModels(providerKey: string, apiKey?: string): Promise<Model[]> {
    return this.provider(providerKey).listModels(apiKey);
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
    const provider = this.provider(providerKey);
    return withLLMRetry(
      () => provider.generateContent(model, prompt, apiKey),
      { retries: config.llmRateLimitRetries },
    );
  }

  /**
   * One model turn with tools available. The caller runs any returned tool
   * calls, appends `turn.message` and the results, and calls again until
   * `stopReason` is "end_turn".
   */
  async generateWithTools(
    providerKey: string,
    model: string,
    request: ToolRequest,
    apiKey?: string,
  ): Promise<ToolTurn> {
    const provider = this.provider(providerKey);
    // Fail before spending a request: a text-only endpoint would ignore the tools.
    if (!this.registry.supportsTools(providerKey))
      throw new NonRetryableError(
        `Provider "${providerKey}" does not support tool calling (set "supportsTools": true in its LLM_PROVIDERS profile if it does)`,
      );
    return withLLMRetry(
      () => provider.generateWithTools(model, request, apiKey),
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
    const provider = this.provider(providerKey);
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
    return this.provider(providerKey).getUsage(apiKey);
  }
}
