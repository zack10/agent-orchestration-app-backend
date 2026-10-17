import { Prisma } from "@prisma/client";
import { encrypt } from "./crypto";

type JsonRecord = Record<string, unknown>;

export const protectAgentConfig = (
  value: unknown,
): Prisma.InputJsonObject | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const config = { ...(value as JsonRecord) };
  if (typeof config.apiKey === "string" && config.apiKey.length > 0) {
    config.apiKey = encrypt(config.apiKey);
  }
  return config as Prisma.InputJsonObject;
};

export const redactAgent = <T extends { config?: unknown }>(
  agent: T,
): Omit<T, "config"> & { config?: JsonRecord } => {
  const { config, ...safe } = agent;
  if (!config || typeof config !== "object" || Array.isArray(config))
    return safe;
  const publicConfig = { ...(config as JsonRecord) };
  delete publicConfig.apiKey;
  return { ...safe, config: publicConfig };
};
