import { z } from "zod";
import { config } from "../config";
import prisma from "../db";
import { describeError } from "../utils/safeError";
import { runAgent } from "./agentRunner";
import rabbitMQService, { AGENT_EXCHANGE } from "./rabbitMQService";

const TASK_QUEUE = "agent_tasks";
const TASK_RETRY_QUEUE = "agent_tasks_retry";
const TASK_ROUTING_KEY = "task.run";
const TASK_RETRY_ROUTING_KEY = "task.retry";
const taskMessageSchema = z.object({ taskId: z.string().uuid() });

class TaskQueueService {
  private recoveryTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    const channel = await rabbitMQService.getChannel();
    await channel.assertQueue(TASK_RETRY_QUEUE, {
      durable: true,
      arguments: {
        "x-message-ttl": config.taskRetryDelayMs,
        "x-dead-letter-exchange": AGENT_EXCHANGE,
        "x-dead-letter-routing-key": TASK_ROUTING_KEY,
      },
    });
    await channel.bindQueue(
      TASK_RETRY_QUEUE,
      AGENT_EXCHANGE,
      TASK_RETRY_ROUTING_KEY,
    );
    await rabbitMQService.subscribe(TASK_QUEUE, TASK_ROUTING_KEY, (message) =>
      this.process(message),
    );
    await this.recoverPendingTasks();
    this.recoveryTimer = setInterval(() => {
      this.recoverPendingTasks().catch((error) =>
        console.error(`Task recovery sweep failed: ${describeError(error)}`),
      );
    }, 30_000);
    this.recoveryTimer.unref();
  }

  stop(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  async dispatch(taskId: string): Promise<void> {
    await rabbitMQService.publish(TASK_ROUTING_KEY, { taskId });
    await prisma.task.update({
      where: { id: taskId },
      data: { queuedAt: new Date() },
    });
  }

  private async process(message: unknown): Promise<void> {
    const parsed = taskMessageSchema.safeParse(message);
    if (!parsed.success) {
      console.error("Discarding invalid task message:", parsed.error.flatten());
      return;
    }

    try {
      await runAgent(parsed.data.taskId);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const task = await prisma.task.findUnique({
        where: { id: parsed.data.taskId },
        select: { attemptCount: true, maxAttempts: true },
      });
      if (!task) return;

      if (task.attemptCount >= task.maxAttempts) {
        await prisma.task.update({
          where: { id: parsed.data.taskId },
          data: {
            status: "FAILED",
            lastError: err.message,
            completedAt: new Date(),
            result: { error: err.message },
          },
        });
        return;
      }

      await prisma.task.update({
        where: { id: parsed.data.taskId },
        data: { status: "PENDING", lastError: err.message, queuedAt: null },
      });
      await rabbitMQService.publish(TASK_RETRY_ROUTING_KEY, {
        taskId: parsed.data.taskId,
      });
    }
  }

  private async recoverPendingTasks(): Promise<void> {
    const staleBefore = new Date(Date.now() - 60_000);
    const expiredLease = new Date(Date.now() - config.taskLeaseMs);
    await prisma.task.updateMany({
      where: {
        status: "IN_PROGRESS",
        startedAt: { lt: expiredLease },
        attemptCount: { lt: config.taskMaxAttempts },
      },
      data: {
        status: "PENDING",
        queuedAt: null,
        lastError: "Execution lease expired",
      },
    });
    await prisma.task.updateMany({
      where: {
        status: "IN_PROGRESS",
        startedAt: { lt: expiredLease },
        attemptCount: { gte: config.taskMaxAttempts },
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        lastError: "Execution lease expired",
      },
    });
    const tasks = await prisma.task.findMany({
      where: {
        status: "PENDING",
        OR: [{ queuedAt: null }, { queuedAt: { lt: staleBefore } }],
      },
      select: { id: true },
      take: 100,
    });
    for (const task of tasks) await this.dispatch(task.id);
  }
}

export default new TaskQueueService();
