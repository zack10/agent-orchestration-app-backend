export type ExternalSystem = 'TRELLO' | 'JIRA';

export type WorkItemStatus = 'TODO' | 'IN_PROGRESS' | 'READY_FOR_TEST' | 'DONE' | 'BLOCKED';

export type AgentRole = 'frontend' | 'backend' | 'qa';

export const canTransitionWorkItemStatus = (from: WorkItemStatus, to: WorkItemStatus): boolean => {
  if (from === to) return true;

  switch (from) {
    case 'TODO':
      return to === 'IN_PROGRESS' || to === 'BLOCKED';
    case 'IN_PROGRESS':
      return to === 'READY_FOR_TEST' || to === 'BLOCKED' || to === 'TODO';
    case 'READY_FOR_TEST':
      return to === 'DONE' || to === 'IN_PROGRESS' || to === 'TODO' || to === 'BLOCKED';
    case 'DONE':
      return to === 'TODO';
    case 'BLOCKED':
      return to === 'TODO' || to === 'IN_PROGRESS';
    default:
      return false;
  }
};

