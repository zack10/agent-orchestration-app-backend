// Checks that every coding-benchmark scenario is valid before any LLM time is
// spent on it: the clean project passes everything, and each planted bug
// passes the repository's own tests but fails its hidden test.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  cleanFiles,
  diffStats,
  hiddenTestPath,
  loadScenarios,
  scenarioFiles,
  writeTree,
} = require("./e2e/codingScenarios");

const scenarios = loadScenarios();

/** Runs `node --test` in a temp copy; returns { passed, output }. */
const runTests = (files, args = []) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-scenario-"));
  try {
    writeTree(dir, files);
    // Without this the child would report to our own test runner.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", ...args], {
      cwd: dir,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { passed: result.status === 0, output: `${result.stdout}\n${result.stderr}`.slice(-3000) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const withHidden = (files, scenario) =>
  new Map([...files, [hiddenTestPath(scenario), scenario.hiddenTest]]);

test("there are 8 scenarios with valid definitions", () => {
  assert.equal(scenarios.length, 8);
  const clean = cleanFiles();
  for (const scenario of scenarios) {
    assert.ok(scenario.title && scenario.description, `${scenario.id}: title and description`);
    assert.ok(["fix", "blocked"].includes(scenario.expect), `${scenario.id}: expect is fix or blocked`);
    for (const file of scenario.expectedFiles)
      assert.ok(clean.has(file), `${scenario.id}: expected file ${file} exists in the clean repo`);
    for (const file of scenario.bugFiles.keys()) {
      assert.ok(clean.has(file), `${scenario.id}: bug file ${file} replaces a clean file`);
      assert.ok(!file.startsWith("tests/"), `${scenario.id}: bugs are planted in source, not tests`);
    }
    if (scenario.expect === "fix") {
      assert.ok(scenario.hiddenTest, `${scenario.id}: has a hidden test`);
      assert.ok(scenario.bugFiles.size > 0, `${scenario.id}: plants a bug`);
    } else {
      assert.equal(scenario.hiddenTest, null, `${scenario.id}: blocked scenarios have no hidden test`);
    }
  }
});

test("the clean project passes its own tests and every hidden test", () => {
  const visible = runTests(cleanFiles());
  assert.ok(visible.passed, visible.output);

  const withAllHidden = new Map(cleanFiles());
  const hiddenPaths = [];
  for (const scenario of scenarios.filter((candidate) => candidate.hiddenTest)) {
    withAllHidden.set(hiddenTestPath(scenario), scenario.hiddenTest);
    hiddenPaths.push(hiddenTestPath(scenario));
  }
  const hidden = runTests(withAllHidden, hiddenPaths);
  assert.ok(hidden.passed, hidden.output);
});

for (const scenario of scenarios.filter((candidate) => candidate.expect === "fix")) {
  test(`${scenario.id}: the bug passes the repo's tests but fails the hidden test`, () => {
    const files = scenarioFiles(scenario);
    const visible = runTests(files);
    assert.ok(visible.passed, `visible tests should not catch the bug:\n${visible.output}`);

    const hidden = runTests(withHidden(files, scenario), [hiddenTestPath(scenario)]);
    assert.equal(hidden.passed, false, "the hidden test must catch the bug");
    // ...by an assertion, not because it crashed (e.g. a broken require).
    assert.match(hidden.output, /ERR_ASSERTION/, hidden.output);
  });
}

test("07: the bug sits beyond the 20 KB repo-context cut-off", () => {
  const scenario = scenarios.find((candidate) => candidate.id.startsWith("07-"));
  const source = scenario.bugFiles.get("src/shippingRates.js");
  assert.ok(Buffer.byteLength(source.slice(0, source.indexOf("function shippingCost"))) > 20_000);
});

test("diffStats counts files and changed lines", () => {
  const diff = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1,2 +1,2 @@",
    "-old",
    "+new",
    "+extra",
    "diff --git a/src/b.js b/src/b.js",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/b.js",
    "+created",
  ].join("\n");
  assert.deepEqual(diffStats(diff), { files: ["src/a.js", "src/b.js"], added: 3, removed: 1 });
});
