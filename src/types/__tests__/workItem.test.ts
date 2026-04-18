import { canTransitionWorkItemStatus, WorkItemStatus } from '../workItem';

describe('canTransitionWorkItemStatus', () => {
  it('should return true if from and to are the same', () => {
    const statuses: WorkItemStatus[] = ['TODO', 'IN_PROGRESS', 'READY_FOR_TEST', 'DONE', 'BLOCKED'];
    statuses.forEach(status => {
      expect(canTransitionWorkItemStatus(status, status)).toBe(true);
    });
  });

  describe('from TODO', () => {
    it('can transition to IN_PROGRESS or BLOCKED', () => {
      expect(canTransitionWorkItemStatus('TODO', 'IN_PROGRESS')).toBe(true);
      expect(canTransitionWorkItemStatus('TODO', 'BLOCKED')).toBe(true);
    });

    it('cannot transition to READY_FOR_TEST or DONE', () => {
      expect(canTransitionWorkItemStatus('TODO', 'READY_FOR_TEST')).toBe(false);
      expect(canTransitionWorkItemStatus('TODO', 'DONE')).toBe(false);
    });
  });

  describe('from IN_PROGRESS', () => {
    it('can transition to READY_FOR_TEST, BLOCKED, or TODO', () => {
      expect(canTransitionWorkItemStatus('IN_PROGRESS', 'READY_FOR_TEST')).toBe(true);
      expect(canTransitionWorkItemStatus('IN_PROGRESS', 'BLOCKED')).toBe(true);
      expect(canTransitionWorkItemStatus('IN_PROGRESS', 'TODO')).toBe(true);
    });

    it('cannot transition to DONE', () => {
      expect(canTransitionWorkItemStatus('IN_PROGRESS', 'DONE')).toBe(false);
    });
  });

  describe('from READY_FOR_TEST', () => {
    it('can transition to DONE, IN_PROGRESS, TODO, or BLOCKED', () => {
      expect(canTransitionWorkItemStatus('READY_FOR_TEST', 'DONE')).toBe(true);
      expect(canTransitionWorkItemStatus('READY_FOR_TEST', 'IN_PROGRESS')).toBe(true);
      expect(canTransitionWorkItemStatus('READY_FOR_TEST', 'TODO')).toBe(true);
      expect(canTransitionWorkItemStatus('READY_FOR_TEST', 'BLOCKED')).toBe(true);
    });
  });

  describe('from DONE', () => {
    it('can transition to TODO', () => {
      expect(canTransitionWorkItemStatus('DONE', 'TODO')).toBe(true);
    });

    it('cannot transition to IN_PROGRESS, READY_FOR_TEST, or BLOCKED', () => {
      expect(canTransitionWorkItemStatus('DONE', 'IN_PROGRESS')).toBe(false);
      expect(canTransitionWorkItemStatus('DONE', 'READY_FOR_TEST')).toBe(false);
      expect(canTransitionWorkItemStatus('DONE', 'BLOCKED')).toBe(false);
    });
  });

  describe('from BLOCKED', () => {
    it('can transition to TODO or IN_PROGRESS', () => {
      expect(canTransitionWorkItemStatus('BLOCKED', 'TODO')).toBe(true);
      expect(canTransitionWorkItemStatus('BLOCKED', 'IN_PROGRESS')).toBe(true);
    });

    it('cannot transition to READY_FOR_TEST or DONE', () => {
      expect(canTransitionWorkItemStatus('BLOCKED', 'READY_FOR_TEST')).toBe(false);
      expect(canTransitionWorkItemStatus('BLOCKED', 'DONE')).toBe(false);
    });
  });
});
