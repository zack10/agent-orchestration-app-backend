import { z } from "zod";

const uuid = z.string().uuid();

// Agent schemas
export const createAgentSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    projectId: uuid.optional(),
    provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
    model: z.string().min(1).optional(),
    baseInstructions: z.string().max(20_000).optional(),
  }),
});

export const updateAgentSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    projectId: uuid.optional(),
    provider: z.enum(["gemini", "openai", "anthropic"]).optional(),
    model: z.string().min(1).optional(),
    baseInstructions: z.string().max(20_000).optional(),
  }),
});

// Skill schemas
export const createSkillSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    logic: z.string().min(1, "Logic is required"),
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
  headers: z
    .object({
      "idempotency-key": z.string().min(8).max(200).optional(),
    })
    .passthrough(),
  body: z.object({
    agentId: uuid,
    payload: z.record(z.unknown()),
  }),
});

export const discoverProviderSchema = z.object({
  body: z.object({
    provider: z.enum(["gemini", "openai", "anthropic"]),
    apiKey: z.string().min(1),
  }),
});

export const providerQuerySchema = z.object({
  query: z.object({ provider: z.enum(["gemini", "openai", "anthropic"]) }),
});

// Project schemas
export const createProjectSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required"),
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
  "AGENT_MESSAGE",
  "TASK_UPDATE",
  "RESOURCE_REQUEST",
  "WORKITEM_STATUS",
  "CONTRACT_PROPOSAL",
  "CONTRACT_ACCEPTED",
  "CONTRACT_REJECTED",
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
