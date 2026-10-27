const assert = require("node:assert/strict");
const test = require("node:test");

const { compactMessages, runAgentLoop } = require("../dist/services/agentGraph/agentLoop");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { renderExecutionPrompt } = require("../dist/prompts");
const { collectRepoContext } = require("../dist/services/agentGraph/repoContext");

/** A model that replies with the scripted turns in order and records each request. */
const scriptedModel = (turns, usage = { inputTokens: 100, outputTokens: 10 }) => {
  const requests = [];
  let index = 0;
  const generate = async (request) => {
    requests.push(structuredClone(request));
    const script = turns[Math.min(index++, turns.length - 1)];
    const toolCalls = (script.calls ?? []).map(([name, args], i) => ({ id: `c${index}-${i}`, name, arguments: args }));
    return {
      message: { role: "assistant", content: script.text ?? "", toolCalls },
      text: script.text ?? "",
      toolCalls,
      stopReason: toolCalls.length ? "tool_use" : "end_turn",
      usage,
    };
  };
  return { generate, requests };
};

/** Tools that echo their input; finish behaves like the real tool. */
const fakeTools = () => {
  const ran = [];
  const runTool = async (call) => {
    ran.push(call.name);
    if (call.name === "finish") return { status: "COMPLETED", output: "Finished.", finish: call.arguments };
    if (call.name === "edit_file" && call.arguments.path === "package.json")
      return { status: "DENIED", output: "protected" };
    return { status: "COMPLETED", output: `${call.name} ok` };
  };
  return { runTool, ran };
};

const budget = (overrides = {}) => ({ maxSteps: 10, maxTokens: 100_000, deadline: Date.now() + 60_000, ...overrides });
const input = (overrides = {}) => ({ system: "sys", task: "Fix the bug", tools: [], budget: budget(), ...overrides });

test("runs tools, feeds results back and stops when the agent finishes", async () => {
  const model = scriptedModel([
    { calls: [["read_file", { path: "src/a.js" }]] },
    { calls: [["edit_file", { path: "src/a.js", oldText: "-", newText: "+" }], ["run_check", { script: "test" }]] },
    { calls: [["finish", { status: "done", summary: "Fixed the sign." }]] },
  ]);
  const tools = fakeTools();
  const steps = [];
  const result = await runAgentLoop(input(), { ...model, ...tools, onStep: async (step) => steps.push(step) });

  assert.equal(result.stopReason, "done");
  assert.equal(result.summary, "Fixed the sign.");
  assert.equal(result.steps, 3);
  assert.deepEqual(result.usage, { inputTokens: 300, outputTokens: 30 });
  assert.deepEqual(tools.ran, ["read_file", "edit_file", "run_check", "finish"]);

  // The third request carries the whole conversation: task, both turns and every result in order.
  const third = model.requests[2].messages;
  assert.deepEqual(third.map((m) => m.role), ["user", "assistant", "tool", "assistant", "tool", "tool"]);
  assert.equal(third[2].content, "read_file ok");
  assert.equal(third[5].toolCallId, "c2-1");
  assert.deepEqual(steps.map((s) => s.toolCalls.map((t) => t.call.name)), [["read_file"], ["edit_file", "run_check"], ["finish"]]);
});

test("a denied call is returned to the model as an error result", async () => {
  const model = scriptedModel([
    { calls: [["edit_file", { path: "package.json", oldText: "a", newText: "b" }]] },
    { calls: [["finish", { status: "done", summary: "ok" }]] },
  ]);
  await runAgentLoop(input(), { ...model, ...fakeTools() });
  const result = model.requests[1].messages[2];
  assert.equal(result.isError, true);
  assert.equal(result.content, "protected");
});

test("the agent can decline the ticket", async () => {
  const model = scriptedModel([{ calls: [["finish", { status: "blocked", summary: "Sends data to an unknown host." }]] }]);
  const result = await runAgentLoop(input(), { ...model, ...fakeTools() });
  assert.equal(result.stopReason, "blocked");
  assert.equal(result.summary, "Sends data to an unknown host.");
});

test("calls after finish in the same turn are not run", async () => {
  const model = scriptedModel([
    { calls: [["finish", { status: "done", summary: "ok" }], ["edit_file", { path: "x", oldText: "", newText: "y" }]] },
  ]);
  const tools = fakeTools();
  await runAgentLoop(input(), { ...model, ...tools });
  assert.deepEqual(tools.ran, ["finish"]);
});

test("the step budget ends the loop before another model call", async () => {
  const model = scriptedModel([{ calls: [["list_files", {}]] }]);
  const result = await runAgentLoop(input({ budget: budget({ maxSteps: 3 }) }), { ...model, ...fakeTools() });
  assert.equal(result.stopReason, "max_steps");
  assert.equal(result.steps, 3);
  assert.equal(model.requests.length, 3);
  assert.match(result.summary, /3 steps/);
});

test("the token budget counts input and output tokens", async () => {
  const model = scriptedModel([{ calls: [["list_files", {}]] }], { inputTokens: 400, outputTokens: 100 });
  const result = await runAgentLoop(input({ budget: budget({ maxTokens: 1200 }) }), { ...model, ...fakeTools() });
  assert.equal(result.stopReason, "max_tokens");
  assert.equal(model.requests.length, 3, "500 + 500 is under budget, 1500 is not");
  assert.deepEqual(result.usage, { inputTokens: 1200, outputTokens: 300 });
});

test("the time budget is checked before each model call", async () => {
  let clock = 0;
  const model = scriptedModel([{ calls: [["list_files", {}]] }]);
  const tools = fakeTools();
  const runTool = async (call) => {
    clock += 40;
    return tools.runTool(call);
  };
  const result = await runAgentLoop(input({ budget: budget({ deadline: 100 }) }), {
    ...model,
    runTool,
    now: () => clock,
  });
  assert.equal(result.stopReason, "timeout");
  assert.equal(model.requests.length, 3, "calls start at t=0, 40 and 80; the one at 120 does not");
});

test("a reply without tool calls gets a reminder, then the loop gives up", async () => {
  const model = scriptedModel([{ text: "The fix is to change - to +." }]);
  const result = await runAgentLoop(input(), { ...model, ...fakeTools() });
  assert.equal(result.stopReason, "no_finish");
  assert.equal(model.requests.length, 3, "first reply plus two reminders");
  assert.match(model.requests[1].messages.at(-1).content, /call finish/);

  const recovered = scriptedModel([{ text: "Let me think." }, { calls: [["finish", { status: "done", summary: "ok" }]] }]);
  assert.equal((await runAgentLoop(input(), { ...recovered, ...fakeTools() })).stopReason, "done");
});

test("old tool output is shortened, recent output and pairing are kept", () => {
  const long = (name) => `${name} header\n${"x".repeat(1000)}`;
  const messages = [{ role: "user", content: "task" }];
  for (let i = 0; i < 4; i++) {
    messages.push({ role: "assistant", content: "", toolCalls: [{ id: `t${i}`, name: "read_file", arguments: {} }], raw: { provider: "p", content: [i] } });
    messages.push({ role: "tool", toolCallId: `t${i}`, name: "read_file", content: long(`file${i}`) });
  }
  messages.push({ role: "tool", toolCallId: "short", name: "run_check", content: "short output" });

  const compacted = compactMessages(messages, 3);
  assert.equal(compacted.length, messages.length, "nothing is removed");
  assert.match(compacted[2].content, /^file0 header\n\[older read_file output removed/);
  assert.match(compacted[4].content, /removed/);
  assert.equal(compacted[6].content, long("file2"), "the three most recent results stay whole");
  assert.equal(compacted[9].content, "short output");
  assert.equal(compacted[2].toolCallId, "t0");
  assert.deepEqual(compacted[1].raw, { provider: "p", content: [0] }, "assistant turns keep their raw reply");
  assert.equal(messages[2].content, long("file0"), "the input is not modified");
});

test("the agent prompt gets the environment and keeps ticket text out of the system prompt", () => {
  const prompt = renderExecutionPrompt("agent", {
    ticket: "Fix total\nRounding is off",
    environment: "Image: example/image:1\nChecks:\n- test: make test",
    internalPlan: "plan",
    repoOverview: "Repository file tree sample:\nsrc/a.js",
    lastFailure: "None",
  });
  assert.equal(prompt.version, "agent.v3");
  assert.match(prompt.user, /Repository overview:\nRepository file tree sample/);
  assert.match(prompt.user, /Repository environment:\nImage: example\/image:1\nChecks:\n- test: make test/);
  assert.match(prompt.system, /run_command/);
  assert.match(prompt.system, /status "blocked"/);
  assert.match(prompt.user, /Rounding is off/);
  assert.doesNotMatch(prompt.system, /Rounding is off/);
});

test("the repository overview lists relevant files without their contents", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-overview-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/pagination.js"), "const SECRET_BODY = 1;\n");
  fs.writeFileSync(path.join(root, "package.json"), '{ "scripts": { "test": "node --test" } }');

  const context = await collectRepoContext(root, "paginate skips the first page in pagination.js", { language: "JavaScript/TypeScript (Node)", checks: { test: ["npm", "run", "test"] } });
  assert.match(context.summary, /SECRET_BODY/, "single-shot mode still gets the contents");
  assert.doesNotMatch(context.overview, /SECRET_BODY/);
  assert.match(context.overview, /Files that look relevant to the ticket: .*src\/pagination\.js/);
  assert.match(context.overview, /Checks: test/);
});
