import { Prisma } from "@prisma/client";
import prisma from "../db";

/**
 * Service to manage Shared Project Context.
 * This acts as the "live document" that agents read and write to
 * to understand the tech stack, decisions, and progress.
 */
export const getProjectContext = async (projectId: string) => {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      agents: true,
      tasks: {
        orderBy: { updatedAt: "desc" },
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
    contextData?: Prisma.InputJsonObject;
    description?: string;
  },
) => {
  const current = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!current) throw new Error(`Project ${projectId} not found`);

  // Merge contextData if it's an object
  const currentContextData =
    current.contextData &&
    typeof current.contextData === "object" &&
    !Array.isArray(current.contextData)
      ? current.contextData
      : {};
  const newContextData: Prisma.InputJsonObject = updates.contextData
    ? { ...currentContextData, ...updates.contextData }
    : { ...currentContextData };

  return prisma.project.update({
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
  return prisma.project.create({
    data: {
      ...data,
      contextData: {},
    },
  });
};
