const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { reviewDiffSafety } = require("../dist/services/agentGraph/diffReview");
const {
  collectRepoContext,
} = require("../dist/services/agentGraph/repoContext");

test("diff review rejects added secrets", () => {
  const result = reviewDiffSafety(
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "+const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';",
    ].join("\n"),
    ["src/app.ts"],
  );

  assert.equal(result.passed, false);
  assert.match(result.issues.join("\n"), /secret|credential/i);
});

test("repo context selects likely relevant files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-graph-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }),
  );
  await fs.writeFile(path.join(root, "README.md"), "# Demo\n");
  await fs.writeFile(
    path.join(root, "src", "trelloAdapter.ts"),
    "export const syncTrello = () => undefined;\n",
  );

  const context = await collectRepoContext(root, "Fix Trello sync bug");

  assert.ok(context.fileTree.includes("src/trelloAdapter.ts"));
  assert.ok(context.packageScripts.includes("test"));
  assert.ok(context.selectedFiles.includes("src/trelloAdapter.ts"));
  assert.match(context.summary, /src\/trelloAdapter\.ts/);
});
