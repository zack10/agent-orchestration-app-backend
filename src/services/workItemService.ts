import prisma from '../db';
import { WorkItemStatus, canTransitionWorkItemStatus } from '../types/workItem';

const workItems = () => {
  const delegate = (prisma as any).workItem;
  if (!delegate) {
    throw new Error('Prisma client is missing WorkItem delegate. Regenerate Prisma client after updating schema.prisma.');
  }
  return delegate as any;
};

export const claimWorkItemLock = async (params: {
  workItemId: string;
  lockOwner: string;
  lockSeconds?: number;
}): Promise<boolean> => {
  const now = new Date();
  const lockSeconds = params.lockSeconds ?? 300;
  const lockUntil = new Date(now.getTime() + lockSeconds * 1000);

  const res = await workItems().updateMany({
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
  const res = await workItems().updateMany({
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
  metadata?: any;
}): Promise<boolean> => {
  const existing = await workItems().findUnique({
    where: { id: params.workItemId },
    select: { status: true },
  });

  if (!existing) return false;

  const from = params.from ?? (existing.status as WorkItemStatus);
  if (!canTransitionWorkItemStatus(from, params.to)) return false;

  await workItems().update({
    where: { id: params.workItemId },
    data: {
      status: params.to,
      lastError: params.lastError ?? undefined,
      metadata: params.metadata ?? undefined,
    },
  });

  return true;
};
