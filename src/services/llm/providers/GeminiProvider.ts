import { LLMProvider, Model, UsageStats } from '../types';
import axios from 'axios';

// environment variable: GEMINI_API_KEY

export class GeminiProvider implements LLMProvider {
  private apiKey = process.env.GEMINI_API_KEY || '';

  async listModels(apiKey?: string): Promise<Model[]> {
    const key = apiKey || this.apiKey;
    try {
      const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const models = response.data.models || [];

      return models
        .filter((m: any) => m.supportedGenerationMethods.includes('generateContent'))
        .map((m: any) => ({
          name: m.name.replace('models/', ''),
          description: m.description || m.displayName,
          type: 'assistant',
          ctx_len: m.inputTokenLimit || 32768,
          n_ctx: m.inputTokenLimit || 32768,
          max_tokens: m.outputTokenLimit || 8192
        }));
    } catch (error) {
      console.error('Gemini listModels failed:', error);
      return [];
    }
  }

  async generateContent(model: string, prompt: { system?: string; user: string }, apiKey?: string): Promise<string> {
    const key = apiKey || this.apiKey;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const payload: any = {
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }]
    };

    if (prompt.system) {
      payload.system_instruction = {
        parts: [{ text: prompt.system }]
      };
    }

    const response = await axios.post(url, payload);
    // Simplified extraction
    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  async getUsage(apiKey?: string): Promise<UsageStats> {
    // Gemini usage API not publicly available; mock values
    return {
      tokens_in: 0,
      tokens_out: 0,
      total_cost: 0,
      rate_limit_remaining: 1000,
      rate_limit_max: 1000,
      rate_limit_reset: Date.now() + 60 * 60 * 1000,
      context_window: 8192,
    };
  }
}
