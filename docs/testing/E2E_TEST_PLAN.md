# End-to-End Test Plan

This file is the step-by-step test plan for the current vertical MVP.

Goal:

```txt
Trello card
→ backend WorkItem
→ Execution
→ plan approval
→ LangGraph agent run
→ Docker verification
→ diff artifact
→ publish approval
→ GitHub draft PR
```

Use a disposable GitHub repository and a disposable Trello board for this test.

Do not run the first end-to-end test on an important repository.

## 0. Postman environment variables

Create a Postman environment named:

```txt
Agent Orchestrator Local
```

Add these variables:

| Variable | Example | Notes |
|---|---|---|
| `BASE_URL` | `http://localhost:3001` | Backend URL |
| `API_AUTH_TOKEN` | empty or your token | Only needed if `.env.local` has `API_AUTH_TOKEN` |
| `PROJECT_ID` | empty | Filled after project creation |
| `AGENT_ID` | empty | Filled after agent creation |
| `REPOSITORY_ID` | empty | Filled after repository creation |
| `INTEGRATION_ID` | empty | Filled after Trello integration creation |
| `WORK_ITEM_ID` | empty | Filled after Trello sync |
| `EXECUTION_ID` | empty | Filled after execution lookup |
| `GITHUB_OWNER` | your username/org | GitHub owner |
| `GITHUB_REPO` | test repo name | Disposable repo |
| `GITHUB_INSTALLATION_ID` | numeric installation id | GitHub App installation id |
| `TRELLO_API_KEY` | your Trello key | From Trello |
| `TRELLO_TOKEN` | your Trello token | From Trello authorization URL |
| `TRELLO_BOARD_ID` | board id | From Trello API |
| `LLM_API_KEY` | your model key | OpenAI/Gemini/Anthropic key |

If you are running local dev with no `API_AUTH_TOKEN`, you can remove the authorization header from the curl commands.

If your `.env.local` has `API_AUTH_TOKEN`, keep this header:

```txt
Authorization: Bearer {{API_AUTH_TOKEN}}
```

## 1. Local infrastructure setup

Start Docker services:

```powershell
docker-compose up -d
```

Check containers:

```powershell
docker-compose ps
```

Expected:

- Postgres running on host port `15432`
- RabbitMQ running on host port `5672`
- RabbitMQ management UI on host port `25672`

RabbitMQ UI:

```txt
http://localhost:25672
```

Default login:

```txt
guest / guest
```

Sync the database schema:

```powershell
npm run prisma:push:local
```

Start the backend:

```powershell
npm run dev:local
```

Expected backend log:

```txt
Server is running on port 3001
```

## 2. Health check

Import this curl into Postman or run it directly.

```bash
curl --request GET "{{BASE_URL}}/health"
```

Expected response:

```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "rabbitmq": "ok"
  }
}
```

If RabbitMQ is `error`, the API may still start but the execution worker will not process jobs.

Fix RabbitMQ before continuing.

## 3. Prepare disposable GitHub repository

Create a small disposable GitHub repository.

Recommended repo contents:

```txt
README.md
package.json
```

Example `README.md`:

```md
# Agnet Orchestrator Demo

This repo is used for testing the agent orchestrator.
```

Example `package.json`:

```json
{
  "name": "agent-orchestrator-e2e-demo",
  "version": "1.0.0",
  "scripts": {
    "test": "node -e \"console.log('tests passed')\""
  }
}
```

Important:

- The repo must have a default branch, usually `main`.
- The GitHub App must be installed on this repo.
- The GitHub App needs permission to read/write contents and create pull requests.
- Use the GitHub App installation id as `{{GITHUB_INSTALLATION_ID}}`.

## 4. Prepare Trello board

Create a disposable Trello board.

Recommended board:

```txt
Agent Orchestrator E2E Test
```

Create lists:

```txt
Backlog
Ready for Agent
In Progress
Done
```

Create a label named exactly:

```txt
agent-ready
```

Create a card in `Ready for Agent`.

Card title:

```txt
Fix README typo
```

Card description:

```txt
Update the README heading from "Agnet Orchestrator Demo" to "Agent Orchestrator Demo".
Keep the change small and do not modify package files.
```

Add the label:

```txt
agent-ready
```

## 5. Get Trello credentials

Get Trello API key:

```txt
https://trello.com/app-key
```

Generate Trello token by opening this URL after replacing `YOUR_TRELLO_API_KEY`:

```txt
https://trello.com/1/authorize?expiration=never&name=Agent%20Orchestrator%20E2E%20Test&scope=read,write&response_type=token&key=YOUR_TRELLO_API_KEY
```

Get board id:

```bash
curl --request GET "https://api.trello.com/1/members/me/boards?fields=name,url&key={{TRELLO_API_KEY}}&token={{TRELLO_TOKEN}}"
```

Find your test board and copy its `id` into:

```txt
{{TRELLO_BOARD_ID}}
```

## 6. Create project

```bash
curl --request POST "{{BASE_URL}}/api/projects" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}" \
  --data '{
    "name": "Agent Orchestrator E2E",
    "description": "End-to-end test project for Trello to GitHub draft PR",
    "techStack": "Node.js / TypeScript",
    "architectureDecisions": "Use one narrow vertical slice first: ticket to verified draft PR"
  }'
```

Expected:

```json
{
  "id": "..."
}
```

Save returned `id` as:

```txt
{{PROJECT_ID}}
```

Verify:

```bash
curl --request GET "{{BASE_URL}}/api/projects/{{PROJECT_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

## 7. Create implementation agent

Choose provider/model based on your available key.

Examples:

- OpenAI: `provider = openai`, `model = gpt-4o-mini`
- Gemini: `provider = gemini`, `model = gemini-flash-latest`
- Anthropic: `provider = anthropic`, `model = claude-3-5-haiku-latest`

Use one of the following.

### Option A — OpenAI agent

```bash
curl --request POST "{{BASE_URL}}/api/agents" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}" \
  --data '{
    "name": "E2E Code Fixer",
    "description": "Fixes small repository issues from Trello tickets",
    "projectId": "{{PROJECT_ID}}",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "baseInstructions": "Make minimal safe code changes. Do not modify unrelated files. Return valid JSON with FILE actions only.",
    "config": {
      "apiKey": "{{LLM_API_KEY}}"
    }
  }'
```

### Option B — Gemini agent

```bash
curl --request POST "{{BASE_URL}}/api/agents" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}" \
  --data '{
    "name": "E2E Code Fixer",
    "description": "Fixes small repository issues from Trello tickets",
    "projectId": "{{PROJECT_ID}}",
    "provider": "gemini",
    "model": "gemini-flash-latest",
    "baseInstructions": "Make minimal safe code changes. Do not modify unrelated files. Return valid JSON with FILE actions only.",
    "config": {
      "apiKey": "{{LLM_API_KEY}}"
    }
  }'
```

Expected:

```json
{
  "id": "...",
  "config": {
    "configured": true
  }
}
```

Save returned `id` as:

```txt
{{AGENT_ID}}
```

Important:

The API key should not be returned in the response. It should be encrypted/redacted.

## 8. Register GitHub repository

Important:

`verificationConfig.scripts` must contain npm script names, not full commands.

Use:

```json
"scripts": ["test"]
```

Do not use:

```json
"scripts": ["npm test"]
```

Register the disposable repo:

```bash
curl --request POST "{{BASE_URL}}/api/repositories" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}" \
  --data '{
    "projectId": "{{PROJECT_ID}}",
    "owner": "{{GITHUB_OWNER}}",
    "name": "{{GITHUB_REPO}}",
    "defaultBranch": "main",
    "githubInstallationId": "{{GITHUB_INSTALLATION_ID}}",
    "verificationConfig": {
      "scripts": ["test"]
    },
    "executionPolicy": {
      "maxChangedFiles": 5,
      "protectedPaths": [
        "package.json",
        "package-lock.json",
        ".github"
      ]
    }
  }'
```

Expected:

```json
{
  "id": "..."
}
```

Save returned `id` as:

```txt
{{REPOSITORY_ID}}
```

Verify:

```bash
curl --request GET "{{BASE_URL}}/api/repositories?projectId={{PROJECT_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

## 9. Register Trello integration

Trello credentials are not stored in `.env.local`.

They are submitted through this API and encrypted in the database.

```bash
curl --request POST "{{BASE_URL}}/api/integrations" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}" \
  --data '{
    "projectId": "{{PROJECT_ID}}",
    "type": "TRELLO",
    "name": "E2E Trello Board",
    "config": {
      "apiKey": "{{TRELLO_API_KEY}}",
      "token": "{{TRELLO_TOKEN}}",
      "boardId": "{{TRELLO_BOARD_ID}}",
      "eligibleLabel": "agent-ready",
      "repositoryId": "{{REPOSITORY_ID}}"
    }
  }'
```

Expected:

```json
{
  "id": "...",
  "config": {
    "configured": true
  }
}
```

Save returned `id` as:

```txt
{{INTEGRATION_ID}}
```

Verify credentials are redacted:

```bash
curl --request GET "{{BASE_URL}}/api/integrations?projectId={{PROJECT_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Expected:

- The response should show `config.configured = true`.
- It should not expose the Trello API key or token.

## 10. Trigger Trello sync

```bash
curl --request POST "{{BASE_URL}}/api/integrations/{{INTEGRATION_ID}}/sync" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Expected:

```json
{
  "ingested": 1
}
```

If `ingested` is `0`, check:

- card has the `agent-ready` label
- label spelling is exactly `agent-ready`
- board id is correct
- Trello token has board access
- card is on the selected board

## 11. List imported work items

```bash
curl --request GET "{{BASE_URL}}/api/work-items?projectId={{PROJECT_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Expected:

- one work item from Trello
- title should be `Fix README typo`
- `externalSystem` should be `TRELLO`
- `sourceUrl` should point to the Trello card

Save returned work item `id` as:

```txt
{{WORK_ITEM_ID}}
```

Optional detail check:

```bash
curl --request GET "{{BASE_URL}}/api/work-items/{{WORK_ITEM_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

## 12. List executions

Trello sync should create an execution automatically.

```bash
curl --request GET "{{BASE_URL}}/api/executions?projectId={{PROJECT_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Expected:

- one execution exists
- status should eventually become one of:
  - `INGESTED`
  - `PLANNING`
  - `AWAITING_PLAN_APPROVAL`

Save returned execution `id` as:

```txt
{{EXECUTION_ID}}
```

If no execution exists, you can manually start one:

```bash
curl --request POST "{{BASE_URL}}/api/executions" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}" \
  --data '{
    "projectId": "{{PROJECT_ID}}",
    "workItemId": "{{WORK_ITEM_ID}}",
    "repositoryId": "{{REPOSITORY_ID}}"
  }'
```

## 13. Wait for plan creation

The execution planner runs from RabbitMQ/outbox.

Check execution details:

```bash
curl --request GET "{{BASE_URL}}/api/executions/{{EXECUTION_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Expected:

- `status` should be `AWAITING_PLAN_APPROVAL`
- `plans` should contain one plan
- `approvals` should contain a pending `PLAN` approval
- `events` should include `PLAN_SUBMITTED`

If it stays at `INGESTED`:

- check backend logs
- check RabbitMQ is connected
- check outbox worker is running
- check `/health`

## 14. Approve the plan

```bash
curl --request POST "{{BASE_URL}}/api/executions/{{EXECUTION_ID}}/approvals/plan" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}" \
  --data '{
    "approved": true,
    "comment": "Approved E2E test plan"
  }'
```

Expected:

- approval status becomes `APPROVED`
- execution status becomes `QUEUED`
- outbox publishes execution run job
- LangGraph execution starts shortly after

## 15. Watch backend logs

In the terminal running:

```powershell
npm run dev:local
```

Watch for:

- GitHub clone
- Docker npm install
- LangGraph execution events
- LLM request
- verification command
- diff artifact creation

If the agent fails to produce valid actions, the execution may become `BLOCKED`.

That is still a useful E2E result because it means the infrastructure path ran and the issue is now agent-output quality.

## 16. Poll execution during agent run

Run this repeatedly:

```bash
curl --request GET "{{BASE_URL}}/api/executions/{{EXECUTION_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Expected successful path:

```txt
QUEUED
→ RUNNING
→ VERIFYING
→ AWAITING_PUBLISH_APPROVAL
```

Expected events may include:

```txt
GRAPH_CONTEXT_LOADED
GRAPH_REPOSITORY_INSPECTED
GRAPH_INTERNAL_PLAN_CREATED
GRAPH_ATTEMPT_STARTED
GRAPH_POLICY_PASSED
GRAPH_VERIFICATION_PASSED
GRAPH_DIFF_REVIEW_PASSED
GRAPH_DIFF_ARTIFACT_CREATED
```

If verification fails, expected events may include:

```txt
GRAPH_VERIFICATION_FAILED
GRAPH_FAILURE_ANALYZED
GRAPH_ATTEMPT_STARTED
```

After max failures, expected status:

```txt
BLOCKED
```

## 17. Inspect diff artifact

When execution reaches:

```txt
AWAITING_PUBLISH_APPROVAL
```

Fetch details:

```bash
curl --request GET "{{BASE_URL}}/api/executions/{{EXECUTION_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Check:

- `artifacts` includes `type = DIFF`
- artifact name is `changes.diff`
- artifact has `sha256`
- `approvals` includes pending `PUBLISH`

Open the diff file locally from the artifact `storagePath`.

Expected diff:

```txt
- # Agnet Orchestrator Demo
+ # Agent Orchestrator Demo
```

The diff should not change:

- `package.json`
- `package-lock.json`
- `.github/*`
- unrelated files

## 18. Reject publish test, optional safety check

Optional but useful.

If you want to test rejection behavior first:

```bash
curl --request POST "{{BASE_URL}}/api/executions/{{EXECUTION_ID}}/approvals/publish" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}" \
  --data '{
    "approved": false,
    "comment": "Testing publish rejection"
  }'
```

Expected:

- execution becomes `CANCELED`
- no GitHub branch/PR is created

If you do this optional rejection test, create a new Trello card or edit the card to create a new execution before continuing.

For the first full success path, skip this optional step.

## 19. Approve publish

Only do this if the diff is safe.

```bash
curl --request POST "{{BASE_URL}}/api/executions/{{EXECUTION_ID}}/approvals/publish" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}" \
  --data '{
    "approved": true,
    "comment": "Approved to open draft PR for E2E test"
  }'
```

Expected:

- execution status becomes `PUBLISHING`
- backend checks approved snapshot hash
- backend checks base branch SHA has not changed
- backend commits and pushes branch
- backend creates draft PR
- execution becomes `COMPLETED`

## 20. Confirm final execution state

```bash
curl --request GET "{{BASE_URL}}/api/executions/{{EXECUTION_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Expected:

```txt
status = COMPLETED
branchName = agent/<execution-id>
completedAt is not null
```

Artifacts should include:

- `DIFF`
- `PULL_REQUEST`

The `PULL_REQUEST` artifact `storagePath` should be the GitHub PR URL.

## 21. Verify in GitHub

Open your disposable GitHub repo.

Verify:

- branch exists:

```txt
agent/{{EXECUTION_ID}}
```

- draft PR exists
- PR targets `main`
- PR contains only the expected README change
- PR title matches the Trello card title
- PR body includes execution information

## 22. Verify in Trello

Open the Trello card.

Expected:

- the backend may add comments such as:
  - plan created / awaiting approval
  - draft PR created

Trello comments are best-effort. If PR creation succeeded but Trello comment failed, the main vertical path is still successful, but Trello notification needs debugging.

## 23. Idempotency test

Run Trello sync again:

```bash
curl --request POST "{{BASE_URL}}/api/integrations/{{INTEGRATION_ID}}/sync" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Then list executions:

```bash
curl --request GET "{{BASE_URL}}/api/executions?projectId={{PROJECT_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Expected:

- no duplicate execution for the same unchanged Trello card revision

If a duplicate appears without changing the Trello card, idempotency needs fixing.

## 24. Failure test: card without eligible label

Create another Trello card without the `agent-ready` label.

Run sync:

```bash
curl --request POST "{{BASE_URL}}/api/integrations/{{INTEGRATION_ID}}/sync" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

List work items:

```bash
curl --request GET "{{BASE_URL}}/api/work-items?projectId={{PROJECT_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

Expected:

- unlabeled card is not imported

## 25. Failure test: protected file change

Create a Trello card with `agent-ready`.

Card title:

```txt
Change package name
```

Card description:

```txt
Change the package name in package.json.
```

Expected:

- agent may try to modify `package.json`
- policy should block protected path modification
- execution should fail/block instead of producing publish approval

This tests:

- protected path policy
- graph failure path
- safety boundary

## 26. Prisma Studio inspection

Optional but very useful.

Open Prisma Studio:

```powershell
npx dotenv -e .env.local -- npx prisma studio
```

Inspect these tables:

- `Project`
- `Agent`
- `Repository`
- `IntegrationConnection`
- `WorkItem`
- `Execution`
- `Plan`
- `PlanTask`
- `TaskAttempt`
- `Approval`
- `Artifact`
- `ExecutionEvent`
- `OutboxEvent`
- `InboxReceipt`

Check:

- Trello credentials are encrypted
- agent API key is encrypted/redacted
- execution status matches API response
- attempts are recorded
- artifacts point to diff/PR evidence
- approvals preserve decision/comment

## 27. Acceptance checklist

The E2E test passes if all of these are true:

- backend health is healthy
- Trello card with `agent-ready` imports into `WorkItem`
- execution is created exactly once for the card revision
- plan is created
- plan approval queues execution
- LangGraph execution starts
- repository is cloned
- agent produces a small change
- policy check passes
- Docker verification passes
- diff review passes
- diff artifact is created
- publish approval is required
- no GitHub PR is created before publish approval
- publish approval creates a GitHub branch
- publish approval creates a draft PR
- execution becomes `COMPLETED`
- PR contains only the expected change

## 28. Common problems and fixes

### `401 Unauthorized`

Cause:

- `.env.local` has `API_AUTH_TOKEN`
- request is missing bearer token

Fix:

Add header:

```txt
Authorization: Bearer {{API_AUTH_TOKEN}}
```

Or remove `API_AUTH_TOKEN` locally and restart backend.

### `/health` says RabbitMQ error

Cause:

- RabbitMQ container is not running
- port `5672` conflict
- backend started before RabbitMQ was ready

Fix:

```powershell
docker-compose ps
docker-compose up -d
```

Restart backend.

### Trello sync returns `ingested: 0`

Likely causes:

- card has no `agent-ready` label
- label spelling/case mismatch
- wrong board id
- wrong token
- token cannot access board

### Plan never appears

Likely causes:

- RabbitMQ worker unavailable
- outbox worker not running
- backend started in degraded mode

Check backend logs and `/health`.

### Agent gets blocked

Likely causes:

- LLM key invalid
- model name invalid
- LLM did not return valid JSON/actions
- generated change failed tests
- diff review rejected the output
- protected path policy blocked the change

Check execution events:

```bash
curl --request GET "{{BASE_URL}}/api/executions/{{EXECUTION_ID}}" \
  --header "Authorization: Bearer {{API_AUTH_TOKEN}}"
```

### Publish fails

Likely causes:

- GitHub App lacks permissions
- installation id is wrong
- base branch changed after execution
- branch already exists
- token expired/invalid
- repository name/owner wrong

Check backend logs and execution `lastError`.

## 29. What to do after the first E2E test

If it passes:

Move to the next roadmap step:

```txt
Typed tool use inside LangGraph
```

If it fails:

Do not add new features yet.

Fix the exact failing stage first:

```txt
Trello sync
Execution creation
Planning
Plan approval
Repo clone
LLM output
Verification
Diff review
Publish approval
GitHub PR creation
```

The goal is to make the narrow vertical path boring and reliable before expanding horizontally.

