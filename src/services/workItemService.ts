import { Prisma } from "@prisma/client";
import prisma from "../db";
import { WorkItemStatus, canTransitionWorkItemStatus } from "../types/workItem";

export const claimWorkItemLock = async (params: {
  workItemId: string;
  lockOwner: string;
  lockSeconds?: number;
}): Promise<boolean> => {
  const now = new Date();
  const lockSeconds = params.lockSeconds ?? 300;
  const lockUntil = new Date(now.getTime() + lockSeconds * 1000);

  const res = await prisma.workItem.updateMany({
    where: {
      id: params.workItemId,
      OR: [{ lockUntil: null }, { lockUntil: { lt: now } }],
    },
    data: {
      lockOwner: params.lockOwner,
      lockUntil,
    },
  });

  return res.count === 1;
};

export const releaseWorkItemLock = async (params: {
  workItemId: string;
  lockOwner: string;
}): Promise<boolean> => {
  const res = await prisma.workItem.updateMany({
    where: {
      id: params.workItemId,
      lockOwner: params.lockOwner,
    },
    data: {
      lockOwner: null,
      lockUntil: null,
    },
  });

  return res.count === 1;
};

export const transitionWorkItemStatus = async (params: {
  workItemId: string;
  from?: WorkItemStatus;
  to: WorkItemStatus;
  lastError?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<boolean> => {
  const existing = await prisma.workItem.findUnique({
    where: { id: params.workItemId },
    select: { status: true },
  });

  if (!existing) return false;

  const from = params.from ?? (existing.status as WorkItemStatus);
  if (!canTransitionWorkItemStatus(from, params.to)) return false;

  const result = await prisma.workItem.updateMany({
    where: { id: params.workItemId, status: from },
    data: {
      status: params.to,
      lastError: params.lastError ?? undefined,
      metadata: params.metadata ?? undefined,
    },
  });

  return result.count === 1;
};
