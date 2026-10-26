const assert = require("node:assert/strict");
const test = require("node:test");

const {
  describeToolchain,
  isTestFile,
  parseVerificationConfig,
  resolveToolchain,
  selectChecks,
} = require("../dist/services/toolchain");
const { parseJsonc } = require("../dist/services/toolchain/devcontainer");
const { config } = require("../dist/config");

/** An in-memory repository: { "path": "content" }. */
const repo = (files) => (file) => files[file];
const resolve = (files, verificationConfig = {}) => resolveToolchain(repo(files), verificationConfig);

const NODE_ENVIRONMENT = {
  toolchain: {
    image: "node:20-bookworm",
    setup: ["npm", "ci", "--ignore-scripts"],
    checks: { test: ["npm", "test"] },
    protectedPaths: ["package.json", "package-lock.json"],
  },
};

test("with nothing defined, any project gets the default image and no checks", () => {
  for (const files of [{ "pom.xml": "<project/>" }, { "composer.json": "{}" }, { "main.c": "" }, {}]) {
    const { toolchain, source, notes } = resolve(files);
    assert.equal(source, "default");
    assert.equal(toolchain.image, config.executionDefaultImage);
    assert.equal(toolchain.setup, null);
    assert.deepEqual(toolchain.checks, {});
    assert.deepEqual(toolchain.env, {});
    assert.ok(notes.some((note) => /no checks are configured/.test(note)));
  }
  assert.match(describeToolchain(resolve({}).toolchain), /checks: none available/);
});

test("the repository's configuration is used as configured", () => {
  const { toolchain, source, notes } = resolve({ "package.json": "{}" }, NODE_ENVIRONMENT);
  assert.equal(source, "configured");
  assert.equal(toolchain.image, "node:20-bookworm");
  assert.deepEqual(toolchain.setup, ["npm", "ci", "--ignore-scripts"]);
  assert.deepEqual(toolchain.checks, { test: ["npm", "test"] });
  assert.deepEqual(toolchain.protectedPaths, ["package.json", "package-lock.json"]);
  assert.deepEqual(notes, []);
});

const DEVCONTAINER = `{
  // The project's own environment.
  "image": "mcr.microsoft.com/devcontainers/php:8.3",
  "features": { "ghcr.io/devcontainers/features/node:1": {} },
  "containerEnv": { "APP_ENV": "testing", "PATH": "\${containerEnv:PATH}:/extra" },
  "onCreateCommand": "composer install --no-interaction",
  "postCreateCommand": { "assets": ["npm", "ci"], "url": "echo 'http://x/*y*/'" }, /* trailing comma: */
}`;

test("the project's devcontainer gives the image, env and setup, and reports what it skipped", () => {
  const { toolchain, source, reason, notes } = resolve({ ".devcontainer/devcontainer.json": DEVCONTAINER });
  assert.equal(source, "devcontainer");
  assert.match(reason, /\.devcontainer\/devcontainer\.json/);
  assert.equal(toolchain.image, "mcr.microsoft.com/devcontainers/php:8.3");
  assert.equal(toolchain.env.APP_ENV, "testing");
  assert.equal(toolchain.env.PATH, undefined, "variables need a running dev container");
  assert.deepEqual(toolchain.setup, [
    "sh",
    "-c",
    "composer install --no-interaction && npm ci && echo 'http://x/*y*/'",
  ]);
  assert.ok(notes.some((note) => /features were not applied: ghcr\.io\/devcontainers\/features\/node:1/.test(note)));
  assert.ok(notes.some((note) => /containerEnv\.PATH was not applied/.test(note)));
});

test("configuration wins over the devcontainer field by field", () => {
  const configured = resolve(
    { ".devcontainer.json": '{ "image": "python:3.12", "postCreateCommand": "pip install -e ." }' },
    { toolchain: { checks: { test: ["pytest", "-q"] } } },
  );
  assert.equal(configured.source, "devcontainer", "no configured image: the project's is used");
  assert.deepEqual(configured.toolchain.setup, ["sh", "-c", "pip install -e ."]);
  assert.deepEqual(configured.toolchain.checks, { test: ["pytest", "-q"] });

  const image = resolve({ ".devcontainer.json": '{ "image": "python:3.12" }' }, { toolchain: { image: "python:3.13" } });
  assert.equal(image.source, "configured");
  assert.equal(image.toolchain.image, "python:3.13");
});

test("a devcontainer that can't be used falls back to the default image and says why", () => {
  const dockerfile = resolve({ ".devcontainer/devcontainer.json": '{ "build": { "dockerfile": "Dockerfile" } }' });
  assert.equal(dockerfile.source, "default");
  assert.ok(dockerfile.notes.some((note) => /builds a Dockerfile, which is not supported yet/.test(note)));

  const broken = resolve({ ".devcontainer.json": "{ not json" });
  assert.equal(broken.source, "default");
  assert.ok(broken.notes.some((note) => /could not be parsed/.test(note)));

  const unsafe = resolve({ ".devcontainer.json": '{ "image": "--privileged" }' });
  assert.equal(unsafe.toolchain.image, config.executionDefaultImage);
  assert.ok(unsafe.notes.some((note) => /not a valid image reference/.test(note)));
});

test("JSONC parsing keeps comment-like text and commas inside strings", () => {
  assert.deepEqual(parseJsonc('{ "a": "x // y", "b": "/* z */", "c": "1,}", }'), { a: "x // y", b: "/* z */", c: "1,}" });
  assert.deepEqual(parseJsonc('[1, 2, /* three */ ]'), [1, 2]);
  assert.deepEqual(parseJsonc('{ "q": "say \\"hi\\" // not a comment" }'), { q: 'say "hi" // not a comment' });
});

test("invalid configuration is rejected as non-retryable", () => {
  const rejects = (verificationConfig, pattern) =>
    assert.throws(
      () => parseVerificationConfig(verificationConfig),
      (error) => error.name === "NonRetryableError" && pattern.test(error.message),
    );
  rejects({ toolchain: { image: "Bad Image!" } }, /invalid image reference/);
  rejects({ toolchain: { image: "--privileged" } }, /invalid image reference/);
  rejects({ toolchain: { testFilePatterns: ["(unclosed"] } }, /invalid regular expression/);
  rejects({ toolchain: { env: { "has-dash": "x" } } }, /toolchain\.env/);
  rejects({ toolchain: { preset: "node" } }, /Unrecognized key/);
  rejects({ unknown: true }, /Unrecognized key/);
  assert.deepEqual(parseVerificationConfig(null), {}, "no configuration is valid");
});

test("selected checks that the repository lacks are unavailable, not failed", () => {
  const { toolchain } = resolve({}, { toolchain: { checks: { build: ["make"], test: ["make", "test"] } } });
  assert.deepEqual(selectChecks(toolchain, {}).run.map((check) => check.name), ["build", "test"]);
  const selected = selectChecks(toolchain, { scripts: ["test", "lint"] });
  assert.deepEqual(selected.run, [{ name: "test", command: ["make", "test"] }]);
  assert.deepEqual(selected.unavailable, ["lint"]);
});

test("the PR body says which checks ran, and when none did", () => {
  const { describeVerification } = require("../dist/services/workspaceService");
  const verified = describeVerification({
    checksRun: 2,
    results: [
      { script: "typecheck", passed: true, unavailable: true, output: "" },
      { script: "lint", passed: true, output: "" },
      { script: "test", passed: true, output: "" },
    ],
  });
  assert.match(verified, /^Checks passed: lint, test\./);
  assert.match(verified, /Not available in this repository: typecheck\./);

  assert.match(describeVerification({ checksRun: 0, results: [] }), /\*\*Unverified:\*\*/);
  assert.match(describeVerification(null), /\*\*Unverified:\*\*/, "no metadata proves nothing");
  assert.match(
    describeVerification({ passed: true, results: [{ script: "test", passed: true, output: "" }] }),
    /^Checks passed: test\./,
    "artifacts from before toolchains",
  );
});

test("default test-file patterns follow common conventions across ecosystems", () => {
  const { toolchain } = resolve({});
  const cases = [
    ["src/a.test.ts", true],
    ["__tests__/a.js", true],
    ["tests/test_api.py", true],
    ["app/models_test.py", true],
    ["pkg/api_test.go", true],
    ["src/test/java/com/x/AppTest.java", true],
    ["tests/Feature/UserTest.php", true],
    ["spec/models/user_spec.rb", true],
    ["Api.Tests/UserTests.cs", true],
    ["src/main/java/com/x/App.java", false],
    ["app/Models/User.php", false],
    ["src/contest.js", false],
    ["src/Latest.cs", false],
    ["pkg/api.go", false],
  ];
  for (const [file, expected] of cases) assert.equal(isTestFile(toolchain, file), expected, file);
  const custom = resolve({}, { toolchain: { testFilePatterns: ["^checks/"] } }).toolchain;
  assert.equal(isTestFile(custom, "checks/a.sh"), true);
  assert.equal(isTestFile(custom, "src/a.test.ts"), false, "configured patterns replace the defaults");
});
