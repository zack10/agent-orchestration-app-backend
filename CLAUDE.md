# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
docker-compose up -d            # Postgres (host port 15432) + RabbitMQ (AMQP 15673, mgmt UI 25672)
npm run dev:local               # ts-node-dev with .env.local (default `npm run dev`)
npm run dev:cloud               # same with .env.cloud (Prisma Accelerate)
npm run build                   # prisma generate + tsc -> dist/
npm run lint                    # eslint . --ext .ts  (lint:fix to autofix)
npm test                        # build, then node:test over tests/*.test.js
npm run verify                  # lint + test

npm run prisma:migrate:local    # create/apply a migration against .env.local DB
npm run prisma:migrate:deploy   # apply committed migrations (deploy)
dotenv -e .env.local -- npx prisma studio   # any prisma CLI command needs the env loaded this way
```

Tests are plain CommonJS files using `node:test` that `require("../dist/...")` — they run against **compiled output**, not `src/`. Always build before running one:

```bash
npm run build && node --test tests/llmUtils.test.js
```

New test files must be added to the explicit list in the `test` script in `package.json`. There is no Jest.

## Architecture

Express/TypeScript API (port 3001) on Prisma 7 + PostgreSQL, with RabbitMQ for async work. `src/index.ts` wires middleware (`securityHeaders` → CORS → `authenticate` → `rateLimit` on `/api`), then starts background loops: RabbitMQ connection, task queue worker, message recovery, execution workers, outbox flusher, Trello polling. If RabbitMQ is unavailable in non-production, the API still starts in degraded mode.

- `src/config.ts` is the single source of env-derived settings; `validateProductionConfig()` refuses to boot in production without `API_AUTH_TOKEN`, `CORS_ORIGINS`, `DATABASE_URL`, `ENCRYPTION_KEY`.
- `src/db.ts` exports the Prisma client: Accelerate client if `DATABASE_URL` starts with `prisma`, otherwise the `@prisma/adapter-pg` driver adapter over a `pg` Pool. `prisma.config.ts` supplies a dummy URL so `prisma generate` works without secrets.
- Request flow: `routes/` → `controllers/` (wrapped in `asyncHandler`, validated with Zod schemas from `schemas/index.ts` via `middleware/validate`) → `services/`. Throw `AppError` (`errors/AppError.ts`); `middleware/errorHandler` formats responses.

There are two independent async pipelines:

### 1. Task pipeline (original MVP)
`POST /api/tasks` persists a Task (honouring `Idempotency-Key`) and returns 202. `taskQueueService` publishes the task ID to a durable topic exchange with publisher confirms, a worker atomically claims it with a lease, and `agentRunner` builds a prompt (`promptBuilder`), calls the agent's LLM via `services/llm/LLMService` (Gemini/OpenAI/Anthropic providers), and parses structured output with `utils/llmUtils.parseAgentOutput`. Failures go through a dead-letter delayed retry queue up to `TASK_MAX_ATTEMPTS`; a periodic sweep re-queues pending tasks and expired leases. Generated files are written only under `generated-code/<project>/` by `utils/codeWriter` with file-count/size limits.

### 2. Execution pipeline (Trello → GitHub draft PR vertical slice)
`WorkItem` (from Trello polling or `POST /api/integrations/:id/sync`) → `Execution`, driven by a state machine in `executionService`. State transitions write `OutboxEvent` rows in the same DB transaction; `outboxService` flushes them to RabbitMQ topics `execution.plan`, `execution.run`, `execution.publish`. `executionWorker` consumes these and deduplicates via `InboxReceipt` (transactional outbox/inbox — don't publish to RabbitMQ directly for execution state changes).

- Two human approval gates: plan approval and publish approval (`POST /api/executions/:id/approvals/plan|publish`).
- The run step executes a LangGraph state graph (`services/agentGraph/executionGraph.ts`): load_context → inspect_repo → plan_change → implement_change → enforce_policy → verify_change (→ analyze_failure loop) → review_diff → create_diff_artifact / block_execution. `diffReview.ts` rejects unsafe diffs (e.g. added secrets).
- Work happens in a Docker-isolated clone under `WORKSPACE_ROOT` (`workspaceService`, shells out to `docker`/`git`); verification runs the repository's configured npm scripts (`Repository.verificationConfig`). Docker Desktop must be running.
- Publishing uses a GitHub App (`integrations/githubApp.ts`) to push and open a **draft** PR only; Trello is notified via `integrations/trelloAdapter.ts`.
- Integration credentials are encrypted at rest (`integrationConfigService`, `utils/crypto`, needs 64-hex `ENCRYPTION_KEY`) and redacted in API responses; same for agent `config.apiKey`.

### Other
- `messagingService` + `constants/routing.ts`: inter-agent `Message` routing over role-based queues (`role.<ROLE>.work`).
- `mcpService` + `services/connectors/`: connector registry; only an allowlisted HTTP connector exists (`MCP_HTTP_ALLOWED_HOSTS`, private IPs blocked unless `MCP_HTTP_ALLOW_PRIVATE_IPS=true`, redirects rejected). Not a full MCP transport.
- Rate limiter is in-process only.

## Environment

- `.env.local` → Docker Postgres + RabbitMQ at `localhost:15673` (compose remaps AMQP to avoid Windows port conflicts). `.env.example` is the template.
- `.env.cloud` → Prisma Accelerate.
- Prisma migrations in `prisma/migrations/` are meant to be committed.
- `docs/` holds planning and reference material (`plans/`, `specs/`, `testing/`, `guides/`, `history/`); it describes intent and past phases, not necessarily current behaviour. `AUDIT.md` at the root is the live fix tracker.
- `scratch/` is gitignored for local experiments.
