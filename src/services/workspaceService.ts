import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config";
import { SANDBOX_ROOT, Toolchain } from "./toolchain";

const exec = promisify(execFile);
const safeId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Unsafe workspace id");
  }
  return id;
};
export const workspacePath = (id: string) =>
  path.resolve(config.workspaceRoot, safeId(id));

export const createWorkspace = async (id: string) => {
  const root = workspacePath(id);
  await fs.mkdir(root, { recursive: true });
  return root;
};
export const removeWorkspace = async (id: string) => {
  const root = workspacePath(id);
  await removeEnvironmentSnapshot(id);
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") throw error;
    // On Linux the container writes as root, so the host user may not be
    // able to delete those files; delete them from inside a container.
    await execDocker(
      dockerArgs(root, false, false, [
        "find",
        "/workspace",
        "-mindepth",
        "1",
        "-delete",
      ]),
    );
    await fs.rm(root, { recursive: true, force: true });
  }
};
// Repository-controlled config (hooks, fsmonitor, textconv) must never run
// with credentials or influence what is reviewed. fileMode=false because
// files are written from the host: on Windows bind mounts every file looks
// executable, which would put a spurious mode change in each diff.
const SAFE_GIT =
  "git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.fileMode=false";
const SAFE_GIT_ARGS = [
  "git",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.fileMode=false",
];
// The token is read from the container env and sent as an HTTP header, so it
// is never written to .git/config or placed on the docker command line.
const AUTH_GIT = `${SAFE_GIT} -c http.extraHeader="Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)"`;

// Clone, diff, reset and cleanup only: any image with git and a shell. The
// repository's own commands run in its toolchain's image instead.
const GIT_IMAGE = "node:20-bookworm";
const LIMIT_ARGS = ["--cpus", "2", "--memory", "2g", "--pids-limit", "256"];
const SETUP_TIMEOUT_MS = 900_000;

const envArgs = (env: Record<string, string> = {}) =>
  Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]);

const dockerArgs = (
  root: string,
  network: boolean,
  withToken: boolean,
  command: string[],
  options: { image?: string; env?: Record<string, string> } = {},
) => [
  "run",
  "--rm",
  ...LIMIT_ARGS,
  "--network",
  network ? "bridge" : "none",
  // `-e NAME` without a value makes docker read it from our process env.
  ...(withToken ? ["-e", "GITHUB_TOKEN"] : []),
  ...envArgs(options.env),
  ...workspaceMounts(root, !options.image),
  "-w",
  SANDBOX_ROOT,
  options.image ?? GIT_IMAGE,
  ...command,
];

/**
 * The repository's own commands (checks, the agent's commands) see .git
 * read-only: through it they could hide changes from the diff that is
 * reviewed and published (assume-unchanged, exclude entries, commits).
 * Only our git operations, in the git image, may write it.
 */
const workspaceMounts = (root: string, writableGit: boolean) => [
  "-v",
  `${root}:${SANDBOX_ROOT}`,
  ...(writableGit || !existsSync(path.join(root, ".git"))
    ? []
    : ["-v", `${path.join(root, ".git")}:${SANDBOX_ROOT}/.git:ro`]),
];

/**
 * execFile's error message is the command line plus stderr only; failures
 * need the exit status and stdout too (npm prints test failures there).
 */
const dockerFailure = (error: unknown, token?: string) => {
  const failure = error as {
    code?: unknown;
    signal?: unknown;
    killed?: boolean;
    stdout?: string;
    stderr?: string;
  };
  const tail = (text = "") =>
    (token ? text.split(token).join("***") : text).trim().slice(-4000) ||
    "(empty)";
  const status = failure.killed
    ? `killed by ${failure.signal ?? "timeout"}`
    : `exit code ${failure.code ?? "unknown"}`;
  return new Error(
    `docker run failed (${status})\nstderr:\n${tail(failure.stderr)}\nstdout:\n${tail(failure.stdout)}`,
  );
};

const execDocker = async (args: string[], token?: string, timeout = 300_000) => {
  try {
    return await exec("docker", args, {
      timeout,
      maxBuffer: 5_000_000,
      env: token ? { ...process.env, GITHUB_TOKEN: token } : process.env,
    });
  } catch (error) {
    throw dockerFailure(error, token);
  }
};

export const runDocker = async (
  id: string,
  command: string[],
  network = false,
) => {
  const result = await execDocker(
    dockerArgs(workspacePath(id), network, false, command),
  );
  return { stdout: result.stdout, stderr: result.stderr };
};

const assertSafeRepo = (...values: string[]) => {
  if (!values.every((value) => /^[a-zA-Z0-9_.-]+$/.test(value)))
    throw new Error("Unsafe repository identifier");
};

export const cloneGithubWorkspace = async (
  id: string,
  owner: string,
  repo: string,
  sha: string,
  token: string,
) => {
  assertSafeRepo(owner, repo, sha);
  // Start from an empty directory so a partial earlier clone cannot wedge retries.
  await removeWorkspace(id);
  const root = await createWorkspace(id);
  const script = `${AUTH_GIT} clone https://github.com/${owner}/${repo}.git . && ${SAFE_GIT} checkout ${sha}`;
  await execDocker(dockerArgs(root, true, true, ["sh", "-c", script]), token);
};

/** Untracked files git doesn't ignore; `directories` collapses whole new folders. */
const untrackedFiles = async (
  id: string,
  directories = false,
  which: "visible" | "ignored" | "all" = "visible",
) =>
  (
    await runDocker(id, [
      ...SAFE_GIT_ARGS,
      "ls-files",
      "-z",
      "--others",
      ...(which === "all" ? [] : ["--exclude-standard"]),
      ...(which === "ignored" ? ["--ignored"] : []),
      ...(directories ? ["--directory"] : []),
    ])
  ).stdout
    .split("\0")
    .filter(Boolean);

const excludeFromDiffs = async (id: string, entries: string[]) => {
  if (entries.length)
    await fs.appendFile(
      path.join(workspacePath(id), ".git", "info", "exclude"),
      entries.map((entry) => `/${entry.replace(/([*?[\\!#])/g, "\\$1")}\n`).join(""),
    );
};

/**
 * Runs `work` (a check) and keeps whatever it creates out of diffs and
 * resets: build output and caches a check writes (__pycache__, target/,
 * coverage) are never part of the change, whatever the language.
 */
export const keepOutputOutOfDiffs = async <T>(id: string, work: () => Promise<T>) => {
  const before = new Set(await untrackedFiles(id));
  try {
    return await work();
  } finally {
    await excludeFromDiffs(
      id,
      (await untrackedFiles(id)).filter((file) => !before.has(file)),
    );
  }
};

const setupContainer = (id: string) => `agent-setup-${safeId(id).toLowerCase()}`;
const snapshotImage = (id: string) => `agent-env-${safeId(id).toLowerCase()}`;

/** Deletes an execution's environment snapshot, if it has one. */
export const removeEnvironmentSnapshot = async (id: string) => {
  for (const args of [["rm", "-f", setupContainer(id)], ["rmi", "-f", snapshotImage(id)]])
    await exec("docker", args).catch(() => undefined);
};

/** How a check did on the unmodified code, during setup. */
export interface BaselineResult {
  check: string;
  passed: boolean;
  output: string;
}

/**
 * Prepares the environment and returns the image every later command uses.
 * In one container with network (package registries) but never the GitHub
 * token, since this runs repository-controlled code:
 *
 * 1. the repository's setup command, if any;
 * 2. each check once, on the unmodified code. Tools fetch some things only
 *    when they really run (test-framework providers, plugins, modules), and
 *    the later checks have no network. The results are the baseline: how the
 *    code did before the agent changed anything.
 *
 * Tools install to different places (~/.m2, ~/.cache, /usr/local), so the
 * container is then snapshotted with `docker commit` instead of knowing any
 * of them; the workspace is a bind mount, so it is not in the snapshot.
 * What setup installed inside the workspace (node_modules, .venv, vendor)
 * is copied into the snapshot too, so verification can restore it exactly
 * (see prepareVerification). Whatever this created inside the workspace is
 * excluded from diffs.
 */
export const setupWorkspace = async (
  id: string,
  toolchain: Toolchain,
  checks: Array<{ name: string; command: string[] }>,
) => {
  const baseline: BaselineResult[] = [];
  let setupOutputs: string[] = [];
  if (!toolchain.setup && !checks.length) return { image: toolchain.image, baseline, setupOutputs };

  await removeEnvironmentSnapshot(id);
  const args = dockerArgs(workspacePath(id), true, false, ["sleep", "infinity"], {
    image: toolchain.image,
    env: toolchain.env,
  });
  // Same limits as every container, but long-lived so it can be committed.
  args.splice(args.indexOf("--rm"), 1, "-d", "--name", setupContainer(id));
  const run = (command: string[]) =>
    execDocker(["exec", setupContainer(id), ...command], undefined, SETUP_TIMEOUT_MS);
  try {
    await execDocker(args);
    if (toolchain.setup) {
      await run(toolchain.setup);
      // A fresh clone has no untracked files: these all came from setup.
      setupOutputs = (await untrackedFiles(id, true, "all")).map((entry) => entry.replace(/\/$/, ""));
      if (setupOutputs.length)
        await run(["sh", "-c", COPY_ENTRIES, "sh", SANDBOX_ROOT, SETUP_COPY_DIR, ...setupOutputs]);
    }
    for (const { name, command } of checks)
      try {
        const result = await run(command);
        baseline.push({ check: name, passed: true, output: `${result.stdout}\n${result.stderr}`.slice(-4000) });
      } catch (error) {
        baseline.push({ check: name, passed: false, output: (error as Error).message.slice(-4000) });
      }
    await execDocker(["commit", setupContainer(id), snapshotImage(id)]);
  } finally {
    await exec("docker", ["rm", "-f", setupContainer(id)]).catch(() => undefined);
  }
  // A fresh clone has no untracked files, so everything here came from setup.
  await excludeFromDiffs(id, await untrackedFiles(id, true));
  return { image: snapshotImage(id), baseline, setupOutputs };
};

// Inside the snapshot, outside the workspace: what setup installed there.
const SETUP_COPY_DIR = "/opt/agent-setup-output";
// sh -c COPY_ENTRIES sh <from> <to> <entry>...: replaces each entry under <to>
// with a full copy of it from <from>, keeping modes and links.
const COPY_ENTRIES =
  'from=$1; to=$2; shift 2; for e in "$@"; do rm -rf "$to/$e" && mkdir -p "$(dirname "$to/$e")" && cp -a "$from/$e" "$to/$e" || exit 1; done';

/**
 * Makes the workspace hold only the change before the checks that judge it.
 * Anything the agent or a check left that the diff doesn't show (ignored or
 * excluded files: a conftest.py hidden from git, edited dependencies, build
 * output) is deleted, and what setup installed is restored from the copy in
 * the snapshot. So checks see exactly the base commit, the setup, and the
 * diff that is reviewed and published.
 */
export const prepareVerification = async (id: string, image: string, setupOutputs: string[]) => {
  const isSetupOutput = (entry: string) =>
    setupOutputs.some((output) => entry === output || entry.startsWith(`${output}/`));
  const leftovers = (await untrackedFiles(id, true, "ignored"))
    .map((entry) => entry.replace(/\/$/, ""))
    .filter((entry) => !isSetupOutput(entry));
  if (leftovers.length) await runDocker(id, ["rm", "-rf", "--", ...leftovers]);
  if (setupOutputs.length)
    await execDocker(
      dockerArgs(workspacePath(id), false, false, ["sh", "-c", COPY_ENTRIES, "sh", SETUP_COPY_DIR, SANDBOX_ROOT, ...setupOutputs], {
        image,
      }),
      undefined,
      SETUP_TIMEOUT_MS,
    );
};
/**
 * Commands that return a clone to its checked-out commit: tracked changes,
 * intent-to-add entries and new files are dropped. Ignored files (what
 * setup installed, tool caches) are kept so retries don't set up again.
 */
export const WORKSPACE_RESET_COMMANDS = [
  [...SAFE_GIT_ARGS, "reset", "--hard", "--quiet"],
  [...SAFE_GIT_ARGS, "clean", "-fd", "--quiet"],
];
export const resetWorkspace = async (id: string) => {
  for (const command of WORKSPACE_RESET_COMMANDS) await runDocker(id, command);
};
export const gitDiff = async (id: string) => {
  await runDocker(id, [...SAFE_GIT_ARGS, "add", "-N", "."]);
  return (
    await runDocker(id, [
      ...SAFE_GIT_ARGS,
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
    ])
  ).stdout;
};
export const changedFiles = async (id: string) =>
  (await changes(id)).map((change) => change.file);

/** A changed file and how: A added, M modified, D deleted, T type changed. */
export interface FileChange {
  status: string;
  file: string;
}

/** The change as the diff shows it; renames appear as a deletion and an addition. */
export const changes = async (id: string): Promise<FileChange[]> => {
  await runDocker(id, [...SAFE_GIT_ARGS, "add", "-N", "."]);
  const fields = (
    await runDocker(id, [...SAFE_GIT_ARGS, "diff", "--name-status", "--no-renames", "-z", "--no-ext-diff"])
  ).stdout
    .split("\0")
    .filter(Boolean);
  const result: FileChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2)
    result.push({ status: fields[index], file: fields[index + 1] });
  return result;
};

/** Files in the checked-out commit, whatever the index or working tree hold now. */
export const trackedFiles = async (id: string) =>
  (await runDocker(id, [...SAFE_GIT_ARGS, "ls-tree", "-r", "-z", "--name-only", "HEAD"])).stdout
    .split("\0")
    .filter(Boolean);

/**
 * Publishes an approved diff from a fresh clone. The verification workspace
 * ran untrusted code, so nothing from it (hooks, config, untracked files)
 * is trusted; only the reviewed patch is applied and pushed.
 */
export const publishApprovedDiff = async (input: {
  executionId: string;
  diff: string;
  branch: string;
  baseSha: string;
  owner: string;
  repo: string;
  token: string;
}) => {
  assertSafeRepo(input.owner, input.repo, input.baseSha);
  if (!/^[a-zA-Z0-9_./-]+$/.test(input.branch))
    throw new Error("Unsafe Git identifier");
  const publishId = `${input.executionId}-publish`;
  await removeWorkspace(publishId);
  const root = await createWorkspace(publishId);
  await fs.writeFile(path.join(root, "changes.diff"), input.diff, "utf8");
  const script = [
    `mkdir repo && cd repo`,
    `${AUTH_GIT} clone https://github.com/${input.owner}/${input.repo}.git .`,
    `${SAFE_GIT} checkout ${input.baseSha}`,
    `${SAFE_GIT} checkout -b '${input.branch}'`,
    `${SAFE_GIT} apply --index --binary ../changes.diff`,
    `${SAFE_GIT} -c user.name='Agent Orchestrator' -c user.email='agent@localhost' commit --no-verify -m 'fix: automated bug fix'`,
    // Force is safe: the branch is owned by this execution, and a retry after
    // a partial publish must be able to replace its own earlier push.
    `${AUTH_GIT} push --no-verify --force origin 'HEAD:refs/heads/${input.branch}'`,
  ].join(" && ");
  try {
    await execDocker(
      dockerArgs(root, true, true, ["sh", "-c", script]),
      input.token,
    );
  } finally {
    await removeWorkspace(publishId);
  }
};
export interface CheckResult {
  script: string;
  passed: boolean;
  output: string;
  /** Configured, but the toolchain has no command for it. */
  unavailable?: true;
}

/**
 * Runs the toolchain's checks in its image, without network, stopping at
 * the first failure. A configured check that doesn't exist is recorded as
 * unavailable and does not fail the verification: it says nothing about
 * the change.
 */
export const verifyWorkspace = async (
  id: string,
  toolchain: Toolchain,
  checks: { run: Array<{ name: string; command: string[] }>; unavailable: string[] },
) => {
  const results: CheckResult[] = checks.unavailable.map((script) => ({
    script,
    passed: true,
    unavailable: true,
    output: `No "${script}" check is configured for this repository.`,
  }));
  let failed = false;
  for (const { name, command } of checks.run)
    try {
      const result = await keepOutputOutOfDiffs(id, () =>
        execDocker(
          dockerArgs(workspacePath(id), false, false, command, {
            image: toolchain.image,
            env: toolchain.env,
          }),
        ),
      );
      results.push({
        script: name,
        passed: true,
        output: `${result.stdout}\n${result.stderr}`.slice(-100_000),
      });
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      results.push({ script: name, passed: false, output });
      failed = true;
      break;
    }
  return { passed: !failed, checksRun: checks.run.length, results };
};
/** What a verification proved, for the PR body: which checks passed, and which did not exist. */
export const describeVerification = (verification: unknown) => {
  const { checksRun, results } = (verification ?? {}) as {
    checksRun?: number;
    results?: CheckResult[];
  };
  const ran = (results ?? []).filter((result) => !result.unavailable).map((result) => result.script);
  const unavailable = (results ?? []).filter((result) => result.unavailable).map((result) => result.script);
  // Artifacts from before toolchains have results but no checksRun.
  const lines = [
    !(checksRun ?? ran.length)
      ? "**Unverified:** no checks are available for this repository, so nothing was run against this change."
      : `Checks passed: ${ran.join(", ")}.`,
  ];
  if (unavailable.length) lines.push(`Not available in this repository: ${unavailable.join(", ")}.`);
  return lines.join("\n");
};

/**
 * Long-lived sandbox for one run: started once, then each command is a
 * `docker exec`, instead of a new container per command. Same limits as
 * every other workspace container, and never any network.
 */
const sandboxName = (id: string) => `agent-sandbox-${safeId(id)}`;

export const startSandbox = async (id: string, toolchain: Toolchain) => {
  // A crashed earlier attempt may have left one behind.
  await stopSandbox(id);
  await execDocker([
    "run",
    "-d",
    "--name",
    sandboxName(id),
    ...LIMIT_ARGS,
    "--network",
    "none",
    // `docker exec` inherits these, so every command sees the toolchain's caches.
    ...envArgs(toolchain.env),
    ...workspaceMounts(workspacePath(id), false),
    "-w",
    SANDBOX_ROOT,
    toolchain.image,
    "sleep",
    "infinity",
  ]);
};

export const stopSandbox = async (id: string) => {
  try {
    await exec("docker", ["rm", "-f", sandboxName(id)], { timeout: 60_000 });
  } catch {
    // Not running: nothing to stop.
  }
};

export interface SandboxResult {
  exitCode: number;
  timedOut: boolean;
  output: string;
}

/**
 * Runs a command in the run's sandbox. A non-zero exit is a result, not an
 * error (a failing test is information for the agent). The time limit is
 * enforced inside the container, so a runaway process is killed there
 * instead of only detaching the host-side client.
 */
export const execInSandbox = async (
  id: string,
  command: string[],
  timeoutMs: number,
): Promise<SandboxResult> => {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  try {
    const result = await exec(
      "docker",
      ["exec", sandboxName(id), "timeout", "-s", "KILL", String(seconds), ...command],
      { timeout: timeoutMs + 30_000, maxBuffer: 5_000_000 },
    );
    return { exitCode: 0, timedOut: false, output: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string; killed?: boolean };
    // Docker itself failed (no daemon, container gone): not the command's result.
    if (
      typeof failure.code !== "number" ||
      /Error response from daemon|Cannot connect to the Docker daemon/.test(failure.stderr ?? "")
    )
      throw dockerFailure(error);
    return {
      exitCode: failure.code,
      // `timeout -s KILL` exits 137 when it had to kill the command.
      timedOut: failure.code === 137 || failure.killed === true,
      output: `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
    };
  }
};

export const hashFile = async (filePath: string) =>
  crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
