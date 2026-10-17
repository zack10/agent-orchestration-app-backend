const assert = require("node:assert/strict");
const test = require("node:test");

const { parseAgentOutput } = require("../dist/utils/llmUtils");

test("parses the structured agent output contract", () => {
  const output = parseAgentOutput(
    JSON.stringify({
      summary: "Implemented the task",
      actions: "",
      contextUpdates: { completed: true },
      status: "COMPLETED",
    }),
  );
  assert.equal(output.thinking, "Implemented the task");
  assert.equal(output.status, "COMPLETED");
  assert.deepEqual(JSON.parse(output.contextUpdates), { completed: true });
});

test("fails closed when status is invalid", () => {
  const output = parseAgentOutput('{"status":"maybe"}');
  assert.equal(output.status, "FAILED");
});
