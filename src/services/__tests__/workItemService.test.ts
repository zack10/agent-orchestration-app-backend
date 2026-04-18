import { claimWorkItemLock, releaseWorkItemLock, transitionWorkItemStatus } from '../workItemService';
import prisma from '../../db';

// Mock the prisma client
jest.mock('../../db', () => ({
  __esModule: true,
  default: {
    workItem: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe('workItemService', () => {
  const mockWorkItem = (prisma as any).workItem;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('claimWorkItemLock', () => {
    it('should return true if a lock is successfully claimed', async () => {
      mockWorkItem.updateMany.mockResolvedValue({ count: 1 });

      const result = await claimWorkItemLock({
        workItemId: '123',
        lockOwner: 'agent-1',
      });

      expect(result).toBe(true);
      expect(mockWorkItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          id: '123',
          OR: [{ lockUntil: null }, { lockUntil: { lt: expect.any(Date) } }],
        },
        data: {
          lockOwner: 'agent-1',
          lockUntil: expect.any(Date),
        },
      }));
    });

    it('should return false if a lock is not claimed', async () => {
      mockWorkItem.updateMany.mockResolvedValue({ count: 0 });

      const result = await claimWorkItemLock({
        workItemId: '123',
        lockOwner: 'agent-1',
      });

      expect(result).toBe(false);
    });
  });

  describe('releaseWorkItemLock', () => {
    it('should return true if a lock is successfully released', async () => {
      mockWorkItem.updateMany.mockResolvedValue({ count: 1 });

      const result = await releaseWorkItemLock({
        workItemId: '123',
        lockOwner: 'agent-1',
      });

      expect(result).toBe(true);
      expect(mockWorkItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: '123',
          lockOwner: 'agent-1',
        },
        data: {
          lockOwner: null,
          lockUntil: null,
        },
      });
    });

    it('should return false if a lock is not released', async () => {
      mockWorkItem.updateMany.mockResolvedValue({ count: 0 });

      const result = await releaseWorkItemLock({
        workItemId: '123',
        lockOwner: 'agent-1',
      });

      expect(result).toBe(false);
    });
  });

  describe('transitionWorkItemStatus', () => {
    it('should return false if work item is not found', async () => {
      mockWorkItem.findUnique.mockResolvedValue(null);

      const result = await transitionWorkItemStatus({
        workItemId: '123',
        to: 'IN_PROGRESS',
      });

      expect(result).toBe(false);
      expect(mockWorkItem.findUnique).toHaveBeenCalledWith({
        where: { id: '123' },
        select: { status: true },
      });
    });

    it('should return false if transition is invalid', async () => {
      mockWorkItem.findUnique.mockResolvedValue({ status: 'DONE' });

      const result = await transitionWorkItemStatus({
        workItemId: '123',
        to: 'IN_PROGRESS', // DONE to IN_PROGRESS is invalid
      });

      expect(result).toBe(false);
      expect(mockWorkItem.update).not.toHaveBeenCalled();
    });

    it('should return true and update status if transition is valid', async () => {
      mockWorkItem.findUnique.mockResolvedValue({ status: 'TODO' });

      const result = await transitionWorkItemStatus({
        workItemId: '123',
        to: 'IN_PROGRESS',
      });

      expect(result).toBe(true);
      expect(mockWorkItem.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: {
          status: 'IN_PROGRESS',
          lastError: undefined,
          metadata: undefined,
        },
      });
    });

    it('should use provided "from" status instead of fetching from DB', async () => {
      // Even if DB says TODO, we use provided from: 'DONE' which should fail
      mockWorkItem.findUnique.mockResolvedValue({ status: 'TODO' });

      const result = await transitionWorkItemStatus({
        workItemId: '123',
        from: 'DONE',
        to: 'IN_PROGRESS',
      });

      expect(result).toBe(false);
      expect(mockWorkItem.update).not.toHaveBeenCalled();
    });

    it('should update lastError and metadata if provided', async () => {
      mockWorkItem.findUnique.mockResolvedValue({ status: 'TODO' });

      const result = await transitionWorkItemStatus({
        workItemId: '123',
        to: 'IN_PROGRESS',
        lastError: 'Something went wrong',
        metadata: { foo: 'bar' },
      });

      expect(result).toBe(true);
      expect(mockWorkItem.update).toHaveBeenCalledWith({
        where: { id: '123' },
        data: {
          status: 'IN_PROGRESS',
          lastError: 'Something went wrong',
          metadata: { foo: 'bar' },
        },
      });
    });
  });
});
