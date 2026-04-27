import { LLMProvider, Model, UsageStats } from '../types';
import axios from 'axios';

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider implements LLMProvider {
  private apiKey = process.env.OPENAI_API_KEY || '';

  constructor() {
    /** Fetch model list from OpenAI API */
  }

  async listModels(apiKey?: string): Promise<Model[]> {
    const key = apiKey || this.apiKey;
    try {
      const response = await axios.get('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      
      const commonModels: Record<string, any> = {
        'gpt-4o': { ctx: 128000, max: 4096 },
        'gpt-4o-mini': { ctx: 128000, max: 16384 },
        'gpt-4-turbo': { ctx: 128000, max: 4096 },
        'o1-preview': { ctx: 128000, max: 32768 },
      };

      return response.data.data
        .filter((m: any) => m.id.startsWith('gpt-') || m.id.startsWith('o1-'))
        .map((model: any) => {
          const meta = commonModels[model.id] || { ctx: 8192, max: 4096 };
          return {
            name: model.id,
            description: `OpenAI ${model.id} model`,
            type: 'assistant',
            ctx_len: meta.ctx,
            n_ctx: meta.ctx,
            max_tokens: meta.max,
          };
        });
    } catch (error) {
      console.error('OpenAI listModels failed:', error);
      return [];
    }
  }

  async generateContent(model: string, prompt: { system?: string; user: string }, apiKey?: string): Promise<string> {
    const key = apiKey || this.apiKey;
    const url = 'https://api.openai.com/v1/chat/completions';
    const messages: any[] = [];
    if (prompt.system) {
      messages.push({ role: 'system', content: prompt.system });
    }
    messages.push({ role: 'user', content: prompt.user });

    const response = await axios.post(
      url,
      {
        model,
        messages,
      },
      { headers: { Authorization: `Bearer ${key}` } },
    );
    return response.data.choices?.[0]?.message?.content ?? '';
  }

  async getUsage(apiKey?: string): Promise<UsageStats> {
    const key = apiKey || this.apiKey;
    try {
      // Perform a minimal 'ping' request to get rate limit headers
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        },
        { headers: { Authorization: `Bearer ${key}` } }
      );

      const headers = response.headers;
      return {
        tokens_in: 0,
        tokens_out: 0,
        total_cost: 0,
        rate_limit_remaining: parseInt(headers['x-ratelimit-remaining-requests'] || '0'),
        rate_limit_max: parseInt(headers['x-ratelimit-limit-requests'] || '0'),
        rate_limit_reset: Date.now() + 1000, // Minimal mock reset
        context_window: 128000
      };
    } catch (error) {
      console.error('OpenAI getUsage failed:', error);
      throw error;
    }
  }
}