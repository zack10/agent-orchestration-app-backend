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
export const removeWorkspace = async (id: string) =>
  fs.rm(workspacePath(id), { recursive: true, force: true });
// Repository-controlled config (hooks, fsmonitor, textconv) must never run
// with credentials or influence what is reviewed.
const SAFE_GIT = "git -c core.hooksPath=/dev/null -c core.fsmonitor=false";
const SAFE_GIT_ARGS = [
  "git",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
];
// The token is read from the container env and sent as an HTTP header, so it
// is never written to .git/config or placed on the docker command line.
const AUTH_GIT = `${SAFE_GIT} -c http.extraHeader="Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)"`;

const dockerArgs = (
  root: string,
  network: boolean,
  withToken: boolean,
  command: string[],
) => [
  "run",
  "--rm",
  "--cpus",
  "2",
  "--memory",
  "2g",
  "--pids-limit",
  "256",
  "--network",
  network ? "bridge" : "none",
  // `-e NAME` without a value makes docker read it from our process env.
  ...(withToken ? ["-e", "GITHUB_TOKEN"] : []),
  "-v",
  `${root}:/workspace`,
  "-w",
  "/workspace",
  "node:20-bookworm",
  ...command,
];

const execDocker = (args: string[], token?: string) =>
  exec("docker", args, {
    timeout: 300_000,
    maxBuffer: 5_000_000,
    env: token ? { ...process.env, GITHUB_TOKEN: token } : process.env,
  });

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
export const hashFile = async (filePath: string) =>
  crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
