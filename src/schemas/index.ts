import { z } from 'zod';

const uuid = z.string().uuid();

// Agent schemas
export const createAgentSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    config: z.record(z.unknown()).optional(),
  }),
});

export const updateAgentSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    config: z.record(z.unknown()).optional(),
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

// Shared param schemas
export const idParamSchema = z.object({
  params: z.object({ id: uuid }),
});
