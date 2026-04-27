import { Request, Response } from 'express';
import { LLMService } from '../services/llm/LLMService';

const router = require('express').Router();
const llmService = new LLMService();

// GET /api/llm/providers
router.get('/providers', (req: Request, res: Response) => {
  const providers = ['gemini', 'openai', 'anthropic'];
  res.json({ providers });
});

// POST /api/llm/discover
router.post('/discover', async (req: Request, res: Response) => {
  const { provider, apiKey } = req.body;
  
  if (!provider || !apiKey) {
    return res.status(400).json({ error: 'Missing provider or apiKey in request body' });
  }

  try {
    const result = await llmService.discover(provider, apiKey);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/llm/models
router.get('/models', async (req: Request, res: Response) => {
  const providerQuery = req.query.provider;
  let provider: string | undefined;

  if (Array.isArray(providerQuery)) {
    provider = String(providerQuery[0]);
  } else if (typeof providerQuery === 'string') {
    provider = providerQuery;
  }

  if (!provider) {
    return res.status(400).json({ error: 'Missing provider parameter' });
  }

  const apiKey = req.query.apiKey as string | undefined;

  try {
    const models = await llmService.listModels(provider, apiKey);
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/llm/usage
router.get('/usage', async (req: Request, res: Response) => {
  const providerQuery = req.query.provider;
  let provider: string | undefined;

  if (Array.isArray(providerQuery)) {
    provider = String(providerQuery[0]);
  } else if (typeof providerQuery === 'string') {
    provider = providerQuery;
  }

  if (!provider) {
    return res.status(400).json({ error: 'Missing provider parameter' });
  }

  const apiKey = req.query.apiKey as string | undefined;

  try {
    const usage = await llmService.getUsage(provider, apiKey);
    res.json({ usage });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
export default router;
