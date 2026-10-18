# Agent Orchestration Backend

Express/TypeScript backend for durable AI-agent task execution with PostgreSQL, Prisma, RabbitMQ, and pluggable LLM providers.

## Implemented architecture

1. `POST /api/tasks` validates and persists a task, using `Idempotency-Key` when supplied.
2. The API publishes the task ID to a durable RabbitMQ topic exchange using publisher confirms.
3. A worker atomically claims the task and invokes its configured LLM provider.
4. Failed executions are sent through a delayed retry queue up to the task's maximum attempt count.
5. Pending tasks and expired execution leases are recovered by a periodic sweep.
6. Structured agent output updates task/project state and may write bounded files only under `generated-code/`.

RabbitMQ is currently used for task execution, the Trello-to-GitHub execution pipeline, and the internal messaging service. MCP resources use a connector registry; only the allowlisted HTTP connector is implemented.

Consumers never requeue a failed message immediately. Failures wait in `<queue>.retry` (`CONSUMER_RETRY_DELAY_MS`) and are retried up to `CONSUMER_MAX_ATTEMPTS` times. Exhausted or non-retryable messages go to `<queue>.dead`; for executions, this also moves the execution to `FAILED` with `lastError`. Inspect the `*.dead` queues in the RabbitMQ management UI (`http://localhost:25672`).

## Requirements

- Node.js 20 LTS or newer
- Docker Desktop with Compose

## Local setup

```powershell
Copy-Item .env.example .env.local
# Set ENCRYPTION_KEY and provider credentials in .env.local.
# Either set API_AUTH_TOKEN, or AUTH_DISABLED=true for local-only development.
docker-compose up -d
npm install
npm run prisma:migrate:local
npm run dev:local
```

Docker Compose exposes Postgres on `localhost:15432` and RabbitMQ on `localhost:15673` (management UI on `25672`).

If your database was created earlier with `prisma db push`, `prisma migrate dev` will offer to reset it (deleting all data). Don't accept. If the schema already matches the init migration, baseline it instead:

```powershell
npx dotenv -e .env.local -- npx prisma migrate resolve --applied 20260620000000_init
npx dotenv -e .env.local -- npx prisma migrate deploy
```

Use migrations (not `db push`) from then on.

The API listens on port `3001` by default. `GET /health` is intentionally unauthenticated for container/platform probes.

All `/api/*` routes require:

```text
Authorization: Bearer <API_AUTH_TOKEN>
```

Authentication is skipped only when `AUTH_DISABLED=true` is set explicitly; without a token and without that flag, requests get `401`. Browser requests are allowed only from origins listed in `CORS_ORIGINS`; an empty list blocks all browser origins.

Production mode refuses to start without `API_AUTH_TOKEN`, `CORS_ORIGINS`, `DATABASE_URL`, and `ENCRYPTION_KEY`, and refuses `AUTH_DISABLED=true`.

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

Repository execution is sandboxed:

- Verification scripts run in a `node:20-bookworm` container with `--network none`, CPU/memory/PID limits, and dependencies installed with `npm ci --ignore-scripts`.
- Generated file writes reject `.git` paths and any path that traverses a symlink.
- Publishing never pushes the verification workspace. It clones the repository fresh at the recorded base SHA, applies only the approved diff, and commits and pushes with git hooks disabled.
- The GitHub token is sent as an HTTP header. It never appears in `.git/config` or on the docker command line.
- Logged errors omit request URLs' query strings and headers, so provider keys and tokens are not written to logs.

LLM responses that hit the output limit (`LLM_MAX_OUTPUT_TOKENS`, default 16000), are blocked, or are empty raise an error instead of being parsed as partial output. Lower the limit for models with a smaller output cap.

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
| `npm run test:e2e` | End-to-end suites against a running server |
| `npm run test:e2e:smoke` | Only the credential-free smoke suite |

Tests use `node:test` and run against the compiled `dist/` output. To run a single file: `npm run build && node --test tests/auditFixes.test.js`. New test files must be added to the `test` script in `package.json`.

### End-to-end tests

`tests/e2e/` drives a **running** server over HTTP (start it with `npm run dev:local` first). Copy `.env.e2e.example` to `.env.e2e` and fill in what you have; each suite skips itself, naming the missing variables, until its credentials are set:

| Suite | Needs | Covers |
| --- | --- | --- |
| `smoke` | server only | health, auth, validation, 404s, project lifecycle, non-tracker sync refused |
| `taskPipeline` | `E2E_LLM_*` | agent key redaction, `Idempotency-Key`, queued task runs to `COMPLETED` |
| `executionPipeline` | `E2E_LLM_*`, `E2E_TRELLO_*`, `E2E_GITHUB_*` (server also needs the GitHub App and Docker) | Trello card → sync → plan approval (stale hash rejected) → run → diff bound to publish approval → draft PR → Trello comment |

The execution suite creates a real Trello card and, unless `E2E_PUBLISH=false`, opens a draft PR, so point it at a throwaway repository. It deletes the card afterwards and, when `E2E_GITHUB_TOKEN` is set, closes the PR and deletes the branch (`E2E_KEEP_RESOURCES=true` keeps them). It reuses one `e2e-execution-pipeline` project between runs.

Database migrations in `prisma/migrations` are intentionally tracked. Create them with `npm run prisma:migrate:local` and commit them with the schema change.

## Current MVP boundary

- One HTTP MCP connector is implemented; this is not a complete Model Context Protocol transport.
- Agent skills and MCP resources are persisted and assignable, but they are not yet included in agent prompts, and automatic tool selection/execution is not implemented.
- Rate limiting and logs are process-local. Production deployments should provide centralized logs, metrics, tracing, and a shared rate limiter.

## Trello-to-GitHub vertical slice

The backend now supports the first controlled workflow: an eligible Trello bug card creates an execution, a plan waits for approval, work runs in a bounded Docker workspace, configured Node scripts verify the change, the exact diff waits for publish approval, and a GitHub App creates a draft pull request.

Configure `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`, then create:

1. A repository record with GitHub owner/name, installation ID, and `verificationConfig`, for example `{ "scripts": ["lint", "build", "test"] }`.
2. A Trello integration whose encrypted config contains `apiKey`, `token`, `boardId`, `eligibleLabel`, and the repository ID.
3. A project implementation agent using Gemini.

Use `POST /api/integrations/:id/sync` for a manual Trello sync. Inspect `/api/work-items` and `/api/executions`, then decide plan and publish approvals through `POST /api/executions/:id/approvals/plan` and `/publish`.

An approval must name the exact snapshot the reviewer saw. Take `snapshotHash` from the pending approval in `GET /api/executions/:id`:

```json
{ "approved": true, "snapshotHash": "<64-char hex from the pending approval>", "comment": "optional" }
```

A mismatched hash, or an approval that was already decided, returns `409`.

Execution lifecycle:

- Runs hold a lease (`EXECUTION_LEASE_MS`) renewed while they work. If a worker dies, a sweep requeues the run after the lease expires.
- Transient failures are retried; policy violations, a moved base branch, or a changed diff fail immediately.
- An execution ends as `COMPLETED`, `BLOCKED` (verification kept failing), `FAILED` (error, with `lastError`), or `CANCELED` (approval rejected).
- Trello is notified on plan, block, failure, and PR creation.

Docker Desktop must be running before an approved plan can execute. The first slice supports Node/TypeScript repositories and creates draft PRs only; it never merges or deploys.

## Project docs

- `AUDIT.md`: audit findings and fix-progress tracker.
- `docs/plans/`: roadmaps and project plans.
- `docs/specs/`: technical specifications (orchestration engine, LangGraph, provider infrastructure).
- `docs/testing/`: unit and end-to-end test plans.
- `docs/guides/`: Prisma and TypeScript guides.
- `docs/history/`: earlier phase plans and walkthroughs.

Planning docs describe intent and past phases; the code and this README describe current behaviour.
