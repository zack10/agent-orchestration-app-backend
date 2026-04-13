import { Request, Response } from 'express';
import prisma from '../db';
import { AppError } from '../errors/AppError';
import { runAgent } from '../services/agentRunner';
import { asyncHandler } from '../middleware/asyncHandler';

export const createTask = asyncHandler(async (req: Request, res: Response) => {
  const { agentId, payload } = req.body;

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    throw AppError.badRequest('Agent not found for the given agentId');
  }

  const task = await prisma.task.create({
    data: { agentId, payload, status: 'PENDING' },
  });

  runAgent(task.id).catch(err => console.error('Agent Runner failed:', err));

  res.status(201).json(task);
});

export const getTasks = asyncHandler(async (_req: Request, res: Response) => {
  const tasks = await prisma.task.findMany({
    include: { agent: true },
  });
  res.status(200).json(tasks);
});

export const getTaskById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: { agent: true },
  });
  if (!task) {
    throw AppError.notFound('Task not found');
  }
  res.status(200).json(task);
});
