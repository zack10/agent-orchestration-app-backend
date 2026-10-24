// Coding benchmark scenarios (Phase 0 of docs/plans/AGENTIC_ROADMAP.md).
//
// coding-scenarios/repo/ is the clean benchmark project. Each scenario folder
// holds scenario.json (the ticket and what is expected), bug/ (files that
// replace the clean ones to plant the bug) and hidden.test.js, which never
// leaves this repository: the agent cannot see or edit it.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "coding-scenarios");
const REPO_DIR = path.join(ROOT, "repo");

const listFiles = (dir, prefix = "") =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), relative) : [relative];
  });

// LF only, so a Windows checkout (core.autocrlf) pushes the same bytes as any other.
const readText = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const readTree = (dir) => new Map(listFiles(dir).map((file) => [file, readText(path.join(dir, file))]));

const loadScenarios = () =>
  fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .map((entry) => {
      const dir = path.join(ROOT, entry.name);
      const hiddenPath = path.join(dir, "hidden.test.js");
      return {
        id: entry.name,
        dir,
        ...JSON.parse(readText(path.join(dir, "scenario.json"))),
        bugFiles: fs.existsSync(path.join(dir, "bug")) ? readTree(path.join(dir, "bug")) : new Map(),
        hiddenTest: fs.existsSync(hiddenPath) ? readText(hiddenPath) : null,
      };
    });

/** The clean benchmark project. */
const cleanFiles = () => readTree(REPO_DIR);

/** What the agent starts from: the clean project with the scenario's bug planted. */
const scenarioFiles = (scenario) => new Map([...cleanFiles(), ...scenario.bugFiles]);

const writeTree = (dir, files) => {
  for (const [file, content] of files) {
    const target = path.join(dir, ...file.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
};

/** Where a hidden test is placed for grading; it requires "../src/...". */
const hiddenTestPath = (scenario) => `hidden/${scenario.id}.test.js`;

/**
 * Files touched and lines added/removed by a `git diff` patch. `editedFiles`
 * lists files that lost or changed at least one existing line (including
 * deleted files), as opposed to files that only gained lines.
 */
const diffStats = (diff) => {
  const files = new Set();
  const editedFiles = new Set();
  let current;
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      current = header[2];
      files.add(current);
    } else if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
      editedFiles.add(current);
    }
  }
  return { files: [...files].sort(), editedFiles: [...editedFiles].sort(), added, removed };
};

module.exports = {
  cleanFiles,
  diffStats,
  hiddenTestPath,
  loadScenarios,
  scenarioFiles,
  writeTree,
};
