import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Prisma } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import { ExecutionAgentMode, config } from "../../config";
import prisma from "../../db";
import { getBaseSha, getInstallationToken } from "../../integrations/githubApp";
import { writeActionsToRoot } from "../../utils/codeWriter";
import { decrypt } from "../../utils/crypto";
import {
  EXECUTION_PROMPTS,
  executionPromptFragment,
  renderExecutionPrompt,
} from "../../prompts";
import { NonRetryableError } from "../../utils/safeError";
import { parseAgentOutput } from "../../utils/llmUtils";
import { hashSnapshot } from "../executionService";
import { LLMService } from "../llm/LLMService";
import { ToolRequest } from "../llm/types";
import { SANDBOX_TOOLS } from "../sandbox/tools";
import {
  executionToolContext,
  prismaToolCallRecorder,
  runRecordedTool,
} from "../sandbox/toolRunner";
import {
  changedFiles,
  cloneGithubWorkspace,
  gitDiff,
  removeWorkspace,
  resetWorkspace,
  startSandbox,
  stopSandbox,
  verifyWorkspace,
  workspacePath,
} from "../workspaceService";
import { AgentStopReason, runAgentLoop } from "./agentLoop";
import { reviewDiffSafety } from "./diffReview";
import { fileActionsError } from "./outputFormat";
import { RepoContext, collectRepoContext } from "./repoContext";
import { RepositoryPolicy, checkRepositoryPolicy } from "./repoPolicy";

const llm = new LLMService();
const MAX_ATTEMPTS = 3;
const FILE_BLOCK_FORMAT = executionPromptFragment("fileFormat");

type VerificationResult = Awaited<ReturnType<typeof verifyWorkspace>>;
type GraphRoute =
  | "retry"
  | "blocked"
  | "review"
  | "implemented"
  | "verify"
  | "artifact"
  | "skipped"
  | undefined;

const ExecutionGraphState = Annotation.Root({
  executionId: Annotation<string>(),
  baseSha: Annotation<string | undefined>(),
  githubToken: Annotation<string | undefined>(),
  planTaskId: Annotation<string | undefined>(),
  agentProvider: Annotation<string | undefined>(),
  agentModel: Annotation<string | undefined>(),
  agentApiKey: Annotation<string | undefined>(),
  ticket: Annotation<string | undefined>(),
  repoContext: Annotation<RepoContext | undefined>(),
  internalPlan: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  attemptNumber: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  // Attempts recorded by earlier (retried) runs of this execution.
  attemptOffset: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  attemptId: Annotation<string | undefined>(),
  lastFailure: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  verification: Annotation<VerificationResult | undefined>(),
  route: Annotation<GraphRoute>(),
  agentMode: Annotation<ExecutionAgentMode>({
    reducer: (_current, update) => update,
    default: () => "single_shot",
  }),
  // Execution budget, set in load_context; enforced by the agent loop.
  maxSteps: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => config.agentMaxSteps,
  }),
  maxTokens: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  deadline: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  // Tokens spent by agent loops so far (single-shot calls report none).
  tokensUsed: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
});

type GraphState = typeof ExecutionGraphState.State;

const requireAgent = (state: GraphState) => {
  if (!state.agentProvider || !state.agentModel)
    throw new Error("Execution graph is missing the agent's provider or model");
  return { provider: state.agentProvider, model: state.agentModel };
};

/** Sends a prompt to the run's agent (provider and model resolved in load_context). */
const askAgent = (
  state: GraphState,
  prompt: { system?: string; user: string },
) => {
  const { provider, model } = requireAgent(state);
  return llm.generateContent(provider, model, prompt, state.agentApiKey);
};

const askAgentWithTools = (state: GraphState, request: ToolRequest) => {
  const { provider, model } = requireAgent(state);
  return llm.generateWithTools(provider, model, request, state.agentApiKey);
};

/** The prompts a mode actually uses, recorded with every run. */
const promptVersionsFor = (mode: ExecutionAgentMode) => {
  const { implement, fileFormat, agent, ...shared } = EXECUTION_PROMPTS;
  return mode === "tool_loop"
    ? { ...shared, agent }
    : { ...shared, implement, fileFormat };
};

interface ExecutionBudget {
  maxSteps?: number;
  maxTokens?: number;
  maxDurationSeconds?: number;
}

const positive = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;

const parseJsonRecord = (raw: string) => {
  const candidate = raw.trim().replace(/^```(?:json)?\s*/i, "");
  const clean = candidate.endsWith("```")
    ? candidate.slice(0, -3).trimEnd()
    : candidate;
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const canRetry = (state: typeof ExecutionGraphState.State) =>
  state.attemptNumber < MAX_ATTEMPTS;

const graphEvent = async (
  executionId: string,
  type: string,
  payload: unknown = {},
) => {
  const execution = await prisma.execution.findUniqueOrThrow({
    where: { id: executionId },
    select: { correlationId: true },
  });
  const latest = await prisma.executionEvent.findFirst({
    where: { executionId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  await prisma.executionEvent.create({
    data: {
      executionId,
      sequence: (latest?.sequence ?? 0) + 1,
      type,
      payload: payload as Prisma.InputJsonValue,
      correlationId: execution.correlationId,
    },
  });
};

const loadExecutionContext = async (
  state: typeof ExecutionGraphState.State,
) => {
  const execution = await prisma.execution.findUniqueOrThrow({
    where: { id: state.executionId },
    include: {
      repository: true,
      workItem: true,
      project: { include: { agents: true } },
      plans: {
        where: { status: "APPROVED" },
        include: { tasks: true },
        orderBy: { version: "desc" },
        take: 1,
      },
    },
  });
  // The worker claims the execution (status RUNNING + lease) before invoking the graph.
  if (execution.status !== "RUNNING")
    throw new NonRetryableError(
      `Execution graph started in unexpected status ${execution.status}`,
    );

  const agent = execution.project.agents[0];
  if (!agent) throw new Error("Project has no implementation agent");

  const planTask = execution.plans[0]?.tasks[0];
  if (!planTask) throw new Error("Approved plan has no task");

  const baseSha = await getBaseSha(
    execution.repository.githubInstallationId,
    execution.repository.owner,
    execution.repository.name,
    execution.repository.defaultBranch,
  );
  const githubToken = await getInstallationToken(
    execution.repository.githubInstallationId,
  );

  await cloneGithubWorkspace(
    execution.id,
    execution.repository.owner,
    execution.repository.name,
    baseSha,
    githubToken,
  );

  await prisma.execution.update({
    where: { id: execution.id },
    data: { baseSha },
  });
  const previousAttempts = await prisma.taskAttempt.aggregate({
    where: { planTaskId: planTask.id },
    _max: { number: true },
  });
  const agentMode = config.executionAgentMode;
  const budget = (execution.budget ?? {}) as ExecutionBudget;
  const maxSteps = positive(budget.maxSteps, config.agentMaxSteps);
  const maxTokens = positive(budget.maxTokens, 200_000);
  const deadline =
    Date.now() + positive(budget.maxDurationSeconds, 1800) * 1000;
  await graphEvent(execution.id, "GRAPH_CONTEXT_LOADED", {
    repositoryId: execution.repositoryId,
    workItemId: execution.workItemId,
    planTaskId: planTask.id,
    agentMode,
    budget: { maxSteps, maxTokens, maxDurationSeconds: (deadline - Date.now()) / 1000 },
    promptVersions: promptVersionsFor(agentMode),
  });

  const resolved = llm.resolveModel(agent);
  const agentConfig = agent.config as { apiKey?: string } | null;
  const agentApiKey = agentConfig?.apiKey
    ? decrypt(agentConfig.apiKey)
    : undefined;

  return {
    baseSha,
    githubToken,
    planTaskId: planTask.id,
    attemptOffset: previousAttempts._max.number ?? 0,
    agentProvider: resolved.provider,
    agentModel: resolved.model,
    agentApiKey,
    ticket: `${execution.workItem.title}\n${execution.workItem.description ?? ""}`,
    agentMode,
    maxSteps,
    maxTokens,
    deadline,
  };
};

const inspectRepository = async (state: typeof ExecutionGraphState.State) => {
  if (!state.ticket) throw new Error("Execution graph is missing ticket");
  const repoContext = await collectRepoContext(
    workspacePath(state.executionId),
    state.ticket,
  );
  await graphEvent(state.executionId, "GRAPH_REPOSITORY_INSPECTED", {
    fileTreeCount: repoContext.fileTree.length,
    selectedFiles: repoContext.selectedFiles,
    packageScripts: repoContext.packageScripts,
  });
  return { repoContext };
};

const planChange = async (state: typeof ExecutionGraphState.State) => {
  if (!state.ticket || !state.repoContext) {
    throw new Error("Execution graph is missing planning context");
  }
  const prompt = renderExecutionPrompt("plan", {
    ticket: state.ticket,
    repoContext: state.repoContext.summary,
  });
  const raw = await askAgent(state, prompt);
  const parsed = parseJsonRecord(raw);
  const internalPlan = JSON.stringify(
    {
      summary: parsed.summary ?? "Implement the ticket with minimal changes.",
      filesToEdit: parsed.filesToEdit ?? state.repoContext.selectedFiles,
      risk: parsed.risk ?? "unknown",
      testStrategy: parsed.testStrategy ?? state.repoContext.packageScripts,
    },
    null,
    2,
  );
  await graphEvent(state.executionId, "GRAPH_INTERNAL_PLAN_CREATED", {
    internalPlan,
    promptVersion: prompt.version,
  });
  return { internalPlan };
};

const startAttempt = async (state: GraphState) => {
  if (!state.planTaskId || !state.ticket) {
    throw new Error("Execution graph is missing task context");
  }
  const attemptNumber = state.attemptNumber + 1;
  const attempt = await prisma.taskAttempt.create({
    data: {
      planTaskId: state.planTaskId,
      number: state.attemptOffset + attemptNumber,
      workspaceId: state.executionId,
    },
  });
  await graphEvent(state.executionId, "GRAPH_ATTEMPT_STARTED", {
    attemptId: attempt.id,
    attemptNumber,
    agentMode: state.agentMode,
    promptVersions: promptVersionsFor(state.agentMode),
  });
  return { attempt, attemptNumber, ticket: state.ticket };
};

const implementChange = async (state: GraphState) => {
  const { attempt, attemptNumber, ticket } = await startAttempt(state);

  const raw = await askAgent(
    state,
    renderExecutionPrompt("implement", {
      ticket,
      internalPlan: state.internalPlan || "No internal plan was produced.",
      repoContext:
        state.repoContext?.summary ?? "No repository context was collected.",
      lastFailure: state.lastFailure || "None",
      fileBlockFormat: FILE_BLOCK_FORMAT,
    }),
  );
  const parsed = parseAgentOutput(raw);

  // A malformed reply is a failed attempt the model can correct, not a crash
  // of the whole run. Parsing is pure, so nothing has been written yet.
  const formatError = fileActionsError(raw, parsed.actions);
  if (formatError) {
    await prisma.taskAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        error: `${formatError}\n--- model reply (tail) ---\n${raw.slice(-4000)}`,
        completedAt: new Date(),
      },
    });
    await graphEvent(state.executionId, "GRAPH_OUTPUT_REJECTED", {
      attemptId: attempt.id,
      attemptNumber,
      reason: formatError,
    });
    return {
      attemptNumber,
      attemptId: attempt.id,
      lastFailure: `Your previous reply was rejected: ${formatError}. ${FILE_BLOCK_FORMAT}`,
      route: (attemptNumber < MAX_ATTEMPTS ? "retry" : "blocked") as GraphRoute,
    };
  }

  // Each attempt starts from the base commit, so a retry never builds on a
  // failed attempt's edits (and files it added don't linger).
  if (attemptNumber > 1) await resetWorkspace(state.executionId);
  writeActionsToRoot(
    parsed.actions,
    path.resolve(config.workspaceRoot, state.executionId),
  );

  return {
    attemptNumber,
    attemptId: attempt.id,
    route: "implemented" as GraphRoute,
  };
};

const MAX_EVENT_TEXT_CHARS = 2000;
const MAX_EVENT_PREVIEW_CHARS = 500;

/** Why an attempt ended without a usable change, as feedback for the next one. */
const LOOP_FAILURES: Record<Exclude<AgentStopReason, "done">, string> = {
  blocked: "The agent declined the ticket",
  max_steps: "The agent ran out of steps",
  max_tokens: "The execution's token budget ran out",
  timeout: "The execution's time budget ran out",
  no_finish: "The agent stopped without finishing",
};

/**
 * Tool-loop alternative to implement_change: the agent edits the workspace
 * through sandbox tools until it calls finish or a budget runs out. The
 * policy, verification and review nodes still run after it.
 */
const agentLoop = async (state: GraphState) => {
  const { attempt, attemptNumber, ticket } = await startAttempt(state);
  // Each attempt starts from the base commit, as in single-shot mode.
  if (attemptNumber > 1) await resetWorkspace(state.executionId);

  const execution = await prisma.execution.findUniqueOrThrow({
    where: { id: state.executionId },
    include: { repository: true },
  });
  const ctx = executionToolContext(state.executionId, execution.repository);
  const recorder = prismaToolCallRecorder(attempt.id);
  const prompt = renderExecutionPrompt("agent", {
    ticket,
    internalPlan: state.internalPlan || "No internal plan was produced.",
    repoContext:
      state.repoContext?.summary ?? "No repository context was collected.",
    lastFailure: state.lastFailure || "None",
    checkScripts: ctx.checkScripts.join(", ") || "none",
  });

  await startSandbox(state.executionId);
  let outcome: Awaited<ReturnType<typeof runAgentLoop>>;
  try {
    outcome = await runAgentLoop(
      {
        system: prompt.system,
        task: prompt.user,
        tools: SANDBOX_TOOLS,
        budget: {
          maxSteps: state.maxSteps,
          maxTokens: Math.max(0, state.maxTokens - state.tokensUsed),
          deadline: state.deadline,
        },
      },
      {
        generate: (request) => askAgentWithTools(state, request),
        runTool: (call) => runRecordedTool(ctx, call, recorder),
        // One event per model call; full tool input and output are in ToolCall.
        onStep: (step) =>
          graphEvent(state.executionId, "GRAPH_AGENT_STEP", {
            attemptId: attempt.id,
            attemptNumber,
            step: step.step,
            promptVersion: prompt.version,
            text: step.text.slice(0, MAX_EVENT_TEXT_CHARS),
            usage: step.usage,
            toolCalls: step.toolCalls.map(({ call, outcome: result }) => ({
              name: call.name,
              status: result.status,
              input: JSON.stringify(call.arguments).slice(0, MAX_EVENT_PREVIEW_CHARS),
              output: result.output.slice(0, MAX_EVENT_PREVIEW_CHARS),
            })),
          }),
      },
    );
  } finally {
    await stopSandbox(state.executionId);
  }

  const tokensUsed =
    state.tokensUsed + outcome.usage.inputTokens + outcome.usage.outputTokens;
  await graphEvent(state.executionId, "GRAPH_AGENT_FINISHED", {
    attemptId: attempt.id,
    attemptNumber,
    stopReason: outcome.stopReason,
    summary: outcome.summary.slice(0, MAX_EVENT_TEXT_CHARS),
    steps: outcome.steps,
    usage: outcome.usage,
    tokensUsed,
  });

  let failure: string;
  if (outcome.stopReason === "done") {
    if ((await changedFiles(state.executionId)).length > 0)
      return { attemptNumber, attemptId: attempt.id, tokensUsed, route: "implemented" as GraphRoute };
    failure = `The agent called finish without changing any files: ${outcome.summary}`;
  } else {
    failure = `${LOOP_FAILURES[outcome.stopReason]}: ${outcome.summary}`;
  }
  await prisma.taskAttempt.update({
    where: { id: attempt.id },
    data: { status: "FAILED", error: failure, completedAt: new Date() },
  });
  // A refusal is the agent's decision, and an exhausted execution budget
  // cannot recover; only a per-attempt failure is worth another attempt.
  const final =
    outcome.stopReason === "blocked" ||
    outcome.stopReason === "max_tokens" ||
    outcome.stopReason === "timeout" ||
    attemptNumber >= MAX_ATTEMPTS;
  return {
    attemptNumber,
    attemptId: attempt.id,
    tokensUsed,
    lastFailure: failure,
    route: (final ? "blocked" : "retry") as GraphRoute,
  };
};

const enforceRepositoryPolicy = async (
  state: typeof ExecutionGraphState.State,
) => {
  const execution = await prisma.execution.findUniqueOrThrow({
    where: { id: state.executionId },
    include: { repository: true },
  });
  const files = await changedFiles(state.executionId);
  const violation = checkRepositoryPolicy(
    files,
    execution.repository.executionPolicy as RepositoryPolicy | null,
  );

  if (violation) {
    if (!state.attemptId) throw new Error("Execution graph is missing attempt");
    await prisma.taskAttempt.update({
      where: { id: state.attemptId },
      data: { status: "FAILED", error: violation, completedAt: new Date() },
    });
    await graphEvent(state.executionId, "GRAPH_POLICY_FAILED", {
      attemptId: state.attemptId,
      attemptNumber: state.attemptNumber,
      files,
      reason: violation,
    });
    return {
      lastFailure: violation,
      route: (canRetry(state) ? "retry" : "blocked") as GraphRoute,
    };
  }

  await graphEvent(state.executionId, "GRAPH_POLICY_PASSED", { files });
  return { route: "verify" as GraphRoute };
};

const verifyChange = async (state: typeof ExecutionGraphState.State) => {
  if (!state.attemptId) throw new Error("Execution graph is missing attempt");

  const execution = await prisma.execution.findUniqueOrThrow({
    where: { id: state.executionId },
    include: { repository: true },
  });
  await prisma.execution.update({
    where: { id: state.executionId },
    data: { status: "VERIFYING" },
  });
  const verificationConfig = execution.repository.verificationConfig as {
    scripts?: string[];
  };
  const verification = await verifyWorkspace(
    state.executionId,
    verificationConfig.scripts ?? ["lint", "build", "test"],
  );

  if (!verification.passed) {
    const lastFailure = JSON.stringify(verification.results).slice(-10000);
    await prisma.taskAttempt.update({
      where: { id: state.attemptId },
      data: { status: "FAILED", error: lastFailure, completedAt: new Date() },
    });
    await graphEvent(state.executionId, "GRAPH_VERIFICATION_FAILED", {
      attemptId: state.attemptId,
      attemptNumber: state.attemptNumber,
    });
    return {
      lastFailure,
      verification,
      route: state.attemptNumber < MAX_ATTEMPTS ? "retry" : "blocked",
    };
  }

  await graphEvent(state.executionId, "GRAPH_VERIFICATION_PASSED", {
    attemptId: state.attemptId,
    attemptNumber: state.attemptNumber,
  });
  return { verification, route: "review" };
};

const analyzeFailure = async (state: typeof ExecutionGraphState.State) => {
  const prompt = renderExecutionPrompt("analyze", {
    ticket: state.ticket ?? "",
    internalPlan: state.internalPlan,
    lastFailure: state.lastFailure,
  });
  const raw = await askAgent(state, prompt);
  const parsed = parseJsonRecord(raw);
  const guidance = JSON.stringify(
    {
      summary: parsed.summary ?? "Previous attempt failed.",
      nextAttemptGuidance:
        parsed.nextAttemptGuidance ?? "Make a smaller targeted fix.",
      avoid: parsed.avoid ?? ["Do not modify unrelated files."],
    },
    null,
    2,
  );
  await graphEvent(state.executionId, "GRAPH_FAILURE_ANALYZED", {
    guidance,
    promptVersion: prompt.version,
  });
  return { lastFailure: guidance };
};

const reviewDiff = async (state: typeof ExecutionGraphState.State) => {
  if (!state.attemptId) throw new Error("Execution graph is missing attempt");

  const diff = await gitDiff(state.executionId);
  const files = await changedFiles(state.executionId);
  const deterministicReview = reviewDiffSafety(diff, files);
  if (!deterministicReview.passed) {
    const feedback = deterministicReview.issues.join("\n");
    await prisma.taskAttempt.update({
      where: { id: state.attemptId },
      data: { status: "FAILED", error: feedback, completedAt: new Date() },
    });
    await graphEvent(state.executionId, "GRAPH_DIFF_REVIEW_FAILED", {
      attemptId: state.attemptId,
      issues: deterministicReview.issues,
    });
    return {
      lastFailure: feedback,
      route: canRetry(state) ? "retry" : "blocked",
    };
  }

  const prompt = renderExecutionPrompt("review", {
    ticket: state.ticket ?? "",
    internalPlan: state.internalPlan,
    changedFiles: files.join("\n"),
    diff: diff.slice(0, 80_000),
  });
  const raw = await askAgent(state, prompt);
  const parsed = parseJsonRecord(raw);
  const approved = parsed.approved === true;
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map(String)
    : ["Diff reviewer did not approve the change."];

  if (!approved) {
    const feedback = issues.join("\n");
    await prisma.taskAttempt.update({
      where: { id: state.attemptId },
      data: { status: "FAILED", error: feedback, completedAt: new Date() },
    });
    await graphEvent(state.executionId, "GRAPH_DIFF_REVIEW_FAILED", {
      attemptId: state.attemptId,
      issues,
      promptVersion: prompt.version,
    });
    return {
      lastFailure: feedback,
      route: canRetry(state) ? "retry" : "blocked",
    };
  }

  await graphEvent(state.executionId, "GRAPH_DIFF_REVIEW_PASSED", {
    attemptId: state.attemptId,
    summary: parsed.summary ?? "Diff reviewer approved the change.",
    promptVersion: prompt.version,
  });
  return { route: "artifact" };
};

const blockExecution = async (state: typeof ExecutionGraphState.State) => {
  await prisma.execution.update({
    where: { id: state.executionId },
    data: {
      status: "BLOCKED",
      lastError: state.lastFailure,
      completedAt: new Date(),
    },
  });
  await graphEvent(state.executionId, "GRAPH_BLOCKED", {
    attempts: state.attemptNumber,
  });
  return {};
};

const createDiffArtifact = async (state: typeof ExecutionGraphState.State) => {
  if (!state.attemptId || !state.verification) {
    throw new Error("Execution graph is missing successful attempt evidence");
  }

  const diff = await gitDiff(state.executionId);
  if (!diff.trim()) throw new Error("Agent produced no repository changes");

  await fs.mkdir(config.artifactRoot, { recursive: true });
  const artifactPath = path.resolve(
    config.artifactRoot,
    `${state.executionId}.diff`,
  );
  await fs.writeFile(artifactPath, diff, "utf8");
  const sha256 = hashSnapshot(diff);

  await prisma.$transaction([
    prisma.taskAttempt.update({
      where: { id: state.attemptId },
      data: { status: "COMPLETED", completedAt: new Date() },
    }),
    prisma.artifact.create({
      data: {
        executionId: state.executionId,
        attemptId: state.attemptId,
        type: "DIFF",
        name: "changes.diff",
        storagePath: artifactPath,
        sha256,
        metadata: state.verification as unknown as Prisma.InputJsonObject,
      },
    }),
    prisma.approval.create({
      data: {
        executionId: state.executionId,
        type: "PUBLISH",
        snapshotHash: sha256,
      },
    }),
    prisma.execution.update({
      where: { id: state.executionId },
      data: { status: "AWAITING_PUBLISH_APPROVAL" },
    }),
  ]);
  await graphEvent(state.executionId, "GRAPH_DIFF_ARTIFACT_CREATED", {
    attemptId: state.attemptId,
    sha256,
  });
  return {};
};

const routeAfterVerification = (state: typeof ExecutionGraphState.State) => {
  if (!state.route) throw new Error("Execution graph route was not set");
  return state.route;
};

/** The node that makes the change: one model call, or the agent loop. */
const implementNode = (state: GraphState) =>
  state.agentMode === "tool_loop" ? "agent_loop" : "implement_change";

const routeAfterFailure = (state: GraphState) =>
  canRetry(state) ? implementNode(state) : "blocked";

const graph = new StateGraph(ExecutionGraphState)
  .addNode("load_context", loadExecutionContext)
  .addNode("inspect_repo", inspectRepository)
  .addNode("plan_change", planChange)
  .addNode("implement_change", implementChange)
  .addNode("agent_loop", agentLoop)
  .addNode("enforce_policy", enforceRepositoryPolicy)
  .addNode("verify_change", verifyChange)
  .addNode("analyze_failure", analyzeFailure)
  .addNode("review_diff", reviewDiff)
  .addNode("block_execution", blockExecution)
  .addNode("create_diff_artifact", createDiffArtifact)
  .addEdge(START, "load_context")
  .addEdge("load_context", "inspect_repo")
  .addEdge("inspect_repo", "plan_change")
  .addConditionalEdges("plan_change", implementNode, {
    implement_change: "implement_change",
    agent_loop: "agent_loop",
  })
  .addConditionalEdges("implement_change", routeAfterVerification, {
    implemented: "enforce_policy",
    retry: "implement_change",
    blocked: "block_execution",
  })
  .addConditionalEdges("agent_loop", routeAfterVerification, {
    implemented: "enforce_policy",
    retry: "agent_loop",
    blocked: "block_execution",
  })
  .addConditionalEdges("enforce_policy", routeAfterVerification, {
    verify: "verify_change",
    retry: "analyze_failure",
    blocked: "block_execution",
  })
  .addConditionalEdges("verify_change", routeAfterVerification, {
    retry: "analyze_failure",
    blocked: "block_execution",
    review: "review_diff",
  })
  .addConditionalEdges("review_diff", routeAfterVerification, {
    retry: "analyze_failure",
    blocked: "block_execution",
    artifact: "create_diff_artifact",
  })
  .addConditionalEdges("analyze_failure", routeAfterFailure, {
    implement_change: "implement_change",
    agent_loop: "agent_loop",
    blocked: "block_execution",
  })
  .addEdge("block_execution", END)
  .addEdge("create_diff_artifact", END)
  .compile();

export const runExecutionGraph = async (executionId: string) => {
  try {
    await graph.invoke({ executionId });
  } finally {
    // The approved diff is stored under ARTIFACT_ROOT and publishing uses a
    // fresh clone, so the verification workspace is not needed afterwards.
    // A retried run re-clones from scratch.
    if (!config.keepWorkspaces) await removeWorkspace(executionId);
  }
};
