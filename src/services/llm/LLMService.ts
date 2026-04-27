import dotenv from 'dotenv';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { LLMProvider, UsageStats } from './types';

dotenv.config()

/**
 * Main LLM Service handling provider discovery and routing
 */
export class LLMService {
  private providers: Map<string, LLMProvider> = new Map()

  constructor() {
    // Register default providers
    this.providers.set('gemini', new GeminiProvider())
    this.providers.set('openai', new OpenAIProvider())
    this.providers.set('anthropic', new AnthropicProvider())
  }

  /**
   * List all available models for a specific provider
   */
  async listModels(providerKey: string, apiKey?: string): Promise<any[]> {
    const provider = this.providers.get(providerKey)
    if (!provider) {
      throw new Error(`Provider ${providerKey} not found`)
    }
    return provider.listModels(apiKey)
  }

  /**
   * Generate content using specified model
   */
  async generateContent(model: string, prompt: { system?: string; user: string }, apiKey?: string): Promise<string> {
    // In MVP, try to find provider matching model name
    const providerKeys = Array.from(this.providers.keys())
    const matchingKey = providerKeys.find(key => model.toLowerCase().includes(key))

    if (!matchingKey) {
      throw new Error(`No provider found for model: ${model}`)
    }

    const provider = this.providers.get(matchingKey)
    if (!provider) {
      throw new Error(`Provider ${matchingKey} not found`)
    }
    return provider.generateContent(model, prompt, apiKey)
  }

  /**
   * Test a provider key and discover available models/quotas
   */
  async discover(providerKey: string, apiKey: string): Promise<{ models: any[]; usage: UsageStats }> {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new Error(`Provider ${providerKey} not found`);
    }

    const [models, usage] = await Promise.all([
      provider.listModels(apiKey),
      provider.getUsage(apiKey)
    ]);

    return { models, usage };
  }

  /**
   * Get usage statistics for a provider
   */
  async getUsage(providerKey: string, apiKey?: string): Promise<UsageStats> {
    const provider = this.providers.get(providerKey)
    if (!provider) {
      throw new Error(`Provider ${providerKey} not found`)
    }
    return provider.getUsage(apiKey)
  }
}