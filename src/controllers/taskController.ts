import { Request, Response } from 'express';
import prisma from '../db';
import { runAgent } from '../services/agentRunner';

export const createTask = async (req: Request, res: Response) => {
  try {
    const { agentId, payload } = req.body;
    const task = await prisma.task.create({
      data: {
        agentId,
        payload,
        status: 'PENDING',
      },
    });
    
    // Trigger Agent Runner asynchronously
    runAgent(task.id).catch(err => console.error('Agent Runner failed:', err));

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create task' });
  }
};

export const getTasks = async (req: Request, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({
      include: {
        agent: true,
      },
    });
    res.status(200).json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};

export const getTaskById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        agent: true,
      },
    });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(200).json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
};
