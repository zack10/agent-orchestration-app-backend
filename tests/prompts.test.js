const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EXECUTION_PROMPTS,
  executionPromptFragment,
  renderExecutionPrompt,
  renderPromptVersion,
} = require("../dist/prompts");

const FILE_BLOCK_FORMAT = `Each changed file is one block: a line "FILE: relative/path", then an opening fence line such as \`\`\`md, then the COMPLETE new file content, then a line containing only \`\`\`. Put all blocks in the JSON "actions" string.`;

// The inline prompts executionGraph.ts sent before they moved to files
// (one user message each). v1 must keep exactly these lines.
const legacy = {
  plan: (v) => `Create a concise internal implementation plan for this repository change. Do not write code yet.

Ticket:
${v.ticket}

Repository context:
${v.repoContext}

Return JSON only:
{
  "summary": "short plan",
  "filesToEdit": ["relative/path.ts"],
  "risk": "low|medium|high",
  "testStrategy": ["script or check"]
}`,
  implement: (v) => `Fix this Node/TypeScript bug in the checked-out repository. Ticket: ${v.ticket}
Return the required JSON output with FILE actions only. Do not change unrelated files.

Internal implementation plan:
${v.internalPlan}

Repository context:
${v.repoContext}

Previous failure or review feedback:
${v.lastFailure}

Return JSON with an "actions" string containing FILE blocks only. ${FILE_BLOCK_FORMAT}`,
  analyze: (v) => `Analyze this failed automated coding attempt and produce concise retry guidance.

Ticket:
${v.ticket}

Internal plan:
${v.internalPlan}

Failure or review feedback:
${v.lastFailure}

Return JSON only:
{
  "summary": "what failed",
  "nextAttemptGuidance": "specific changes the next attempt should make",
  "avoid": ["things to avoid"]
}`,
  review: (v) => `Review this diff before it is sent for human publish approval.

Ticket:
${v.ticket}

Internal plan:
${v.internalPlan}

Changed files:
${v.changedFiles}

Diff:
${v.diff}

Return JSON only:
{
  "approved": true,
  "issues": [],
  "summary": "short review summary"
}

Reject if the diff does not address the ticket, changes unrelated files, adds secrets, or is unsafe.`,
};

const variables = {
  plan: { ticket: "Fix total\nRounding is off", repoContext: "--- a.js ---" },
  implement: {
    ticket: "Fix total\nRounding is off",
    internalPlan: '{ "summary": "round once" }',
    repoContext: "--- a.js ---",
    lastFailure: "None",
    fileBlockFormat: FILE_BLOCK_FORMAT,
  },
  analyze: {
    ticket: "Fix total",
    internalPlan: "plan",
    lastFailure: "test failed",
  },
  review: {
    ticket: "Fix total",
    internalPlan: "plan",
    changedFiles: "a.js\nb.js",
    diff: "+x",
  },
};

// The current versions also get the repository environment.
const ENVIRONMENT = "Image: example/image:1\nChecks:\n- test: make test";
const current = {
  ...variables,
  plan: { ...variables.plan, environment: ENVIRONMENT },
  implement: { ...variables.implement, environment: ENVIRONMENT },
  analyze: { ...variables.analyze, workspace: "The repository is back at the unmodified code." },
};

const lines = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

for (const name of Object.keys(legacy)) {
  test(`${name}.v1 keeps the wording of the old inline prompt`, () => {
    const prompt = renderPromptVersion(`${name}.v1`, variables[name]);
    assert.ok(prompt.system.length > 0);
    assert.ok(prompt.user.length > 0);

    // Splitting into system + user may move lines, never reword them. The
    // implement prompt's first line is split in two, so compare sentences.
    const words = (text) => lines(text.replace(/\. /g, ".\n"));
    assert.deepEqual(
      words(`${prompt.system}\n${prompt.user}`),
      words(legacy[name](variables[name])),
    );
  });
}

test("ticket details go to the user prompt, fixed instructions to the system prompt", () => {
  const prompt = renderExecutionPrompt("implement", current.implement);
  assert.match(prompt.user, /Rounding is off/);
  assert.match(prompt.user, /Repository environment:\nImage: example\/image:1/);
  assert.doesNotMatch(prompt.system, /Rounding is off/);
  assert.match(prompt.system, /FILE: relative\/path/);
  assert.doesNotMatch(prompt.system, /\{\{/);
  assert.doesNotMatch(prompt.user, /\{\{/);
});

test("the file-format fragment matches the old FILE_BLOCK_FORMAT text", () => {
  assert.equal(executionPromptFragment("fileFormat"), FILE_BLOCK_FORMAT);
});

test("a missing variable fails loudly and names the variable", () => {
  const { diff, ...missingDiff } = variables.review;
  assert.ok(diff);
  assert.throws(
    () => renderPromptVersion("review.v1", missingDiff),
    /review\.v1 is missing variable "diff"/,
  );
});

test("an unused variable fails loudly (catches typos in variable names)", () => {
  assert.throws(
    () => renderPromptVersion("plan.v1", { ...variables.plan, tickets: "x" }),
    /plan\.v1 does not use variable\(s\): tickets/,
  );
});

test("values are inserted as-is, never expanded again", () => {
  const prompt = renderExecutionPrompt("plan", {
    ticket: "Literal {{repoContext}} and $& in the ticket",
    environment: ENVIRONMENT,
    repoContext: "context",
  });
  assert.match(prompt.user, /Literal \{\{repoContext\}\} and \$& in the ticket/);
});

test("unknown or unsafe prompt versions are refused", () => {
  assert.throws(() => renderPromptVersion("../package"), /Invalid prompt version/);
  assert.throws(() => renderPromptVersion("plan.v99"), /ENOENT/);
});

test("plan.v2 and review.v2 extend v1 with the new-test-file rule and change nothing else", () => {
  for (const name of ["plan", "review"]) {
    const v1 = renderPromptVersion(`${name}.v1`, variables[name]);
    const v2 = renderPromptVersion(`${name}.v2`, variables[name]);
    assert.equal(v2.version, `${name}.v2`);
    assert.equal(v2.user, v1.user);
    const added = lines(v2.system).filter((line) => !lines(v1.system).includes(line));
    assert.equal(added.length, 1, `${name}.v2 adds one paragraph`);
    assert.deepEqual(lines(v1.system).filter((line) => !lines(v2.system).includes(line)), [], "nothing removed");
  }
  assert.match(renderPromptVersion("plan.v2", variables.plan).system, /Existing test files must not be changed.*new test file/);
  assert.match(renderExecutionPrompt("review", variables.review).system, /guidance, not a contract.*A new test file for the fix is expected/);
});

test("agent.v4 and review.v3 keep the earlier rules and add the benchmark's lessons", () => {
  const agentVariables = { ticket: "t", environment: "e", internalPlan: "p", repoOverview: "o", lastFailure: "f" };
  const agentV3 = renderPromptVersion("agent.v3", agentVariables);
  const agentV4 = renderPromptVersion("agent.v4", agentVariables);
  assert.equal(agentV4.user, agentV3.user);
  assert.match(agentV4.system, /follow them through every one of those/);
  assert.match(agentV4.system, /test you wrote fails, first check that its expected values are right/);
  assert.match(agentV4.system, /Keep the functions, types and other names that other code may use/);
  for (const rule of ["status \"blocked\"", "run_command", "existing test files", "do not stop at a change you have not verified"])
    assert.ok(agentV4.system.includes(rule), `agent.v4 keeps "${rule}"`);

  const reviewV2 = renderPromptVersion("review.v2", variables.review);
  const reviewV3 = renderPromptVersion("review.v3", variables.review);
  assert.equal(reviewV3.user, reviewV2.user);
  const added = lines(reviewV3.system).filter((line) => !lines(reviewV2.system).includes(line));
  assert.equal(added.length, 1, "review.v3 adds one paragraph");
  assert.match(added[0], /^Reject if the diff removes or renames .* unless the ticket asks for that/);
  assert.deepEqual(lines(reviewV2.system).filter((line) => !lines(reviewV3.system).includes(line)), [], "nothing removed");
});

test("analyze.v2 keeps analyze.v1 and adds where the next attempt starts and the test rule", () => {
  const v1 = renderPromptVersion("analyze.v1", variables.analyze);
  const v2 = renderPromptVersion("analyze.v2", current.analyze);
  const added = lines(v2.system).filter((line) => !lines(v1.system).includes(line));
  assert.equal(added.length, 2, "analyze.v2 adds two paragraphs");
  assert.ok(added.some((line) => /starts again from the unmodified code/.test(line)));
  assert.ok(added.some((line) => /must not change or delete existing test files/.test(line)));
  assert.deepEqual(lines(v1.system).filter((line) => !lines(v2.system).includes(line)), [], "nothing removed");
  assert.ok(v2.user.startsWith(v1.user));
  assert.match(v2.user, /What the next attempt starts from:\nThe repository is back at the unmodified code\./);
});

test("the prompts in use name no language, package manager or file type", () => {
  // Only the templates are checked, so every variable is a neutral value.
  const neutral = (names) => Object.fromEntries(names.map((name) => [name, "x"]));
  const rendered = [
    ...["plan", "implement", "analyze", "review"].map((name) =>
      renderExecutionPrompt(name, neutral(Object.keys(current[name]))),
    ),
    renderExecutionPrompt("agent", neutral(["ticket", "environment", "internalPlan", "repoOverview", "lastFailure"])),
    renderExecutionPrompt("discover", neutral(["fixed", "files", "lastAttempt"])),
  ];
  for (const prompt of rendered) {
    const text = `${prompt.system}\n${prompt.user}`;
    assert.doesNotMatch(text, /Node|TypeScript|JavaScript|npm|\.(js|ts)\b/, prompt.version);
  }
  assert.deepEqual(
    rendered.map((prompt) => prompt.version),
    ["plan.v3", "implement.v2", "analyze.v2", "review.v3", "agent.v4", "discover.v1"],
  );
});
