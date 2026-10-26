import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config";

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

const SANDBOX_IMAGE = "node:20-bookworm";
const LIMIT_ARGS = ["--cpus", "2", "--memory", "2g", "--pids-limit", "256"];

const dockerArgs = (
  root: string,
  network: boolean,
  withToken: boolean,
  command: string[],
) => [
  "run",
  "--rm",
  ...LIMIT_ARGS,
  "--network",
  network ? "bridge" : "none",
  // `-e NAME` without a value makes docker read it from our process env.
  ...(withToken ? ["-e", "GITHUB_TOKEN"] : []),
  "-v",
  `${root}:/workspace`,
  "-w",
  "/workspace",
  SANDBOX_IMAGE,
  ...command,
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

const execDocker = async (args: string[], token?: string) => {
  try {
    return await exec("docker", args, {
      timeout: 300_000,
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
  const script = `${AUTH_GIT} clone https://github.com/${owner}/${repo}.git . && ${SAFE_GIT} checkout ${sha} && npm ci --ignore-scripts`;
  await execDocker(dockerArgs(root, true, true, ["sh", "-c", script]), token);
};
/**
 * Commands that return a clone to its checked-out commit: tracked changes,
 * intent-to-add entries and new files are dropped. Ignored files (installed
 * node_modules) are kept so retries don't reinstall dependencies.
 */
export const WORKSPACE_RESET_COMMANDS = [
  [...SAFE_GIT_ARGS, "reset", "--hard", "--quiet"],
  [...SAFE_GIT_ARGS, "clean", "-fd", "--quiet", "-e", "node_modules"],
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
export const changedFiles = async (id: string) => {
  await runDocker(id, [...SAFE_GIT_ARGS, "add", "-N", "."]);
  return (
    await runDocker(id, [...SAFE_GIT_ARGS, "diff", "--name-only", "--no-ext-diff"])
  ).stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
};

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
export const verifyWorkspace = async (id: string, scripts: string[]) => {
  const results: Array<{ script: string; passed: boolean; output: string }> =
    [];
  for (const script of scripts)
    try {
      const result = await runDocker(id, ["npm", "run", script]);
      results.push({
        script,
        passed: true,
        output: `${result.stdout}\n${result.stderr}`.slice(-100_000),
      });
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      results.push({ script, passed: false, output });
      break;
    }
  return {
    passed:
      results.length === scripts.length &&
      results.every((result) => result.passed),
    results,
  };
};
/**
 * Long-lived sandbox for one run: started once, then each command is a
 * `docker exec`, instead of a new container per command. Same limits as
 * every other workspace container, and never any network.
 */
const sandboxName = (id: string) => `agent-sandbox-${safeId(id)}`;

export const startSandbox = async (id: string) => {
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
    "-v",
    `${workspacePath(id)}:/workspace`,
    "-w",
    "/workspace",
    SANDBOX_IMAGE,
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
