import { Request, Response } from "express";
import { config } from "../config";
import prisma from "../db";
import { AppError } from "../errors/AppError";
import { asyncHandler } from "../middleware/asyncHandler";
import taskQueueService from "../services/taskQueueService";
import { redactAgent } from "../utils/agentConfig";
import { describeError } from "../utils/safeError";

export const createTask = asyncHandler(async (req: Request, res: Response) => {
  const { agentId, payload } = req.body;
  const idempotencyKey = req.header("idempotency-key");

  if (idempotencyKey) {
    const existing = await prisma.task.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      res.status(200).json(existing);
      return;
    }
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    throw AppError.badRequest("Agent not found for the given agentId");
  }

  const task = await prisma.task.create({
    data: {
      agentId,
      projectId: agent.projectId,
      payload,
      status: "PENDING",
      maxAttempts: config.taskMaxAttempts,
      idempotencyKey,
    },
  });

  try {
    await taskQueueService.dispatch(task.id);
  } catch (error) {
    console.error(
      `Task ${task.id} persisted but could not be dispatched: ${describeError(error)}`,
    );
  }

  const persistedTask = await prisma.task.findUniqueOrThrow({
    where: { id: task.id },
  });
  res.status(202).json(persistedTask);
});

export const getTasks = asyncHandler(async (_req: Request, res: Response) => {
  const tasks = await prisma.task.findMany({
    include: { agent: true },
  });
  res
    .status(200)
    .json(tasks.map((task) => ({ ...task, agent: redactAgent(task.agent) })));
});

export const getTaskById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: { agent: true },
  });
  if (!task) {
    throw AppError.notFound("Task not found");
  }
  res.status(200).json({ ...task, agent: redactAgent(task.agent) });
});
