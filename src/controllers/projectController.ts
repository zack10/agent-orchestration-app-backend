import { Request, Response } from 'express';
import prisma from '../db';
import { AppError } from '../errors/AppError';
import { asyncHandler } from '../middleware/asyncHandler';

export const createProject = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, techStack, architectureDecisions, contextData } = req.body;
  const project = await prisma.project.create({
    data: { name, description, techStack, architectureDecisions, contextData },
  });
  res.status(201).json(project);
});

export const getProjects = asyncHandler(async (_req: Request, res: Response) => {
  const projects = await prisma.project.findMany({
    include: { agents: true, tasks: true },
  });
  res.status(200).json(projects);
});

export const getProjectById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { agents: true, tasks: true },
  });
  if (!project) {
    throw AppError.notFound('Project not found');
  }
  res.status(200).json(project);
});

export const updateProject = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, techStack, architectureDecisions, contextData } = req.body;
  const project = await prisma.project.update({
    where: { id },
    data: { name, description, techStack, architectureDecisions, contextData },
  });
  res.status(200).json(project);
});

export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await prisma.project.delete({ where: { id } });
  res.status(204).send();
});
