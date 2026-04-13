# Agent Orchestration Backend — Roadmap

## Product Goal (MVP v1)
Build a tool-agnostic agent orchestration backend where multiple role-based agents (Frontend, Backend, QA) collaborate to complete work items pulled from an external board (start with **Trello via polling**, later swap to Jira) and move ticket status across a workflow (`TODO` → `IN_PROGRESS` → `READY_FOR_TEST` → `DONE`). Agents can coordinate on API contracts (e.g., JSON shape) via an explicit contract proposal/acceptance flow.

### MVP v1 Acceptance Criteria
- [ ] A board adapter polls Trello and creates/updates internal work items without coupling the core to Trello specifics.
- [ ] Frontend/Backend agents claim work items, transition the external ticket to `IN_PROGRESS`, and publish progress messages.
- [ ] When work is ready, agents transition the ticket to `READY_FOR_TEST` and notify QA.
- [ ] QA agent detects `READY_FOR_TEST`, runs a (stubbed) test routine, and transitions the ticket to `DONE` (or back to `TODO` with a failure reason).
- [ ] Agents can propose and accept an API contract (JSON schema) before proceeding with work that depends on it.

## Progress Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | DONE | Define MVP domain + workflows |
| Phase 1 | DONE | Foundation Fixes |
| Phase 2 | TODO | Core APIs + domain models |
| Phase 3 | TODO | Tool-agnostic board integration (Trello first) |
| Phase 4 | TODO | Role-based agent runtime + collaboration |
| Phase 5 | TODO | Security + secrets |
| Phase 6 | TODO | Testing |
| Phase 7 | TODO | Observability & DevOps |

---

## Phase 0 — MVP Domain & Workflow Definition [DONE]

Make the “ticket → work item → agent execution” path explicit so later integrations (Jira) don’t change core behavior.

### 0.1 Work Item Domain Model [DONE]
- [x] Add a `WorkItem` model (internal canonical representation of a board ticket)
  - Fields: `externalSystem` (`TRELLO`/`JIRA`), `externalId`, `boardId`, `status`, `title`, `description`, `labels`, `assigneeRole`, `lockOwner`, `lockUntil`, `attemptCount`, `lastError`, `metadata` (JSON), timestamps
- [x] Define canonical workflow statuses: `TODO`, `IN_PROGRESS`, `READY_FOR_TEST`, `DONE`, `BLOCKED`
- [x] Define idempotency rules (e.g., `externalSystem + externalId` unique, transitions are monotonic unless explicitly reopened)

### 0.2 Agent Roles + Routing [DONE]
- [x] Define agent “roles” (at minimum): `frontend`, `backend`, `qa`
- [x] Define role routing keys/queues (e.g., `role.frontend.work`, `role.backend.work`, `role.qa.work`)
- [x] Define a claim/lock protocol for work items (DB lock primitives; correlation ids already exist in message metadata and get wired into work-item processing in Phase 4)

### 0.3 Contract Negotiation (JSON Agreement) [DONE]
- [x] Add an `ApiContract` model (or `Contract`) with: `name`, `version`, `schema` (JSON Schema or Zod JSON), `status` (`PROPOSED`/`ACCEPTED`/`REJECTED`), `proposedBy`, timestamps
- [x] Add message types for collaboration: `CONTRACT_PROPOSAL`, `CONTRACT_ACCEPTED`, `CONTRACT_REJECTED`, `WORKITEM_STATUS`

---

## Phase 1 — Foundation Fixes [DONE]

### 1.1 Input Validation [DONE]
- [x] Installed `zod`
- [x] Created `src/schemas/index.ts` with schemas for all endpoints (createAgent, updateAgent, createSkill, updateSkill, assignSkill, createTask, idParam)
- [x] Created `src/middleware/validate.ts` — parses body/params/query against zod schema, returns 400 with field-level errors
- [x] Wired validation into all route files (`agentRoutes`, `skillRoutes`, `taskRoutes`)
- [x] UUID validation on all `:id` params

### 1.2 Error Handling [DONE]
- [x] Created `src/errors/AppError.ts` — typed error class with static factories (`badRequest`, `notFound`, `conflict`, `internal`)
- [x] Created `src/middleware/errorHandler.ts` — global handler mapping `AppError`, Prisma errors (`P2025`->404, `P2002`->409, `P2003`->400), and unhandled errors
- [x] Created `src/middleware/asyncHandler.ts` — wraps async route handlers to catch promise rejections
- [x] Refactored all controllers to remove try/catch, use `asyncHandler` and throw `AppError`
- [x] `createTask` now verifies agent exists before creating

### 1.3 RabbitMQ Startup & Health [DONE]
- [x] `index.ts` connects to RabbitMQ on startup (with graceful fallback if unavailable)
- [x] Added `GET /health` endpoint checking database + RabbitMQ connectivity
- [x] Added `isConnected()` and `close()` methods to `RabbitMQService`
- [x] Added automatic reconnection with exponential backoff (up to 10 retries, max 30s delay)
- [x] Graceful shutdown on `SIGTERM`/`SIGINT` — closes RabbitMQ, disconnects Prisma

### 1.4 Package Cleanup [DONE]
- [x] Moved `@types/amqplib` and `@types/uuid` to `devDependencies`
- [x] Verified `.gitignore` covers `node_modules/`, `dist/`, `.env*`
- [x] Removed deprecated `version: '3.8'` from `docker-compose.yml`

---

## Phase 2 — Core APIs + Domain Models [TODO]

Fill in the missing CRUD endpoints so the core domain is usable and the UI (or other clients) can drive the system.

### 2.1 MCPResource Routes & Controller
- [ ] Create `src/controllers/mcpResourceController.ts`
  - `POST /api/resources` — create a resource
  - `GET /api/resources` — list all resources
  - `GET /api/resources/:id` — get by ID
  - `PUT /api/resources/:id` — update
  - `DELETE /api/resources/:id` — delete
  - `POST /api/resources/assign` — assign resource to agent
  - `POST /api/resources/unassign` — remove resource from agent
- [ ] Create `src/routes/mcpResourceRoutes.ts`
- [ ] Register in `index.ts` at `/api/resources`

### 2.2 Message Routes & Controller
- [ ] Create `src/controllers/messageController.ts`
  - `POST /api/messages` — send a message (calls `messagingService.sendMessage`)
  - `GET /api/messages` — list messages (with optional `senderId`/`receiverId` filters)
  - `GET /api/messages/:id` — get single message
- [ ] Create `src/routes/messageRoutes.ts`
- [ ] Register in `index.ts` at `/api/messages`

### 2.3 Extended Agent & Task Endpoints
- [ ] `GET /api/agents/:id/tasks` — list tasks for a specific agent
- [ ] `GET /api/agents/:id/messages` — list messages sent/received by agent
- [ ] `PATCH /api/tasks/:id/cancel` — cancel a pending/in-progress task
- [ ] `POST /api/tasks/:id/retry` — retry a failed task
- [ ] `DELETE /api/tasks/:id` — delete a task
- [ ] `POST /api/agents/:id/subscribe` — activate agent's RabbitMQ subscription
- [ ] `DELETE /api/agents/:id/subscribe` — deactivate subscription

### 2.4 Validation Schemas for New Endpoints
- [ ] Add zod schemas for all new endpoints (resource CRUD, message send, assign/unassign)
- [ ] Wire validation middleware into new route files

### 2.5 Work Item & Contract APIs [TODO]
- [ ] Create WorkItem CRUD + query endpoints
  - `POST /api/work-items` (optional manual create)
  - `GET /api/work-items` (filters: status, externalSystem, assigneeRole)
  - `GET /api/work-items/:id`
  - `PATCH /api/work-items/:id` (status transitions / metadata updates)
- [ ] Create Contract endpoints
  - `POST /api/contracts/propose`
  - `POST /api/contracts/:id/accept`
  - `POST /api/contracts/:id/reject`
  - `GET /api/contracts` (filters: name, status)

**Files to create/modify:** new controllers/routes for resources/messages/work-items/contracts, modified agent/task controllers and routes, `src/index.ts`, `src/schemas/index.ts`, `prisma/schema.prisma`

---

## Phase 3 — Tool-Agnostic Board Integration (Trello First) [TODO]

Add a generic “board adapter” interface and implement Trello via polling. Jira becomes a second adapter with minimal impact on core code.

### 3.1 Board Adapter Interface [TODO]
- [ ] Create a `BoardAdapter` interface (tool-agnostic)
  - `listTickets(changedSince?)`
  - `getTicket(externalId)`
  - `transitionTicket(externalId, targetStatus, note?)`
  - `addComment(externalId, comment)`
- [ ] Define a canonical mapping between external statuses and internal `WorkItem.status`

### 3.2 Trello Adapter (Polling) [TODO]
- [ ] Implement `TrelloAdapter` using Trello REST API
- [ ] Implement `PollingIngestor` service
  - Poll interval configurable via env var
  - Upsert `WorkItem` records from board tickets
  - Publish work-item events to role queues based on labels/assignment rules

### 3.3 Adapter Swap Readiness (Jira Later) [TODO]
- [ ] Ensure Trello-specific fields stay inside adapter config/metadata only
- [ ] Add a placeholder `JiraAdapter` skeleton implementing the same interface (no functional integration required for MVP)

**Files to create/modify:** new `src/integrations/boards/*`, new poller service, `prisma/schema.prisma` (WorkItem), env docs

---

## Phase 4 — Role-Based Agent Runtime + Collaboration [TODO]

This is the core “agents work together” milestone. Keep the first cut deterministic and observable.

### 4.1 Work Item Claiming + Execution Loop [TODO]
- [ ] Implement a worker loop per role queue (frontend/backend/qa)
- [ ] Add DB-level claiming/locking (`lockOwner`, `lockUntil`) to prevent double work
- [ ] Transition external ticket status through adapter (`IN_PROGRESS`, `READY_FOR_TEST`, `DONE`)
- [ ] Add retry policy + max attempts + dead-letter handling for poison work items

### 4.2 Collaboration Messages + Contracts [TODO]
- [ ] Implement contract proposal/acceptance messages and persistence
- [ ] Gate work execution on required accepted contracts (configurable per work type)
- [ ] Add correlation ids across message + DB + logs for a single work item lifecycle

### 4.3 Skill Execution (Scoped) [TODO]
- [ ] Implement safe, structured skills (recommended: type+config dispatch) for:
  - `http_request` (already exists via MCP HTTP connector)
  - `transform_data`
  - `send_message`

---

## Phase 5 — Security + Secrets [TODO]

### 5.1 Authentication Middleware
- [ ] Install `jsonwebtoken` (or use API key auth for simplicity)
- [ ] Create `src/middleware/auth.ts`
- [ ] Simple approach for v1: API key in `Authorization` header, validated against env var
- [ ] Protect all `/api/*` routes, leave `/health` public

### 5.2 Credential Management for MCP Resources
- [ ] Encrypt sensitive fields in `MCPResource.config` before storing (AES-256-GCM)
- [ ] Encryption key from env var `ENCRYPTION_KEY`
- [ ] Decrypt at runtime when the connector needs the config
- [ ] Create `src/utils/crypto.ts` with `encrypt()`/`decrypt()` helpers
- [ ] Never return raw credentials in API responses — mask them

### 5.3 Rate Limiting
- [ ] Install `express-rate-limit`
- [ ] Apply global rate limit (e.g., 100 req/min)
- [ ] Tighter limits on write endpoints (POST/PUT/DELETE)

**Files to create/modify:** new `src/middleware/auth.ts`, new `src/utils/crypto.ts`, `src/index.ts`, `mcpService.ts`, `mcpResourceController.ts`

---

## Phase 6 — Testing [TODO]

### 6.1 Test Setup
- [ ] Install `vitest` (or `jest`) + `supertest` for API testing
- [ ] Add `test` script to `package.json`
- [ ] Create test database config (SQLite for unit tests or separate Postgres via Docker)
- [ ] Add `prisma/seed.ts` for test data

### 6.2 Unit Tests
- [ ] `rabbitMQService` — publish/subscribe with mocked channel
- [ ] `skillExecutor` — each skill type with various inputs
- [ ] `messagingService` — message creation and publish
- [ ] `crypto` utils — encrypt/decrypt roundtrip
- [ ] Validation schemas — valid and invalid inputs

### 6.3 Integration Tests
- [ ] Agent CRUD lifecycle (`POST` -> `GET` -> `PUT` -> `DELETE`)
- [ ] Task lifecycle (`POST` task -> verify status transitions -> `GET` result)
- [ ] Skill assignment flow (create agent, create skill, assign, verify)
- [ ] Message sending (create 2 agents, send message, verify DB + RabbitMQ publish)
- [ ] MCP resource execution through `HttpConnector` (mock external HTTP)

### 6.4 Agent Runner Tests
- [ ] Create agent with skills -> assign task -> verify skill execution
- [ ] Verify failed task status + error result
- [ ] Verify timeout handling
- [ ] Verify message-triggered task creation

**Files to create/modify:** new `src/__tests__/` directory, `package.json`, `vitest.config.ts` (or `jest.config.ts`)

---

## Phase 7 — Observability & DevOps [TODO]

### 7.1 Structured Logging
- [ ] Install `pino` (or `winston`)
- [ ] Replace all `console.log`/`console.error` with logger
- [ ] Add request logging middleware (method, path, status, duration)
- [ ] Include `correlationId` from message metadata in log context
- [ ] Log levels: `debug` for dev, `info` for prod

### 7.2 Dockerize the App
- [ ] Create `Dockerfile` (multi-stage: build TS -> run JS)
- [ ] Create `.dockerignore`
- [ ] Update `docker-compose.yml`:
  - Add `app` service that builds from Dockerfile
  - Add healthchecks for all services
  - Add `depends_on` with `condition: service_healthy`
  - Add `env_file` reference
- [ ] Create `.env.docker` with container-appropriate URLs

### 7.3 CI Pipeline (optional)
- [ ] GitHub Actions workflow:
  - Lint (`npm run lint`)
  - Build (`npm run build`)
  - Test (`npm test`) with Docker services
- [ ] Run on push to `main` and on PRs

**Files to create/modify:** new `Dockerfile`, `.dockerignore`, `docker-compose.yml`, new `src/utils/logger.ts`, new `src/middleware/requestLogger.ts`, new `.github/workflows/ci.yml`

---

## Recommended Execution Order

| Order | Phase | Effort | Status |
|-------|-------|--------|--------|
| 1 | Phase 0 — MVP Domain & Workflow Definition | Small | DONE |
| 2 | Phase 1 — Foundation Fixes | Small | DONE |
| 3 | Phase 2 — Core APIs + Domain Models | Small-Medium | TODO |
| 4 | Phase 3 — Tool-Agnostic Board Integration | Medium | TODO |
| 5 | Phase 4 — Role-Based Agent Runtime + Collaboration | Large | TODO |
| 6 | Phase 5 — Security + Secrets | Medium | TODO |
| 7 | Phase 6 — Testing | Medium | TODO |
| 8 | Phase 7 — Observability & DevOps | Medium | TODO |

---

## Decision Points

These are choices that need to be made before or during implementation:

1. **Contract format** (Phase 0.3 / 4.2) — JSON Schema vs Zod-as-JSON vs other typed representation?
2. **Polling vs webhooks** (Phase 3.2) — keep polling for MVP; decide when to add webhooks.
3. **Skill execution model** (Phase 4.3) — type+config dispatch (recommended) vs plugins.
4. **Auth strategy** (Phase 5.1) — API keys (simple) vs JWT vs OAuth.
5. **Test database** (Phase 6.1) — SQLite (fast) vs Postgres in Docker (parity).
6. **Credential storage** (Phase 5.2) — encrypt in DB vs external secret manager.
