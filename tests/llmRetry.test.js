const assert = require("node:assert/strict");
const test = require("node:test");

const { isRetryableLLMError, retryDelayMs, withLLMRetry } = require("../dist/services/llm/retry");

const httpError = (status, { headers = {}, data } = {}) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, headers, data },
});

test("rate limits and overloads are retryable; exhausted credits and other errors are not", () => {
  assert.equal(isRetryableLLMError(httpError(429)), true);
  assert.equal(isRetryableLLMError(httpError(503)), true);
  assert.equal(isRetryableLLMError(httpError(529)), true);
  assert.equal(isRetryableLLMError(httpError(400)), false);
  assert.equal(isRetryableLLMError(new Error("boom")), false);
  assert.equal(
    isRetryableLLMError(httpError(429, { data: { error: { type: "insufficient_quota", code: "credit_balance_exhausted" } } })),
    false,
  );
});

test("retry delay honours Retry-After, then Gemini RetryInfo, then backs off (capped)", () => {
  assert.equal(retryDelayMs(httpError(429, { headers: { "retry-after": "7" } }), 0), 7000);
  assert.equal(
    retryDelayMs(httpError(429, { data: { error: { details: [{ "@type": "RetryInfo", retryDelay: "37s" }] } } }), 0),
    38_000,
  );
  assert.equal(retryDelayMs(httpError(429), 0), 10_000);
  assert.equal(retryDelayMs(httpError(429), 1), 20_000);
  assert.equal(retryDelayMs(httpError(429, { headers: { "retry-after": "600" } }), 0), 60_000);
});

test("withLLMRetry retries retryable failures up to the limit, then rethrows", async () => {
  const waits = [];
  let calls = 0;
  const result = await withLLMRetry(
    async () => {
      calls++;
      if (calls < 3) throw httpError(429);
      return "ok";
    },
    { retries: 3, wait: async (ms) => waits.push(ms) },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10_000, 20_000]);

  calls = 0;
  await assert.rejects(
    withLLMRetry(async () => { calls++; throw httpError(429); }, { retries: 2, wait: async () => undefined }),
    (error) => error.response.status === 429,
  );
  assert.equal(calls, 3);
});

test("withLLMRetry fails fast, non-retryably, on exhausted credits or long quota resets", async () => {
  const { NonRetryableError } = require("../dist/utils/safeError");
  const cases = [
    httpError(429, { data: { error: { type: "insufficient_quota", code: "credit_balance_exhausted" } } }),
    httpError(429, { data: { error: { details: [{ "@type": "RetryInfo", retryDelay: "15525s" }] } } }),
  ];
  for (const failure of cases) {
    let calls = 0;
    await assert.rejects(
      withLLMRetry(async () => { calls++; throw failure; }, { retries: 3, wait: async () => undefined }),
      (error) => error instanceof NonRetryableError,
    );
    assert.equal(calls, 1);
  }
});

test("withLLMRetry does not retry permanent failures", async () => {
  let calls = 0;
  await assert.rejects(
    withLLMRetry(async () => { calls++; throw httpError(401); }, { retries: 3, wait: async () => undefined }),
  );
  assert.equal(calls, 1);
});
