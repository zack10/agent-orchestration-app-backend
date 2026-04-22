import { Request, Response } from 'express';
import { LLMService } from '../services/llm/LLMService';

const router = require('express').Router();
const llmService = new LLMService();

// GET /api/llm/providers
router.get('/providers', (req: Request, res: Response) => {
  const providers = ['gemini', 'openai'];
  res.json({ providers });
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
  try {
    const models = await llmService.listModels(provider);
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
  try {
    const usage = await llmService.getUsage(provider);
    res.json({ usage });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
export default router;
