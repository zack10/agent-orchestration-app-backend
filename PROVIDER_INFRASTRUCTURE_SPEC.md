# 🔌 Technical Specification: Multi-Provider Infrastructure & Discovery (Phase 1.8)

This document details the architecture and implementation plan for the **Provider Discovery Engine**. The goal is to move the orchestration backend from a Gemini-only system to a provider-agnostic engine that can automatically detect capabilities based on any provided API key.

---

## 🏗️ 1. Architecture: The Provider Abstraction Layer

We will introduce a `ProviderService` that acts as a factory for different LLM engines. This ensures that the `agentRunner` doesn't need to know which provider it is talking to.

### 1.1 The `ILLMProvider` Interface
Every provider (Gemini, OpenAI, Anthropic) must implement this interface:

```typescript
interface LLMModelInfo {
  id: string;
  name: string;
  maxTokens?: number;
  capabilities: {
    vision: boolean;
    tools: boolean;
    systemInstructions: boolean;
  };
}

interface QuotaStatus {
  limit: number;
  remaining: number;
  resetAt: Date;
  isUsageExceeded: boolean;
}

interface ILLMProvider {
  listModels(apiKey: string): Promise<LLMModelInfo[]>;
  getQuota(apiKey: string): Promise<QuotaStatus>;
  generateResponse(apiKey: string, prompt: any, modelId: string): Promise<string>;
}
```

---

## 🔍 2. Discovery Logic (Per Provider)

### 2.1 Google Gemini
- **Endpoint**: `GET https://generativelanguage.googleapis.com/v1beta/models?key={API_KEY}`
- **Discovery**: Returns a JSON list of models with supported growth methods.
- **Quota**: Extract from `X-Goog-Quota-*` response headers.

### 2.2 OpenAI
- **Endpoint**: `GET https://api.openai.com/v1/models`
- **Discovery**: Returns all models the key has access to (e.g., GPT-4o, GPT-3.5-Turbo).
- **Quota**: Since OpenAI doesn't have a "get usage" endpoint for all keys, we will perform a **"Dry Run/Ping"**:
  - Send a chat completion request with `max_tokens: 1`.
  - Parse the `x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens` headers.

### 2.3 Anthropic (Claude)
- **Endpoint**: `GET https://api.anthropic.com/v1/models`
- **Discovery**: List available Claude models (Opus, Sonnet, Haiku).
- **Quota**: Perform a "Ping" request with 1 token to `v1/messages`.
  - Parse `anthropic-ratelimit-requests-remaining` and `anthropic-ratelimit-tokens-remaining`.

---

## 📡 3. New API Endpoints

### `POST /api/providers/discover`
Allows the frontend/user to test a key before saving it to an agent.

**Request Body**:
```json
{
  "provider": "openai",
  "apiKey": "sk-..."
}
```

**Response**:
```json
{
  "status": "success",
  "models": [ ... ],
  "quota": {
    "requestsRemaining": 450,
    "tokensRemaining": 150000,
    "tier": "Tier 1"
  }
}
```

---

## 🛠️ 4. Integration with Agents

The `Agent` model in the database will be updated to include two new fields:
1. `provider`: (Enum: `GEMINI`, `OPENAI`, `ANTHROPIC`)
2. `modelId`: (String, e.g., `gpt-4o`)

**The Execution Flow**:
1. `agentRunner` fetches the Agent.
2. It calls `ProviderService.getProvider(agent.provider)`.
3. It passes the `agent.modelId` and environment-stored `API_KEY` to the provider instance.

---

## ⚠️ 5. Challenges & Solutions

### 5.1 System Instruction Incompatibility
- **Problem**: Gemini 1.0 and some OpenAI models handle "System Prompts" differently.
- **Solution**: The `ILLMProvider` implementation will automatically translate the `system` parameter. For OpenAI/Claude, it will be injected as the first message role (`system` or `developer`).

### 5.2 Encryption of Keys
- **Problem**: Storing API keys in the DB is dangerous.
- **Solution**: We will initially only support keys stored in the `.env` file. If multi-user support is needed, we will implement AES-256 encryption at the Prisma middleware level for any `apiKey` fields.

---

## ✅ Phase 1.8 Success Criteria
1. User provides a key -> System shows exactly which models are usable.
2. User selects `gpt-4o` for an agent -> Agent successfully writes code to `generated-code/`.
3. Request fails due to quota -> System returns a specialized "Quota Exceeded" error instead of a generic 500.
