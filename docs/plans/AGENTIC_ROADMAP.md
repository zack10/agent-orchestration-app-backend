# Agentic Roadmap

Created 2026-10-19. Tracks the work to turn the run step from "an LLM inside a fixed workflow" into a tool-using agent, and to measure whether each change actually helps.

The existing plumbing stays: Docker sandbox, LangGraph run graph, snapshot-bound approvals, outbox/inbox, leases, retries, dead-lettering, and the end-to-end suites. The phases change what happens **inside** the run step.

**Rule for every phase:** finish by re-running the Phase 0 benchmark and recording the result in the [results log](#results-log).

## Progress

| Phase | Problem it solves | How (concept) | Size | Status |
| --- | --- | --- | --- | --- |
| 0. Coding evaluation + prompt management | We can't tell whether the agent writes correct code, or whether a change made it better or worse. | A benchmark of 8 realistic bugs scored by hidden tests the agent never sees; prompts move to versioned files so every result is tied to the exact prompts used. | M | Done (baseline 2026-10-25: 6/8 pass, 1 wrong fix shipped) |
| 1. Provider registry + tool calling in the LLM layer | Each new LLM needs its own code and edits in several places, and the LLM layer can only send text and get text back, so the model can't ask to do anything. | One generic OpenAI-compatible provider configured per vendor (new vendors need configuration only), a single provider registry, then function calling behind one shared format. | M–L | Done; live check pending for Anthropic and OpenAI-compatible (no keys yet) |
| 2. Sandbox tools | The agent only sees files chosen by name, cut at 20 KB, and must rewrite whole files; it can also edit tests. | Give it safe tools inside the Docker sandbox (list, read, search, edit, run checks) with the safety rules enforced in each tool, and log every call. | M | Not started |
| 3. Agent loop | The agent gets one shot per attempt and can't explore, check its work or change course. | A loop where the model picks a tool, sees the result and decides the next step, until it finishes or hits a step/token/time budget; the existing checks still run after it. | L | Not started |
| 4. Parallel executions (several tickets at once) | Tickets run one after another, so one slow ticket holds up the rest. | Allow several runs at once with limits on runs, CPU/memory and LLM rate, keep each run isolated, and let workers scale as separate processes. | M–L | Not started |
| 5. Agent roles and a real planner | Every step uses the project's first agent, and plan approval reviews a fixed template. | Give agents roles (planner, implementer, reviewer) picked per step, and add a planner that reads the repo and proposes a real plan to approve. | M | Not started |
| 6. Agent skills | Stored skills never reach the agent, so reusable know-how goes unused. | The agent sees a short list of its role's skills and loads the full instructions only when needed; skills guide but never grant permissions. | M | Not started |
| 7. Real MCP | Tools are hard-coded and there's no standard way to plug in new ones. | Serve the sandbox tools over the Model Context Protocol and have the agent discover tools, so allowlisted external tool servers can be added safely. | M | Not started |
| 8. Retrieval | Tickets that don't name the right file can miss the relevant code. | Index the repo by meaning (embeddings in Postgres with pgvector) and add a semantic search tool. | M | Not started |
| 9. Collaborating agents and memory | The same agent reviews its own work, and nothing learned in one run helps the next. | An independent reviewer using structured, capped hand-offs controlled by the graph, plus per-repo lessons kept only once a real result confirms them. | M | Not started |

Phase 4 does not depend on Phases 1–3; it can be pulled forward any time after Phase 0.

## Why: what the project does not teach yet

Found while reviewing the code after the first passing end-to-end run (draft PR #1 on `zack10/agent-orchestration-test`, 2026-10-18):

| Gap | Where it shows up | Addressed by |
| --- | --- | --- |
| No way to measure coding quality; one easy pass proves plumbing, not ability | Only e2e ticket is "append a line to README" against a repo whose `test` script just echoes | Phase 0 |
| Execution prompts are hard-coded, unversioned and not recorded per run, so a prompt change can't be linked to a result | 5 inline prompt strings in `executionGraph.ts` (task, plan, implement, analyze, review); no system prompt; the agent's `baseInstructions` is ignored by this pipeline (only `promptBuilder.ts` uses it) | Phases 0, 5 |
| Skills are stored and assignable but have no effect | `Skill` model and `POST /api/skills/assign` exist; no prompt in either pipeline reads them | Phase 6 |
| Every new LLM needs its own code; only one OpenAI-compatible endpoint can be configured at a time | Provider list hard-coded in `LLMService.ts`, 4 Zod enums, `llmRoutes.ts`; single global `OPENAI_BASE_URL`; `listModels` keeps only `gpt-*`/`o1-*` | Phase 1 |
| No tool calling: the model never decides what to read, search or run | `implement_change` sends one prompt and gets whole files back | Phases 1–3 |
| Repo context is chosen by **file name** only | `repoContext.ts` scores paths by ticket words, max 12 files | Phases 2, 6 |
| Files are cut at **20 KB** but the agent returns **whole files** | `MAX_FILE_BYTES` in `repoContext.ts` + whole-file `FILE` blocks; large files can be silently truncated | Phase 2 |
| The agent can **edit or delete existing tests** to pass verification | Default `protectedPaths` covers only `package.json`, `package-lock.json`, `.github` | Phases 0 (hidden tests), 2 (tool policy) |
| `Execution.budget.maxTokens` is stored but never enforced | `createExecution` in `executionService.ts` | Phase 3 |
| Tickets run one after another in a single process | Each consumer takes one message at a time (`channel.prefetch(1)`, `rabbitMQService.ts`); no concurrency setting | Phase 4 |
| Parallel runs would share LLM rate limits with nothing coordinating them | Retries exist per call (`retry.ts`), but no shared limiter | Phase 4 |
| API and workers always run in the same process | `src/index.ts` starts both | Phase 4 |
| A run always uses the project's **first** agent, in no guaranteed order | `execution.project.agents[0]` in `executionGraph.ts`; `Agent` has no role field (the `AgentRole` enum is only used by `WorkItem`) | Phase 5 |
| Plan approval approves almost nothing | `executionWorker.plan` submits a fixed template ("Investigate and fix: <title>") | Phase 5 |
| Not real MCP; MCP resources never reach prompts | `mcpService` + one allowlisted HTTP connector | Phase 7 |
| Vague tickets can miss the relevant code | File-name matching only | Phase 8 |
| Review is one LLM call by the same agent; no memory between runs | `review_diff` in `executionGraph.ts` uses the run's agent; nothing is carried between executions | Phase 9 |

---

## Phase 0: Coding evaluation + prompt management

*Teaches: evaluating agents, benchmark design, avoiding gamed results, treating prompts as versioned code.*

**Goal:** measure whether the agent produces correct fixes on realistic bugs, and whether the pipeline stops wrong ones. Record a **baseline** for today's single-shot agent before changing anything.

### Design

- **Benchmark repo:** a small real JS project (`tests/e2e/coding-scenarios/repo/`): pagination, pricing, text utils, a CSV contact import, invoices and a money helper, an async user service, and a 30 KB shipping-rates module. Tests use `node:test` with no dependencies, so `npm ci` is instant and verification works with `--network none`.
- **Scenarios are sources in this repo, not branches.** Each `tests/e2e/coding-scenarios/NN-*/` has `scenario.json` (ticket, expected files), `bug/` (files that plant the bug over the clean project) and `hidden.test.js`. Before each run, the runner commits the scenario's code to the sandbox repo's `main` through the GitHub API, and afterwards it restores the clean project. This rewrites `main`, which is only acceptable because the repo is a throwaway sandbox.
- **Hidden acceptance tests** never leave this repo, so the agent cannot see or game them.
- **Every scenario is checked for fairness** in `npm test` (`tests/codingScenarios.test.js`): the clean project passes everything, and each bug passes the repo's own tests but fails its hidden test by an assertion.
- **Harness flow per run:** commit the scenario to `main` → create the Trello card → approve the plan → wait for a diff or `BLOCKED` → **reject publishing** (reaching publish approval already means a PR would be opened, so no real PRs pile up) → grade the diff in a network-less Docker container: apply it, run the repo's own tests, then the hidden test → record the result.

### Scenarios

| # | Scenario | Tests |
| --- | --- | --- |
| 1 | Off-by-one in pagination; ticket names the function | Basic single-file fix |
| 2 | Wrong rounding in an order total | Logic, numeric edge cases |
| 3 | `slugify` breaks on empty/accented input | Edge-case handling |
| 4 | Missing `await` gives wrong results | Async reasoning |
| 5 | Fix needs changes in two files (helper + caller) | Multi-file changes |
| 6 | Vague user-style ticket, no file names | File selection (known weak spot) |
| 7 | Bug in a file larger than 20 KB | Truncation risk (known weak spot) |
| 8 | Ambiguous or impossible ticket | Should end `BLOCKED`, not open a bogus PR |

### Scoring

Each run is recorded with outcome, attempts used, duration, LLM calls and tokens, files and lines changed, whether only the expected files changed, and whether any existing test was modified or deleted. Outcomes:

- **Correct fix**: a PR was opened and the hidden test passes.
- **Wrong fix shipped**: a PR was opened but the hidden test fails. **This is the key number.** It is what a human reviewer would have to catch.
- **Correctly blocked**: no PR on an impossible ticket.
- **No fix (blocked)**: the run gave up on a fixable ticket. Not harmful, but not a success.
- **Infrastructure failure**: Docker, rate limit or crash; counted separately so it doesn't skew the coding numbers.

Tokens are not recorded yet; the pipeline starts tracking usage in Phase 3.

### Open decisions (needed before starting)

- [x] OK to rewrite `main` on `zack10/agent-orchestration-test` before each scenario? (Alternative: one sandbox repo per scenario; slower to set up.) **Yes.**
- [x] Model and budget: 24 runs (8 scenarios × 3) at roughly 3–8 LLM calls each is about 70–190 calls, far above the Gemini free tier (20 requests/day per model). Choose: a paid key, spreading runs over several days (`--scenario`), or starting with 8 runs (1 per scenario). **Decided 2026-10-24: free tier (`gemini-flash-lite-latest`), 1 run per scenario, about 2 scenarios a day. The 8 × 3 run waits for a paid key, and switching model then starts a new baseline row.**
- [x] Provide `E2E_GITHUB_TOKEN`: a fine-grained PAT for the sandbox repo only, with *Contents* read/write (used to commit each scenario to `main`). *Pull requests* read/write is optional; it lets the execution e2e suite close its PRs. Check it with `npm run eval:coding -- --check`. **Done; `--check` passes.**

### Prompt management

The benchmark only means something if every result is tied to the exact prompts that produced it.

- **Prompts become versioned files** (e.g. `src/prompts/execution/implement.v1.md`) instead of inline strings in `executionGraph.ts`. The first move keeps the **exact same text**, so the baseline describes today's behaviour.
- **Fixed instructions vs ticket details.** Each prompt is split into a system prompt (fixed instructions) and a user prompt (per-ticket details).
- **Every run records its prompt versions** (in the attempt/execution events and the benchmark report), and the results log has a prompt-version column.
- **A prompt change is an experiment.** It gets a new version number, goes through the benchmark like a code change, and is kept only if results don't get worse.

### Tasks

- [x] Move the 5 execution-graph prompts to versioned prompt files, unchanged in wording, with a small loader and fill-in variables (`src/prompts/`; the task prompt is folded into `implement.v1`, and the FILE format is a shared fragment `file-format.v1`)
- [x] Split each into a system and a user part; providers already accept `system` (`LLMService.generateContent`)
- [x] Record prompt versions per attempt (execution event payload) and in each benchmark report (`promptVersions` on `GRAPH_CONTEXT_LOADED` and `GRAPH_ATTEMPT_STARTED`, `promptVersion` on each LLM step's event; the report header lists them)
- [x] Unit test: the loader fills every variable and fails loudly on a missing one (`tests/prompts.test.js`, which also proves v1 keeps the old wording)
- [x] Build the benchmark repo content and the 8 scenarios (as sources here instead of branches; see Design)
- [x] `tests/e2e/coding-scenarios/<id>/` with ticket text, expected files and hidden test for each scenario, plus the fairness check in `npm test`
- [x] Runner `npm run eval:coding` (reuses `tests/e2e/helpers.js` and the new `tests/e2e/pipeline.js`) that writes `docs/testing/coding-eval-<date>.md`; `--check` verifies the setup without LLM calls. The grader was checked against known-good and known-bad diffs; a full run is still pending
- [x] Run the baseline (single-shot agent, 1 run per scenario on the free tier) and record it in the results log (2026-10-24/25; see the results log and the findings below)
- [ ] After the baseline, first prompt experiment: `implement.v2` asking explicitly for `actions` as one string. On `gemini-flash-lite-latest`, attempt 1 of every baseline run so far was rejected because `actions` came back as an array, costing one attempt and one LLM call per scenario

**Done when:** prompts live in versioned files, and a baseline report exists, tied to those prompt versions, with per-scenario outcomes and an overall pass rate and wrong-fix-shipped rate.

### Baseline findings (2026-10-25)

1 run per scenario on `gemini-flash-lite-latest`, so each number is one sample; re-run 8 × 3 when a paid key is available.

| # | Outcome | What happened |
| --- | --- | --- |
| 1–5 | Correct fix | Small, focused fixes, each with added regression tests; no existing test changed |
| 6 | **Wrong fix shipped** | Found the right file from a vague ticket and fixed the import, but the rewrite broke the exported `parseLine` (`"a,b,c"` → `["a"]`). First graded correct: nothing tested `parseLine`. The hidden test now checks it and the stored diff was re-graded |
| 7 | No fix (blocked) | 2 of 3 attempts lost to the `actions` format; the one real attempt failed the repo's tests (large-file weak spot) |
| 8 | Correctly blocked | The planner refused the right way, but the implement step cannot decline: it must return FILE blocks, so it was blocked only by exhausting all 3 attempts |

What this says about the next phases:

- **Attempt 1 failed on output format in all 8 runs** (`actions` sent as an array). That is ~1 LLM call and 1 of 3 attempts wasted per ticket, and it cost scenario 7 its fix. First experiment: `implement.v2` (task below). The Phase 3 tool loop removes the free-text file format entirely.
- **There is no way to decline a ticket.** An impossible or unsafe ticket ends `BLOCKED` only after burning every attempt, with "no FILE blocks" as the recorded reason. Phase 3's `finish(summary)` needs an explicit "cannot do / needs clarification" outcome, and Phase 5's planner should be able to stop at plan time.
- **Hidden tests must also protect the exported API of the files a fix is likely to touch**, not only the bug. Scenario 6 showed a rewrite can pass every bug test while breaking a neighbouring function. Apply this rule when adding scenarios.

---

## Phase 1: Provider registry + tool calling in the LLM layer

*Teaches: function calling, tool schemas, provider differences, configuration-driven integrations.*

Today providers only offer `generateContent(prompt) → text` (`src/services/llm/`), and adding one means code in several places: a provider class, registration and the `ProviderKey` type in `LLMService.ts`, four `z.enum(["gemini", "openai", "anthropic"])` in `schemas/index.ts`, and the list in `routes/llmRoutes.ts`. `OpenAIProvider` can already reach an OpenAI-compatible API, but only one at a time (a single global `OPENAI_BASE_URL`), and its `listModels` hides any model not named `gpt-*`/`o1-*`.

**Goal:** adding an LLM is configuration, not code. Most vendors (Mistral, Groq, DeepSeek, xAI, Together, Fireworks, OpenRouter, and local Ollama/vLLM/LM Studio) speak the OpenAI `/chat/completions` format, so one generic provider covers them. Native classes are written only for APIs that really differ (Gemini and Anthropic today; Bedrock, Vertex or Cohere only if needed). The registry is done **before** tool calling, so every compatible vendor gets tool calling from the single OpenAI mapping.

### Design

- **Provider profiles:** each OpenAI-compatible vendor is a configuration entry, e.g. `{ "key": "groq", "baseUrl": "https://api.groq.com/openai/v1", "apiKeyEnv": "GROQ_API_KEY", "supportsTools": true }`. Built-in profiles cover OpenAI; others come from config (`LLM_PROVIDERS`, parsed and validated in `src/config.ts`).
- **One registry is the source of truth:** provider keys for Zod validation, `/api/llm`, `LLMService` routing and the default provider all come from it. No hard-coded provider lists elsewhere.
- **Base URLs come only from server configuration**, never from API callers or an agent's `config`: otherwise anyone who can create an agent could make the server send its key to any host (same SSRF concern as the MCP connector). Agents choose a provider key and a model, nothing else.
- **Capabilities per profile** (`supportsTools`, `supportsSystemPrompt`): compatible servers differ, and callers that need tools (Phase 3) get a clear error instead of a silent text-only reply.
- **Same guarantees for every provider:** rate-limit retries (`retry.ts`), truncation/refusal/empty detection (`LLMOutputError`), `describeError` logging.

### Tasks

**Provider registry**

- [x] Turn `OpenAIProvider` into a generic `OpenAICompatibleProvider(profile)` with its own base URL, key and capabilities; `listModels` returns every model the endpoint lists (no `gpt-*` filter) with known metadata where available
- [x] `LLM_PROVIDERS` config: parse and validate profiles at boot (unique keys, `https` base URLs except an explicit local allowance such as `localhost` in non-production, key env var present), and keep `OPENAI_BASE_URL` working for existing setups
- [x] Provider registry built at startup from the native providers plus the profiles; `LLMService` routes through it
- [x] Replace the hard-coded provider lists: the four Zod enums, `/api/llm`, `ProviderKey`, and the `"gemini"` fallbacks in `executionGraph.ts` / `agentRunner.ts` (a configured default instead)
- [x] Unit tests: two profiles side by side route to their own base URLs and keys; an unknown provider is rejected by validation; an invalid profile refuses to boot; agent input cannot set a base URL
- [x] README: how to add an LLM by configuration, and when a native provider is still needed

Registry done 2026-10-25 (`src/services/llm/registry.ts`, `providers/OpenAICompatibleProvider.ts`, `tests/llmRegistry.test.js`). Not yet tried against a real non-OpenAI vendor: a quick check with a local Ollama or any vendor key is still open.

**Tool calling**

- [x] Add a provider-neutral message and tool format, plus `generateWithTools(messages, tools) → { text, toolCalls, stopReason, usage }` to `LLMProvider`
- [x] Gemini mapping: `functionDeclarations` / `functionCall` / `functionResponse`
- [x] OpenAI-compatible mapping: `tools` / `tool_calls` / `role: "tool"` (shared by every profile with `supportsTools`)
- [x] Anthropic mapping: `tools` / `tool_use` / `tool_result`
- [x] A profile without `supportsTools` fails `generateWithTools` with a clear, non-retryable error
- [x] Keep the existing guarantees: rate-limit retries (`retry.ts`), truncation/refusal/empty detection (`LLMOutputError`), `describeError` logging
- [x] Unit tests with recorded provider responses showing the same tool call round-trips on Gemini, Anthropic and the OpenAI-compatible provider

Tool calling done 2026-10-25 (`generateWithTools` in `LLMService` and each provider, `toolMessages.ts`, `tests/llmTools.test.js`). Assistant turns keep the provider's raw reply and replay it, because Anthropic thinking blocks and Gemini thought signatures must come back unchanged. A live two-turn tool call worked on `gemini-flash-lite-latest`; Anthropic and the OpenAI-compatible mapping are covered by unit tests only until a key is available.

**Done when:** a new OpenAI-compatible LLM can be added and used by an agent with configuration only (no code change), and one tool definition works identically across Gemini, Anthropic and the OpenAI-compatible provider in tests.

---

## Phase 2: Sandbox tools

*Teaches: tool design, safety at the tool boundary, observability.*

### Tasks

- [ ] Long-lived container per run (`docker run -d` + `docker exec`) instead of a new container per command, with the same CPU/memory/PID limits and no network
- [ ] `list_files`
- [ ] `read_file(path, startLine, endLine)`: range reads remove the 20 KB cut-off
- [ ] `search_code(pattern)`: `git grep` inside the sandbox; content search instead of file-name matching
- [ ] `edit_file(path, oldText, newText)`: targeted replacement instead of whole-file rewrites; fails if `oldText` is missing or not unique
- [ ] `run_check(script)`: only scripts listed in `Repository.verificationConfig`
- [ ] `finish(summary)`
- [ ] Policy inside the tools: existing path checks (no `.git`, no symlinks, no escaping the root), protected paths **including existing test files**, output caps, per-tool timeouts. Denials are returned to the model as results, not thrown
- [ ] Record every call in the existing, currently unused `ToolCall` table (`REQUESTED/RUNNING/COMPLETED/DENIED/FAILED`)
- [ ] Unit tests for each tool's policy (path escape, protected test file, oversized output, unknown script)

**Done when:** every tool works and is policy-tested against a local workspace, with calls visible in `ToolCall`.

---

## Phase 3: Agent loop

*Teaches: act → observe → decide loops, budgets, stopping conditions, context management.*

### Tasks

- [ ] New `agent_loop` graph node that replaces `implement_change`: model → tool calls → results → repeat until `finish` or a budget runs out
- [ ] Budgets: max steps, max tokens (enforce `Execution.budget.maxTokens`), wall-clock time; hitting one ends the attempt with a clear reason
- [ ] Context management: trim or summarise old tool output so long runs fit the context window
- [ ] Keep `verify_change → review_diff → analyze_failure` after the loop as an independent outer guard
- [ ] Feature flag `EXECUTION_AGENT_MODE=single_shot|tool_loop` so both modes run through the benchmark
- [ ] Execution events for each step, so a run can be replayed from `GET /api/executions/:id`
- [ ] Update the README run-graph diagram

**Done when:** `tool_loop` completes the e2e execution suite, and its benchmark results are recorded next to the baseline.

---

## Phase 4: Parallel executions (several tickets at once)

*Teaches: concurrency in agent systems, isolation, shared rate limits, scaling workers.*

**Goal:** several agents work on different tickets at the same time, safely, without interfering with each other or exhausting shared limits.

What already makes this safe: each execution has its own workspace folder, Docker container, diff artifact and branch (`agent/<executionId>`), and leases plus atomic claims stop two workers from running the same execution. What's missing is a way to turn concurrency on, limits to keep it under control, and proof that it works.

### Tasks

- [ ] Per-queue concurrency option in `rabbitMQService.subscribe` (prefetch per consumer), driven by `EXECUTION_RUN_CONCURRENCY`, `EXECUTION_PLAN_CONCURRENCY`, `EXECUTION_PUBLISH_CONCURRENCY`; defaults stay at 1
- [ ] Resource cap: a maximum number of concurrent Docker runs per process, sized to the host (each run is limited to 2 CPUs / 2 GB today)
- [ ] Shared LLM rate limiter keyed by provider + API key (per-minute requests and tokens), so parallel runs queue for capacity instead of all hitting `429`; in-process first, then Postgres- or Redis-backed for multiple processes
- [ ] Process roles: `PROCESS_ROLE=api|worker|all` (default `all`), so workers can scale separately from the API
- [ ] Fairness: one project's backlog cannot starve another's (e.g. a per-project concurrency cap)
- [ ] Visibility: running and queued executions per project via the API (and queue depth in `/health` or a status endpoint)
- [ ] Isolation audit: confirm nothing is shared between runs (workspace and artifact paths, branch names, temp files, Trello comments, `TaskAttempt` numbering)
- [ ] Unit tests: concurrency limits respected, rate limiter waits rather than fails, per-project cap
- [ ] E2E concurrency test: create 3 cards at once and run them in parallel; all reach `COMPLETED`, and each PR contains only its own change
- [ ] E2E recovery test with 2 worker processes: kill one mid-run; its lease expires and the other worker finishes the run
- [ ] Update README (architecture diagram, configuration, troubleshooting)

**Done when:** 3 tickets run in parallel end to end with no cross-contamination, the shared limiter keeps them under the provider's rate limit, and a killed worker's run is recovered by another process.

---

## Phase 5: Agent roles and a real planner

*Teaches: assigning agents to jobs, separating planning from doing, making human review meaningful.*

### Tasks

- [ ] Agent roles per project: add a role field to `Agent` (e.g. `PLANNER`, `IMPLEMENTER`, `REVIEWER`) with a migration; each role can use its own provider, model and key
- [ ] The graph selects the agent for each step by role (with a clear error, or a documented fallback, when a role is missing) instead of `project.agents[0]`
- [ ] Each role's `baseInstructions` is added to that step's system prompt in the execution pipeline (today only the task pipeline uses it); the prompt version is still recorded
- [ ] API validation and README docs for roles (e.g. at most one agent per role per project)
- [ ] A planning agent that explores the repo **read-only** with Phase 2 tools and proposes affected files, approach, risks and test strategy
- [ ] Replace the fixed template in `executionWorker.plan` with that plan, so plan approval reviews real content
- [ ] The agent loop receives the approved plan and reports deviations from it
- [ ] Benchmark: compare the outcomes and the attempts used with and without the planner

**Done when:** each step of a run uses the agent assigned to its role, approved plans name concrete files and an approach, and the benchmark shows the planner's effect.

---

## Phase 6: Agent skills

*Teaches: packaging reusable know-how for agents, progressive disclosure, context budgets, prompt-injection risk.*

Comes after the agent loop (Phase 3) and roles (Phase 5), because skills are loaded through a tool and assigned per role.

### Design

- **What a skill is:** a name and a one-line description the agent always sees, plus a detailed instruction body loaded **only when needed** through a `load_skill(name)` tool. This "progressive disclosure" keeps the context small instead of pasting every skill into every prompt.
- **Where skills attach:** to agent roles (e.g. a planner skill "how to scope a bug fix", a reviewer skill "what to check in a diff") and optionally to a repository (e.g. "how this repo runs its tests").
- **Skills are guidance, never permissions.** A skill cannot grant tools, paths or network access beyond the Phase 2 policy; the tools enforce policy regardless of what a skill says.
- **Skills are a prompt-injection surface.** They are text written by people and fed to the model, so: size limits, only authorised API callers can create or edit them, every change is versioned, and the version used is recorded per run (like prompts in Phase 0).
- **Skills earn their place.** Each one is benchmarked against the same scenarios without it, and removed if it doesn't help.

### Tasks

- [ ] Extend the `Skill` model as needed (version, role/repository scope, size limit) with a migration; keep the existing API working
- [ ] Show each available skill's name and description in the role's system prompt
- [ ] `load_skill(name)` tool in the agent loop; it returns only skills assigned to the current role or repository
- [ ] Record which skills (and versions) were loaded in each run's events and benchmark report
- [ ] Validation and limits on skill create/update (size, allowed fields); unit tests for scoping and limits
- [ ] Benchmark each skill with and without it; record results; remove skills that don't help
- [ ] Update README (skills section, "Known limits")

**Done when:** assigned skills reach the agent through `load_skill`, every run records which skill versions it used, and each kept skill has a benchmark result showing it helps.

---

## Phase 7: Real MCP

*Teaches: Model Context Protocol, standard tool discovery, connecting servers.*

### Tasks

- [ ] Expose the Phase 2 sandbox tools as an MCP server using the official SDK
- [ ] Make the agent loop an MCP client that discovers tools instead of hard-coding them
- [ ] Allow attaching allowlisted external MCP servers (e.g. documentation), reusing the connector registry and `MCP_HTTP_ALLOWED_HOSTS` rules
- [ ] Make assigned MCP resources available to the agent (an existing gap; skills are handled in Phase 6)
- [ ] Update the README "Known limits" section

**Done when:** the agent loop runs entirely through MCP tool discovery, and an external server can be attached safely.

---

## Phase 8: Retrieval

*Teaches: embeddings, chunking, search quality.*

### Tasks

- [ ] Chunk the cloned repository and store embeddings in Postgres with pgvector (migration + index)
- [ ] `semantic_search(query)` tool
- [ ] Benchmark scenario 6 (vague ticket) with and without it

**Done when:** scenario 6 results are recorded with and without retrieval.

---

## Phase 9: Collaborating agents and memory

*Teaches: dividing work between agents, explicit hand-offs, long-term memory.*

Phase 4 runs many agents side by side on **different** tickets. This phase has several agents cooperate on the **same** ticket.

### Design rules: limit error sources

Free-form agent conversation is deliberately **out of scope**. Agents chatting until they agree tends to compound errors (each agent builds on the last one's mistakes), converge on wrong answers (models defer to each other, especially the same model), multiply cost and latency, lose context at each hand-off, and make failures hard to trace. Cooperation here follows these rules:

1. **Structured, one-way hand-offs.** An agent returns data in a fixed schema, never free text for another agent to interpret. For example, the reviewer returns `{ "decision": "approve" | "request_changes", "issues": [{ "file", "line", "problem", "requiredChange" }] }`, validated with Zod; invalid output counts as a failed review.
2. **The graph is in control.** Agents never message each other directly. Graph edges decide who acts next. Decision: hand-offs are **graph edges, not the messaging layer** (`messagingService`), because they need the graph's ordering, budgets and audit trail; the messaging layer suits loosely coupled services.
3. **Bounded rounds.** At most 2 review rounds per attempt, then `BLOCKED` for a human. The rounds count toward the execution budget (steps, tokens, time).
4. **Real independence.** The reviewer uses a different model where possible, and always a fresh context: it sees the ticket, the approved plan and the diff, never the implementer's reasoning or conversation.
5. **Objective checks outrank agent opinions.** Verification scripts, hidden tests and deterministic diff review (`diffReview.ts`) run regardless of what the reviewer says. A reviewer can only add rejections; it can never override a failing check.
6. **Small hand-off payloads.** Each hand-off carries only what the next step needs (e.g. the planner passes a short structured plan, not its exploration transcript), so the receiving context stays focused.
7. **Prove it or remove it.** Every collaboration feature is benchmarked against the single-agent baseline. If wrong-fix-shipped does not go down, or cost rises without a quality gain, it is removed and the result is recorded in the results log.

### Tasks

- [ ] Independent reviewer agent (the `REVIEWER` role from Phase 5) replacing the single review call, following rules 1, 4 and 5
- [ ] Zod schema for the reviewer's output; invalid output fails the review instead of being guessed at
- [ ] Review loop as graph edges: `request_changes` sends the structured issues back to the implementer, capped at 2 rounds, then `BLOCKED`
- [ ] Every hand-off recorded as an execution event (sender role, schema version, payload), so each decision can be traced
- [ ] Per-repository memory: store lessons from failed attempts (e.g. "this repo uses `node:test`", "run `build` before `test`") as short structured notes, and retrieve them in later runs. Notes must be confirmed by an objective result (e.g. a check that failed and then passed) before they are reused, so the agents can't feed themselves guesses
- [ ] Benchmark each feature separately against the baseline: reviewer, review loop, memory

**Done when:** the effect of each feature is recorded in the results log, and any feature that did not improve wrong-fix-shipped or cost per success has been removed.

---

## Results log

One row per benchmark run, newest last.

| Date | Phase / change | Mode | Model | Prompt versions | Skills | Runs | Correct fix | Wrong fix shipped | Correctly blocked | Infra failures | Avg attempts | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-25 | 0. Baseline | single_shot | gemini-flash-lite-latest | plan.v1, review.v1, analyze.v1, implement.v1, file-format.v1 | none | 8 (1 per scenario) | 5 | 1 | 1 | 0 | 2.25 | Pass rate 75% (6/8), wrong-fix-shipped 13% (1/8), 33 LLM calls, code `0356a2a`+grader fixes. 1 no fix (#7). Reports: [10-24](../testing/coding-eval-2026-10-24.md), [10-24-2](../testing/coding-eval-2026-10-24-2.md), [10-25](../testing/coding-eval-2026-10-25.md), [10-25-2](../testing/coding-eval-2026-10-25-2.md) |
