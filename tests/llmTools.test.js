const assert = require("node:assert/strict");
const test = require("node:test");
const axios = require("axios");

const { ProviderRegistry, parseProviderProfiles } = require("../dist/services/llm/registry");
const { LLMService } = require("../dist/services/llm/LLMService");

// The same tool and conversation run through every provider.
const readFile = {
  name: "read_file",
  description: "Read a file from the repository",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Relative path" } },
    required: ["path"],
  },
};
const ask = { role: "user", content: "What does src/a.js export?" };

const registry = new ProviderRegistry(
  parseProviderProfiles(
    JSON.stringify([{ key: "local", baseUrl: "http://localhost:11434/v1" }]),
    {},
    "development",
  ),
  "gemini",
  "gemini-flash-latest",
);
const llm = new LLMService(registry);

/** Answers axios.post with `replies` in order and records each request body. */
const scripted = (t, replies) => {
  const bodies = [];
  const original = axios.post;
  axios.post = async (url, body) => {
    bodies.push({ url, body });
    return { data: replies[bodies.length - 1] };
  };
  t.after(() => {
    axios.post = original;
  });
  return bodies;
};

/** Turn 1 asks for the tool, turn 2 answers; returns both turns. */
const roundTrip = async (provider, model) => {
  const request = { system: "Be brief.", messages: [ask], tools: [readFile] };
  const first = await llm.generateWithTools(provider, model, request);
  const second = await llm.generateWithTools(provider, model, {
    ...request,
    messages: [
      ask,
      first.message,
      { role: "tool", toolCallId: first.toolCalls[0].id, name: "read_file", content: "module.exports = { a };" },
    ],
  });
  return { first, second };
};

const expectSameOutcome = ({ first, second }, toolCallId) => {
  assert.equal(first.stopReason, "tool_use");
  assert.deepEqual(first.toolCalls, [{ id: toolCallId, name: "read_file", arguments: { path: "src/a.js" } }]);
  assert.equal(second.stopReason, "end_turn");
  assert.deepEqual(second.toolCalls, []);
  assert.equal(second.text, "It exports a.");
};

test("Anthropic: tool_use round trip, with thinking blocks replayed unchanged", async (t) => {
  const thinking = { type: "thinking", thinking: "", signature: "sig-123" };
  const bodies = scripted(t, [
    {
      stop_reason: "tool_use",
      content: [thinking, { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "src/a.js" } }],
      usage: { input_tokens: 120, output_tokens: 30 },
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "It exports a." }], usage: { input_tokens: 160, output_tokens: 8 } },
  ]);
  const turns = await roundTrip("anthropic", "claude-haiku-5-5");
  expectSameOutcome(turns, "toolu_1");
  assert.deepEqual(turns.first.usage, { inputTokens: 120, outputTokens: 30 });

  const [request1, request2] = bodies.map((entry) => entry.body);
  assert.equal(bodies[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(request1.system, "Be brief.");
  assert.deepEqual(request1.tools, [
    { name: "read_file", description: readFile.description, input_schema: readFile.parameters },
  ]);
  assert.deepEqual(request2.messages[1], {
    role: "assistant",
    content: [thinking, { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "src/a.js" } }],
  });
  assert.deepEqual(request2.messages[2], {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "module.exports = { a };" }],
  });
});

test("Gemini: functionCall round trip, with thought signatures replayed unchanged", async (t) => {
  const callPart = { functionCall: { name: "read_file", args: { path: "src/a.js" } }, thoughtSignature: "sig-456" };
  const bodies = scripted(t, [
    {
      candidates: [{ finishReason: "STOP", content: { role: "model", parts: [callPart] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 15 },
    },
    { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "It exports a." }] } }] },
  ]);
  const turns = await roundTrip("gemini", "gemini-flash-latest");
  expectSameOutcome(turns, "call-0");
  assert.deepEqual(turns.first.usage, { inputTokens: 100, outputTokens: 35 }, "thinking tokens count as output");

  const [request1, request2] = bodies.map((entry) => entry.body);
  assert.deepEqual(request1.system_instruction, { parts: [{ text: "Be brief." }] });
  assert.deepEqual(request1.tools, [
    { functionDeclarations: [{ name: "read_file", description: readFile.description, parameters: readFile.parameters }] },
  ]);
  assert.deepEqual(request2.contents[1], { role: "model", parts: [callPart] });
  assert.deepEqual(request2.contents[2], {
    role: "user",
    parts: [{ functionResponse: { name: "read_file", response: { result: "module.exports = { a };" } } }],
  });
});

test("OpenAI-compatible: tool_calls round trip", async (t) => {
  const bodies = scripted(t, [
    {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{ id: "call_9", type: "function", function: { name: "read_file", arguments: '{"path":"src/a.js"}' } }],
          },
        },
      ],
      usage: { prompt_tokens: 90, completion_tokens: 12 },
    },
    { choices: [{ finish_reason: "stop", message: { content: "It exports a." } }] },
  ]);
  const turns = await roundTrip("openai", "gpt-4o");
  expectSameOutcome(turns, "call_9");
  assert.deepEqual(turns.first.usage, { inputTokens: 90, outputTokens: 12 });

  const [request1, request2] = bodies.map((entry) => entry.body);
  assert.deepEqual(request1.messages[0], { role: "system", content: "Be brief." });
  assert.deepEqual(request1.tools, [
    { type: "function", function: { name: "read_file", description: readFile.description, parameters: readFile.parameters } },
  ]);
  assert.deepEqual(request2.messages.slice(2), [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_9", type: "function", function: { name: "read_file", arguments: '{"path":"src/a.js"}' } }],
    },
    { role: "tool", tool_call_id: "call_9", content: "module.exports = { a };" },
  ]);
});

test("several results for one turn travel together; errors are marked", async (t) => {
  const bodies = scripted(t, [{ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
  await llm.generateWithTools("anthropic", "claude-haiku-5-5", {
    messages: [
      ask,
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "t1", name: "read_file", arguments: { path: "a" } },
          { id: "t2", name: "read_file", arguments: { path: "b" } },
        ],
      },
      { role: "tool", toolCallId: "t1", name: "read_file", content: "A" },
      { role: "tool", toolCallId: "t2", name: "read_file", content: "no such file", isError: true },
    ],
    tools: [readFile],
  });
  const messages = bodies[0].body.messages;
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[2].content, [
    { type: "tool_result", tool_use_id: "t1", content: "A" },
    { type: "tool_result", tool_use_id: "t2", content: "no such file", is_error: true },
  ]);
});

test("unusable replies raise errors instead of being guessed at", async (t) => {
  scripted(t, [
    { stop_reason: "max_tokens", content: [] },
    { stop_reason: "refusal", content: [] },
    { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL", content: { parts: [] } }] },
    { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "c", function: { name: "read_file", arguments: "{oops" } }] } }] },
    { choices: [{ finish_reason: "stop", message: { content: "" } }] },
  ]);
  const request = { messages: [ask], tools: [readFile] };
  await assert.rejects(llm.generateWithTools("anthropic", "m", request), /truncated/);
  await assert.rejects(llm.generateWithTools("anthropic", "m", request), /refused/);
  await assert.rejects(llm.generateWithTools("gemini", "m", request), /MALFORMED_FUNCTION_CALL/);
  await assert.rejects(llm.generateWithTools("openai", "m", request), /invalid JSON arguments/);
  await assert.rejects(llm.generateWithTools("openai", "m", request), /empty response/);
});

test("a profile without supportsTools is refused before any request is sent", async (t) => {
  const bodies = scripted(t, []);
  await assert.rejects(
    llm.generateWithTools("local", "llama3", { messages: [ask], tools: [readFile] }),
    (error) => error.name === "NonRetryableError" && /does not support tool calling/.test(error.message),
  );
  assert.equal(bodies.length, 0);
});
