import { Message, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../db";
import { AgentMessagePayload } from "../types/messaging";
import { describeError } from "../utils/safeError";
import rabbitMQService from "./rabbitMQService";

const MAX_PUBLISH_ATTEMPTS = 10;
let recoveryTimer: NodeJS.Timeout | null = null;

const publishMessage = async (message: Message): Promise<void> => {
  const payload: AgentMessagePayload = {
    id: message.id,
    type: "AGENT_MESSAGE",
    senderId: message.senderId,
    receiverId: message.receiverId,
    payload: message.content,
    metadata: {
      timestamp: message.createdAt.toISOString(),
      correlationId: randomUUID(),
    },
  };

  try {
    await rabbitMQService.publish(
      `agent.${message.receiverId}.message`,
      payload,
    );
    await prisma.message.update({
      where: { id: message.id },
      data: {
        publishedAt: new Date(),
        publishAttempts: { increment: 1 },
        lastError: null,
      },
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await prisma.message.update({
      where: { id: message.id },
      data: { publishAttempts: { increment: 1 }, lastError: err.message },
    });
    throw err;
  }
};

export const sendMessage = async (
  senderId: string,
  receiverId: string,
  content: Record<string, unknown>,
): Promise<Message> => {
  const message = await prisma.message.create({
    data: { senderId, receiverId, content: content as Prisma.InputJsonObject },
  });
  await publishMessage(message);
  return message;
};

const recoverUnpublishedMessages = async (): Promise<void> => {
  const messages = await prisma.message.findMany({
    where: { publishedAt: null, publishAttempts: { lt: MAX_PUBLISH_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const message of messages) {
    try {
      await publishMessage(message);
    } catch (error) {
      console.error(
        `Message ${message.id} recovery publish failed: ${describeError(error)}`,
      );
    }
  }
};

export const startMessageRecovery = async (): Promise<void> => {
  await recoverUnpublishedMessages();
  recoveryTimer = setInterval(() => {
    recoverUnpublishedMessages().catch((error) =>
      console.error(`Message recovery sweep failed: ${describeError(error)}`),
    );
  }, 30_000);
  recoveryTimer.unref();
};

export const stopMessageRecovery = (): void => {
  if (recoveryTimer) clearInterval(recoveryTimer);
  recoveryTimer = null;
};
