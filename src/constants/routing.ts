import type { AgentRole } from "../types/workItem";

export const roleWorkRoutingKey = (role: AgentRole) => `role.${role}.work`;

export const roleWorkQueueName = (role: AgentRole) => `role_${role}_work_queue`;
