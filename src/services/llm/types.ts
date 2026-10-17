export interface LLMProvider {
  listModels(apiKey?: string): Promise<Model[]>;
  generateContent(
    model: string,
    prompt: { system?: string; user: string },
    apiKey?: string,
  ): Promise<string>;
  getUsage(apiKey?: string): Promise<UsageStats>;
}

export interface Model {
  name: string;
  description: string;
  type: "system" | "user" | "assistant";
  ctx_len: number;
  n_ctx: number;
  max_tokens: number;
  prices?: {
    input_price: number;
    output_price: number;
  };
}

export interface UsageStats {
  available: boolean;
  message: string;
}
