import { LLMProvider, Model, UsageStats } from '../types';
import axios from 'axios';

export class AnthropicProvider implements LLMProvider {
  private apiKey = process.env.ANTHROPIC_API_KEY || '';

  async listModels(apiKey?: string): Promise<Model[]> {
    const key = apiKey || this.apiKey;
    try {
      const response = await axios.get('https://api.anthropic.com/v1/models', {
        headers: { 
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
      });
      
      return response.data.map((model: any) => ({
        name: model.id,
        description: model.display_name || `Anthropic ${model.id}`,
        type: 'assistant',
        ctx_len: 200000,
        n_ctx: 200000,
        max_tokens: 4096,
      }));
    } catch (error) {
      console.error('Anthropic listModels failed:', error);
      return [];
    }
  }

  async generateContent(model: string, prompt: { system?: string; user: string }, apiKey?: string): Promise<string> {
    const key = apiKey || this.apiKey;
    const url = 'https://api.anthropic.com/v1/messages';
    const payload: any = {
      model,
      messages: [{ role: 'user', content: prompt.user }],
      max_tokens: 1024
    };
    
    if (prompt.system) {
      payload.system = prompt.system;
    }

    const response = await axios.post(url, payload, { 
      headers: { 
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      } 
    });
    return response.data.content?.[0]?.text ?? '';
  }

  async getUsage(apiKey?: string): Promise<UsageStats> {
    const key = apiKey || this.apiKey;
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        },
        { 
          headers: { 
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          } 
        }
      );

      const headers = response.headers;
      return {
        tokens_in: 0,
        tokens_out: 0,
        total_cost: 0,
        rate_limit_remaining: parseInt(headers['anthropic-ratelimit-requests-remaining'] || '0'),
        rate_limit_max: parseInt(headers['anthropic-ratelimit-requests-limit'] || '0'),
        rate_limit_reset: Date.now() + 1000,
        context_window: 200000
      };
    } catch (error) {
      console.error('Anthropic getUsage failed:', error);
      throw error;
    }
  }
}