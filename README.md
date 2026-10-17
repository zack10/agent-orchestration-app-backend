# Agent Orchestration Backend

Express/TypeScript backend for durable AI-agent task execution with PostgreSQL, Prisma, RabbitMQ, and pluggable LLM providers.

## Implemented architecture

1. `POST /api/tasks` validates and persists a task, using `Idempotency-Key` when supplied.
2. The API publishes the task ID to a durable RabbitMQ topic exchange using publisher confirms.
3. A worker atomically claims the task and invokes its configured LLM provider.
4. Failed executions are sent through a delayed retry queue up to the task's maximum attempt count.
5. Pending tasks and expired execution leases are recovered by a periodic sweep.
6. Structured agent output updates task/project state and may write bounded files only under `generated-code/`.

RabbitMQ is currently used for task execution and the internal messaging service. MCP resources use a connector registry; only the allowlisted HTTP connector is implemented.

## Requirements

- Node.js 20 LTS or newer
- Docker Desktop with Compose

## Local setup

```powershell
Copy-Item .env.example .env.local
# Set ENCRYPTION_KEY and provider credentials in .env.local.
docker-compose up -d
npm install
npm run prisma:migrate:local
npm run dev:local
```

The API listens on port `3001` by default. `GET /health` is intentionally unauthenticated for container/platform probes.

When `API_AUTH_TOKEN` is configured, all `/api/*` routes require:

```text
Authorization: Bearer <API_AUTH_TOKEN>
```

Production mode refuses to start without `API_AUTH_TOKEN`, `CORS_ORIGINS`, `DATABASE_URL`, and `ENCRYPTION_KEY`.

## Important API behavior

- Task creation returns `202 Accepted`; execution is asynchronous.
- Send a stable `Idempotency-Key` header when creating tasks so client retries do not duplicate work.
- Provider discovery accepts temporary credentials in the `POST /api/llm/discover` body.
- `GET /api/llm/models` accepts an optional provider credential through `X-Provider-Api-Key`, never the URL.
- `/api/llm/usage` returns `501` when the provider has no safe account-usage API. It never performs paid inference as a usage probe.
- Agent API keys supplied in `config.apiKey` are encrypted at rest and redacted from API responses.

## Security configuration

HTTP MCP calls are denied unless their hostname appears in `MCP_HTTP_ALLOWED_HOSTS`. Redirects and embedded URL credentials are rejected. Private IP targets additionally require `MCP_HTTP_ALLOW_PRIVATE_IPS=true`; use this only for explicitly trusted internal services.

Generated output is confined below `generated-code/<project>/`, with configurable file-count and size limits. Raw LLM output is not persisted unless `STORE_RAW_LLM_OUTPUT=true`.

The built-in rate limiter is per-process. Multi-instance production deployments should replace it with a shared Redis-backed limiter at the ingress or application layer.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:local` | Run with `.env.local` |
| `npm run dev:cloud` | Run with `.env.cloud` |
| `npm run prisma:migrate:local` | Create/apply a local schema migration |
| `npm run prisma:migrate:deploy` | Apply committed migrations in deployment |
| `npm run build` | Generate Prisma Client and compile TypeScript |
| `npm run lint` | Run ESLint |
| `npm test` | Build and run unit tests |
| `npm run verify` | Run lint, build, and tests |

Before the first deployment, run `npm run prisma:migrate:local` and commit the generated `prisma/migrations` directory. Database migrations are intentionally tracked.

## Current MVP boundary

- One HTTP MCP connector is implemented; this is not a complete Model Context Protocol transport.
- Agent skills/resources are persisted and included in agent context, but automatic tool selection/execution is not yet implemented.
- Rate limiting and logs are process-local. Production deployments should provide centralized logs, metrics, tracing, and a shared rate limiter.

## Trello-to-GitHub vertical slice

The backend now supports the first controlled workflow: an eligible Trello bug card creates an execution, a plan waits for approval, work runs in a bounded Docker workspace, configured Node scripts verify the change, the exact diff waits for publish approval, and a GitHub App creates a draft pull request.

Configure `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`, then create:

1. A repository record with GitHub owner/name, installation ID, and `verificationConfig`, for example `{ "scripts": ["lint", "build", "test"] }`.
2. A Trello integration whose encrypted config contains `apiKey`, `token`, `boardId`, `eligibleLabel`, and the repository ID.
3. A project implementation agent using Gemini.

Use `POST /api/integrations/:id/sync` for a manual Trello sync. Inspect `/api/work-items` and `/api/executions`, then decide plan and publish approvals through `POST /api/executions/:id/approvals/plan` and `/publish` with `{ "approved": true }`.

Docker Desktop must be running before an approved plan can execute. The first slice supports Node/TypeScript repositories and creates draft PRs only; it never merges or deploys.
