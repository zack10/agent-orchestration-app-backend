// Reference projects: real issues in real projects, from a public benchmark
// of verified instances (Multi-SWE-bench), run through the whole pipeline.
//
// Per project: the project at the issue's base commit becomes the sandbox
// repo's main -> the issue becomes a Trello card -> approve the plan ->
// the agent works, with no environment configured (discovery finds it) ->
// reject publishing -> grade the diff the way the benchmark does: in its
// own image, without network, with the instance's test patch added, every
// FAIL_TO_PASS and PASS_TO_PASS test class must pass (JUnit XML reports).
// Writes docs/testing/reference-<date>.md and restores main.
//
// Needs what the coding eval needs (see codingEval.js). It REWRITES the
// sandbox repo's main.
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const { api, assertServerHealthy, env, envInt, runId, skipUnless } = require("./helpers");
const { cleanFiles, diffStats, loadSuites } = require("./codingScenarios");
const {
  OUTCOMES,
  eventMetrics,
  log,
  setDefaultBranch,
  suiteEnvironment,
  usageMetrics,
  useEnvironment,
} = require("./codingEval");
const {
  PIPELINE_ENV,
  createCard,
  ensureFixtures,
  github,
  ingestCard,
  pendingApproval,
  repoPath,
  trello,
  waitForAnyStatus,
  waitForStatus,
} = require("./pipeline");

const execFileAsync = promisify(execFile);
const PROJECTS_FILE = path.join(__dirname, "reference-projects", "projects.json");
const CACHE_DIR = path.resolve(__dirname, "..", "..", "scratch", "reference-cache");
const REPORT_DIR = path.resolve(__dirname, "..", "..", "docs", "testing");
const PLAN_TIMEOUT_MS = envInt("E2E_PLAN_TIMEOUT_MS", 120_000);
// Real builds are slower than the benchmark's: discovery, setup and checks.
const RUN_TIMEOUT_MS = envInt("E2E_REFERENCE_RUN_TIMEOUT_MS", 2_700_000);
const RUN_END_STATES = ["AWAITING_PUBLISH_APPROVAL", "BLOCKED", "FAILED", "CANCELED"];
const DEFAULT_SUITE = "node";

const docker = (args, options = {}) =>
  execFileAsync("docker", args, { maxBuffer: 50_000_000, timeout: 900_000, ...options });

/** The benchmark instance a project is built from, downloaded once into scratch/. */
const loadInstance = async ({ source }) => {
  const file = path.join(CACHE_DIR, source.file.replace(/\//g, "__"));
  if (!fs.existsSync(file)) {
    const url = `https://huggingface.co/datasets/${source.dataset}/resolve/main/${source.file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not download ${url}: ${response.status}`);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, await response.text());
  }
  const instance = fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((candidate) => candidate.number === source.number);
  if (!instance) throw new Error(`${source.file} has no instance ${source.number}`);
  return instance;
};

/** The project's tracked files at the base commit, read from the benchmark image (no network needed). */
const projectFiles = async (project, instance) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reference-"));
  const { stdout: container } = await docker(["create", project.grader.image]);
  try {
    await docker(["cp", `${container.trim()}:${project.grader.workdir}/.`, dir]);
    // The image's prepare step checked out the base commit; make sure.
    await execFileAsync("git", ["-C", dir, "checkout", "-q", "--force", instance.base.sha]);
    const { stdout: head } = await execFileAsync("git", ["-C", dir, "rev-parse", "HEAD"]);
    if (head.trim() !== instance.base.sha) throw new Error(`image is at ${head.trim()}, expected ${instance.base.sha}`);
    // "<mode> <sha> <stage>\t<path>": the mode keeps executable scripts executable.
    const { stdout: listed } = await execFileAsync("git", ["-C", dir, "ls-files", "-s", "-z"], { maxBuffer: 50_000_000 });
    const files = new Map();
    for (const entry of listed.split("\0").filter(Boolean)) {
      const [info, file] = entry.split("\t");
      // The stored blob, not the checked-out file: git on Windows may have converted its line endings.
      const [mode, sha] = info.split(" ");
      const { stdout: content } = await execFileAsync("git", ["-C", dir, "cat-file", "blob", sha], { encoding: "buffer", maxBuffer: 50_000_000 });
      files.set(file, { mode, content });
    }
    return files;
  } finally {
    await docker(["rm", "-f", container.trim()]).catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** Replaces the sandbox repo's main with `files` ({ mode, content: Buffer }, so binary files survive). */
const pushProject = async (files, message) => {
  const branch = env("E2E_GITHUB_DEFAULT_BRANCH", "main");
  const ref = await github("GET", `${repoPath()}/git/ref/heads/${branch}`);
  const tree = [];
  // Text goes inline in the one tree request: a request per file trips
  // GitHub's secondary rate limit. Only binary files need a blob each.
  for (const [file, { mode, content }] of files) {
    const text = content.toString("utf8");
    if (!text.includes("\0") && Buffer.from(text, "utf8").equals(content)) tree.push({ path: file, mode, type: "blob", content: text });
    else {
      const blob = await github("POST", `${repoPath()}/git/blobs`, { content: content.toString("base64"), encoding: "base64" });
      tree.push({ path: file, mode, type: "blob", sha: blob.sha });
    }
  }
  const created = await github("POST", `${repoPath()}/git/trees`, { tree });
  const commit = await github("POST", `${repoPath()}/git/commits`, { message, tree: created.sha, parents: [ref.object.sha] });
  await github("PATCH", `${repoPath()}/git/refs/heads/${branch}`, { sha: commit.sha });
  return commit.sha;
};

/**
 * Grades a diff as the benchmark does: in its image, without network, the
 * diff and then the instance's test patch applied, the tests run, and every
 * FAIL_TO_PASS and PASS_TO_PASS test class must pass. Results come from the
 * JUnit XML reports the test run leaves behind.
 */
const gradeDiff = async (project, instance, diff) => {
  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "reference-patch-"));
  try {
    fs.writeFileSync(path.join(patchDir, "agent.diff"), diff);
    const { workdir, testPatch, test } = project.grader;
    const script = [
      `cd ${workdir}`,
      `git checkout -q --force ${instance.base.sha}`,
      "[ ! -s /patch/agent.diff ] || git apply --whitespace=nowarn /patch/agent.diff || { echo GRADE_APPLY_FAILED; exit 0; }",
      `git apply --whitespace=nowarn ${testPatch} || { echo GRADE_TEST_PATCH_FAILED; exit 0; }`,
      `${test.map((part) => `'${part}'`).join(" ")} > /tmp/test.log 2>&1; echo GRADE_EXIT=$?`,
      // One line per test suite report: its opening tag carries the name and the counts.
      `grep -rl --include='*.xml' '<testsuite' . | while read -r f; do grep -o '<testsuite [^>]*>' "$f" | head -1; done`,
      "tail -c 3000 /tmp/test.log",
    ].join("\n");
    const { stdout } = await docker(
      ["run", "--rm", "--network", "none", "--cpus", "2", "--memory", "3g", "-v", `${patchDir}:/patch:ro`, project.grader.image, "bash", "-c", script],
      { timeout: 1_800_000 },
    );
    if (stdout.includes("GRADE_APPLY_FAILED")) return { applied: false, output: stdout.slice(-1500) };
    if (stdout.includes("GRADE_TEST_PATCH_FAILED")) return { applied: false, output: `the hidden test patch no longer applies\n${stdout.slice(-1500)}` };
    const suites = new Map();
    for (const tag of stdout.match(/<testsuite [^>]*>/g) ?? []) {
      const attribute = (name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
      const failed = Number(attribute("failures") ?? 0) + Number(attribute("errors") ?? 0) > 0;
      suites.set(attribute("name"), failed ? "FAIL" : "PASS");
    }
    const status = (name) => suites.get(name) ?? "MISSING";
    const failing = (names) => names.filter((name) => status(name) !== "PASS").map((name) => `${name} (${status(name)})`);
    const failToPass = failing(Object.keys(instance.f2p_tests));
    const passToPass = failing(Object.keys(instance.p2p_tests));
    return { applied: true, failToPass, passToPass, passed: !failToPass.length && !passToPass.length, output: stdout.slice(-1500) };
  } finally {
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
};

// The shared sandbox repository's own policy, put back after the projects ran.
let originalPolicy;
const ORIGINAL_POLICY = (fixtures) => (originalPolicy ??= fixtures.repository.executionPolicy ?? {});

/** Sets the sandbox repository's execution policy (limits such as the setup timeout), if it differs. */
const usePolicy = async (fixtures, executionPolicy) => {
  if (JSON.stringify(fixtures.repository.executionPolicy) === JSON.stringify(executionPolicy)) return;
  const { data } = await api("PATCH", `/api/repositories/${fixtures.repository.id}`, { body: { executionPolicy }, expectStatus: 200 });
  fixtures.repository = data;
};

const runProject = async (fixtures, project) => {
  const id = runId();
  const started = Date.now();
  const result = { project: project.id, language: project.language, outcome: "infra_failure", note: "" };
  let cardId;
  try {
    const instance = await loadInstance(project);
    const issue = instance.resolved_issues[0];
    result.issue = `${instance.org}/${instance.repo}#${issue.number}`;
    log(`${project.id}: ${result.issue} "${issue.title}"`);
    await docker(["pull", "-q", project.grader.image]);
    const files = await projectFiles(project, instance);
    // The environment a person approved once, if the project has one; else none,
    // and discovery has to find out how the project is built and tested.
    await useEnvironment(fixtures, project.environment ?? {});
    await usePolicy(fixtures, { ...ORIGINAL_POLICY(fixtures), ...project.executionPolicy });
    log(`${project.id}: pushing ${files.size} files at ${instance.base.sha.slice(0, 8)}`);
    const baseSha = await pushProject(files, `reference: ${project.id} at ${instance.base.sha} (${id})`);
    cardId = await createCard(`[${id}] ${issue.title}`, issue.body ?? "");
    const workItem = await ingestCard(fixtures, cardId);
    const { data: detail } = await api("GET", `/api/work-items/${workItem.id}`, { expectStatus: 200 });
    result.executionId = detail.executions[0].id;
    log(`${project.id}: execution ${result.executionId}`);

    const planned = await waitForStatus(result.executionId, "AWAITING_PLAN_APPROVAL", PLAN_TIMEOUT_MS);
    await api("POST", `/api/executions/${result.executionId}/approvals/plan`, {
      body: { approved: true, snapshotHash: pendingApproval(planned, "PLAN").snapshotHash, comment: `reference ${id}` },
      expectStatus: 200,
    });
    const execution = await waitForAnyStatus(result.executionId, RUN_END_STATES, RUN_TIMEOUT_MS);
    Object.assign(result, eventMetrics(execution.events), usageMetrics(execution.usage));
    if (execution.baseSha && execution.baseSha !== baseSha) throw new Error(`run used base ${execution.baseSha}, expected ${baseSha}`);
    const event = (type) => execution.events.find((candidate) => candidate.type === type)?.payload;
    result.environment = event("GRAPH_TOOLCHAIN_RESOLVED");
    result.discovery = event("GRAPH_ENVIRONMENT_DISCOVERED");
    result.baseline = event("GRAPH_BASELINE_CHECKED");
    result.failingBefore = event("GRAPH_VERIFICATION_PASSED")?.failingBefore;

    if (execution.status === "AWAITING_PUBLISH_APPROVAL") {
      const artifact = execution.artifacts.find((candidate) => candidate.type === "DIFF");
      const diff = fs.readFileSync(artifact.storagePath, "utf8");
      // Same formula as hashSnapshot in src/services/executionService.ts.
      if (crypto.createHash("sha256").update(JSON.stringify(diff)).digest("hex") !== artifact.sha256)
        throw new Error("diff artifact does not match its recorded sha256");
      await api("POST", `/api/executions/${result.executionId}/approvals/publish`, {
        body: { approved: false, snapshotHash: pendingApproval(execution, "PUBLISH").snapshotHash, comment: "reference eval" },
        expectStatus: 200,
      });
      const stats = diffStats(diff);
      result.files = stats.files;
      result.linesAdded = stats.added;
      result.linesRemoved = stats.removed;
      const objections = artifact.metadata?.reviewObjections ?? [];
      const graded = await gradeDiff(project, instance, diff);
      result.gradeOutput = graded.output;
      if (!graded.applied) result.note = `diff did not apply: ${graded.output.trim().slice(0, 300)}`;
      else if (graded.passed) result.outcome = "correct_fix";
      else {
        result.outcome = objections.length ? "wrong_fix_flagged" : "wrong_fix_shipped";
        result.note = [
          graded.failToPass.length ? `FAIL_TO_PASS still failing: ${graded.failToPass.join(", ")}` : "",
          graded.passToPass.length ? `PASS_TO_PASS broken: ${graded.passToPass.slice(0, 5).join(", ")}${graded.passToPass.length > 5 ? ", ..." : ""}` : "",
        ].filter(Boolean).join("; ");
      }
      if (objections.length) result.note = [result.note, `reviewer objected: ${objections.join(" / ").slice(0, 200)}`].filter(Boolean).join("; ");
    } else if (execution.status === "BLOCKED") {
      result.outcome = "no_fix";
      result.note = (execution.lastError ?? "").replace(/\s+/g, " ").slice(0, 300);
    } else {
      result.note = `${execution.status}: ${(execution.lastError ?? "").replace(/\s+/g, " ").slice(0, 300)}`;
    }
  } catch (error) {
    result.outcome = "infra_failure";
    result.note = error.message.replace(/\s+/g, " ").slice(0, 300);
  } finally {
    result.durationMs = Date.now() - started;
    if (cardId && env("E2E_KEEP_RESOURCES") !== "true")
      await trello("DELETE", `/cards/${cardId}`).catch((error) => log(`could not delete card: ${error.message}`));
  }
  log(`${project.id}: ${OUTCOMES[result.outcome]}${result.note ? ` (${result.note})` : ""}`);
  return result;
};

const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

const writeReport = (results, meta) => {
  const lines = [
    `# Reference projects ${meta.date}`,
    "",
    "Generated by `npm run eval:reference` (tests/e2e/referenceEval.js). Projects: `tests/e2e/reference-projects/projects.json`, instances from Multi-SWE-bench, graded by its FAIL_TO_PASS and PASS_TO_PASS tests in its own image.",
    "",
    `Model: ${env("E2E_LLM_PROVIDER")} / ${env("E2E_LLM_MODEL")}. Code version: ${meta.commit}.`,
    "",
    "| Project | Issue | Outcome | Attempts | LLM calls | Tokens | Cost | Duration | Files changed | Note |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map((result) => {
      const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
      return `| ${result.project} | ${result.issue ?? ""} | ${OUTCOMES[result.outcome]} | ${result.attempts ?? ""} | ${result.llmCalls ?? ""} | ${tokens ? `${Math.round(tokens / 1000)}k` : ""} | ${result.costUsd === undefined ? "" : `$${result.costUsd.toFixed(3)}`} | ${Math.round(result.durationMs / 1000)}s | ${cell((result.files ?? []).join(", "))} | ${cell(result.note)} |`;
    }),
    "",
    "## Environment per project",
    "",
    ...results.flatMap((result) => [
      `### ${result.project}`,
      "",
      "```json",
      JSON.stringify({ environment: result.environment, discovery: result.discovery, baseline: result.baseline, failingBefore: result.failingBefore }, null, 2).slice(0, 6000),
      "```",
      "",
      ...(result.gradeOutput ? ["Grading output (end):", "", "```text", result.gradeOutput.trim(), "```", ""] : []),
    ]),
  ];
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  let file = path.join(REPORT_DIR, `reference-${meta.date}.md`);
  for (let index = 2; fs.existsSync(file); index += 1) file = path.join(REPORT_DIR, `reference-${meta.date}-${index}.md`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
};

const main = async () => {
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const check = process.argv.includes("--check");
  const missing = skipUnless([...PIPELINE_ENV, "E2E_GITHUB_TOKEN"]);
  if (missing) throw new Error(missing);
  let projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8"));
  if (wanted.length) projects = projects.filter((project) => wanted.some((id) => project.id.startsWith(id)));
  if (!projects.length) throw new Error(`No reference project matches ${wanted.join(", ")}`);

  await assertServerHealthy();
  const fixtures = await ensureFixtures();
  if (check) {
    // No model calls: the instances load, the images run, and the known fix grades as correct.
    for (const project of projects) {
      const instance = await loadInstance(project);
      await docker(["pull", "-q", project.grader.image]);
      const files = await projectFiles(project, instance);
      const fix = await gradeDiff(project, instance, instance.fix_patch);
      const none = await gradeDiff(project, instance, "");
      log(`${project.id}: ${files.size} files; known fix ${fix.passed ? "passes" : `FAILS (${[...(fix.failToPass ?? []), ...(fix.passToPass ?? [])].join(", ") || fix.output})`}; unchanged code ${none.passed ? "PASSES (instance is not valid)" : `fails as expected (${none.failToPass.join(", ")})`}`);
    }
    return;
  }
  const { stdout: commit } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"]).catch(() => ({ stdout: "unknown" }));
  log(`${projects.length} project(s) with ${env("E2E_LLM_PROVIDER")}/${env("E2E_LLM_MODEL")}${env("E2E_PRICE_PER_MTOK") ? "" : " (set E2E_PRICE_PER_MTOK for cost)"}`);
  const results = [];
  try {
    for (const project of projects) results.push(await runProject(fixtures, project));
  } finally {
    const suite = loadSuites().find((candidate) => candidate.name === DEFAULT_SUITE);
    await setDefaultBranch(cleanFiles(suite), "reference: restore clean project").catch((error) => log(`could not restore main: ${error.message}`));
    await useEnvironment(fixtures, suiteEnvironment(suite)).catch((error) => log(`could not restore the environment: ${error.message}`));
    await usePolicy(fixtures, ORIGINAL_POLICY(fixtures)).catch((error) => log(`could not restore the policy: ${error.message}`));
  }
  const file = writeReport(results, { date: new Date().toLocaleDateString("sv"), commit: commit.trim() });
  log(`report: ${path.relative(process.cwd(), file)}`);
};

if (require.main === module)
  main().catch((error) => {
    console.error(`[reference] ${error.stack}`);
    process.exitCode = 1;
  });

module.exports = { gradeDiff, loadInstance, projectFiles };
