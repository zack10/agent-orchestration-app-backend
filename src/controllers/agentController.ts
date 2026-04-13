import { Request, Response } from 'express';
import prisma from '../db';
import { AppError } from '../errors/AppError';
import { asyncHandler } from '../middleware/asyncHandler';

export const createAgent = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, config } = req.body;
  const agent = await prisma.agent.create({
    data: { name, description, config },
  });
  res.status(201).json(agent);
});

export const getAgents = asyncHandler(async (_req: Request, res: Response) => {
  const agents = await prisma.agent.findMany({
    include: { skills: true, resources: true },
  });
  res.status(200).json(agents);
});

export const getAgentById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { skills: true, resources: true },
  });
  if (!agent) {
    throw AppError.notFound('Agent not found');
  }
  res.status(200).json(agent);
});

export const updateAgent = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, config } = req.body;
  const agent = await prisma.agent.update({
    where: { id },
    data: { name, description, config },
  });
  res.status(200).json(agent);
});

export const deleteAgent = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await prisma.agent.delete({ where: { id } });
  res.status(204).send();
});
