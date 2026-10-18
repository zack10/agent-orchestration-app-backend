// Task pipeline: POST /api/tasks -> RabbitMQ -> agentRunner -> real LLM call.
// Needs one LLM provider key. Costs a single small LLM request per run.
const assert = require("node:assert/strict");
const { before, describe } = require("node:test");

const { api, assertServerHealthy, env, envInt, poll, runId, skipUnless, steps } = require("./helpers");

const REQUIRED = ["E2E_LLM_PROVIDER", "E2E_LLM_MODEL", "E2E_LLM_API_KEY"];
const TIMEOUT_MS = envInt("E2E_TASK_TIMEOUT_MS", 180_000);

describe("task pipeline", { skip: skipUnless(REQUIRED) }, () => {
  const id = runId();
  const step = steps();
  const state = {};

  before(assertServerHealthy);

  step("creates a project and an agent whose API key is redacted", async () => {
    const { data: project } = await api("POST", "/api/projects", {
      body: { name: `${id}-tasks` },
      expectStatus: 201,
    });
    state.projectId = project.id;

    const { data: agent } = await api("POST", "/api/agents", {
      body: {
        name: `${id}-agent`,
        projectId: project.id,
        provider: env("E2E_LLM_PROVIDER"),
        model: env("E2E_LLM_MODEL"),
        config: { apiKey: env("E2E_LLM_API_KEY") },
      },
      expectStatus: 201,
    });
    state.agentId = agent.id;
    assert.equal(JSON.stringify(agent).includes(env("E2E_LLM_API_KEY")), false, "API key leaked in response");
  });

  step("accepts a task and honours Idempotency-Key", async () => {
    const request = {
      headers: { "idempotency-key": `${id}-task` },
      body: {
        agentId: state.agentId,
        payload: {
          instruction:
            "This is an automated end-to-end check. Reply with a one-sentence summary, no file actions, and status COMPLETED.",
        },
      },
    };
    const { data: task } = await api("POST", "/api/tasks", { ...request, expectStatus: 202 });
    state.taskId = task.id;

    const { data: replay } = await api("POST", "/api/tasks", { ...request, expectStatus: 200 });
    assert.equal(replay.id, task.id, "replay with the same Idempotency-Key must return the same task");
  });

  step(
    "worker runs the task to COMPLETED",
    async () => {
      const task = await poll(
        `task ${state.taskId} to finish`,
        async (seen) => {
          const { data } = await api("GET", `/api/tasks/${state.taskId}`, { expectStatus: 200 });
          seen({ status: data.status, attemptCount: data.attemptCount, lastError: data.lastError });
          return ["COMPLETED", "FAILED"].includes(data.status) ? data : undefined;
        },
        { timeoutMs: TIMEOUT_MS },
      );
      assert.equal(task.status, "COMPLETED", `task failed: ${task.lastError}`);
      assert.ok(task.result, "completed task has a result");
      assert.ok(task.attemptCount >= 1);
      assert.equal(JSON.stringify(task).includes(env("E2E_LLM_API_KEY")), false, "API key leaked in task response");
    },
    { timeout: TIMEOUT_MS + 30_000 },
  );
});
