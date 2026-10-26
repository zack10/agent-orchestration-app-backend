import { Prisma } from "@prisma/client";
import prisma from "../../db";
import { DEFAULT_PROTECTED_PATHS, RepositoryPolicy } from "../agentGraph/repoPolicy";
import { ToolCall } from "../llm/types";
import { execInSandbox, workspacePath } from "../workspaceService";
import { CHECK_TIMEOUT_MS, ToolContext, ToolOutcome, ToolStatus, executeTool } from "./tools";

// Stored output is capped; the full output already went to the model.
const MAX_STORED_OUTPUT_CHARS = 10_000;

/** Where tool calls are recorded; the Prisma version writes the ToolCall table. */
export interface ToolCallRecorder {
  create(data: { name: string; input: unknown; policy: unknown }): Promise<string>;
  update(
    id: string,
    data: {
      status: "RUNNING" | ToolStatus;
      output?: unknown;
      policy?: unknown;
      startedAt?: Date;
      completedAt?: Date;
    },
  ): Promise<void>;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

export const prismaToolCallRecorder = (attemptId: string): ToolCallRecorder => ({
  async create({ name, input, policy }) {
    const row = await prisma.toolCall.create({
      data: { attemptId, name, input: json(input), policy: json(policy) },
    });
    return row.id;
  },
  async update(id, { output, policy, ...rest }) {
    await prisma.toolCall.update({
      where: { id },
      data: {
        ...rest,
        ...(output === undefined ? {} : { output: json(output) }),
        ...(policy === undefined ? {} : { policy: json(policy) }),
      },
    });
  },
});

/**
 * Runs one tool call and records it: REQUESTED with the policy in force,
 * RUNNING, then COMPLETED, DENIED or FAILED with its (capped) output.
 */
export const runRecordedTool = async (
  ctx: ToolContext,
  call: ToolCall,
  recorder: ToolCallRecorder,
): Promise<ToolOutcome> => {
  const policy = { protectedPaths: ctx.protectedPaths, checkScripts: ctx.checkScripts };
  const id = await recorder.create({ name: call.name, input: call.arguments, policy });
  await recorder.update(id, { status: "RUNNING", startedAt: new Date() });
  const outcome = await executeTool(ctx, call.name, call.arguments);
  await recorder.update(id, {
    status: outcome.status,
    output: {
      text: outcome.output.slice(0, MAX_STORED_OUTPUT_CHARS),
      truncated: outcome.output.length > MAX_STORED_OUTPUT_CHARS,
      ...(outcome.finish ? { finish: outcome.finish } : {}),
    },
    // Denials record why, so a run can be audited without the transcript.
    ...(outcome.status === "DENIED" ? { policy: { ...policy, denied: outcome.output } } : {}),
    completedAt: new Date(),
  });
  return outcome;
};

/** The tool context for an execution, from its repository's settings. */
export const executionToolContext = (
  executionId: string,
  repository: { executionPolicy: unknown; verificationConfig: unknown },
): ToolContext => {
  const policy = repository.executionPolicy as RepositoryPolicy | null;
  const verification = repository.verificationConfig as { scripts?: string[] } | null;
  return {
    root: workspacePath(executionId),
    protectedPaths: policy?.protectedPaths ?? DEFAULT_PROTECTED_PATHS,
    checkScripts: verification?.scripts ?? ["lint", "build", "test"],
    runCheck: (script) => execInSandbox(executionId, ["npm", "run", script], CHECK_TIMEOUT_MS),
    createdFiles: new Set(),
  };
};
