import { Request, Response } from "express";
import { config } from "../config";
import prisma from "../db";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createExecution,
  decideApproval,
  submitPlan,
} from "../services/executionService";
import { syncIntegrationConnection } from "../services/ingestionService";
import {
  redactIntegration,
  sealIntegrationConfig,
} from "../services/integrationConfigService";

export const createRepository = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      projectId,
      owner,
      name,
      defaultBranch,
      githubInstallationId,
      verificationConfig,
      executionPolicy,
    } = req.body;
    const repository = await prisma.repository.create({
      data: {
        projectId,
        owner,
        name,
        defaultBranch,
        githubInstallationId,
        verificationConfig,
        executionPolicy,
      },
    });
    res.status(201).json(repository);
  },
);
/** Sets a repository's environment or policy; later executions use it. */
export const updateRepository = asyncHandler(
  async (req: Request, res: Response) => {
    const { verificationConfig, executionPolicy } = req.body;
    res.json(
      await prisma.repository.update({
        where: { id: req.params.id },
        data: { verificationConfig, executionPolicy },
      }),
    );
  },
);
export const listRepositories = asyncHandler(
  async (req: Request, res: Response) => {
    res.json(
      await prisma.repository.findMany({
        where: { projectId: req.query.projectId as string | undefined },
        take: 100,
      }),
    );
  },
);
export const createIntegration = asyncHandler(
  async (req: Request, res: Response) => {
    const { config: secretConfig, projectId, type, name } = req.body;
    const connection = await prisma.integrationConnection.create({
      data: {
        projectId,
        type,
        name,
        encryptedConfig: sealIntegrationConfig(secretConfig),
      },
    });
    res.status(201).json(redactIntegration(connection));
  },
);
export const listIntegrations = asyncHandler(
  async (req: Request, res: Response) => {
    const rows = await prisma.integrationConnection.findMany({
      where: { projectId: req.query.projectId as string | undefined },
      take: 100,
    });
    res.json(rows.map(redactIntegration));
  },
);
export const syncIntegration = asyncHandler(
  async (req: Request, res: Response) => {
    res.json(await syncIntegrationConnection(req.params.id));
  },
);
export const listWorkItems = asyncHandler(
  async (req: Request, res: Response) => {
    res.json(
      await prisma.workItem.findMany({
        where: { projectId: req.query.projectId as string | undefined },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
    );
  },
);
export const getWorkItem = asyncHandler(async (req: Request, res: Response) => {
  res.json(
    await prisma.workItem.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { executions: true },
    }),
  );
});
export const startExecution = asyncHandler(
  async (req: Request, res: Response) => {
    const workItem = await prisma.workItem.findUniqueOrThrow({
      where: { id: req.body.workItemId },
    });
    const execution = await createExecution({
      projectId: req.body.projectId,
      repositoryId: req.body.repositoryId,
      workItemId: workItem.id,
      revisionHash: workItem.revisionHash ?? workItem.updatedAt.toISOString(),
    });
    res.status(202).json(execution);
  },
);
export const listExecutions = asyncHandler(
  async (req: Request, res: Response) => {
    res.json(
      await prisma.execution.findMany({
        where: { projectId: req.query.projectId as string | undefined },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  },
);
export const getExecution = asyncHandler(
  async (req: Request, res: Response) => {
    res.json(
      await prisma.execution.findUniqueOrThrow({
        where: { id: req.params.id },
        include: {
          plans: {
            include: {
              tasks: { include: { dependencies: true, attempts: true } },
            },
          },
          approvals: true,
          artifacts: true,
          events: { orderBy: { sequence: "asc" } },
        },
      }),
    );
  },
);
export const createPlan = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await submitPlan(req.params.id, req.body));
});
export const approve = asyncHandler(async (req: Request, res: Response) => {
  res.json(
    await decideApproval(
      req.params.id,
      req.params.type.toUpperCase() as "PLAN" | "PUBLISH",
      req.body.approved,
      req.body.snapshotHash,
      config.apiAuthActor,
      req.body.comment,
    ),
  );
});
