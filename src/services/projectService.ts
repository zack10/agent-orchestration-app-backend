import prisma from '../db';

/**
 * Service to manage Shared Project Context.
 * This acts as the "live document" that agents read and write to
 * to understand the tech stack, decisions, and progress.
 */
export const getProjectContext = async (projectId: string) => {
  return (prisma as any).project.findUnique({
    where: { id: projectId },
    include: {
      agents: true,
      tasks: {
        orderBy: { updatedAt: 'desc' },
        take: 10, // Get recent history
      },
    },
  });
};

export const updateProjectContext = async (
  projectId: string,
  updates: {
    techStack?: string;
    architectureDecisions?: string;
    contextData?: any;
    description?: string;
  }
) => {
  const current = await (prisma as any).project.findUnique({
    where: { id: projectId },
  });

  if (!current) throw new Error(`Project ${projectId} not found`);

  // Merge contextData if it's an object
  const newContextData = updates.contextData
    ? { ...(current.contextData as object || {}), ...updates.contextData }
    : current.contextData;

  return (prisma as any).project.update({
    where: { id: projectId },
    data: {
      ...updates,
      contextData: newContextData,
    },
  });
};

export const createProject = async (data: {
  name: string;
  description?: string;
  techStack?: string;
}) => {
  return (prisma as any).project.create({
    data: {
      ...data,
      contextData: {},
    },
  });
};
