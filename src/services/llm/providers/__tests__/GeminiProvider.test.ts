import axios from 'axios';
import { GeminiProvider } from '../GeminiProvider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new GeminiProvider();
  });

  describe('listModels', () => {
    it('should fetch and format models from Gemini API', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          models: [
            {
              name: 'models/gemini-pro',
              description: 'Pro model',
              supportedGenerationMethods: ['generateContent'],
              inputTokenLimit: 30000,
              outputTokenLimit: 4000
            },
            {
              name: 'models/other',
              supportedGenerationMethods: ['otherMethod'],
            }
          ]
        }
      });

      const models = await provider.listModels('test-key');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('https://generativelanguage.googleapis.com/v1beta/models?key=test-key')
      );
      expect(models).toHaveLength(1);
      expect(models[0]).toEqual({
        name: 'gemini-pro',
        description: 'Pro model',
        type: 'assistant',
        ctx_len: 30000,
        n_ctx: 30000,
        max_tokens: 4000
      });
    });

    it('should return empty array on failure', async () => {
      mockedAxios.get.mockRejectedValue(new Error('API Down'));
      const models = await provider.listModels();
      expect(models).toEqual([]);
    });
  });

  describe('generateContent', () => {
    it('should send correct payload to Gemini API', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          candidates: [{ content: { parts: [{ text: 'Hello world' }] } }]
        }
      });

      const response = await provider.generateContent(
        'gemini-pro',
        { system: 'Be helpful', user: 'Hi' },
        'key'
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('gemini-pro:generateContent?key=key'),
        {
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          system_instruction: { parts: [{ text: 'Be helpful' }] }
        }
      );
      expect(response).toBe('Hello world');
    });
  });

  describe('getUsage', () => {
    it('should return mock usage stats', async () => {
      const usage = await provider.getUsage();
      expect(usage).toHaveProperty('rate_limit_remaining');
      expect(usage.context_window).toBe(8192);
    });
  });
});
