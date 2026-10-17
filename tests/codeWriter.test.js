const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { writeGeneratedCode } = require("../dist/utils/codeWriter");

test("writes generated files below the project output directory", () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "orchestrator-code-writer-"),
  );
  try {
    process.chdir(tempDir);
    const files = writeGeneratedCode(
      "FILE: src/index.ts\n```ts\nexport {};\n```",
      "Test Project",
    );
    assert.deepEqual(files, ["src/index.ts"]);
    assert.equal(
      fs.readFileSync(
        path.join(tempDir, "generated-code/test-project/src/index.ts"),
        "utf8",
      ),
      "export {};\n",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rejects generated paths that escape the output directory", () => {
  assert.throws(
    () =>
      writeGeneratedCode(
        "FILE: ../../src/index.ts\n```ts\nunsafe\n```",
        "Test Project",
      ),
    /escapes output directory/,
  );
});
