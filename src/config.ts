const parseList = (value: string | undefined): string[] =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];

const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePositiveInt(process.env.PORT, 3001),
  apiAuthToken: process.env.API_AUTH_TOKEN ?? "",
  // Auth is only skipped when explicitly disabled outside production.
  authDisabled: process.env.AUTH_DISABLED === "true",
  apiAuthActor: process.env.API_AUTH_ACTOR ?? "api-token:default",
  artifactRoot: process.env.ARTIFACT_ROOT ?? "artifacts",
  workspaceRoot: process.env.WORKSPACE_ROOT ?? "workspaces",
  keepWorkspaces: process.env.KEEP_WORKSPACES === "true",
  // TRELLO_POLL_INTERVAL_MS is the pre-adapter name, still honoured.
  integrationPollIntervalMs: parsePositiveInt(
    process.env.INTEGRATION_POLL_INTERVAL_MS ??
      process.env.TRELLO_POLL_INTERVAL_MS,
    30_000,
  ),
  corsOrigins: parseList(process.env.CORS_ORIGINS),
  rabbitMqUrl: process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",
  taskMaxAttempts: parsePositiveInt(process.env.TASK_MAX_ATTEMPTS, 3),
  taskRetryDelayMs: parsePositiveInt(process.env.TASK_RETRY_DELAY_MS, 5000),
  taskLeaseMs: parsePositiveInt(process.env.TASK_LEASE_MS, 300_000),
  executionLeaseMs: parsePositiveInt(process.env.EXECUTION_LEASE_MS, 300_000),
  consumerMaxAttempts: parsePositiveInt(process.env.CONSUMER_MAX_ATTEMPTS, 3),
  consumerRetryDelayMs: parsePositiveInt(
    process.env.CONSUMER_RETRY_DELAY_MS,
    30_000,
  ),
  llmRequestTimeoutMs: parsePositiveInt(
    process.env.LLM_REQUEST_TIMEOUT_MS,
    120_000,
  ),
  llmMaxOutputTokens: parsePositiveInt(
    process.env.LLM_MAX_OUTPUT_TOKENS,
    16_000,
  ),
  llmRateLimitRetries: parsePositiveInt(
    process.env.LLM_RATE_LIMIT_RETRIES,
    3,
  ),
  apiRateLimitPerMinute: parsePositiveInt(
    process.env.API_RATE_LIMIT_PER_MINUTE,
    120,
  ),
  connectorAllowedHosts: parseList(process.env.MCP_HTTP_ALLOWED_HOSTS).map(
    (host) => host.toLowerCase(),
  ),
  connectorAllowPrivateIps: process.env.MCP_HTTP_ALLOW_PRIVATE_IPS === "true",
  connectorTimeoutMs: parsePositiveInt(process.env.MCP_HTTP_TIMEOUT_MS, 10000),
  connectorMaxResponseBytes: parsePositiveInt(
    process.env.MCP_HTTP_MAX_RESPONSE_BYTES,
    1_000_000,
  ),
  generatedCodeMaxFiles: parsePositiveInt(
    process.env.GENERATED_CODE_MAX_FILES,
    25,
  ),
  generatedCodeMaxFileBytes: parsePositiveInt(
    process.env.GENERATED_CODE_MAX_FILE_BYTES,
    500_000,
  ),
  storeRawLlmOutput: process.env.STORE_RAW_LLM_OUTPUT === "true",
};

export const validateProductionConfig = (): void => {
  if (config.nodeEnv !== "production") return;

  const missing: string[] = [];
  if (!config.apiAuthToken) missing.push("API_AUTH_TOKEN");
  if (config.corsOrigins.length === 0) missing.push("CORS_ORIGINS");
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.ENCRYPTION_KEY) missing.push("ENCRYPTION_KEY");
  if (config.authDisabled)
    throw new Error("AUTH_DISABLED cannot be used in production");

  if (missing.length > 0) {
    throw new Error(
      `Missing required production configuration: ${missing.join(", ")}`,
    );
  }
};
