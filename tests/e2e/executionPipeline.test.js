// Execution pipeline, end to end against real services:
// Trello card -> sync -> plan -> plan approval -> Docker run + LLM -> diff ->
// publish approval -> GitHub draft PR -> Trello comment.
//
// The SERVER needs GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY, ENCRYPTION_KEY and
// Docker Desktop running. This suite needs the E2E_* variables below. Use a
// throwaway repository: a successful run pushes a branch and opens a draft PR
// (both removed in cleanup when E2E_GITHUB_TOKEN is set).
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, describe } = require("node:test");

const { api, assertServerHealthy, env, envInt, external, poll, runId, skipUnless, steps } = require("./helpers");

const REQUIRED = [
  "E2E_LLM_PROVIDER",
  "E2E_LLM_MODEL",
  "E2E_LLM_API_KEY",
  "E2E_TRELLO_API_KEY",
  "E2E_TRELLO_TOKEN",
  "E2E_TRELLO_BOARD_ID",
  "E2E_TRELLO_LIST_ID",
  "E2E_TRELLO_LABEL",
  "E2E_GITHUB_OWNER",
  "E2E_GITHUB_REPO",
  "E2E_GITHUB_INSTALLATION_ID",
];
const PLAN_TIMEOUT_MS = envInt("E2E_PLAN_TIMEOUT_MS", 120_000);
const RUN_TIMEOUT_MS = envInt("E2E_RUN_TIMEOUT_MS", 1_200_000);
const PUBLISH_TIMEOUT_MS = envInt("E2E_PUBLISH_TIMEOUT_MS", 300_000);
const FAILED_STATES = ["BLOCKED", "FAILED", "CANCELED"];

const trello = (method, path, query = {}) =>
  external(method, `https://api.trello.com/1${path}`, {
    query: { ...query, key: env("E2E_TRELLO_API_KEY"), token: env("E2E_TRELLO_TOKEN") },
  });

const github = (method, path, body) =>
  external(method, `https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${env("E2E_GITHUB_TOKEN")}`,
      "x-github-api-version": "2022-11-28",
    },
    body,
  });

const getExecution = async (executionId) =>
  (await api("GET", `/api/executions/${executionId}`, { expectStatus: 200 })).data;

const pendingApproval = (execution, type) =>
  execution.approvals.find((approval) => approval.type === type && approval.status === "PENDING");

/** Waits for `target`, failing fast with the error and recent events if the execution dies. */
const waitForStatus = (executionId, target, timeoutMs) =>
  poll(
    `execution ${executionId} to reach ${target}`,
    async (seen) => {
      const execution = await getExecution(executionId);
      seen({ status: execution.status, lastError: execution.lastError });
      if (execution.status === target) return execution;
      if (FAILED_STATES.includes(execution.status)) {
        const events = execution.events.slice(-8).map((event) => event.type).join(" -> ");
        throw new Error(
          `Execution ${executionId} reached ${execution.status} while waiting for ${target}.\n` +
            `lastError: ${execution.lastError ?? "none"}\nrecent events: ${events}`,
        );
      }
      return undefined;
    },
    { timeoutMs },
  );

/** Reuses the long-lived e2e project/agent/repository/integration so runs don't pile up rows. */
const ensureFixtures = async () => {
  const projectName = "e2e-execution-pipeline";
  const { data: projects } = await api("GET", "/api/projects", { expectStatus: 200 });
  const project =
    projects.find((candidate) => candidate.name === projectName) ??
    (await api("POST", "/api/projects", { body: { name: projectName }, expectStatus: 201 })).data;

  // The run step uses the project's first agent, so keep exactly one and refresh its key.
  const agentBody = {
    name: "e2e-implementer",
    provider: env("E2E_LLM_PROVIDER"),
    model: env("E2E_LLM_MODEL"),
    config: { apiKey: env("E2E_LLM_API_KEY") },
  };
  const { data: agents } = await api("GET", "/api/agents", { expectStatus: 200 });
  const agent = agents.find((candidate) => candidate.projectId === project.id);
  if (agent) await api("PUT", `/api/agents/${agent.id}`, { body: agentBody, expectStatus: 200 });
  else await api("POST", "/api/agents", { body: { ...agentBody, projectId: project.id }, expectStatus: 201 });

  // Repositories are unique by owner/name, so reuse one if it already exists.
  const owner = env("E2E_GITHUB_OWNER");
  const name = env("E2E_GITHUB_REPO");
  const { data: repositories } = await api("GET", "/api/repositories", { expectStatus: 200 });
  const repository =
    repositories.find((candidate) => candidate.owner === owner && candidate.name === name) ??
    (
      await api("POST", "/api/repositories", {
        body: {
          projectId: project.id,
          owner,
          name,
          defaultBranch: env("E2E_GITHUB_DEFAULT_BRANCH", "main"),
          githubInstallationId: env("E2E_GITHUB_INSTALLATION_ID"),
          verificationConfig: { scripts: env("E2E_VERIFY_SCRIPTS", "test").split(",").map((s) => s.trim()) },
          executionPolicy: { maxChangedFiles: 5 },
        },
        expectStatus: 201,
      })
    ).data;

  // Integration configs are encrypted and have no update endpoint, so the name
  // carries a hash of the config: changing any E2E_TRELLO_* value creates a new one.
  const trelloConfig = {
    apiKey: env("E2E_TRELLO_API_KEY"),
    token: env("E2E_TRELLO_TOKEN"),
    boardId: env("E2E_TRELLO_BOARD_ID"),
    eligibleLabel: env("E2E_TRELLO_LABEL"),
    repositoryId: repository.id,
  };
  const integrationName = `e2e-trello-${crypto.createHash("sha256").update(JSON.stringify(trelloConfig)).digest("hex").slice(0, 12)}`;
  const { data: integrations } = await api("GET", `/api/integrations?projectId=${project.id}`, { expectStatus: 200 });
  const integration =
    integrations.find((candidate) => candidate.name === integrationName) ??
    (
      await api("POST", "/api/integrations", {
        body: { projectId: project.id, type: "TRELLO", name: integrationName, config: trelloConfig },
        expectStatus: 201,
      })
    ).data;

  return { project, repository, integration };
};

describe("execution pipeline (Trello -> GitHub draft PR)", { skip: skipUnless(REQUIRED) }, () => {
  const id = runId();
  const step = steps();
  const state = {};

  before(assertServerHealthy);

  after(async () => {
    if (env("E2E_KEEP_RESOURCES") === "true") return;
    const problems = [];
    if (state.cardId)
      await trello("DELETE", `/cards/${state.cardId}`).catch((error) => problems.push(error.message));
    if (state.branch && env("E2E_GITHUB_TOKEN")) {
      const repoPath = `/repos/${env("E2E_GITHUB_OWNER")}/${env("E2E_GITHUB_REPO")}`;
      if (state.prNumber)
        await github("PATCH", `${repoPath}/pulls/${state.prNumber}`, { state: "closed" }).catch((error) =>
          problems.push(error.message),
        );
      await github("DELETE", `${repoPath}/git/refs/heads/${state.branch}`).catch((error) =>
        problems.push(error.message),
      );
    } else if (state.prUrl) {
      console.log(`# E2E_GITHUB_TOKEN not set: close ${state.prUrl} and delete branch ${state.branch} manually`);
    }
    if (problems.length) console.log(`# cleanup problems:\n#   ${problems.join("\n#   ")}`);
  });

  step("sets up project, agent, repository and Trello integration", async () => {
    Object.assign(state, await ensureFixtures());
  });

  step("creates a labelled Trello card", async () => {
    const labels = await trello("GET", `/boards/${env("E2E_TRELLO_BOARD_ID")}/labels`);
    const label = labels.find((candidate) => candidate.name.toLowerCase() === env("E2E_TRELLO_LABEL").toLowerCase());
    assert.ok(label, `label "${env("E2E_TRELLO_LABEL")}" does not exist on the board`);

    const card = await trello("POST", "/cards", {
      idList: env("E2E_TRELLO_LIST_ID"),
      idLabels: label.id,
      name: `[${id}] ${env("E2E_TICKET_TITLE", "Add an end-to-end marker to the README")}`,
      desc: env(
        "E2E_TICKET_DESCRIPTION",
        `Append a single line "E2E run ${id}" to the end of README.md. Change nothing else.`,
      ),
    });
    state.cardId = card.id;
  });

  step("sync ingests the card and creates an execution", async (t) => {
    const { data } = await api("POST", `/api/integrations/${state.integration.id}/sync`, { expectStatus: 200 });
    assert.ok(data.ingested >= 1, `expected the new card to be ingested, got ${JSON.stringify(data)}`);

    const { data: workItems } = await api("GET", `/api/work-items?projectId=${state.project.id}`, { expectStatus: 200 });
    const workItem = workItems.find((candidate) => candidate.externalId === state.cardId);
    assert.ok(workItem, "work item for the new card not found");

    const { data: detail } = await api("GET", `/api/work-items/${workItem.id}`, { expectStatus: 200 });
    assert.equal(detail.executions.length, 1, "exactly one execution per card revision");
    state.executionId = detail.executions[0].id;
    t.diagnostic(`execution ${state.executionId}`);

    // Re-syncing the same revision must not create a second execution.
    await api("POST", `/api/integrations/${state.integration.id}/sync`, { expectStatus: 200 });
    const { data: again } = await api("GET", `/api/work-items/${workItem.id}`, { expectStatus: 200 });
    assert.equal(again.executions.length, 1, "re-sync created a duplicate execution");
  });

  step(
    "planner produces a plan awaiting approval",
    async () => {
      const execution = await waitForStatus(state.executionId, "AWAITING_PLAN_APPROVAL", PLAN_TIMEOUT_MS);
      state.planHash = pendingApproval(execution, "PLAN")?.snapshotHash;
      assert.match(state.planHash ?? "", /^[a-f0-9]{64}$/, "pending PLAN approval with a snapshotHash");
    },
    { timeout: PLAN_TIMEOUT_MS + 30_000 },
  );

  step("plan approval rejects a stale snapshotHash", async () => {
    await api("POST", `/api/executions/${state.executionId}/approvals/plan`, {
      body: { approved: true, snapshotHash: "0".repeat(64) },
      expectStatus: 409,
    });
  });

  step("plan approval with the current snapshotHash queues the run", async () => {
    const { data } = await api("POST", `/api/executions/${state.executionId}/approvals/plan`, {
      body: { approved: true, snapshotHash: state.planHash, comment: `e2e ${id}` },
      expectStatus: 200,
    });
    assert.equal(data.status, "APPROVED");
  });

  step(
    "run produces a verified diff awaiting publish approval",
    async () => {
      const execution = await waitForStatus(state.executionId, "AWAITING_PUBLISH_APPROVAL", RUN_TIMEOUT_MS);
      const diff = execution.artifacts.find((artifact) => artifact.type === "DIFF");
      assert.ok(diff, "DIFF artifact recorded");
      state.publishHash = pendingApproval(execution, "PUBLISH")?.snapshotHash;
      assert.equal(state.publishHash, diff.sha256, "publish approval is bound to the diff artifact hash");
    },
    { timeout: RUN_TIMEOUT_MS + 30_000 },
  );

  step(
    "publish approval opens a draft PR and comments on the card",
    async (t) => {
      if (env("E2E_PUBLISH", "true") === "false") {
        await api("POST", `/api/executions/${state.executionId}/approvals/publish`, {
          body: { approved: false, snapshotHash: state.publishHash, comment: "E2E_PUBLISH=false" },
          expectStatus: 200,
        });
        assert.equal((await getExecution(state.executionId)).status, "CANCELED");
        t.diagnostic("E2E_PUBLISH=false: rejected publish instead of opening a PR");
        return;
      }

      await api("POST", `/api/executions/${state.executionId}/approvals/publish`, {
        body: { approved: true, snapshotHash: state.publishHash, comment: `e2e ${id}` },
        expectStatus: 200,
      });
      state.branch = `agent/${state.executionId}`;
      const execution = await waitForStatus(state.executionId, "COMPLETED", PUBLISH_TIMEOUT_MS);
      assert.equal(execution.branchName, state.branch);

      const pr = execution.artifacts.find((artifact) => artifact.type === "PULL_REQUEST");
      assert.ok(pr?.metadata?.html_url, "PULL_REQUEST artifact with a URL");
      state.prUrl = pr.metadata.html_url;
      state.prNumber = pr.metadata.number;
      t.diagnostic(`draft PR ${state.prUrl}`);

      if (env("E2E_GITHUB_TOKEN")) {
        const remote = await github("GET", `/repos/${env("E2E_GITHUB_OWNER")}/${env("E2E_GITHUB_REPO")}/pulls/${state.prNumber}`);
        assert.equal(remote.draft, true, "PR must be a draft");
        assert.equal(remote.head.ref, state.branch);
      }

      // The tracker comment is posted right after COMPLETED; allow a short lag.
      await poll(
        "the PR link comment on the Trello card",
        async () => {
          const comments = await trello("GET", `/cards/${state.cardId}/actions`, { filter: "commentCard" });
          return comments.some((action) => action.data?.text?.includes(state.prUrl)) ? true : undefined;
        },
        { timeoutMs: 60_000 },
      );
    },
    { timeout: PUBLISH_TIMEOUT_MS + 120_000 },
  );
});
