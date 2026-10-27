import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "../../config";
import { findSymlink, isGitPath, resolveInsideRoot } from "../../utils/safePath";
import { isProtectedPath } from "../agentGraph/repoPolicy";
import { ToolDefinition } from "../llm/types";
import { SandboxResult } from "../workspaceService";

/**
 * Tools the agent uses inside a run's workspace. Every safety rule is
 * enforced here, in the tool, whatever the prompt or a skill says. A denied
 * or failed call is returned to the model as a result it can act on; only
 * bugs in this module throw.
 */

export interface ToolContext {
  /** Host path of the run's workspace (bind-mounted into the sandbox). */
  root: string;
  protectedPaths: string[];
  /** Checks run_check may run, by name: the repository toolchain's checks. */
  checkScripts: string[];
  /** Runs the named check's command in the run's sandbox. */
  runCheck: (check: string) => Promise<SandboxResult>;
  /** Runs a shell command in the run's sandbox (no network). */
  runCommand: (command: string, timeoutMs: number) => Promise<SandboxResult>;
  /** Whether a repository-relative path is a test file, per the toolchain. */
  isTestFile: (file: string) => boolean;
  /** Whether a file is tracked at the base commit; new files are not "existing" tests. */
  isBaseFile: (file: string) => boolean;
}

export type ToolStatus = "COMPLETED" | "DENIED" | "FAILED";

export interface ToolOutcome {
  status: ToolStatus;
  output: string;
  /** Set by finish: the agent's own verdict on the run. */
  finish?: { status: "done" | "blocked"; summary: string };
}

const MAX_OUTPUT_CHARS = 20_000;
const MAX_LIST_ENTRIES = 500;
const MAX_READ_LINES = 400;
const MAX_READ_BYTES = 5_000_000;
const MAX_SEARCH_MATCHES = 100;
const MAX_SEARCH_FILE_BYTES = 1_000_000;
const MAX_MATCH_LINE_CHARS = 300;
export const CHECK_TIMEOUT_MS = 300_000;
const MAX_COMMAND_CHARS = 4000;
// Dependencies, caches and build output of the common toolchains.
const SKIPPED_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  ".venv",
  "__pycache__",
  "target",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  ".gradle",
]);

export const SANDBOX_TOOLS: ToolDefinition[] = [
  {
    name: "list_files",
    description:
      "List files under a directory of the repository (recursive, skips node_modules, .git and build output).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: 'Directory relative to the repository root; default "."' } },
    },
  },
  {
    name: "read_file",
    description: `Read a file with line numbers. At most ${MAX_READ_LINES} lines per call; use startLine/endLine to page through larger files.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the repository root" },
        startLine: { type: "integer", description: "First line to read (1-based)" },
        endLine: { type: "integer", description: "Last line to read (inclusive)" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_code",
    description: `Find lines containing a piece of text (plain text, not a regex; case-insensitive). Returns up to ${MAX_SEARCH_MATCHES} matches as path:line: text.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for" },
        path: { type: "string", description: 'Directory to search; default "."' },
      },
      required: ["query"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace one exact piece of text in a file. oldText must appear exactly once; include enough surrounding lines to make it unique. To create a new file, pass an empty oldText. Existing test files and protected paths cannot be changed; add new test files instead.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the repository root" },
        oldText: { type: "string", description: "Exact text to replace, or empty to create a new file" },
        newText: { type: "string", description: "Replacement text (the whole content for a new file)" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "run_check",
    description:
      "Run one of the repository's checks by name (for example test, lint or build, as configured for its language) and see its output.",
    parameters: {
      type: "object",
      properties: { check: { type: "string", description: "Check name, e.g. test" } },
      required: ["check"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the repository's sandbox and see its output and exit code: build, run tests or a single test, use the language's tools, inspect the environment. The working directory is the repository root; there is no network, and dependencies are already installed. Files the command changes are part of your change, and the same rules apply to them: existing test files and protected files must not change. .git is read-only.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command (run with sh -c)" },
        timeoutSeconds: {
          type: "integer",
          description: `Time limit in seconds; default and maximum ${CHECK_TIMEOUT_MS / 1000}`,
        },
      },
      required: ["command"],
    },
  },
  {
    name: "finish",
    description:
      'End the run. Use status "done" when the change is complete, or "blocked" when the ticket cannot or should not be done (unclear, impossible or unsafe); explain why in the summary.',
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["done", "blocked"] },
        summary: { type: "string", description: "What was changed, or why the ticket is blocked" },
      },
      required: ["status", "summary"],
    },
  },
];

const ARGS = {
  list_files: z.object({ path: z.string().optional() }),
  read_file: z.object({
    path: z.string(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  }),
  search_code: z.object({ query: z.string().min(1), path: z.string().optional() }),
  edit_file: z.object({ path: z.string(), oldText: z.string(), newText: z.string() }),
  run_check: z.object({ check: z.string() }),
  run_command: z.object({
    command: z.string().min(1).max(MAX_COMMAND_CHARS),
    timeoutSeconds: z.number().int().positive().max(CHECK_TIMEOUT_MS / 1000).optional(),
  }),
  finish: z.object({ status: z.enum(["done", "blocked"]), summary: z.string().min(1) }),
};

const completed = (output: string): ToolOutcome => ({ status: "COMPLETED", output });
const denied = (output: string): ToolOutcome => ({ status: "DENIED", output });
const failed = (output: string): ToolOutcome => ({ status: "FAILED", output });

/** Caps output; keeps the end for command output, where errors are. */
const cap = (text: string, keep: "head" | "tail" = "head") => {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const note = `[output truncated: ${text.length} characters, showing the ${keep === "head" ? "first" : "last"} ${MAX_OUTPUT_CHARS}]`;
  return keep === "head"
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n${note}`
    : `${note}\n${text.slice(-MAX_OUTPUT_CHARS)}`;
};

/** Applies the path rules shared by every file tool; a string is a denial. */
const checkPath = (ctx: ToolContext, filePath: string) => {
  const resolved = resolveInsideRoot(ctx.root, filePath);
  if (!resolved) return `Path "${filePath}" is outside the repository.`;
  if (isGitPath(resolved.relativePath)) return "Git metadata (.git) is off limits.";
  if (findSymlink(ctx.root, resolved.relativePath))
    return `Path "${filePath}" goes through a symbolic link, which is not allowed.`;
  return resolved;
};

const isBinary = (buffer: Buffer) => buffer.subarray(0, 8000).includes(0);

/** Files below `dir` (relative paths), skipping build output and symlinks. */
const walk = (ctx: ToolContext, dir: string, limit: number) => {
  const files: string[] = [];
  let truncated = false;
  const visit = (relativeDir: string) => {
    const entries = fs
      .readdirSync(path.join(ctx.root, relativeDir), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const relative = relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) visit(relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };
  visit(dir);
  return { files, truncated };
};

const listFiles = (ctx: ToolContext, args: z.infer<typeof ARGS.list_files>) => {
  const target = checkPath(ctx, args.path || ".");
  if (typeof target === "string") return denied(target);
  if (!fs.existsSync(target.fullPath) || !fs.statSync(target.fullPath).isDirectory())
    return failed(`"${args.path}" is not a directory.`);
  const { files, truncated } = walk(ctx, target.relativePath || ".", MAX_LIST_ENTRIES);
  const note = truncated ? `\n[only the first ${MAX_LIST_ENTRIES} files are listed; list a subdirectory]` : "";
  return completed(cap(`${files.join("\n") || "(no files)"}${note}`));
};

const readFile = (ctx: ToolContext, args: z.infer<typeof ARGS.read_file>) => {
  const target = checkPath(ctx, args.path);
  if (typeof target === "string") return denied(target);
  if (!fs.existsSync(target.fullPath) || !fs.statSync(target.fullPath).isFile())
    return failed(`File "${args.path}" does not exist.`);
  if (fs.statSync(target.fullPath).size > MAX_READ_BYTES)
    return failed(`File "${args.path}" is too large to read.`);
  const buffer = fs.readFileSync(target.fullPath);
  if (isBinary(buffer)) return failed(`File "${args.path}" is binary.`);

  const lines = buffer.toString("utf8").split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const start = args.startLine ?? 1;
  if (start > lines.length) return failed(`"${args.path}" has only ${lines.length} lines.`);
  const end = Math.min(args.endLine ?? lines.length, lines.length, start + MAX_READ_LINES - 1);
  const body = lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}: ${line}`)
    .join("\n");
  const more = end < lines.length ? `\n[more: lines ${end + 1}-${lines.length}; call read_file with startLine ${end + 1}]` : "";
  return completed(cap(`${target.relativePath} (lines ${start}-${end} of ${lines.length})\n${body}${more}`));
};

const searchCode = (ctx: ToolContext, args: z.infer<typeof ARGS.search_code>) => {
  const target = checkPath(ctx, args.path || ".");
  if (typeof target === "string") return denied(target);
  if (!fs.existsSync(target.fullPath) || !fs.statSync(target.fullPath).isDirectory())
    return failed(`"${args.path}" is not a directory.`);
  const query = args.query.toLowerCase();
  const matches: string[] = [];
  for (const file of walk(ctx, target.relativePath || ".", Number.MAX_SAFE_INTEGER).files) {
    const fullPath = path.join(ctx.root, file);
    if (fs.statSync(fullPath).size > MAX_SEARCH_FILE_BYTES) continue;
    const buffer = fs.readFileSync(fullPath);
    if (isBinary(buffer)) continue;
    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].toLowerCase().includes(query)) continue;
      matches.push(`${file}:${index + 1}: ${lines[index].trim().slice(0, MAX_MATCH_LINE_CHARS)}`);
      if (matches.length >= MAX_SEARCH_MATCHES)
        return completed(cap(`${matches.join("\n")}\n[stopped at ${MAX_SEARCH_MATCHES} matches; narrow the query or path]`));
    }
  }
  return completed(cap(matches.join("\n") || `No matches for "${args.query}".`));
};

const editFile = (ctx: ToolContext, args: z.infer<typeof ARGS.edit_file>) => {
  const target = checkPath(ctx, args.path);
  if (typeof target === "string") return denied(target);
  const file = target.relativePath;
  if (isProtectedPath(file, ctx.protectedPaths))
    return denied(`"${file}" is protected and cannot be changed. Protected: ${ctx.protectedPaths.join(", ")}.`);
  const exists = fs.existsSync(target.fullPath);
  if (exists && !fs.statSync(target.fullPath).isFile()) return failed(`"${file}" is not a file.`);
  if (exists && ctx.isTestFile(file) && ctx.isBaseFile(file))
    return denied(`"${file}" is an existing test file and cannot be changed. Add new tests in a new file instead.`);

  let content: string;
  if (args.oldText === "") {
    if (exists) return failed(`"${file}" already exists; pass the text to replace as oldText.`);
    content = args.newText;
  } else {
    if (!exists) return failed(`File "${file}" does not exist; pass an empty oldText to create it.`);
    const current = fs.readFileSync(target.fullPath, "utf8");
    // Models write \n; keep a CRLF file's line endings intact.
    const crlf = current.includes("\r\n") && !args.oldText.includes("\r\n");
    const oldText = crlf ? args.oldText.replace(/\n/g, "\r\n") : args.oldText;
    const newText = crlf ? args.newText.replace(/\n/g, "\r\n") : args.newText;
    const occurrences = current.split(oldText).length - 1;
    if (occurrences === 0) return failed(`oldText was not found in "${file}". Read the file and copy the text exactly.`);
    if (occurrences > 1)
      return failed(`oldText appears ${occurrences} times in "${file}"; include more surrounding lines so it is unique.`);
    content = current.replace(oldText, () => newText);
  }
  if (Buffer.byteLength(content, "utf8") > config.generatedCodeMaxFileBytes)
    return denied(`The result would exceed the ${config.generatedCodeMaxFileBytes}-byte file limit.`);

  fs.mkdirSync(path.dirname(target.fullPath), { recursive: true });
  fs.writeFileSync(target.fullPath, content);
  return completed(exists ? `Edited ${file}.` : `Created ${file}.`);
};

const runCheck = async (ctx: ToolContext, args: z.infer<typeof ARGS.run_check>) => {
  if (!ctx.checkScripts.includes(args.check))
    return denied(`"${args.check}" is not an available check. Available: ${ctx.checkScripts.join(", ") || "none"}.`);
  const result = await ctx.runCheck(args.check);
  return completed(cap(`${args.check} check: ${verdict(result, CHECK_TIMEOUT_MS)}\n${result.output.trim()}`, "tail"));
};

const verdict = (result: SandboxResult, timeoutMs: number) =>
  result.timedOut
    ? `TIMED OUT after ${timeoutMs / 1000}s`
    : result.exitCode === 0
      ? "PASSED"
      : `FAILED (exit code ${result.exitCode})`;

const runCommand = async (ctx: ToolContext, args: z.infer<typeof ARGS.run_command>) => {
  const timeoutMs = (args.timeoutSeconds ?? CHECK_TIMEOUT_MS / 1000) * 1000;
  const result = await ctx.runCommand(args.command, timeoutMs);
  return completed(cap(`$ ${args.command}\n${verdict(result, timeoutMs)}\n${result.output.trim()}`, "tail"));
};

/** Runs one tool call. Unknown tools and invalid arguments are FAILED results. */
export const executeTool = async (
  ctx: ToolContext,
  name: string,
  rawArgs: Record<string, unknown>,
): Promise<ToolOutcome> => {
  if (!(name in ARGS)) return failed(`Unknown tool "${name}". Available: ${Object.keys(ARGS).join(", ")}.`);
  const parsed = ARGS[name as keyof typeof ARGS].safeParse(rawArgs);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failed(`Invalid arguments for ${name}: ${issue.path.join(".") || "input"} ${issue.message}.`);
  }
  try {
    switch (name) {
      case "list_files":
        return listFiles(ctx, parsed.data as z.infer<typeof ARGS.list_files>);
      case "read_file":
        return readFile(ctx, parsed.data as z.infer<typeof ARGS.read_file>);
      case "search_code":
        return searchCode(ctx, parsed.data as z.infer<typeof ARGS.search_code>);
      case "edit_file":
        return editFile(ctx, parsed.data as z.infer<typeof ARGS.edit_file>);
      case "run_check":
        return await runCheck(ctx, parsed.data as z.infer<typeof ARGS.run_check>);
      case "run_command":
        return await runCommand(ctx, parsed.data as z.infer<typeof ARGS.run_command>);
      default: {
        const args = parsed.data as z.infer<typeof ARGS.finish>;
        return { ...completed(`Finished (${args.status}).`), finish: args };
      }
    }
  } catch (error) {
    // Filesystem errors (permissions, races) are results the agent can see,
    // without the host's directory layout.
    const message = error instanceof Error ? error.message : String(error);
    return failed(`${name} failed: ${message.split(ctx.root).join(".")}`);
  }
};
