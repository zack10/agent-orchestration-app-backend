import { LLMService } from '../LLMService';
import { GeminiProvider } from '../providers/GeminiProvider';
import { OpenAIProvider } from '../providers/OpenAIProvider';
import { AnthropicProvider } from '../providers/AnthropicProvider';

jest.mock('../providers/GeminiProvider');
jest.mock('../providers/OpenAIProvider');
jest.mock('../providers/AnthropicProvider');

describe('LLMService', () => {
  let llmService: LLMService;

  beforeEach(() => {
    jest.clearAllMocks();
    llmService = new LLMService();
  });

  describe('listModels', () => {
    it('should call listModels on the correct provider', async () => {
      const mockModels = [{ name: 'gemini-1' }];
      (GeminiProvider.prototype.listModels as jest.Mock).mockResolvedValue(mockModels);

      const result = await llmService.listModels('gemini', 'test-key');

      expect(GeminiProvider.prototype.listModels).toHaveBeenCalledWith('test-key');
      expect(result).toEqual(mockModels);
    });

    it('should throw error for unknown provider', async () => {
      await expect(llmService.listModels('unknown')).rejects.toThrow('Provider unknown not found');
    });
  });

  describe('generateContent', () => {
    it('should route to correct provider based on model name', async () => {
      (OpenAIProvider.prototype.generateContent as jest.Mock).mockResolvedValue('GPT response');

      const result = await llmService.generateContent('gpt-4o-openai', { user: 'hi' }, 'key');

      expect(OpenAIProvider.prototype.generateContent).toHaveBeenCalledWith(
        'gpt-4o-openai',
        { user: 'hi' },
        'key'
      );
      expect(result).toBe('GPT response');
    });

    it('should throw error if no provider matches model name', async () => {
      await expect(llmService.generateContent('mystery-model', { user: 'hi' })).rejects.toThrow('No provider found for model: mystery-model');
    });
  });

  describe('discover', () => {
    it('should return models and usage for a provider', async () => {
      const mockModels = [{ name: 'anthropic-1' }];
      const mockUsage = { tokens_in: 100 };
      (AnthropicProvider.prototype.listModels as jest.Mock).mockResolvedValue(mockModels);
      (AnthropicProvider.prototype.getUsage as jest.Mock).mockResolvedValue(mockUsage);

      const result = await llmService.discover('anthropic', 'key');

      expect(result).toEqual({ models: mockModels, usage: mockUsage });
    });
  });
});
