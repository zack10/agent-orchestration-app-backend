import { z } from 'zod';

const uuid = z.string().uuid();

// Agent schemas
export const createAgentSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    projectId: uuid.optional(),
  }),
});

export const updateAgentSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    projectId: uuid.optional(),
  }),
});

// Skill schemas
export const createSkillSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    logic: z.string().min(1, 'Logic is required'),
  }),
});

export const updateSkillSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    logic: z.string().min(1).optional(),
  }),
});

export const assignSkillSchema = z.object({
  body: z.object({
    agentId: uuid,
    skillId: uuid,
  }),
});

// Task schemas
export const createTaskSchema = z.object({
  body: z.object({
    agentId: uuid,
    payload: z.record(z.unknown()),
  }),
});

// Project schemas
export const createProjectSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    techStack: z.string().optional(),
    architectureDecisions: z.string().optional(),
    contextData: z.record(z.unknown()).optional(),
  }),
});

export const updateProjectSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    techStack: z.string().optional(),
    architectureDecisions: z.string().optional(),
    contextData: z.record(z.unknown()).optional(),
  }),
});

// Message schemas
export const messageTypeSchema = z.enum([
  'AGENT_MESSAGE',
  'TASK_UPDATE',
  'RESOURCE_REQUEST',
  'WORKITEM_STATUS',
  'CONTRACT_PROPOSAL',
  'CONTRACT_ACCEPTED',
  'CONTRACT_REJECTED',
]);

export const messageMetadataSchema = z.object({
  timestamp: z.string().datetime().or(z.string()), // Flexible ISO string
  conversationId: uuid.optional(),
  correlationId: uuid.optional(),
});

export const agentMessageSchema = z.object({
  body: z.object({
    id: uuid,
    type: messageTypeSchema,
    senderId: uuid,
    receiverId: uuid.nullable(),
    payload: z.record(z.unknown()),
    metadata: messageMetadataSchema,
  }),
});

// Shared param schemas
export const idParamSchema = z.object({
  params: z.object({ id: uuid }),
});
