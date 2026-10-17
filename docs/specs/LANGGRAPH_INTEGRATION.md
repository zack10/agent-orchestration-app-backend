# LangGraph Integration Notes

This document explains the LangGraph integration added to the backend execution flow.

## Why LangGraph was added

The project already had the important product infrastructure:

- Express API routes
- Prisma persistence
- RabbitMQ durable job handling
- Trello work item ingestion
- GitHub App publishing
- human approval gates
- Docker-based repository verification
- execution events, artifacts, and attempts

LangGraph was added only to the agent execution loop, not to replace the whole backend.

The goal is to make the orchestrator's "brain loop" more explicit, easier to debug, and easier to extend.

Before this change, the execution worker handled most of the code-writing flow inline:

```txt
load execution
clone repo
ask LLM
write files
check policy
run verification
retry
create diff artifact
request publish approval
```

That worked, but the logic was horizontal inside one worker function. LangGraph gives us a clearer state-machine structure for the part of the system where agent behavior will become more complex.

## What changed

### Added dependencies

The following packages were added:

```json
"@langchain/core": "^1.2.9",
"@langchain/langgraph": "^1.4.12"
```

These are used to define and run the execution graph.

### Added graph runner

New file:

```txt
src/services/agentGraph/executionGraph.ts
```

This file contains the LangGraph workflow used when an approved execution is ready to run.

### Updated execution worker

Updated file:

```txt
src/services/executionWorker.ts
```

The worker no longer contains the full implementation loop directly. Instead, it delegates execution runs to:

```ts
runExecutionGraph(executionId)
```

The worker still owns queue consumption and high-level orchestration. LangGraph only owns the internal agent execution flow.

## Current graph flow

The current graph is:

```txt
START
  ↓
load_context
  ↓
inspect_repo
  ↓
plan_change
  ↓
implement_change
  ↓
enforce_policy
  ↓
verify_change
  ├─ retry    → analyze_failure → implement_change
  ├─ blocked  → block_execution → END
  └─ review   → review_diff
                  ├─ retry    → analyze_failure → implement_change
                  ├─ blocked  → block_execution → END
                  └─ artifact → create_diff_artifact → END
```

There is also a skip path for stale or duplicate messages. If an execution is no longer in the `QUEUED` state, the graph exits safely without re-running the job.

## Graph node responsibilities

### `load_context`

Loads the execution, repository, work item, approved plan, and project agent.

It also:

- checks the execution is still `QUEUED`
- gets the GitHub base SHA
- gets a GitHub installation token
- creates the local workspace
- clones the GitHub repository into Docker workspace storage
- updates the execution status to `RUNNING`
- stores the base SHA on the execution
- prepares the LLM prompt context

### `inspect_repo`

Collects bounded repository context before asking the model to edit code.

It currently gathers:

- a capped file tree sample
- package scripts from `package.json`
- likely relevant files selected with deterministic ticket/file heuristics
- capped content excerpts for selected files

This gives the coding prompt concrete repo context without dumping the whole repository into the model.

### `plan_change`

Asks the configured agent model for a concise internal implementation plan.

This is not the human approval plan. The human-facing approval plan still happens before execution starts. This node creates a smaller coding plan for the implementation attempt, including likely files, risk, and test strategy.

### `implement_change`

Creates a `TaskAttempt`, calls the configured agent LLM, parses the model output, and writes generated `FILE` actions into the workspace.

The model is asked to use:

- ticket text
- repository context
- the internal implementation plan
- previous failure or review feedback

It must still return bounded `FILE` actions only.

### `enforce_policy`

Checks the repository change policy before verification.

Current protections include:

- maximum changed files
- protected paths such as:
  - `package.json`
  - `package-lock.json`
  - `.github`

If policy is violated, execution fails instead of producing a risky diff.

### `verify_change`

Runs configured repository verification scripts inside Docker.

For example:

```json
{
  "scripts": ["test", "build"]
}
```

If verification fails, the failure output is saved on the attempt and passed to the failure-analysis node.

The graph retries up to 3 attempts.

### `analyze_failure`

Summarizes failed verification output or diff-review feedback into concise retry guidance.

This prevents the next attempt from receiving only raw logs. The retry prompt gets a cleaner explanation of what failed and what to avoid.

### `review_diff`

Reviews the generated diff before creating the human publish approval.

It has two layers:

1. deterministic safety review
2. LLM-assisted ticket-fit review

The deterministic review rejects issues such as:

- empty diffs
- likely secrets or credentials in added lines
- dependency metadata changes
- GitHub automation changes
- very large diffs

The LLM-assisted review checks whether the diff appears to match the ticket and internal plan.

If review fails and attempts remain, the graph analyzes the feedback and retries. If no attempts remain, the execution is blocked.

### `block_execution`

If verification keeps failing after the max attempts, the execution is marked:

```txt
BLOCKED
```

The last verification failure is stored on the execution.

### `create_diff_artifact`

If verification passes, the graph:

- generates the git diff
- writes a `.diff` artifact
- hashes the diff snapshot
- marks the task attempt as completed
- creates a `PUBLISH` approval request
- moves execution to:

```txt
AWAITING_PUBLISH_APPROVAL
```

At this point the human must approve before the backend opens a draft PR.

## What did not change

LangGraph does not own the whole application.

The following remain outside LangGraph:

- API routes
- auth/security middleware
- Prisma schema
- RabbitMQ queue subscription
- Trello polling and sync
- GitHub App authentication
- draft PR publishing
- human approval persistence
- outbox/inbox idempotency
- Docker workspace primitives

This is intentional.

LangGraph is used as the agent execution state machine, while the backend remains the product platform and source of truth.

## Why this is better

This gives the project a cleaner path toward a real agent orchestrator.

The execution loop is now easier to extend with future nodes like:

- repository inspection
- file search
- structured planning
- test failure analysis
- code review
- tool execution
- security review
- dependency impact checks
- multi-agent handoff

Instead of adding more logic into one long worker function, new behavior can be added as explicit graph nodes.

## Verification performed

After the integration, these commands were run successfully:

```powershell
npm run build
npm run lint
npm test
```

Result:

```txt
build passed
lint passed
8 tests passed
0 tests failed
```

## Audit note

After installing LangGraph, the project was checked with:

```powershell
npm audit --audit-level=moderate
```

The remaining reported high-severity issue is from Prisma's transitive `deepmerge-ts` dependency, not from the LangGraph integration.

The suggested automatic fix would downgrade Prisma to `6.12.0`, which is a breaking change, so it was not applied automatically.

## Current limitation

The graph is now repo-aware and has pre-edit planning, failure analysis, and diff review.

The next limitation is tool richness. The agent still edits through bounded `FILE` actions rather than a typed tool loop with operations such as:

1. search files
2. read exact file ranges
3. apply patches
4. run targeted commands
5. inspect test failures interactively

That is the next capability layer to add after the current repo-aware graph is proven end-to-end with a real Trello card and GitHub draft PR.
