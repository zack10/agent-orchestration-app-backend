# Production MVP Roadmap

This roadmap tracks the path from the current backend implementation to a production-ready MVP for a real problem-solving agent orchestrator.

The target product is:

```txt
Trello/Jira ticket
→ agent execution
→ verified code change
→ human approval
→ GitHub draft pull request
```

The goal is not to add more agents, providers, or adapters too early. The goal is to complete one narrow, reliable vertical path first.

## Current status summary

The architecture is promising and the MVP backend foundation is strong, but the product is not production-ready yet.

Current status:

```txt
Architecture: promising
Backend foundation: strong
Agent workflow: improving
End-to-end proof: still needed
Production readiness: not yet
```

## Legend

| Status | Meaning |
|---|---|
| Done | Implemented and locally verified |
| Partial | Implemented partly, needs hardening or real E2E proof |
| Next | Immediate priority |
| Todo | Not yet implemented |

## Phase 1 — Core backend foundation

Status: Done

This phase created the backend structure needed to support the product.

Completed:

- Express API backend
- Prisma/PostgreSQL data model
- RabbitMQ job queue
- durable execution records
- execution events
- artifacts
- approvals
- project, agent, work item, repository, and integration records
- local Docker Compose setup for Postgres and RabbitMQ
- environment setup with `.env.local` and `.env.example`
- basic auth/security middleware
- encrypted integration and agent credentials
- test/build/lint scripts

Verification:

```powershell
npm run build
npm run lint
npm test
```

Current test status:

```txt
8 tests passing
0 failing
```

## Phase 2 — Trello ingestion

Status: Partial

Completed:

- Trello integration connection model
- encrypted Trello config storage
- manual Trello sync endpoint
- Trello polling service
- card ingestion into `WorkItem`
- eligible label filtering
- idempotent execution creation from Trello card revision hash

Current behavior:

```txt
Trello card with eligible label
→ backend sync
→ WorkItem
→ Execution
```

Still left:

- prove with a real Trello test board
- add better sync error reporting
- add rate-limit handling
- support label/list mapping
- support Trello webhooks
- update Trello card status through execution lifecycle

Acceptance criteria:

- creating a card with `agent-ready` imports exactly one work item
- re-syncing does not create duplicates
- changing the card creates a new revision/execution only when appropriate
- sync errors are visible in the integration record

## Phase 3 — GitHub App publishing

Status: Partial

Completed:

- GitHub App configuration support
- installation token usage
- base SHA lookup
- repository registration
- branch creation
- commit and push flow
- draft PR creation
- base branch change protection before publish
- publish approval gate before PR creation

Still left:

- prove with a real disposable GitHub repository
- handle branch already exists
- handle PR already exists
- handle installation permission changes
- handle repository unavailable errors cleanly
- add retry/backoff for GitHub API failures
- improve PR body with execution evidence and verification summary

Acceptance criteria:

- approved execution creates branch `agent/<execution-id>`
- draft PR is opened against the expected base branch
- no PR is created before publish approval
- publish fails safely if base branch changed

## Phase 4 — LangGraph execution brain

Status: Done / Improving

Completed:

- added LangGraph dependencies
- moved execution loop into LangGraph
- added explicit graph nodes
- added stale-message skip path
- added repo inspection
- added internal implementation planning
- added verification retry loop
- added failure analysis
- added deterministic diff safety review
- added LLM-assisted diff review
- added helper tests

Current graph:

```txt
load_context
→ inspect_repo
→ plan_change
→ implement_change
→ enforce_policy
→ verify_change
→ analyze_failure if failed
→ review_diff if passed
→ create_diff_artifact
```

Files:

```txt
src/services/agentGraph/executionGraph.ts
src/services/agentGraph/repoContext.ts
src/services/agentGraph/diffReview.ts
tests/agentGraphHelpers.test.js
LANGGRAPH_INTEGRATION.md
```

Still left:

- prove the graph with a real repository execution
- improve repo context selection beyond heuristics
- add typed tool use
- add better graph-level observability
- persist richer per-node metadata

Acceptance criteria:

- each graph node emits execution events
- failed verification leads to retry guidance
- unsafe diffs are blocked before publish approval
- successful diffs create a `PUBLISH` approval request

## Phase 5 — Full end-to-end vertical slice

Status: Next

This is the most important next phase.

Goal:

```txt
Trello card
→ WorkItem
→ Execution
→ Plan approval
→ GitHub repo clone
→ Agent code change
→ Docker verification
→ Diff artifact
→ Publish approval
→ Draft PR
→ Trello/GitHub evidence
```

Why this matters:

Until this works on real Trello and GitHub test resources, the project is still an implemented backend, not a proven MVP.

Step-by-step work:

1. Create a disposable GitHub test repository.
2. Install the GitHub App on only that repo.
3. Create a disposable Trello test board.
4. Create an `agent-ready` label.
5. Register project, agent, repository, and Trello integration.
6. Sync Trello card into backend.
7. Approve plan.
8. Watch the LangGraph execution run.
9. Inspect diff artifact.
10. Approve publish.
11. Confirm draft PR appears in GitHub.
12. Confirm Trello card receives execution/PR comment.

Acceptance criteria:

- one Trello card results in one execution
- execution creates a human-reviewable plan
- plan approval triggers repo work
- verification runs in Docker
- successful execution produces a diff artifact
- publish approval creates a draft PR
- failures are visible and recoverable

## Phase 6 — Typed tool use inside LangGraph

Status: Todo

This is the next major agent capability upgrade after E2E proof.

Current limitation:

The agent still edits code by returning bounded `FILE` action blocks.

That is acceptable for simple MVP tasks, but real coding agents need typed tools.

Needed tools:

- search files
- read file ranges
- apply patches
- run targeted commands
- inspect command output
- inspect git diff
- request more context

Target flow:

```txt
inspect_repo
→ search_files
→ read_files
→ plan_change
→ apply_patch
→ run_targeted_check
→ inspect_failure
→ patch_again
→ full_verification
→ diff_review
```

Implementation direction:

- create typed tool interfaces under `src/services/agentGraph/tools/`
- expose only safe workspace-scoped tools
- record every tool call in the database
- limit tool count and command duration
- preserve human approval gates outside the graph

Acceptance criteria:

- agent can inspect files before editing
- agent can patch incrementally instead of rewriting whole files
- each tool call is logged
- unsafe paths are blocked
- command execution remains sandboxed

## Phase 7 — Execution observability

Status: Todo

The backend has execution events, but production use needs clearer visibility.

Needed:

- execution timeline endpoint or UI-ready response
- per-node graph event details
- per-node duration
- model/provider used per step
- verification output summaries
- diff review summaries
- retry reason summaries
- cost/token tracking where provider supports it
- redacted model inputs/outputs

Acceptance criteria:

- a human can inspect why an execution succeeded or failed
- every retry has an obvious cause
- logs do not leak secrets
- artifacts are linked to attempts and approvals

## Phase 8 — Approval UX

Status: Todo

Current approvals are API-only.

That is fine for backend testing, but not enough for real users.

Options:

1. frontend approval UI
2. Trello comment commands
3. GitHub issue/PR comment commands
4. Slack/Discord approval integration later

Recommended MVP path:

Start with a simple frontend or admin approval page.

Later add comment-based commands:

```txt
/approve plan
/reject plan because scope is too broad
/approve publish
/reject publish because tests are insufficient
```

Acceptance criteria:

- user can approve/reject plan without curl/Postman
- user can approve/reject publish without curl/Postman
- rejection reason is saved
- execution status updates clearly

## Phase 9 — Sandbox and security hardening

Status: Todo

Current Docker isolation is a good start, but production needs stronger hardening.

Needed:

- verify no privileged containers
- strict CPU, memory, PID, and timeout limits
- workspace cleanup policy
- network disabled except clone/install phases
- secret redaction in logs and artifacts
- stronger protected path policy
- dependency install policy
- command allowlist for typed tools
- artifact size limits
- diff size limits
- model-output validation improvements

Acceptance criteria:

- generated code cannot write outside workspace
- secrets are not stored in artifacts/logs
- unsafe files cannot be modified without explicit policy
- runaway commands are terminated
- workspace is cleaned or retained according to policy

## Phase 10 — Trello/GitHub webhook support

Status: Todo

Polling works for MVP, but webhooks are better for production.

Needed:

- Trello webhook registration
- Trello webhook verification
- GitHub webhook support
- idempotent webhook processing
- webhook event storage
- retries and dead-letter behavior

Acceptance criteria:

- Trello card changes trigger sync without waiting for polling
- duplicate webhook deliveries do not duplicate executions
- webhook failures are visible
- polling can remain as fallback

## Phase 11 — Multi-agent roles

Status: Todo

Do not start here too early.

Multi-agent orchestration should come after the single-agent vertical slice works.

Potential roles:

- Planner Agent
- Coder Agent
- Reviewer Agent
- Verifier Agent
- Security Reviewer Agent
- Release Notes Agent

Recommended rule:

Only split into multiple agents when one role has a clear, tested responsibility.

Acceptance criteria:

- each role has a concrete input/output contract
- each role produces inspectable evidence
- role handoffs are stored
- multi-agent flow improves quality without adding chaos

## Immediate next steps

Recommended order:

1. Prove the full Trello-to-GitHub draft PR flow with a disposable repo.
2. Fix any bugs found during that live E2E test.
3. Add typed tool use inside LangGraph.
4. Add execution timeline/observability.
5. Improve approval UX.
6. Harden sandbox/security.
7. Add webhook-based Trello/GitHub events.
8. Add multi-agent roles only after the single-agent flow is reliable.

## Definition of production-ready MVP

The MVP is production-ready when this is reliably true:

```txt
A non-technical user can create or label a ticket,
the backend can safely attempt the fix,
the system can verify the change,
a human can review evidence,
and GitHub receives a draft PR without manual backend intervention.
```

Minimum acceptance gate:

- real Trello board tested
- real GitHub App tested
- disposable repo E2E tested
- plan approval works
- publish approval works
- verification evidence exists
- unsafe diffs are blocked
- failures are explainable
- no secrets leak into logs/artifacts
- draft PR is created only after human approval

