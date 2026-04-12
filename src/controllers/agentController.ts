import { Request, Response } from 'express';
import prisma from '../db';

export const createAgent = async (req: Request, res: Response) => {
  try {
    const { name, description, config } = req.body;
    const agent = await prisma.agent.create({
      data: {
        name,
        description,
        config,
      },
    });
    res.status(201).json(agent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create agent' });
  }
};

export const getAgents = async (req: Request, res: Response) => {
  try {
    const agents = await prisma.agent.findMany({
      include: {
        skills: true,
        resources: true,
      },
    });
    res.status(200).json(agents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
};

export const getAgentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const agent = await prisma.agent.findUnique({
      where: { id },
      include: {
        skills: true,
        resources: true,
      },
    });
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.status(200).json(agent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
};

export const updateAgent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, config } = req.body;
    const agent = await prisma.agent.update({
      where: { id },
      data: {
        name,
        description,
        config,
      },
    });
    res.status(200).json(agent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update agent' });
  }
};

export const deleteAgent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.agent.delete({
      where: { id },
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete agent' });
  }
};
