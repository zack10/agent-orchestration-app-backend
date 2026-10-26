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
  const prompt = renderExecutionPrompt("implement", variables.implement);
  assert.match(prompt.user, /Rounding is off/);
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
    const v2 = renderExecutionPrompt(name, variables[name]);
    assert.equal(v2.version, `${name}.v2`);
    assert.equal(v2.user, v1.user);
    const added = lines(v2.system).filter((line) => !lines(v1.system).includes(line));
    assert.equal(added.length, 1, `${name}.v2 adds one paragraph`);
    assert.deepEqual(lines(v1.system).filter((line) => !lines(v2.system).includes(line)), [], "nothing removed");
  }
  assert.match(renderExecutionPrompt("plan", variables.plan).system, /Existing test files must not be changed.*new test file/);
  assert.match(renderExecutionPrompt("review", variables.review).system, /guidance, not a contract.*A new test file for the fix is expected/);
});
