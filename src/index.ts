import cors from 'cors';
import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import prisma from './db';
import { errorHandler } from './middleware/errorHandler';
import agentRoutes from './routes/agentRoutes';
import projectRoutes from './routes/projectRoutes';
import skillRoutes from './routes/skillRoutes';
import taskRoutes from './routes/taskRoutes';
import llmRoutes from './routes/llmRoutes';
import rabbitMQService from './services/rabbitMQService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {};

  try {
    await (prisma as any).$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  checks.rabbitmq = rabbitMQService.isConnected() ? 'ok' : 'error';

  const healthy = Object.values(checks).every(v => v === 'ok');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'healthy' : 'degraded', checks });
});

app.use('/api/agents', agentRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/llm', llmRoutes);

app.get('/', (_req: Request, res: Response) => {
  res.send('Agent Orchestration API is running');
});

app.use(errorHandler);

async function start() {
  try {
    await rabbitMQService.connect();
  } catch (err) {
    console.warn('RabbitMQ not available at startup — will retry on first use');
  }

  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    server.close();
    await rabbitMQService.close();
    await (prisma as any).$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start();
