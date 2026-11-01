const assert = require("node:assert/strict");
const test = require("node:test");

const { triageDecision } = require("../dist/services/agentGraph/executionGraph");

test("triage proceeds, declines, or asks only with a question", () => {
  assert.equal(triageDecision({ decision: "proceed", reason: "ok" }).decision, "proceed");
  assert.equal(triageDecision({ decision: "decline", reason: "needs a key" }).decision, "decline");
  assert.deepEqual(triageDecision({ decision: "ask", reason: "two readings", question: " (a) or (b)? " }), {
    decision: "ask",
    reason: "two readings",
    question: "(a) or (b)?",
  });
  assert.equal(triageDecision({ decision: "ask", reason: "two readings", question: "  " }).decision, "proceed");
  assert.equal(triageDecision({}).decision, "proceed", "an unclear reply proceeds");
});
