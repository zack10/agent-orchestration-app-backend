import prisma from "../db";
import { describeError } from "../utils/safeError";
import rabbitMQService from "./rabbitMQService";

let timer: NodeJS.Timeout | null = null;
export const flushOutbox = async () => {
  const rows = await prisma.outboxEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const row of rows) {
    try {
      await rabbitMQService.publish(row.topic, {
        messageId: row.id,
        ...(row.payload as object),
      });
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: message,
          availableAt: new Date(Date.now() + 5000),
        },
      });
    }
  }
};
let flushing = false;
const tick = async () => {
  if (flushing) return;
  flushing = true;
  try {
    await flushOutbox();
  } catch (error) {
    // A DB or broker outage must not become an unhandled rejection (process exit).
    console.error(`Outbox flush failed: ${describeError(error)}`);
  } finally {
    flushing = false;
  }
};
export const startOutbox = async () => {
  await tick();
  timer = setInterval(() => void tick(), 2000);
  timer.unref();
};
export const stopOutbox = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};
