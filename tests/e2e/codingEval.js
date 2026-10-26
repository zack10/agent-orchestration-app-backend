// Coding benchmark runner (Phase 0 of docs/plans/AGENTIC_ROADMAP.md).
//
//   npm run eval:coding                       every scenario, E2E_EVAL_RUNS times
//   npm run eval:coding -- --scenario 01,05   only these scenarios
//   npm run eval:coding -- --runs 3           runs per scenario
//   npm run eval:coding -- --check            check the setup without any LLM calls
//
// For each run: point the sandbox repo's main at the scenario's code -> create
// the Trello card -> approve the plan -> wait for a diff or BLOCKED -> reject
// publishing (no PR is opened) -> grade the diff in Docker with the repo's own
// tests and the hidden test -> record the outcome. Writes
// docs/testing/coding-eval-<date>.md and restores main to the clean project.
//
// Needs everything the execution e2e suite needs plus E2E_GITHUB_TOKEN with
// Contents read/write on the sandbox repo. It REWRITES that repo's main branch.
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const { api, assertServerHealthy, env, envInt, runId, skipUnless } = require("./helpers");
const {
  cleanFiles,
  diffStats,
  hiddenTestPath,
  loadScenarios,
  scenarioFiles,
  writeTree,
} = require("./codingScenarios");
const {
  PIPELINE_ENV,
  createCard,
  ensureFixtures,
  getExecution,
  github,
  ingestCard,
  pendingApproval,
  repoPath,
  trello,
  waitForAnyStatus,
  waitForStatus,
} = require("./pipeline");

const execFileAsync = promisify(execFile);
const PLAN_TIMEOUT_MS = envInt("E2E_PLAN_TIMEOUT_MS", 120_000);
const RUN_TIMEOUT_MS = envInt("E2E_RUN_TIMEOUT_MS", 1_200_000);
const RUN_END_STATES = ["AWAITING_PUBLISH_APPROVAL", "BLOCKED", "FAILED", "CANCELED"];
const REPORT_DIR = path.resolve(__dirname, "..", "..", "docs", "testing");
const GRADER_IMAGE = "node:20-bookworm";

const OUTCOMES = {
  correct_fix: "Correct fix",
  wrong_fix_shipped: "Wrong fix shipped",
  correctly_blocked: "Correctly blocked",
  no_fix: "No fix (blocked)",
  infra_failure: "Infrastructure failure",
};

const parseArgs = (argv) => {
  const options = { scenarios: null, runs: envInt("E2E_EVAL_RUNS", 1), check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split("=");
    const value = () => inline ?? argv[++index];
    if (flag === "--check") options.check = true;
    else if (flag === "--scenario") options.scenarios = value().split(",").map((id) => id.trim());
    else if (flag === "--runs") options.runs = Number.parseInt(value(), 10);
    else throw new Error(`Unknown argument ${argv[index]}`);
  }
  if (!(options.runs >= 1)) throw new Error("--runs must be a positive number");
  return options;
};

const log = (message) => console.log(`[eval ${new Date().toISOString().slice(11, 19)}] ${message}`);

/** Replaces the whole tree of the sandbox repo's default branch with `files`. */
const setDefaultBranch = async (files, message) => {
  const branch = env("E2E_GITHUB_DEFAULT_BRANCH", "main");
  const ref = await github("GET", `${repoPath()}/git/ref/heads/${branch}`);
  // No base_tree: files that are not listed are removed.
  const tree = await github("POST", `${repoPath()}/git/trees`, {
    tree: [...files].map(([file, content]) => ({ path: file, mode: "100644", type: "blob", content })),
  });
  const commit = await github("POST", `${repoPath()}/git/commits`, {
    message,
    tree: tree.sha,
    parents: [ref.object.sha],
  });
  await github("PATCH", `${repoPath()}/git/refs/heads/${branch}`, { sha: commit.sha });
  return commit.sha;
};

/**
 * Setup check without LLM calls: creating a tree and a commit proves the
 * token can write Contents, but no branch is moved.
 */
const checkSetup = async () => {
  const branch = env("E2E_GITHUB_DEFAULT_BRANCH", "main");
  const ref = await github("GET", `${repoPath()}/git/ref/heads/${branch}`);
  const tree = await github("POST", `${repoPath()}/git/trees`, {
    tree: [{ path: "README.md", mode: "100644", type: "blob", content: "setup check\n" }],
  });
  await github("POST", `${repoPath()}/git/commits`, {
    message: "benchmark: setup check (never referenced)",
    tree: tree.sha,
    parents: [ref.object.sha],
  });
  const grade = await gradeDiff(loadScenarios()[0], "");
  if (!grade.visiblePassed) throw new Error(`grading container failed:\n${grade.output}`);
  log(`setup OK: server, Docker grading, Trello fixtures, and write access to ${repoPath()} (${branch} untouched)`);
};

/** Runs a command in a throwaway container without network access. */
const docker = async (mounts, command) => {
  const args = ["run", "--rm", "--network", "none", "--cpus", "2", "--memory", "1g", "--pids-limit", "256"];
  for (const [hostPath, containerPath, mode = "rw"] of mounts) args.push("-v", `${hostPath}:${containerPath}:${mode}`);
  args.push("-w", "/w", GRADER_IMAGE, ...command);
  try {
    const result = await execFileAsync("docker", args, { timeout: 180_000, maxBuffer: 5_000_000 });
    return { passed: true, output: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    return { passed: false, output: `${error.stdout ?? ""}\n${error.stderr ?? error.message}` };
  }
};

/**
 * Grades an approved diff the way a reviewer would: apply it to the scenario's
 * starting code, run the repo's own tests, then the hidden test. The agent's
 * code runs only inside the container.
 */
const gradeDiff = async (scenario, diff) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-eval-"));
  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-eval-patch-"));
  try {
    writeTree(workDir, scenarioFiles(scenario));
    fs.writeFileSync(path.join(patchDir, "changes.diff"), diff);
    const mounts = [
      [workDir, "/w"],
      [patchDir, "/patch", "ro"],
    ];

    // A real run never produces an empty diff; the setup check grades one.
    if (diff.trim()) {
      const applied = await docker(mounts, ["git", "apply", "--whitespace=nowarn", "/patch/changes.diff"]);
      if (!applied.passed) return { applied: false, visiblePassed: false, hiddenPassed: false, output: applied.output };
    }

    const visible = await docker(mounts, ["node", "--test"]);
    // The hidden test is added only after the repo's own tests ran.
    if (scenario.hiddenTest) writeTree(workDir, new Map([[hiddenTestPath(scenario), scenario.hiddenTest]]));
    const hidden = scenario.hiddenTest
      ? await docker(mounts, ["node", "--test", hiddenTestPath(scenario)])
      : { passed: true, output: "" };
    return {
      applied: true,
      visiblePassed: visible.passed,
      hiddenPassed: hidden.passed,
      output: [visible.passed ? "" : visible.output, hidden.passed ? "" : hidden.output].join("\n").trim(),
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
};

/** Mode, attempts, LLM calls and prompt versions, read from the execution's events. */
const eventMetrics = (events) => {
  const ofType = (type) => events.filter((event) => event.type === type);
  const context = ofType("GRAPH_CONTEXT_LOADED")[0]?.payload;
  // A single-shot attempt is one implement call; a tool-loop attempt records
  // each model call as a GRAPH_AGENT_STEP (with a promptVersion).
  const llmCalls = events.filter(
    (event) =>
      (event.type === "GRAPH_ATTEMPT_STARTED" && event.payload?.agentMode !== "tool_loop") ||
      event.payload?.promptVersion,
  ).length;
  const loopTokens = ofType("GRAPH_AGENT_FINISHED").reduce(
    (sum, event) => sum + (event.payload?.usage?.inputTokens ?? 0) + (event.payload?.usage?.outputTokens ?? 0),
    0,
  );
  return {
    agentMode: context?.agentMode ?? "single_shot",
    attempts: ofType("GRAPH_ATTEMPT_STARTED").length,
    llmCalls,
    loopTokens,
    promptVersions: context?.promptVersions ?? null,
  };
};

const runScenario = async (fixtures, scenario, runNumber) => {
  const id = runId();
  const started = Date.now();
  const result = { scenario: scenario.id, run: runNumber, outcome: "infra_failure", note: "" };
  let cardId;
  try {
    const baseSha = await setDefaultBranch(scenarioFiles(scenario), `benchmark: ${scenario.id} (${id})`);
    cardId = await createCard(`[${id}] ${scenario.title}`, scenario.description);
    const workItem = await ingestCard(fixtures, cardId);
    const { data: detail } = await api("GET", `/api/work-items/${workItem.id}`, { expectStatus: 200 });
    result.executionId = detail.executions[0].id;
    log(`${scenario.id} run ${runNumber}: execution ${result.executionId}`);

    const planned = await waitForStatus(result.executionId, "AWAITING_PLAN_APPROVAL", PLAN_TIMEOUT_MS);
    await api("POST", `/api/executions/${result.executionId}/approvals/plan`, {
      body: { approved: true, snapshotHash: pendingApproval(planned, "PLAN").snapshotHash, comment: `eval ${id}` },
      expectStatus: 200,
    });

    const execution = await waitForAnyStatus(result.executionId, RUN_END_STATES, RUN_TIMEOUT_MS);
    Object.assign(result, eventMetrics(execution.events));
    if (execution.baseSha && execution.baseSha !== baseSha)
      throw new Error(`run used base ${execution.baseSha}, expected the scenario commit ${baseSha}`);

    if (execution.status === "AWAITING_PUBLISH_APPROVAL") {
      const artifact = execution.artifacts.find((candidate) => candidate.type === "DIFF");
      // The runner shares the server's disk; the hash proves it is the approved diff.
      const diff = fs.readFileSync(artifact.storagePath, "utf8");
      // Same formula as hashSnapshot in src/services/executionService.ts.
      if (crypto.createHash("sha256").update(JSON.stringify(diff)).digest("hex") !== artifact.sha256)
        throw new Error("diff artifact does not match its recorded sha256");
      // Never open a PR during the benchmark.
      await api("POST", `/api/executions/${result.executionId}/approvals/publish`, {
        body: { approved: false, snapshotHash: pendingApproval(execution, "PUBLISH").snapshotHash, comment: "coding eval" },
        expectStatus: 200,
      });

      const stats = diffStats(diff);
      result.files = stats.files;
      result.linesAdded = stats.added;
      result.linesRemoved = stats.removed;
      // Adding test cases is fine; changing or deleting existing ones is the gaming risk.
      const addedTest = (file) => file.startsWith("tests/") && !stats.editedFiles.includes(file);
      result.testsModified = stats.editedFiles.some((file) => file.startsWith("tests/"));
      result.testsAdded = stats.files.some(addedTest);
      // Added tests are reported in their own column, so they don't count as unexpected files.
      result.onlyExpectedFiles = stats.files.every((file) => addedTest(file) || scenario.expectedFiles.includes(file));

      if (scenario.expect === "blocked") {
        result.outcome = "wrong_fix_shipped";
        result.note = "a PR would have been opened for an impossible ticket";
      } else {
        const grade = await gradeDiff(scenario, diff);
        if (!grade.applied) {
          result.note = `diff did not apply: ${grade.output.trim().slice(0, 300)}`;
        } else if (grade.visiblePassed && grade.hiddenPassed) {
          result.outcome = "correct_fix";
        } else {
          result.outcome = "wrong_fix_shipped";
          result.note = grade.hiddenPassed ? "repo tests failed" : "hidden test failed";
          result.gradeOutput = grade.output.slice(-1500);
        }
      }
    } else if (execution.status === "BLOCKED") {
      result.outcome = scenario.expect === "blocked" ? "correctly_blocked" : "no_fix";
      result.note = (execution.lastError ?? "").replace(/\s+/g, " ").slice(0, 200);
    } else {
      result.note = `${execution.status}: ${(execution.lastError ?? "").replace(/\s+/g, " ").slice(0, 200)}`;
    }
  } catch (error) {
    result.outcome = "infra_failure";
    result.note = error.message.replace(/\s+/g, " ").slice(0, 300);
  } finally {
    result.durationMs = Date.now() - started;
    if (cardId && env("E2E_KEEP_RESOURCES") !== "true")
      await trello("DELETE", `/cards/${cardId}`).catch((error) => log(`could not delete card: ${error.message}`));
  }
  if (result.executionId && result.attempts === undefined)
    Object.assign(result, eventMetrics((await getExecution(result.executionId).catch(() => ({ events: [] }))).events));
  log(`${scenario.id} run ${runNumber}: ${OUTCOMES[result.outcome]}${result.note ? ` (${result.note})` : ""}`);
  return result;
};

const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "n/a");
const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

const summarize = (results) => {
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  const graded = results.length - count("infra_failure");
  const attempts = results.filter((result) => result.attempts);
  return {
    runs: results.length,
    correct: count("correct_fix"),
    wrong: count("wrong_fix_shipped"),
    blocked: count("correctly_blocked"),
    noFix: count("no_fix"),
    infra: count("infra_failure"),
    graded,
    avgAttempts: attempts.length
      ? (attempts.reduce((sum, result) => sum + result.attempts, 0) / attempts.length).toFixed(1)
      : "n/a",
  };
};

const writeReport = (results, meta) => {
  const summary = summarize(results);
  const promptVersions = results.find((result) => result.promptVersions)?.promptVersions;
  const promptList = promptVersions ? Object.values(promptVersions).join(", ") : "unknown";
  const lines = [
    `# Coding evaluation ${meta.date}`,
    "",
    "Generated by `npm run eval:coding` (tests/e2e/codingEval.js). Scenarios: `tests/e2e/coding-scenarios/`.",
    "",
    "| | |",
    "| --- | --- |",
    `| Mode | ${[...new Set(results.map((result) => result.agentMode).filter(Boolean))].join(", ") || "unknown"} |`,
    `| Model | ${env("E2E_LLM_PROVIDER")} / ${env("E2E_LLM_MODEL")} |`,
    `| Prompt versions | ${promptList} |`,
    `| Code version | ${meta.commit} |`,
    `| Runs per scenario | ${meta.runs} |`,
    `| Duration | ${Math.round(meta.durationMs / 60000)} min |`,
    "",
    "## Summary",
    "",
    "Rates exclude infrastructure failures. **Wrong fix shipped** is the key number: a PR a human reviewer would have to catch.",
    "",
    "| Runs | Correct fix | Wrong fix shipped | Correctly blocked | No fix (blocked) | Infra failures | Pass rate | Wrong-fix-shipped rate | Avg attempts |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    `| ${summary.runs} | ${summary.correct} | ${summary.wrong} | ${summary.blocked} | ${summary.noFix} | ${summary.infra} | ${percent(summary.correct + summary.blocked, summary.graded)} | ${percent(summary.wrong, summary.graded)} | ${summary.avgAttempts} |`,
    "",
    "## Runs",
    "",
    "| Scenario | Run | Outcome | Attempts | LLM calls | Duration | Files changed | Lines +/- | Only expected files (besides added tests) | Tests added | Existing tests changed | Note |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (result) =>
        `| ${result.scenario} | ${result.run} | ${OUTCOMES[result.outcome]} | ${result.attempts ?? ""} | ${result.llmCalls ?? ""}${result.loopTokens ? ` (${Math.round(result.loopTokens / 1000)}k tokens)` : ""} | ${Math.round(result.durationMs / 1000)}s | ${cell((result.files ?? []).join(", "))} | ${result.files ? `+${result.linesAdded}/-${result.linesRemoved}` : ""} | ${result.files ? (result.onlyExpectedFiles ? "yes" : "no") : ""} | ${result.files ? (result.testsAdded ? "yes" : "no") : ""} | ${result.files ? (result.testsModified ? "**yes**" : "no") : ""} | ${cell(result.note)} |`,
    ),
    "",
    "Tokens are the agent loop's input + output tokens (tool_loop mode only; single-shot calls do not report usage).",
    "",
  ];
  const failures = results.filter((result) => result.gradeOutput);
  if (failures.length) {
    lines.push("## Grading output of wrong fixes", "");
    for (const result of failures)
      lines.push(`### ${result.scenario} run ${result.run}`, "", "```text", result.gradeOutput.trim(), "```", "");
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  let file = path.join(REPORT_DIR, `coding-eval-${meta.date}.md`);
  for (let suffix = 2; fs.existsSync(file); suffix += 1)
    file = path.join(REPORT_DIR, `coding-eval-${meta.date}-${suffix}.md`);
  fs.writeFileSync(file, lines.join("\n"));

  const logRow = `| ${meta.date} | | ${[...new Set(results.map((result) => result.agentMode).filter(Boolean))].join(", ") || "unknown"} | ${env("E2E_LLM_MODEL")} | ${promptList} | none | ${summary.runs} | ${summary.correct} | ${summary.wrong} | ${summary.blocked} | ${summary.infra} | ${summary.avgAttempts} | [report](../testing/${path.basename(file)}) |`;
  return { file, summary, logRow };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const missing = skipUnless([...PIPELINE_ENV, "E2E_GITHUB_TOKEN"]);
  if (missing) throw new Error(missing);

  let scenarios = loadScenarios();
  if (options.scenarios) {
    scenarios = scenarios.filter((scenario) => options.scenarios.some((id) => scenario.id.startsWith(id)));
    if (!scenarios.length) throw new Error(`No scenario matches ${options.scenarios.join(", ")}`);
  }

  await assertServerHealthy();
  await execFileAsync("docker", ["version"]).catch(() => {
    throw new Error("Docker is not available; it is needed to grade diffs.");
  });
  const fixtures = await ensureFixtures();
  if (options.check) return checkSetup();
  const { stdout: commit } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"]).catch(() => ({ stdout: "unknown" }));

  const started = Date.now();
  log(`${scenarios.length} scenario(s) x ${options.runs} run(s) with ${env("E2E_LLM_PROVIDER")}/${env("E2E_LLM_MODEL")}`);
  const results = [];
  try {
    for (const scenario of scenarios)
      for (let run = 1; run <= options.runs; run += 1) results.push(await runScenario(fixtures, scenario, run));
  } finally {
    // Leave the sandbox on the clean project so other suites start from it.
    await setDefaultBranch(cleanFiles(), "benchmark: restore clean project").catch((error) =>
      log(`could not restore ${env("E2E_GITHUB_DEFAULT_BRANCH", "main")}: ${error.message}`),
    );
  }

  const report = writeReport(results, {
    // Local calendar date (the "sv" locale formats as YYYY-MM-DD).
    date: new Date().toLocaleDateString("sv"),
    commit: commit.trim(),
    runs: options.runs,
    durationMs: Date.now() - started,
  });
  const { summary } = report;
  log(
    `done: ${summary.correct} correct, ${summary.wrong} wrong fix shipped, ${summary.blocked} correctly blocked, ` +
      `${summary.noFix} no fix, ${summary.infra} infra failures`,
  );
  log(`report: ${path.relative(process.cwd(), report.file)}`);
  log(`results-log row for docs/plans/AGENTIC_ROADMAP.md:\n${report.logRow}`);
};

if (require.main === module)
  main().catch((error) => {
    console.error(`[eval] ${error.message}`);
    process.exitCode = 1;
  });

module.exports = { eventMetrics, gradeDiff, parseArgs, summarize };
