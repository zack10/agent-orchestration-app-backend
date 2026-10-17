# Agent Orchestrator — Product Roadmap

## Product North Star

Build a controlled engineering-agent orchestrator that turns a real backlog item into a tested, traceable, review-ready code change with less human effort than completing the work manually.

The product is successful when a team can:

1. Connect a board and source repository.
2. Select or ingest a work item.
3. Let the system plan and execute the work in an isolated workspace.
4. Observe every action, cost, decision, and artifact.
5. Receive a tested pull request for human review.
6. Approve, reject, or request changes.
7. Have the result written back to the original work item.

Multi-agent collaboration is a means to this outcome, not the product by itself. A deterministic workflow or single agent should be preferred whenever it solves the task more reliably.

## Final Product Definition of Done

The first production product is complete only when all of the following are demonstrated:

- [ ] A Jira or Trello work item can start an execution without manual database changes.
- [ ] The execution is idempotent and safely resumes after API, worker, database, or broker restarts.
- [ ] The orchestrator creates a dependency-aware implementation plan with explicit acceptance criteria.
- [ ] Work runs in an isolated repository workspace with scoped credentials and tool permissions.
- [ ] Agents can inspect and edit files, run approved commands, and use approved external integrations.
- [ ] Every generated change passes configured formatting, linting, build, test, and security gates.
- [ ] Failed verification produces bounded repair attempts instead of reporting false success.
- [ ] Sensitive or irreversible actions require human approval.
- [ ] Successful work produces a branch and review-ready pull request linked to the source ticket.
- [ ] The source ticket receives accurate status, summary, evidence, and failure information.
- [ ] Users can inspect a complete audit trail, timeline, artifacts, costs, and token usage.
- [ ] Tenant data, credentials, queues, workspaces, and permissions are isolated.
- [ ] A real pilot team demonstrates measurable time savings and an acceptable PR acceptance rate.

## Status Legend

- `[x]` implemented and currently verifiable
- `[~]` partially implemented; not yet an end-to-end product capability
- `[ ]` not implemented

---

## Phase 0 — Reliable Backend Foundation `[DONE]`

### Domain and persistence

- [x] PostgreSQL persistence through Prisma.
- [x] Models for projects, agents, skills, tasks, messages, MCP resources, work items, and API contracts.
- [x] Canonical work-item statuses and role types.
- [x] Atomic work-item claim/release helpers and guarded status transitions.
- [x] Typed task status lifecycle with attempts, errors, queue timestamps, and execution leases.
- [x] Task idempotency keys.
- [x] Tracked baseline database migration and deploy migration command.

### API foundation

- [x] Agent, project, skill, and task APIs.
- [x] Zod request validation and UUID validation.
- [x] Central application and Prisma error handling.
- [x] Health endpoint for PostgreSQL and RabbitMQ.
- [x] Graceful process shutdown.

### LLM foundation

- [x] Provider abstraction for Gemini, OpenAI-compatible APIs, and Anthropic.
- [x] Explicit provider/model routing.
- [x] Provider model discovery endpoints.
- [x] Provider request timeouts and sanitized failures.
- [x] Structured agent-output contract with fail-closed status parsing.
- [x] Project context included in agent prompts.
- [x] Raw model output disabled by default.
- [~] Usage reporting correctly reports unsupported providers, but cost/token accounting is not implemented.

### Durable execution

- [x] RabbitMQ durable exchange and queues.
- [x] Publisher confirmations.
- [x] Consumer acknowledgement only after successful processing.
- [x] Delayed task retries with bounded attempts.
- [x] Atomic task claims preventing duplicate concurrent execution.
- [x] Recovery of stale pending tasks and expired execution leases.
- [x] Message persistence with recovery for unpublished messages.
- [x] RabbitMQ reconnection and subscription restoration.

### Security baseline

- [x] Bearer-token API authentication, mandatory in production.
- [x] Production configuration validation.
- [x] Explicit CORS allowlist.
- [x] Security headers and request-body limit.
- [x] Per-process API rate limiting.
- [x] AES-256-GCM encryption and API redaction for agent provider keys.
- [x] HTTP connector hostname allowlist, private-IP protection, redirect rejection, timeout, and response limits.
- [x] Generated-file path containment and file count/size limits.
- [x] Dependency audit currently reports zero known vulnerabilities.

### Engineering quality

- [x] Strict TypeScript compilation and Prisma generation in the build.
- [x] ESLint configuration.
- [x] Initial unit tests for generated-file confinement and LLM output parsing.
- [x] `npm run verify` runs lint, build, and tests.
- [x] Environment template and updated operational documentation.

### Existing capabilities that remain partial

- [~] Skills are persisted and assignable, but no structured skill runtime executes them.
- [~] MCP resources and an HTTP connector exist, but resources have no complete management API or agent tool loop.
- [~] Messages can be persisted and published, but there is no complete collaboration workflow.
- [~] Work-item and API-contract models exist, but their APIs and business workflows are incomplete.
- [~] Generated code can be written safely under `generated-code/`, but it is not connected to an isolated repository, verification pipeline, branch, or pull request.
- [~] Shared project context exists, but concurrent updates are not versioned or conflict-aware.

---

## Phase 1 — Complete the Control-Plane APIs `[NEXT]`

Goal: make every existing domain capability manageable through validated, authorized APIs before adding autonomous behavior.

### Resources and credentials

- [ ] Add MCP resource CRUD, assignment, and unassignment endpoints.
- [ ] Define provider-specific Zod schemas for connector configuration.
- [ ] Encrypt and redact all sensitive MCP resource fields, not only agent API keys.
- [ ] Add credential versioning and rotation metadata.
- [ ] Prevent agents from receiving credentials outside their assigned resources.

### Work items and contracts

- [ ] Add work-item list/detail/create/update endpoints with filters and pagination.
- [ ] Expose claim, release, block, retry, and guarded transition operations.
- [ ] Add API-contract propose, accept, reject, version, and query endpoints.
- [ ] Validate contract schemas using JSON Schema.
- [ ] Record actor, reason, and correlation ID for every transition.

### Tasks and messages

- [ ] Add task cancellation, manual retry, timeline, and artifact endpoints.
- [ ] Define cancellation semantics for queued and running work.
- [ ] Add message send/list/detail endpoints with pagination.
- [ ] Add dead-letter inspection and replay operations restricted to administrators.
- [ ] Add optimistic concurrency/version fields where users or agents can update shared state.

### Phase acceptance

- [ ] API integration tests cover every state-changing endpoint.
- [ ] No endpoint returns credentials or unbounded result sets.
- [ ] OpenAPI documentation is generated from validated contracts.

---

## Phase 2 — External Work Intake `[BOARD → INTERNAL WORK ITEM]`

Goal: ingest real work without coupling orchestration logic to one vendor.

### Board adapter contract

- [ ] Define a typed `BoardAdapter` interface for listing, reading, transitioning, commenting, and linking tickets.
- [ ] Define explicit mappings between external and canonical statuses.
- [ ] Normalize title, description, acceptance criteria, labels, priority, assignee, links, and attachments.
- [ ] Store provider cursors and webhook delivery IDs for idempotency.

### First integration

- [ ] Choose exactly one first adapter: Jira or Trello.
- [ ] Implement OAuth/scoped credential handling when supported.
- [ ] Implement webhook ingestion where available, with polling reconciliation as a fallback.
- [ ] Upsert work items transactionally and publish one canonical ingestion event.
- [ ] Write status, comments, links, and failure summaries back to the board.
- [ ] Add rate-limit handling, exponential backoff, circuit breaking, and reconciliation jobs.

### Routing policy

- [ ] Route only explicitly eligible tickets into automation.
- [ ] Support project, label, work-type, priority, and repository routing rules.
- [ ] Reject ambiguous or incomplete tickets with a useful board comment.
- [ ] Add a dry-run mode that plans but cannot modify repositories or tickets.

### Phase acceptance

- [ ] Creating or labeling a real board ticket creates exactly one internal work item.
- [ ] Duplicate webhooks and polling results do not duplicate execution.
- [ ] Internal transitions are reflected accurately on the board.

---

## Phase 3 — Goals, Planning, and Execution Graphs `[WORK ITEM → PLAN]`

Goal: convert a work item into an explicit, inspectable plan rather than immediately prompting an agent to “do everything.”

### Planning domain

- [ ] Add `Goal`, `Plan`, `PlanVersion`, and task-dependency models.
- [ ] Represent acceptance criteria and verification requirements as structured data.
- [ ] Support dependency types, blocked states, priorities, and bounded parallelism.
- [ ] Version plans instead of mutating them invisibly.

### Planning workflow

- [ ] Gather repository, project, contract, and ticket context before planning.
- [ ] Produce structured tasks with owner capability, inputs, expected outputs, and verification gates.
- [ ] Validate plans deterministically for cycles, missing dependencies, and excessive scope.
- [ ] Estimate model cost, command budget, and execution time before approval.
- [ ] Require human approval for plans above configurable risk or cost thresholds.
- [ ] Support bounded replanning using recorded failure evidence.

### Scheduler

- [ ] Dispatch only dependency-ready tasks.
- [ ] Enforce concurrency limits per project, repository, tenant, and provider.
- [ ] Propagate cancellation and terminal failures through the graph.
- [ ] Resume plans safely after service restarts.

### Phase acceptance

- [ ] A representative feature ticket produces a valid dependency graph with clear acceptance criteria.
- [ ] The graph executes in order and resumes after an intentional worker restart.

---

## Phase 4 — Repository Workspaces and Safe Tool Execution `[PLAN → CODE]`

Goal: perform real engineering work in an isolated, reproducible environment.

### Repository integration

- [ ] Add GitHub first, with GitLab as a later adapter.
- [ ] Resolve tickets to an allowlisted repository and base branch.
- [ ] Create a unique branch and workspace for each execution.
- [ ] Use short-lived, least-privilege repository credentials.
- [ ] Record base commit, resulting commits, patches, and artifact hashes.

### Isolation

- [ ] Execute each run in an ephemeral container or equivalent sandbox.
- [ ] Apply CPU, memory, disk, process, and wall-clock limits.
- [ ] Disable network access by default and allowlist required destinations per tool.
- [ ] Prevent host filesystem access and cross-run workspace access.
- [ ] Destroy or quarantine workspaces according to the execution outcome.

### Structured tool runtime

- [ ] Replace free-form action text with typed tool calls and schemas.
- [ ] Implement scoped tools for file read/search/write, patching, Git, and approved commands.
- [ ] Add command allow/deny policy, environment filtering, output limits, and timeouts.
- [ ] Connect assigned skills and MCP resources to an explicit capability registry.
- [ ] Record every tool request, policy decision, result, duration, and artifact.
- [ ] Make mutating tools idempotent where possible.

### Phase acceptance

- [ ] An agent can clone a test repository, change code, commit it, and leave the host untouched.
- [ ] Forbidden paths, commands, networks, and credentials are reliably blocked.

---

## Phase 5 — Verification and Self-Correction `[CODE → VERIFIED CHANGE]`

Goal: never equate model output with completed work.

### Deterministic quality gates

- [ ] Detect project commands from trusted repository configuration.
- [ ] Run formatting, linting, type checks, builds, and tests in the workspace.
- [ ] Add secret scanning, dependency auditing, and configurable static analysis.
- [ ] Store structured verification results and complete logs as artifacts.
- [ ] Treat missing or skipped required checks as failure.

### Repair loop

- [ ] Feed concise failure evidence back into a repair task.
- [ ] Bound repair attempts, cost, elapsed time, and changed-file scope.
- [ ] Detect repeated failures and stop instead of looping indefinitely.
- [ ] Restore a known workspace state before unsafe retry scenarios.
- [ ] Escalate blocked work with evidence and a recommended human action.

### Evaluation

- [ ] Build a versioned benchmark set of representative repository tasks.
- [ ] Track pass rate, regression rate, unsupported-task rate, and false-success rate by model and prompt version.
- [ ] Add regression tests for orchestration policies and prompt/output contracts.
- [ ] Prevent prompt/model changes from deploying when benchmark quality regresses beyond thresholds.

### Phase acceptance

- [ ] Intentionally broken generated code is rejected, repaired when possible, and never marked complete without passing required gates.

---

## Phase 6 — Human Governance and Delivery `[VERIFIED CHANGE → REVIEW]`

Goal: place humans at explicit decision points while minimizing routine supervision.

### Risk and approval policy

- [ ] Classify actions by risk: read-only, reversible write, external write, privileged, destructive.
- [ ] Require approval for configured repositories, files, commands, costs, and external actions.
- [ ] Support approve, reject, edit plan, request changes, pause, cancel, and resume.
- [ ] Ensure approvals are scoped, expiring, attributable, and non-replayable.

### Pull-request delivery

- [ ] Push only verified branches.
- [ ] Create a pull request containing ticket link, plan, summary, test evidence, risks, and generated/modified file list.
- [ ] Apply labels and request reviewers using repository policy.
- [ ] Consume CI and review feedback as structured events.
- [ ] Re-enter bounded repair only when policy allows it.
- [ ] Never auto-merge in the initial production release.

### Board completion

- [ ] Link the pull request to the original ticket.
- [ ] Write progress and terminal status back to the board.
- [ ] Distinguish implemented, verified, awaiting review, merged, rejected, and blocked states.

### Real Problem Solver MVP acceptance

- [ ] A real ticket produces a tested pull request and accurate ticket update without manual backend/database intervention.
- [ ] A reviewer can understand what happened and make a decision from the supplied evidence.
- [ ] Failure leaves the repository and ticket in a safe, truthful state.

This phase is the first market-testable product milestone.

---

## Phase 7 — Deliberate Multi-Agent Collaboration `[AFTER VERTICAL SLICE]`

Goal: use multiple agents only where specialization measurably improves quality, latency, or cost.

### Capability-based delegation

- [ ] Replace hard-coded frontend/backend/QA assumptions with capability requirements.
- [ ] Select agents using capability, availability, cost, model, and trust policy.
- [ ] Compare single-agent and multi-agent performance on the benchmark set.
- [ ] Fall back to one agent when coordination adds no value.

### Typed collaboration

- [ ] Define versioned request, response, advice, review, and escalation message schemas.
- [ ] Implement conversation/thread state with correlation and causation IDs.
- [ ] Add deadlines, deduplication, cancellation, and terminal semantics.
- [ ] Prevent unbounded agent-to-agent conversations.

### Contract workflow

- [ ] Implement API-contract proposal, review, acceptance, rejection, and supersession.
- [ ] Validate contracts and compatibility automatically.
- [ ] Gate dependent tasks on accepted contract versions.
- [ ] Detect conflicting edits and require reconciliation.

### Shared memory

- [ ] Separate durable facts, decisions, summaries, artifacts, and ephemeral conversation.
- [ ] Add provenance, versioning, ownership, and retention to memory entries.
- [ ] Use retrieval based on relevance and permissions rather than injecting all project state.
- [ ] Prevent one agent from silently overwriting another agent’s decisions.

### Phase acceptance

- [ ] A cross-stack task demonstrates a measurable improvement from specialization and contract gating over the single-agent baseline.

---

## Phase 8 — User Experience and Operational Visibility

Goal: make the system understandable and controllable without reading raw logs.

### User-facing control plane

- [ ] Project, repository, board, agent, model, resource, and policy configuration UI.
- [ ] Work-item queue and execution detail pages.
- [ ] Plan graph with dependencies, status, ownership, and retries.
- [ ] Approval inbox and intervention controls.
- [ ] Artifact, diff, verification, conversation, and pull-request views.

### Real-time events

- [ ] Create a versioned execution-event model.
- [ ] Provide SSE or WebSocket streams with resume cursors.
- [ ] Emit useful states such as planning, waiting, executing tool, verifying, repairing, awaiting approval, and blocked.
- [ ] Do not expose private chain-of-thought; show concise action summaries and evidence.

### Observability

- [ ] Replace console logging with structured logs.
- [ ] Propagate request, work-item, plan, task, message, and tool-call correlation IDs.
- [ ] Add OpenTelemetry traces and metrics.
- [ ] Dashboard queue depth, latency, success rate, retries, dead letters, provider errors, costs, and approval wait time.
- [ ] Alert on stuck executions, DLQ growth, repeated failures, and budget anomalies.

---

## Phase 9 — Production Platform Hardening

Goal: safely operate the product for multiple teams and instances.

### Identity and tenancy

- [ ] Add users, organizations, projects, service accounts, and tenant ownership to all data.
- [ ] Implement SSO/OIDC and role-based access control.
- [ ] Enforce tenant isolation in database queries, queues, object storage, caches, logs, and workspaces.
- [ ] Add configurable retention and deletion workflows.

### Secrets and policy

- [ ] Move production secrets to a managed secret store.
- [ ] Implement key rotation and re-encryption workflows.
- [ ] Add repository/tenant policy-as-code with versioning and audit history.
- [ ] Redact secrets and sensitive source content from logs, prompts, errors, and artifacts.

### Scale and resilience

- [ ] Replace the in-memory rate limiter with a shared implementation.
- [ ] Separate API, scheduler, worker, connector, and recovery process roles.
- [ ] Add transactional outbox/inbox patterns for all database-to-broker workflows.
- [ ] Add dead-letter queues, replay tooling, and poison-message quarantine.
- [ ] Test horizontal scaling, graceful draining, backpressure, and provider throttling.
- [ ] Define and test backup, restore, disaster-recovery, and broker/database failover procedures.

### Delivery

- [ ] Add production Docker images with non-root users and minimal runtime contents.
- [ ] Add CI for lint, build, unit tests, integration tests, migration validation, and image scanning.
- [ ] Add staging and production deployment manifests.
- [ ] Use expand/migrate/contract database rollout practices.
- [ ] Publish runbooks and service-level objectives.

---

## Phase 10 — Product Validation and General Availability

Goal: prove that the system creates economic value, not merely technical activity.

### Pilot

- [ ] Select one team, one repository family, one board integration, and two or three bounded task types.
- [ ] Run in plan-only mode, then draft-PR mode, before broader write access.
- [ ] Review every outcome during the pilot and classify failure causes.
- [ ] Interview users about trust, interruption cost, review burden, and missing context.

### Product metrics

- [ ] Percentage of eligible tickets reaching a review-ready pull request.
- [ ] Percentage of generated pull requests accepted with minor or no changes.
- [ ] Median human review/correction time compared with manual implementation.
- [ ] False-success and regression rates.
- [ ] Cost and elapsed time per accepted pull request.
- [ ] Retry, cancellation, blocked, and human-intervention rates.
- [ ] Time from ticket eligibility to pull-request creation.

### GA gate

- [ ] The pilot demonstrates meaningful net engineering-time savings.
- [ ] Security review and threat model are complete.
- [ ] Recovery, audit, deletion, and incident procedures are tested.
- [ ] Supported task types and limitations are documented honestly.
- [ ] Pricing or internal cost allocation is supported by measured unit economics.

---

## Immediate Execution Order

Do not implement every integration or add more agent roles next. Build the narrow vertical slice in this order:

1. [ ] Complete work-item, resource, contract, task-control, and audit APIs.
2. [ ] Choose Jira or Trello as the single first board integration.
3. [ ] Choose GitHub as the single first repository integration.
4. [ ] Add goals, structured plans, task dependencies, and acceptance criteria.
5. [ ] Add isolated repository workspaces and typed file/Git/command tools.
6. [ ] Add deterministic build/test/security verification.
7. [ ] Add bounded repair loops and truthful blocked/failure outcomes.
8. [ ] Add human plan/action approval gates.
9. [ ] Create verified draft pull requests and write results back to the board.
10. [ ] Pilot this single-agent vertical slice before expanding multi-agent collaboration.

## Explicit Non-Goals Until the Vertical Slice Works

- Supporting many board, repository, and cloud vendors simultaneously.
- Autonomous merging or production deployment.
- Open-ended shell or unrestricted network access.
- Unlimited agent-to-agent conversation.
- Training custom models.
- Complex agent marketplaces or plugin ecosystems.
- Optimizing for extreme queue throughput before product-value metrics are proven.

## Roadmap Governance

- A checkbox is marked complete only when implementation, automated tests, documentation, and acceptance evidence exist.
- Every phase must deliver a testable user outcome, not only new abstractions.
- Security, auditability, idempotency, and recovery are acceptance criteria for each mutating workflow.
- New integrations require a demonstrated user need and must conform to stable adapter contracts.
- Roadmap completion is not the success metric; verified review-ready changes and saved human time are.
