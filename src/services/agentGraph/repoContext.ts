import { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export interface RepoContext {
  fileTree: string[];
  packageScripts: string[];
  selectedFiles: string[];
  selectedFileContents: Array<{ path: string; content: string }>;
  summary: string;
}

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);
const MAX_FILE_TREE_ENTRIES = 250;
const MAX_SELECTED_FILES = 12;
const MAX_FILE_BYTES = 20_000;
const MAX_CONTEXT_CHARS = 60_000;

const normalizeRelativePath = (value: string) => value.replaceAll("\\", "/");

const shouldSkipEntry = (entry: Dirent): boolean => {
  const isDotFile = entry.name.startsWith(".") && entry.name !== ".env.example";
  const isExcludedDir = entry.isDirectory() && EXCLUDED_DIRS.has(entry.name);
  return isDotFile && isExcludedDir;
};

const safeReadText = async (filePath: string, maxBytes = MAX_FILE_BYTES) => {
  const buffer = await fs.readFile(filePath);
  return buffer.subarray(0, maxBytes).toString("utf8");
};

const listFiles = async (root: string) => {
  const files: string[] = [];
  const visit = async (dir: string) => {
    if (files.length >= MAX_FILE_TREE_ENTRIES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILE_TREE_ENTRIES) break;
      if (shouldSkipEntry(entry)) continue;
      const fullPath = path.join(dir, entry.name);
      const relative = normalizeRelativePath(path.relative(root, fullPath));
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };
  await visit(root);
  return files.sort((a, b) => a.localeCompare(b));
};

const parsePackageScripts = async (root: string) => {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    const value = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return Object.keys(value.scripts ?? {}).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

const tokenize = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );

const scoreFile = (file: string, ticketTokens: Set<string>) => {
  const lower = file.toLowerCase();
  let score = 0;
  if (lower === "readme.md") score += 12;
  if (lower === "package.json") score += 10;
  if (lower.includes("test") || lower.includes("spec")) score += 4;
  if (lower.startsWith("src/")) score += 3;
  for (const token of ticketTokens) {
    if (lower.includes(token)) score += 8;
  }
  return score;
};

const selectRelevantFiles = (files: string[], ticket: string) => {
  const ticketTokens = tokenize(ticket);
  const ranked = files
    .filter((file) => /\.(ts|tsx|js|jsx|json|md|yml|yaml|css|scss)$/.test(file))
    .map((file) => ({ file, score: scoreFile(file, ticketTokens) }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const selected = ranked
    .filter((entry) => entry.score > 0)
    .slice(0, MAX_SELECTED_FILES)
    .map((entry) => entry.file);
  if (selected.length > 0) return selected;
  return files
    .filter((file) => file === "README.md" || file === "package.json")
    .slice(0, MAX_SELECTED_FILES);
};

const readSelectedFiles = async (root: string, files: string[]) => {
  const contents: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    const fullPath = path.resolve(root, file);
    const relative = path.relative(root, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      contents.push({ path: file, content: await safeReadText(fullPath) });
    } catch {
      // Files can disappear during generated edits; skip unavailable context.
    }
  }
  return contents;
};

const formatSummary = (context: Omit<RepoContext, "summary">) => {
  const selected = context.selectedFileContents
    .map(
      // Not the "FILE:" output syntax, so models don't echo it back unfenced.
      (file) =>
        `--- ${file.path} ---\n${file.content.slice(0, MAX_FILE_BYTES)}\n--- end of ${file.path} ---`,
    )
    .join("\n\n");
  return [
    `Repository file tree sample:\n${context.fileTree.join("\n")}`,
    `Package scripts: ${context.packageScripts.join(", ") || "none detected"}`,
    `Selected files:\n${selected || "No selected files could be read."}`,
  ]
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);
};

export const collectRepoContext = async (root: string, ticket: string) => {
  const fileTree = await listFiles(root);
  const packageScripts = await parsePackageScripts(root);
  const selectedFiles = selectRelevantFiles(fileTree, ticket);
  const selectedFileContents = await readSelectedFiles(root, selectedFiles);
  const partial = {
    fileTree,
    packageScripts,
    selectedFiles,
    selectedFileContents,
  };
  return { ...partial, summary: formatSummary(partial) };
};
