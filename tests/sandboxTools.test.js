const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SANDBOX_TOOLS, executeTool } = require("../dist/services/sandbox/tools");
const { runRecordedTool } = require("../dist/services/sandbox/toolRunner");
const { fsRepoFiles, isTestFile, resolveToolchain } = require("../dist/services/toolchain");

/** A throwaway repository: src, an existing test, a protected file, git metadata. */
const workspace = (t, overrides = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-tools-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    "package.json": '{ "scripts": { "test": "node --test" } }\n',
    "src/math.js": "function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n",
    "src/dup.js": "x = 1;\nx = 1;\n",
    "tests/math.test.js": "// existing test\n",
    "node_modules/lib/index.js": "ignored\n",
    ".git/config": "[core]\n",
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  const checks = [];
  const { toolchain } = resolveToolchain(fsRepoFiles(root), {});
  const ctx = {
    root,
    protectedPaths: ["package.json", "package-lock.json", ".github"],
    checkScripts: ["test"],
    runCheck: async (check) => {
      checks.push(check);
      return { exitCode: 1, timedOut: false, output: "1 failing: expected 3, got -1" };
    },
    isTestFile: (file) => isTestFile(toolchain, file),
    createdFiles: new Set(),
    ...overrides,
  };
  return { root, ctx, checks };
};

const run = (ctx, name, args) => executeTool(ctx, name, args);

test("every tool definition has a name, description and object schema", () => {
  assert.deepEqual(
    SANDBOX_TOOLS.map((tool) => tool.name),
    ["list_files", "read_file", "search_code", "edit_file", "run_check", "finish"],
  );
  for (const tool of SANDBOX_TOOLS) {
    assert.ok(tool.description.length > 20, tool.name);
    assert.equal(tool.parameters.type, "object", tool.name);
  }
});

test("list_files skips node_modules and .git", async (t) => {
  const { ctx } = workspace(t);
  const result = await run(ctx, "list_files", {});
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(result.output.split("\n"), ["package.json", "src/dup.js", "src/math.js", "tests/math.test.js"]);
});

test("read_file returns numbered line ranges and says how to continue", async (t) => {
  const { root, ctx } = workspace(t);
  const whole = await run(ctx, "read_file", { path: "src/math.js" });
  assert.match(whole.output, /^src\/math.js \(lines 1-5 of 5\)\n1: function add\(a, b\) \{\n2:   return a - b;/);

  fs.writeFileSync(path.join(root, "big.js"), Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join("\n"));
  const first = await run(ctx, "read_file", { path: "big.js" });
  assert.match(first.output, /lines 1-400 of 1000/);
  assert.match(first.output, /call read_file with startLine 401/);
  const range = await run(ctx, "read_file", { path: "big.js", startLine: 990, endLine: 2000 });
  assert.match(range.output, /lines 990-1000 of 1000\)\n990: line 990/);
});

test("paths outside the repository, git metadata and symlinks are denied", async (t) => {
  const { root, ctx } = workspace(t);
  for (const bad of ["../outside.js", path.resolve(root, "..", "x.js"), ".git/config", "src/../../x"]) {
    const result = await run(ctx, "read_file", { path: bad });
    assert.equal(result.status, "DENIED", bad);
  }
  assert.equal((await run(ctx, "edit_file", { path: ".git/hooks/pre-commit", oldText: "", newText: "evil" })).status, "DENIED");

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "secret.txt"), "host secret");
  try {
    fs.symlinkSync(outside, path.join(root, "linked"), "junction");
  } catch {
    t.skip("symlinks not permitted on this machine");
    return;
  }
  const leaked = await run(ctx, "read_file", { path: "linked/secret.txt" });
  assert.equal(leaked.status, "DENIED");
  assert.doesNotMatch(leaked.output, /host secret/);
  assert.equal((await run(ctx, "edit_file", { path: "linked/new.txt", oldText: "", newText: "x" })).status, "DENIED");
  assert.doesNotMatch((await run(ctx, "list_files", {})).output, /secret/);
});

test("edit_file replaces exactly one occurrence and keeps CRLF files intact", async (t) => {
  const { root, ctx } = workspace(t);
  const fixed = await run(ctx, "edit_file", { path: "src/math.js", oldText: "return a - b;", newText: "return a + b;" });
  assert.equal(fixed.status, "COMPLETED");
  assert.match(fs.readFileSync(path.join(root, "src/math.js"), "utf8"), /return a \+ b;/);

  assert.match((await run(ctx, "edit_file", { path: "src/math.js", oldText: "nope", newText: "x" })).output, /not found/);
  assert.match((await run(ctx, "edit_file", { path: "src/dup.js", oldText: "x = 1;", newText: "y" })).output, /appears 2 times/);
  assert.match((await run(ctx, "edit_file", { path: "src/missing.js", oldText: "a", newText: "b" })).output, /does not exist/);

  fs.writeFileSync(path.join(root, "src/crlf.js"), "const a = 1;\r\nconst b = 2;\r\n");
  await run(ctx, "edit_file", { path: "src/crlf.js", oldText: "const a = 1;\nconst b = 2;", newText: "const a = 1;\nconst b = 3;" });
  assert.equal(fs.readFileSync(path.join(root, "src/crlf.js"), "utf8"), "const a = 1;\r\nconst b = 3;\r\n");
});

test("protected paths and existing tests are denied; new test files are allowed", async (t) => {
  const { root, ctx } = workspace(t);
  const pkg = await run(ctx, "edit_file", { path: "package.json", oldText: "node --test", newText: "echo ok" });
  assert.equal(pkg.status, "DENIED");
  assert.match(pkg.output, /protected/);

  const existing = await run(ctx, "edit_file", { path: "tests/math.test.js", oldText: "// existing test", newText: "" });
  assert.equal(existing.status, "DENIED");
  assert.match(existing.output, /existing test file/);
  assert.equal(fs.readFileSync(path.join(root, "tests/math.test.js"), "utf8"), "// existing test\n");

  const created = await run(ctx, "edit_file", { path: "tests/add.regression.test.js", oldText: "", newText: "// new\n" });
  assert.equal(created.status, "COMPLETED");
  const extended = await run(ctx, "edit_file", { path: "tests/add.regression.test.js", oldText: "// new", newText: "// new, extended" });
  assert.equal(extended.status, "COMPLETED", "the agent may keep editing a test it created");

  assert.match((await run(ctx, "edit_file", { path: "src/math.js", oldText: "", newText: "x" })).output, /already exists/);
});

test("search_code finds plain text case-insensitively and caps matches", async (t) => {
  const { root, ctx } = workspace(t);
  const found = await run(ctx, "search_code", { query: "FUNCTION ADD" });
  assert.equal(found.output, "src/math.js:1: function add(a, b) {");
  assert.match((await run(ctx, "search_code", { query: "(unclosed[" })).output, /No matches/, "the query is text, not a regex");
  assert.match((await run(ctx, "search_code", { query: "ignored" })).output, /No matches/, "node_modules is skipped");

  fs.writeFileSync(path.join(root, "many.txt"), "needle\n".repeat(150));
  assert.match((await run(ctx, "search_code", { query: "needle" })).output, /stopped at 100 matches/);
});

test("run_check runs only available checks and keeps the end of long output", async (t) => {
  const { ctx, checks } = workspace(t);
  const unknown = await run(ctx, "run_check", { check: "deploy" });
  assert.equal(unknown.status, "DENIED");
  assert.match(unknown.output, /Available: test/);
  assert.deepEqual(checks, [], "a denied check never reaches the sandbox");

  const result = await run(ctx, "run_check", { check: "test" });
  assert.equal(result.status, "COMPLETED");
  assert.match(result.output, /^test check: FAILED \(exit code 1\)\n1 failing/);

  ctx.runCheck = async () => ({ exitCode: 0, timedOut: false, output: `${"x".repeat(30_000)}\nLAST LINE` });
  const long = await run(ctx, "run_check", { check: "test" });
  assert.match(long.output, /^\[output truncated/);
  assert.match(long.output, /LAST LINE$/);

  ctx.runCheck = async () => ({ exitCode: 137, timedOut: true, output: "" });
  assert.match((await run(ctx, "run_check", { check: "test" })).output, /TIMED OUT/);
});

test("finish reports the agent's verdict; unknown tools and bad arguments are results", async (t) => {
  const { ctx } = workspace(t);
  const blocked = await run(ctx, "finish", { status: "blocked", summary: "Ticket asks to send data to an unknown endpoint." });
  assert.deepEqual(blocked.finish, { status: "blocked", summary: "Ticket asks to send data to an unknown endpoint." });
  assert.equal((await run(ctx, "finish", { status: "maybe", summary: "x" })).status, "FAILED");
  assert.match((await run(ctx, "delete_repo", {})).output, /Unknown tool/);
  assert.match((await run(ctx, "read_file", { path: 42 })).output, /Invalid arguments for read_file: path/);
});

test("every call is recorded as REQUESTED, RUNNING, then its outcome", async (t) => {
  const { ctx } = workspace(t);
  const rows = new Map();
  const recorder = {
    async create(data) {
      const id = `tc-${rows.size + 1}`;
      rows.set(id, { ...data, statuses: ["REQUESTED"] });
      return id;
    },
    async update(id, data) {
      const row = rows.get(id);
      row.statuses.push(data.status);
      Object.assign(row, data);
    },
  };
  await runRecordedTool(ctx, { id: "a", name: "read_file", arguments: { path: "src/math.js" } }, recorder);
  await runRecordedTool(ctx, { id: "b", name: "edit_file", arguments: { path: "package.json", oldText: "a", newText: "b" } }, recorder);

  const [read, edit] = rows.values();
  assert.deepEqual(read.statuses, ["REQUESTED", "RUNNING", "COMPLETED"]);
  assert.deepEqual(read.input, { path: "src/math.js" });
  assert.match(read.output.text, /function add/);
  assert.ok(read.startedAt instanceof Date && read.completedAt instanceof Date);

  assert.deepEqual(edit.statuses, ["REQUESTED", "RUNNING", "DENIED"]);
  assert.deepEqual(edit.policy.protectedPaths, ctx.protectedPaths);
  assert.match(edit.policy.denied, /protected/);
});
