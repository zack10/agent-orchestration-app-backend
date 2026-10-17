# Agent Orchestrator — Detailed Test Plan

## 1. What this plan tests

This document validates the implemented backend in increasing levels of risk:

1. Build, lint, unit tests, schema validation, and dependency audit.
2. PostgreSQL, RabbitMQ, API health, authentication, and legacy tasks.
3. Repository and encrypted Trello integration configuration.
4. Trello card ingestion and execution idempotency.
5. Plan approval.
6. Docker-isolated agent execution, verification, and repair.
7. Diff-bound publish approval and GitHub draft pull-request creation.
8. Rejection, verification failure, protected-path, restart, and base-branch drift behavior.

Use only a disposable Trello board and disposable GitHub repository. The test workflow can create branches, commits, comments, and draft pull requests.

---

## 2. Required software

Install and confirm:

- Node.js 20 or newer.
- npm.
- Docker Desktop.
- Git.
- `curl` or Postman.

Start local infrastructure:

```bash
docker-compose up -d
docker-compose ps
```

Expected services and ports:

| Service | Address |
| --- | --- |
| API | `http://localhost:3001` |
| PostgreSQL | `localhost:15432` |
| RabbitMQ AMQP | `localhost:5672` |
| RabbitMQ management | `http://localhost:25672` |
| Prisma Studio | `http://localhost:5555` |

RabbitMQ management credentials are `guest / guest` for local development.

Synchronize the local schema:

```bash
npm run prisma:push:local
```

Run automated verification:

```bash
npm install
npm run verify
npm audit --audit-level=moderate
npx prisma validate
```

Expected:

- ESLint passes.
- Prisma Client generates.
- TypeScript compiles.
- Six tests pass.
- npm reports zero vulnerabilities.
- Prisma reports that the schema is valid.

Start the backend and keep this terminal running:

```bash
npm run dev:local
```

Optionally start Prisma Studio in another terminal:

```bash
npx dotenv -e .env.local -- npx prisma studio
```

---

## 3. Configure local environment

At minimum, `.env.local` needs:

```dotenv
NODE_ENV=development
PORT=3001
DATABASE_URL="postgresql://user:password@localhost:15432/agent_orchestration?schema=public"
RABBITMQ_URL="amqp://guest:guest@localhost:5672"
ENCRYPTION_KEY=YOUR_64_CHARACTER_HEXADECIMAL_KEY
GEMINI_API_KEY=YOUR_GEMINI_KEY
```

For the complete GitHub workflow it also needs:

```dotenv
GITHUB_APP_ID=YOUR_GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

The private key must be stored as one quoted environment value. Replace actual line breaks with the two characters `\n`. The backend converts them back to line breaks at runtime.

Authentication is optional in local development when `API_AUTH_TOKEN` is empty. To test authentication, set:

```dotenv
API_AUTH_TOKEN=local-test-token-change-me
API_AUTH_ACTOR=local-test-user
```

Restart the backend after changing `.env.local`.

Never commit `.env.local`, Trello tokens, GitHub private keys, or provider API keys.

---

## 4. Create a disposable GitHub test repository

### 4.1 Create the repository

In GitHub:

1. Create a new private repository, for example `agent-orchestrator-fixture`.
2. Do not use a production repository.
3. Clone it locally.
4. Create a small Node.js/TypeScript project.
5. Commit a `package-lock.json` because the worker runs `npm ci --ignore-scripts`.
6. Ensure these scripts exist and pass on the default branch:

```json
{
  "scripts": {
    "lint": "eslint .",
    "build": "tsc",
    "test": "node --test"
  }
}
```

7. Add a small reproducible bug and at least one test that demonstrates the expected behavior.
8. Push the repository to GitHub.

The agent is not allowed to modify these protected paths by default:

- `package.json`
- `package-lock.json`
- `.github/`

Choose a test bug that can be fixed without changing those files.

### 4.2 Create a GitHub App

Use GitHub’s official GitHub App settings:

1. Open GitHub profile menu → **Settings**.
2. Open **Developer settings** → **GitHub Apps**.
3. Click **New GitHub App**.
4. Set a unique name, such as `Local Agent Orchestrator Test`.
5. Set Homepage URL to `http://localhost:3001`.
6. Disable webhook delivery for this test because the current backend does not consume GitHub webhooks.
7. Under **Repository permissions**, configure:
   - **Contents:** Read and write.
   - **Pull requests:** Read and write.
   - **Metadata:** Read-only; GitHub normally enables this automatically.
8. Do not request organization or account permissions.
9. Select **Only on this account** if GitHub presents an installation scope option.
10. Create the app.

Official reference: [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).

### 4.3 Generate the private key

On the GitHub App settings page:

1. Note the numeric **App ID**.
2. Scroll to **Private keys**.
3. Click **Generate a private key**.
4. GitHub downloads a `.pem` file once. Store it securely.
5. Convert the PEM into a quoted single-line value with `\n` separators and place it in `GITHUB_APP_PRIVATE_KEY`.
6. Put the App ID in `GITHUB_APP_ID`.

Do not use the OAuth Client ID; the backend requires the numeric App ID.

### 4.4 Install the GitHub App

1. Open the GitHub App settings page.
2. Select **Install App**.
3. Install it on the account that owns the disposable repository.
4. Choose **Only select repositories**.
5. Select only `agent-orchestrator-fixture`.
6. Complete the installation.
7. Open the installation configuration page.
8. Copy the numeric installation ID from the browser URL. It is the number in a URL similar to:

```text
https://github.com/settings/installations/12345678
```

Official reference: [Installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app).

You now need these values later:

- GitHub repository owner.
- GitHub repository name.
- Default branch, usually `main`.
- GitHub App installation ID.

---

## 5. Create a disposable Trello test board

### 5.1 Create the board and label

In Trello:

1. Create a board such as `Agent Orchestrator Test`.
2. Create lists such as `Todo`, `In Progress`, and `Done`.
3. Create a label whose exact name is `agent-ready`.
4. Do not add that label to a card until repository and integration configuration is complete.

### 5.2 Obtain a Trello API key

Use Trello’s developer/Power-Up administration page while logged in:

1. Open [Trello Power-Up Admin](https://trello.com/power-ups/admin).
2. Create a new Power-Up or integration entry if required by Trello.
3. Open its API key section.
4. Generate or copy the API key.

Trello’s UI can change. The authoritative concepts are an API key identifying the integration and a member token authorizing access. See [Trello REST API authorization](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/).

### 5.3 Generate a Trello member token

Replace `YOUR_TRELLO_API_KEY` and open this URL in a browser:

```text
https://trello.com/1/authorize?expiration=never&name=Agent%20Orchestrator%20Test&scope=read,write&response_type=token&key=YOUR_TRELLO_API_KEY
```

Then:

1. Review the requested `read,write` scope.
2. Approve only for the disposable Trello account/board.
3. Copy the displayed token.
4. Store it securely; it grants access as the approving Trello user.

For stricter testing, replace `expiration=never` with a shorter supported expiration and regenerate when needed.

### 5.4 Find the Trello board ID using curl

```bash
curl --request GET \
  --url "https://api.trello.com/1/members/me/boards?fields=name,url&key=YOUR_TRELLO_API_KEY&token=YOUR_TRELLO_TOKEN" \
  --header "Accept: application/json"
```

Find the object whose `name` is `Agent Orchestrator Test` and copy its `id`.

You now need:

- Trello API key.
- Trello token.
- Trello board ID.
- Eligible label name: `agent-ready`.

---

## 6. curl conventions

Examples below use placeholders such as `PROJECT_ID`. Replace them with IDs returned by earlier requests.

Base URL:

```text
http://localhost:3001
```

When local authentication is disabled, omit the Authorization header. When enabled, include:

```bash
--header "Authorization: Bearer local-test-token-change-me"
```

On Windows PowerShell, call `curl.exe` instead of `curl` if PowerShell aliases `curl` to another command. The HTTP syntax remains the same.

For readable JSON, optionally pipe responses to `jq` if installed:

```bash
curl ... | jq
```

---

## 7. Postman setup

### 7.1 Create an environment

Create a Postman environment named `Agent Orchestrator Local` with:

| Variable | Initial value |
| --- | --- |
| `baseUrl` | `http://localhost:3001` |
| `apiToken` | empty, or your local API token |
| `projectId` | empty |
| `agentId` | empty |
| `repositoryId` | empty |
| `integrationId` | empty |
| `workItemId` | empty |
| `executionId` | empty |
| `geminiModel` | empty |

Select this environment.

### 7.2 Configure collection authentication

Create a collection named `Agent Orchestrator Tests`:

1. Open collection **Authorization**.
2. Select **Bearer Token**.
3. Set token to `{{apiToken}}`.
4. If authentication is disabled locally, either leave the variable empty and remove inherited auth from requests, or set `API_AUTH_TOKEN` and restart the backend.
5. Add collection header `Content-Type: application/json` for JSON requests.

### 7.3 Save response IDs automatically

For create requests, add a Postman post-response script like:

```javascript
const body = pm.response.json();
pm.environment.set("projectId", body.id);
```

Change the variable name for each resource:

- Project → `projectId`
- Agent → `agentId`
- Repository → `repositoryId`
- Integration → `integrationId`

For work-item and execution list responses:

```javascript
const body = pm.response.json();
pm.expect(body).to.be.an("array").that.is.not.empty;
pm.environment.set("workItemId", body[0].id);
```

Use `executionId` for the execution list request.

---

## 8. API health and authentication tests

### 8.1 Health

curl:

```bash
curl --request GET --url "http://localhost:3001/health"
```

Postman:

- Method: `GET`
- URL: `{{baseUrl}}/health`
- Authorization: No Auth

Expected status: `200`.

Expected body:

```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "rabbitmq": "ok"
  }
}
```

### 8.2 Authentication rejection

This test requires a non-empty `API_AUTH_TOKEN` and a restarted backend.

```bash
curl --request GET \
  --url "http://localhost:3001/api/agents" \
  --header "Authorization: Bearer wrong-token"
```

Expected: HTTP `401` and error code `UNAUTHORIZED`.

Repeat using the correct token. Expected: HTTP `200`.

---

## 9. Create project and implementation agent

### 9.1 Create project

curl:

```bash
curl --request POST \
  --url "http://localhost:3001/api/projects" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Vertical Slice Test",
    "description": "Disposable Trello to GitHub test project",
    "techStack": "Node.js 20, TypeScript",
    "architectureDecisions": "Small bug fixes only; draft PRs; no automatic merge"
  }'
```

If authentication is disabled, remove the Authorization line.

Expected: HTTP `201`. Copy `id` as `PROJECT_ID` or let Postman save it as `projectId`.

Postman:

- Method: `POST`
- URL: `{{baseUrl}}/api/projects`
- Body → raw → JSON: use the same body.
- Post-response script: save `body.id` to `projectId`.

### 9.2 Discover Gemini models

```bash
curl --request GET \
  --url "http://localhost:3001/api/llm/models?provider=gemini" \
  --header "Authorization: Bearer YOUR_API_TOKEN"
```

Expected: HTTP `200` and a non-empty `models` array. Copy one model’s `name` as `GEMINI_MODEL`.

In Postman save it automatically:

```javascript
const body = pm.response.json();
pm.expect(body.models).to.be.an("array").that.is.not.empty;
pm.environment.set("geminiModel", body.models[0].name);
```

### 9.3 Create implementation agent

```bash
curl --request POST \
  --url "http://localhost:3001/api/agents" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Bug Fix Agent",
    "description": "Implements bounded Node and TypeScript bug fixes",
    "projectId": "PROJECT_ID",
    "provider": "gemini",
    "model": "GEMINI_MODEL",
    "baseInstructions": "Fix only the reported bug. Do not modify protected files or unrelated code."
  }'
```

Expected: HTTP `201`. Copy `id` as `AGENT_ID`. The response must not expose an API key.

---

## 10. Test the legacy task workflow

This proves the original `/api/tasks` flow still works.

```bash
curl --request POST \
  --url "http://localhost:3001/api/tasks" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --header "Idempotency-Key: legacy-test-001" \
  --header "Content-Type: application/json" \
  --data '{
    "agentId": "AGENT_ID",
    "payload": {
      "instruction": "Create a small TypeScript hello-world file."
    }
  }'
```

Expected: HTTP `202`. Copy the task `id`.

Poll:

```bash
curl --request GET \
  --url "http://localhost:3001/api/tasks/TASK_ID" \
  --header "Authorization: Bearer YOUR_API_TOKEN"
```

Expected status progression: `PENDING → IN_PROGRESS → COMPLETED`, or a truthful `FAILED` result.

Repeat the POST with the same `Idempotency-Key`. Expected: the same task ID, not a duplicate task.

---

## 11. Register the GitHub repository

```bash
curl --request POST \
  --url "http://localhost:3001/api/repositories" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "projectId": "PROJECT_ID",
    "owner": "YOUR_GITHUB_OWNER",
    "name": "agent-orchestrator-fixture",
    "defaultBranch": "main",
    "githubInstallationId": "YOUR_INSTALLATION_ID",
    "verificationConfig": {
      "scripts": ["lint", "build", "test"]
    },
    "executionPolicy": {
      "maxChangedFiles": 20,
      "protectedPaths": ["package.json", "package-lock.json", ".github"]
    }
  }'
```

Expected: HTTP `201`. Copy `id` as `REPOSITORY_ID`.

Postman:

- Method: `POST`
- URL: `{{baseUrl}}/api/repositories`
- Replace IDs with `{{projectId}}` and values with your repository information.
- Save response `id` to `repositoryId`.

Negative test: try owner `../unsafe`. Expected: HTTP `400` validation failure.

---

## 12. Register the encrypted Trello integration

```bash
curl --request POST \
  --url "http://localhost:3001/api/integrations" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "projectId": "PROJECT_ID",
    "type": "TRELLO",
    "name": "Disposable Trello Board",
    "config": {
      "apiKey": "YOUR_TRELLO_API_KEY",
      "token": "YOUR_TRELLO_TOKEN",
      "boardId": "YOUR_TRELLO_BOARD_ID",
      "eligibleLabel": "agent-ready",
      "repositoryId": "REPOSITORY_ID"
    }
  }'
```

Expected: HTTP `201`. Copy `id` as `INTEGRATION_ID`.

Expected response property:

```json
{
  "config": {
    "configured": true
  }
}
```

The response must not contain `apiKey` or `token`.

Check Prisma Studio → `IntegrationConnection`. `encryptedConfig` must contain ciphertext and must not contain the plaintext Trello key or token.

Postman: save response `id` to `integrationId`.

---

## 13. Create and ingest a Trello bug card

### 13.1 Create the card manually in Trello

Create a card in the disposable board:

Title:

```text
Fix add() returning concatenated strings
```

Description:

```text
Reproduction: add("2", "3") returns "23".
Expected: add("2", "3") returns 5.
Keep changes limited to the implementation and its existing tests.
```

Apply the exact label `agent-ready`.

### 13.2 Trigger manual synchronization

```bash
curl --request POST \
  --url "http://localhost:3001/api/integrations/INTEGRATION_ID/sync" \
  --header "Authorization: Bearer YOUR_API_TOKEN"
```

Expected: HTTP `200` with an `ingested` count of at least one.

### 13.3 List work items

```bash
curl --request GET \
  --url "http://localhost:3001/api/work-items?projectId=PROJECT_ID" \
  --header "Authorization: Bearer YOUR_API_TOKEN"
```

Expected:

- One work item corresponds to the card ID.
- `externalSystem` is `TRELLO`.
- `sourceUrl` points to the card.
- `revisionHash` is populated.

Copy its `id` as `WORK_ITEM_ID`.

### 13.4 List executions

```bash
curl --request GET \
  --url "http://localhost:3001/api/executions?projectId=PROJECT_ID" \
  --header "Authorization: Bearer YOUR_API_TOKEN"
```

Expected: one execution reaches `AWAITING_PLAN_APPROVAL`. Copy its `id` as `EXECUTION_ID`.

### 13.5 Test ingestion idempotency

Run the manual sync two more times without editing the Trello card. List executions again.

Expected: no new execution for the unchanged card revision.

Then edit the card description and sync again. Expected: one new execution for the new revision hash, unless another active execution policy prevents it.

---

## 14. Inspect and approve the plan

### 14.1 Inspect execution details

```bash
curl --request GET \
  --url "http://localhost:3001/api/executions/EXECUTION_ID" \
  --header "Authorization: Bearer YOUR_API_TOKEN"
```

Expected:

- Status: `AWAITING_PLAN_APPROVAL`.
- One plan with status `PENDING_APPROVAL`.
- Acceptance criteria are present.
- A pending approval with type `PLAN` and a snapshot hash exists.
- Trello contains a comment saying the plan awaits approval.

### 14.2 Approve the plan

```bash
curl --request POST \
  --url "http://localhost:3001/api/executions/EXECUTION_ID/approvals/plan" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "approved": true,
    "comment": "Approved for disposable repository testing."
  }'
```

Expected: approval status `APPROVED` and execution state progression:

```text
QUEUED → RUNNING → VERIFYING
```

Postman:

- Method: `POST`
- URL: `{{baseUrl}}/api/executions/{{executionId}}/approvals/plan`
- Body: same JSON.

### 14.3 Observe execution

Poll every few seconds:

```bash
curl --request GET \
  --url "http://localhost:3001/api/executions/EXECUTION_ID" \
  --header "Authorization: Bearer YOUR_API_TOKEN"
```

The worker should:

1. Obtain a short-lived GitHub installation token.
2. Resolve and store the default branch SHA.
3. Create `workspaces/EXECUTION_ID`.
4. Clone the repository inside a Docker container.
5. Run `npm ci --ignore-scripts`.
6. Ask the configured agent for a bounded bug fix.
7. Reject unsafe paths or too many changed files.
8. Run configured `lint`, `build`, and `test` scripts with network disabled.
9. Retry failed implementation/verification up to three attempts.

Expected successful terminal for this stage: `AWAITING_PUBLISH_APPROVAL`.

If the state becomes `BLOCKED` or `FAILED`, inspect:

- `lastError`.
- `plans[].tasks[].attempts`.
- `artifacts`.
- Backend logs.
- Docker Desktop container logs/history.

The system must never report success when a required verification script failed.

---

## 15. Inspect and approve publication

### 15.1 Inspect evidence

Request execution details again.

Expected:

- Status: `AWAITING_PUBLISH_APPROVAL`.
- A `DIFF` artifact exists.
- A pending approval with type `PUBLISH` exists.
- The publish approval snapshot hash equals the diff artifact `sha256`.
- No GitHub branch or pull request exists yet.

Review the diff artifact from its `storagePath` before approving.

### 15.2 Approve publication

```bash
curl --request POST \
  --url "http://localhost:3001/api/executions/EXECUTION_ID/approvals/publish" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "approved": true,
    "comment": "Approved exact diff and verification evidence."
  }'
```

Expected state progression:

```text
PUBLISHING → COMPLETED
```

Expected GitHub outcome:

- Branch `agent/EXECUTION_ID` exists.
- One commit contains the reviewed changes.
- One draft pull request exists.
- PR base is the configured default branch.
- PR body links the Trello card and execution ID.
- PR is not merged.

Expected Trello outcome:

- A comment contains the draft PR URL.

Expected execution outcome:

- `branchName` is populated.
- `completedAt` is populated.
- A `PULL_REQUEST` artifact contains the PR URL.

---

## 16. Postman request order

Create these requests in one collection and run them in order:

1. `GET Health`
2. `POST Create Project`
3. `GET Gemini Models`
4. `POST Create Agent`
5. `POST Create Repository`
6. `POST Create Trello Integration`
7. `POST Sync Trello`
8. `GET Work Items`
9. `GET Executions`
10. `GET Execution Details`
11. `POST Approve Plan`
12. `GET Execution Details` repeatedly until publish approval
13. `POST Approve Publish`
14. `GET Execution Details` until completed

Useful Postman assertions:

```javascript
pm.test("Successful HTTP status", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 201, 202]);
});
```

Execution awaiting plan:

```javascript
const body = pm.response.json();
pm.expect(body.status).to.eql("AWAITING_PLAN_APPROVAL");
pm.expect(body.approvals.some(a => a.type === "PLAN" && a.status === "PENDING")).to.eql(true);
```

Execution awaiting publish:

```javascript
const body = pm.response.json();
pm.expect(body.status).to.eql("AWAITING_PUBLISH_APPROVAL");
const diff = body.artifacts.find(a => a.type === "DIFF");
const approval = body.approvals.find(a => a.type === "PUBLISH" && a.status === "PENDING");
pm.expect(diff).to.exist;
pm.expect(approval.snapshotHash).to.eql(diff.sha256);
```

Completed execution:

```javascript
const body = pm.response.json();
pm.expect(body.status).to.eql("COMPLETED");
pm.expect(body.artifacts.some(a => a.type === "PULL_REQUEST")).to.eql(true);
```

---

## 17. Required failure tests

### 17.1 Reject plan

Create another eligible card, sync, then call:

```bash
curl --request POST \
  --url "http://localhost:3001/api/executions/EXECUTION_ID/approvals/plan" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"approved":false,"comment":"Plan is too broad."}'
```

Expected:

- Execution becomes `CANCELED`.
- No workspace, branch, or PR is created.

### 17.2 Reject publication

Allow another execution to reach `AWAITING_PUBLISH_APPROVAL`, then reject publish approval.

Expected:

- Execution becomes `CANCELED`.
- No remote branch or PR is created.
- Local evidence remains available for audit.

### 17.3 Verification failure

Use a fixture whose required test cannot pass without violating scope.

Expected:

- Up to three `TaskAttempt` records.
- Execution ends `BLOCKED`.
- `lastError` contains verification evidence.
- No publish approval or PR.
- Trello receives a blocked comment.

### 17.4 Protected path

Create a ticket that requires changing `package.json`, `package-lock.json`, or `.github/*`.

Expected:

- Policy rejects the change.
- Execution fails or blocks.
- No publication occurs.

### 17.5 Too many files

Set repository `maxChangedFiles` to a small number such as `1`, then use a bug requiring multiple file changes.

Expected: policy rejection and no publication.

### 17.6 Duplicate approval

Approve the same plan twice.

Expected: the second request returns HTTP `409`; it does not enqueue another execution.

### 17.7 Base branch drift

After the execution reaches `AWAITING_PUBLISH_APPROVAL`, push a new commit to `main`, then approve publication.

Expected:

- Publication is rejected because the current base SHA differs from the execution base SHA.
- No stale PR is created.

### 17.8 Workspace changed after approval

After requesting publish approval, alter a file inside `workspaces/EXECUTION_ID`, then approve.

Expected:

- Recomputed diff hash does not match the approved snapshot.
- Publication is rejected.

### 17.9 Restart recovery

Stop and restart `npm run dev:local` once while an execution is queued and once while tasks are pending.

Expected:

- RabbitMQ reconnects.
- Outbox events resume.
- No duplicate execution, task attempt, branch, or PR.

### 17.10 Invalid Trello credentials

Create an integration with an invalid token and trigger manual sync.

Expected:

- Sync returns an error.
- `IntegrationConnection.lastError` is populated by polling.
- Credentials are not printed in API responses.

---

## 18. Inspect state in Prisma Studio

During tests inspect these tables:

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

Confirm:

- Integration credentials are encrypted.
- Execution statuses follow the documented order.
- Approval actors match `API_AUTH_ACTOR`.
- Diff and approval hashes match before publication.
- Outbox events become `PUBLISHED`.
- Inbox receipts prevent repeated queue processing.

---

## 19. Evidence and acceptance gate

For every live run record:

- Trello card URL.
- Work-item ID.
- Execution ID.
- Base commit SHA.
- Plan and acceptance criteria.
- Plan approval actor/comment.
- Attempt count.
- Verification outputs.
- Diff artifact hash.
- Publish approval actor/comment.
- Draft PR URL.
- Final Trello comment.
- Any manual corrections required by the reviewer.

Do not consider the vertical slice accepted after only one successful demonstration. Run at least ten disposable small-bug tasks.

Acceptance requires:

- No duplicate executions or PRs for unchanged card revisions.
- No `COMPLETED` execution when required checks failed.
- No host filesystem or protected-path escape.
- No plaintext credential exposure.
- Every external repository write has publish approval.
- At least one restart-recovery test succeeds.
- Reviewers can understand and evaluate each draft PR from its plan and verification evidence.
