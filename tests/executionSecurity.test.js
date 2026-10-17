const assert = require("node:assert/strict");
const test = require("node:test");

process.env.ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { hashSnapshot } = require("../dist/services/executionService");
const {
  openIntegrationConfig,
  redactIntegration,
  sealIntegrationConfig,
} = require("../dist/services/integrationConfigService");

test("integration credentials are encrypted and redacted", () => {
  const sealed = sealIntegrationConfig({ token: "secret", boardId: "board" });
  assert.equal(JSON.stringify(sealed).includes("secret"), false);
  assert.deepEqual(openIntegrationConfig(sealed), {
    token: "secret",
    boardId: "board",
  });
  const redacted = redactIntegration({ id: "1", encryptedConfig: sealed });
  assert.deepEqual(redacted, { id: "1", config: { configured: true } });
});

test("approval snapshot hashes are deterministic and content-bound", () => {
  assert.equal(hashSnapshot({ diff: "a" }), hashSnapshot({ diff: "a" }));
  assert.notEqual(hashSnapshot({ diff: "a" }), hashSnapshot({ diff: "b" }));
});
