import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Prisma } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config";
import prisma from "../../db";
import { getBaseSha, getInstallationToken } from "../../integrations/githubApp";
import { writeActionsToRoot } from "../../utils/codeWriter";
import { decrypt } from "../../utils/crypto";
import { NonRetryableError } from "../../utils/safeError";
import { parseAgentOutput } from "../../utils/llmUtils";
import { hashSnapshot } from "../executionService";
import { LLMService } from "../llm/LLMService";
import {
  changedFiles,
  cloneGithubWorkspace,
  gitDiff,
  verifyWorkspace,
  workspacePath,
} from "../workspaceService";
import { reviewDiffSafety } from "./diffReview";
import { RepoContext, collectRepoContext } from "./repoContext";

const llm = new LLMService();
const MAX_ATTEMPTS = 3;

type VerificationResult = Awaited<ReturnType<typeof verifyWorkspace>>;
type GraphRoute =
  | "retry"
  | "blocked"
  | "review"
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
  prompt: Annotation<string | undefined>(),
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
});

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
  await graphEvent(execution.id, "GRAPH_CONTEXT_LOADED", {
    repositoryId: execution.repositoryId,
    workItemId: execution.workItemId,
    planTaskId: planTask.id,
  });

  const agentConfig = agent.config as { apiKey?: string } | null;
  const agentApiKey = agentConfig?.apiKey
    ? decrypt(agentConfig.apiKey)
    : undefined;

  return {
    baseSha,
    githubToken,
    planTaskId: planTask.id,
    attemptOffset: previousAttempts._max.number ?? 0,
    agentProvider: agent.provider || "gemini",
    agentModel: agent.model || "gemini-flash-latest",
    agentApiKey,
    ticket: `${execution.workItem.title}\n${execution.workItem.description ?? ""}`,
    prompt: `Fix this Node/TypeScript bug in the checked-out repository. Ticket: ${execution.workItem.title}\n${execution.workItem.description ?? ""}\nReturn the required JSON output with FILE actions only. Do not change unrelated files.`,
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
  const raw = await llm.generateContent(
    state.agentProvider || "gemini",
    state.agentModel || "gemini-flash-latest",
    {
      user: `Create a concise internal implementation plan for this repository change. Do not write code yet.

Ticket:
${state.ticket}

Repository context:
${state.repoContext.summary}

Return JSON only:
{
  "summary": "short plan",
  "filesToEdit": ["relative/path.ts"],
  "risk": "low|medium|high",
  "testStrategy": ["script or check"]
}`,
    },
    state.agentApiKey,
  );
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
  });
  return { internalPlan };
};

const implementChange = async (state: typeof ExecutionGraphState.State) => {
  if (!state.planTaskId || !state.prompt) {
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
  });

  const raw = await llm.generateContent(
    state.agentProvider || "gemini",
    state.agentModel || "gemini-flash-latest",
    {
      user: `${state.prompt}

Internal implementation plan:
${state.internalPlan || "No internal plan was produced."}

Repository context:
${state.repoContext?.summary ?? "No repository context was collected."}

Previous failure or review feedback:
${state.lastFailure || "None"}

Return JSON with an "actions" string containing FILE blocks only.`,
    },
    state.agentApiKey,
  );
  const parsed = parseAgentOutput(raw);
  writeActionsToRoot(
    parsed.actions,
    path.resolve(config.workspaceRoot, state.executionId),
  );

  return { attemptNumber, attemptId: attempt.id };
};

const enforceRepositoryPolicy = async (
  state: typeof ExecutionGraphState.State,
) => {
  const execution = await prisma.execution.findUniqueOrThrow({
    where: { id: state.executionId },
    include: { repository: true },
  });
  const files = await changedFiles(state.executionId);
  const policy = execution.repository.executionPolicy as {
    maxChangedFiles?: number;
    protectedPaths?: string[];
  };
  const protectedPaths = policy.protectedPaths ?? [
    "package.json",
    "package-lock.json",
    ".github",
  ];

  if (files.length > (policy.maxChangedFiles ?? 20)) {
    throw new NonRetryableError("Change exceeds repository file-count policy");
  }
  if (
    files.some((file) =>
      protectedPaths.some(
        (protectedPath) =>
          file === protectedPath || file.startsWith(`${protectedPath}/`),
      ),
    )
  ) {
    throw new NonRetryableError("Change modifies a protected repository path");
  }

  await graphEvent(state.executionId, "GRAPH_POLICY_PASSED", { files });
  return {};
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
  const raw = await llm.generateContent(
    state.agentProvider || "gemini",
    state.agentModel || "gemini-flash-latest",
    {
      user: `Analyze this failed automated coding attempt and produce concise retry guidance.

Ticket:
${state.ticket ?? ""}

Internal plan:
${state.internalPlan}

Failure or review feedback:
${state.lastFailure}

Return JSON only:
{
  "summary": "what failed",
  "nextAttemptGuidance": "specific changes the next attempt should make",
  "avoid": ["things to avoid"]
}`,
    },
    state.agentApiKey,
  );
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
  await graphEvent(state.executionId, "GRAPH_FAILURE_ANALYZED", { guidance });
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

  const raw = await llm.generateContent(
    state.agentProvider || "gemini",
    state.agentModel || "gemini-flash-latest",
    {
      user: `Review this diff before it is sent for human publish approval.

Ticket:
${state.ticket ?? ""}

Internal plan:
${state.internalPlan}

Changed files:
${files.join("\n")}

Diff:
${diff.slice(0, 80_000)}

Return JSON only:
{
  "approved": true,
  "issues": [],
  "summary": "short review summary"
}

Reject if the diff does not address the ticket, changes unrelated files, adds secrets, or is unsafe.`,
    },
    state.agentApiKey,
  );
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
    });
    return {
      lastFailure: feedback,
      route: canRetry(state) ? "retry" : "blocked",
    };
  }

  await graphEvent(state.executionId, "GRAPH_DIFF_REVIEW_PASSED", {
    attemptId: state.attemptId,
    summary: parsed.summary ?? "Diff reviewer approved the change.",
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

const routeAfterFailure = (state: typeof ExecutionGraphState.State) =>
  canRetry(state) ? "retry" : "blocked";

const graph = new StateGraph(ExecutionGraphState)
  .addNode("load_context", loadExecutionContext)
  .addNode("inspect_repo", inspectRepository)
  .addNode("plan_change", planChange)
  .addNode("implement_change", implementChange)
  .addNode("enforce_policy", enforceRepositoryPolicy)
  .addNode("verify_change", verifyChange)
  .addNode("analyze_failure", analyzeFailure)
  .addNode("review_diff", reviewDiff)
  .addNode("block_execution", blockExecution)
  .addNode("create_diff_artifact", createDiffArtifact)
  .addEdge(START, "load_context")
  .addEdge("load_context", "inspect_repo")
  .addEdge("inspect_repo", "plan_change")
  .addEdge("plan_change", "implement_change")
  .addEdge("implement_change", "enforce_policy")
  .addEdge("enforce_policy", "verify_change")
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
    retry: "implement_change",
    blocked: "block_execution",
  })
  .addEdge("block_execution", END)
  .addEdge("create_diff_artifact", END)
  .compile();

export const runExecutionGraph = async (executionId: string) => {
  await graph.invoke({ executionId });
};
