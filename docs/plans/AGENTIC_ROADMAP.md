# Agentic Roadmap

Created 2026-10-19. Tracks the work to turn the run step from "an LLM inside a fixed workflow" into a tool-using agent, and to measure whether each change actually helps.

The existing plumbing stays: Docker sandbox, LangGraph run graph, snapshot-bound approvals, outbox/inbox, leases, retries, dead-lettering, and the end-to-end suites. The phases change what happens **inside** the run step.

**Rule for every phase:** finish by re-running the Phase 0 benchmark and recording the result in the [results log](#results-log). From Phase 4 on, also run the [reference projects](#reference-projects): real projects in different stacks. Limitations nobody has found yet are expected to show up there, as failing rows, and go into the [known limitations](#known-limitations-audit-2026-10-26) table before the phase counts as done.

**Rule for every phase: no language lock-in.** The agent must work on repositories in any language, framework and platform, not only Node/TypeScript. New code must not assume a language, package manager, build tool or test runner; anything toolchain-specific comes from the repository's detected or configured toolchain (Phase 4), and prompts must not name a language unless it comes from that toolchain.

**Deployment (decided 2026-10-26): developer laptop first, shared server later.** First each developer runs the orchestrator on their own machine for their own tickets; once that works well, a team installs it on a server and shares it. Both run executions in containers: runs are started by tickets, not watched command by command, so the agent never gets the developer's machine (files, SSH keys, credentials), and it works on its own clone so it never touches the developer's checkout. Design for both from now on: what runs on a laptop must also work on a server (several users, several executions at once, Phase 8), and laptop costs matter (disk for images, Docker Desktop speed, one-command install, a per-developer token budget). A supervised "host mode" that uses the developer's own environment, like Claude Code, can be added later as an explicit option for runs a person starts and watches.

## Progress

| Phase | Problem it solves | How (concept) | Size | Status |
| --- | --- | --- | --- | --- |
| 0. Coding evaluation + prompt management | We can't tell whether the agent writes correct code, or whether a change made it better or worse. | A benchmark of 8 realistic bugs scored by hidden tests the agent never sees; prompts move to versioned files so every result is tied to the exact prompts used. | M | Done (baseline 2026-10-25: 6/8 pass, 1 wrong fix shipped) |
| 1. Provider registry + tool calling in the LLM layer | Each new LLM needs its own code and edits in several places, and the LLM layer can only send text and get text back, so the model can't ask to do anything. | One generic OpenAI-compatible provider configured per vendor (new vendors need configuration only), a single provider registry, then function calling behind one shared format. | M–L | Done; live check pending for Anthropic only (no key yet) |
| 2. Sandbox tools | The agent only sees files chosen by name, cut at 20 KB, and must rewrite whole files; it can also edit tests. | Give it safe tools inside the Docker sandbox (list, read, search, edit, run checks) with the safety rules enforced in each tool, and log every call. | M | Done (tools built and tested; used from Phase 3) |
| 3. Agent loop | The agent gets one shot per attempt and can't explore, check its work or change course. | A loop where the model picks a tool, sees the result and decides the next step, until it finishes or hits a step/token/time budget; the existing checks still run after it. | L | Done |
| 4. Any language, framework and platform | The pipeline assumes Node: a Node-only sandbox image, `npm ci`, checks run as `npm run <script>`, `package.json`-based context and prompts that say "Node/TypeScript". A PHP, Java, Python or Go repository cannot be fixed at all. | Detect each repository's toolchain (with per-repository overrides) and take the sandbox image, install step and checks from it; give the agent a general command tool inside the sandbox like a real coding agent; enforce test and protected-file rules on the final diff; language-neutral prompts; benchmark scenarios in other languages. | L | In progress |
| 5. Any source host and issue tracker | Only GitHub repositories and Trello cards work; the agent reads only a card's title and description, and always targets the default branch. | Pluggable source-control adapters (GitLab, Bitbucket, Azure DevOps) like the tracker adapters, more tracker adapters (Jira, Linear, GitHub Issues), ticket attachments and comments passed to the agent, and a chosen target branch. | L | Not started |
| 6. Any kind of task | The agent only fixes bugs, with one task in one repository per ticket. | Task types (bug, feature, refactor, dependency upgrade, migration) with matching prompts and checks, plans with several tasks, and changes across several repositories; benchmark scenarios for each type. | L | Not started |
| 7. Feedback loop after the PR | The agent stops at the draft PR: it never sees review comments or the repository's own CI. | Read PR review comments and CI results, and run a follow-up attempt on the same branch, within the same budgets and approvals. | M | Not started |
| 8. Parallel executions (several tickets at once) | Tickets run one after another, so one slow ticket holds up the rest. | Allow several runs at once with limits on runs, CPU/memory and LLM rate, keep each run isolated, and let workers scale as separate processes. | M–L | Not started |
| 9. Agent roles and a real planner | Every step uses the project's first agent, and plan approval reviews a fixed template. | Give agents roles (planner, implementer, reviewer) picked per step, and add a planner that reads the repo and proposes a real plan to approve. | M | Not started |
| 10. Agent skills | Stored skills never reach the agent, so reusable know-how goes unused. | The agent sees a short list of its role's skills and loads the full instructions only when needed; skills guide but never grant permissions. | M | Not started |
| 11. Real MCP | Tools are hard-coded and there's no standard way to plug in new ones. | Serve the sandbox tools over the Model Context Protocol and have the agent discover tools, so allowlisted external tool servers can be added safely. | M | Not started |
| 12. Retrieval | Tickets that don't name the right file can miss the relevant code. | Index the repo by meaning (embeddings in Postgres with pgvector) and add a semantic search tool. | M | Not started |
| 13. Collaborating agents and memory | The same agent reviews its own work, and nothing learned in one run helps the next. | An independent reviewer using structured, capped hand-offs controlled by the graph, plus per-repo lessons kept only once a real result confirms them. | M | Not started |
| 14. Other platforms and running the app | Everything runs in Linux containers, so iOS/macOS, Windows-only, Android, GPU and browser-based work can't be built or tested, and the agent can't run the app to reproduce UI or runtime bugs. | Platform runners selected by the toolchain (macOS and Windows build machines, Android emulators, headless browsers), and tools to start the app and observe it (HTTP requests, browser screenshots, logs). | L | Not started |

Phase 8 does not depend on Phases 1–7; it can be pulled forward any time after Phase 0.

## Known limitations (audit 2026-10-26)

Every place where the agent is tied to one language, platform, service or kind of problem, and the phase that removes it. **No phase is done while it leaves one of its rows open.** New limitations of this kind go in this table first.

| # | Limitation | Where in the code | Effect | Phase |
| --- | --- | --- | --- | --- |
| 1 | Node/TypeScript only | `node:20-bookworm` image, `npm ci`, `npm run` (`workspaceService.ts`, `run_check`, `verifyWorkspace`), `package.json` context, prompts | Other languages can't be fixed at all | 4 |
| 2 | Tests that need services can't run | Sandbox runs with `--network none` and nothing beside it | Web backends whose tests need Postgres, MySQL, Redis, queues (Laravel, Django, Rails, Spring, ...) can't be verified | 4 |
| 3 | Linux containers only | All work runs in a Linux Docker container | iOS/macOS (Xcode), Windows-only .NET Framework, Android, GPU and browser tests can't be built or run | 14 |
| 4 | GitHub only | GitHub App for clone, push and PRs (`integrations/githubApp.ts`) | GitLab, Bitbucket, Azure DevOps repositories can't be used | 5 |
| 5 | Trello only | One `IssueTrackerAdapter` (Trello) | Jira, Linear, GitHub Issues tickets can't come in | 5 |
| 6 | Private dependencies fail | Install has no registry credentials; submodules and Git LFS not fetched | Private npm/Maven/Composer/PyPI packages, submodules and LFS files are missing | 4 |
| 7 | Missing check scripts block every run | Default checks `lint`, `build`, `test` (`executionGraph.ts`, `toolRunner.ts`) | A repository without one of them fails verification on every attempt, even with a correct fix | 4 |
| 8 | Bug fixes only | Prompts say "fix this bug"; the plan is a fixed template | Features, refactors, upgrades and migrations aren't supported or measured | 6 |
| 9 | One task in one repository | `plans[0].tasks[0]`; one repository per execution | Multi-step tickets and changes across repositories (e.g. frontend + backend) can't be done | 6 |
| 10 | Fixed size limits | 20 changed files, 500 KB per file, 2 CPU / 2 GB per sandbox, 5-minute checks, 250-file context tree, all hard-coded | Large builds (Java, C++, monorepos) run out of memory or time; large changes are rejected | 4 |
| 11 | Only the ticket title and description are read | Trello fetch reads `name,desc` | Screenshots, attached logs, stack traces and comments never reach the agent | 5 |
| 12 | Monorepos and subprojects | Checks always run at the repository root | A fix in a subproject can't be verified with that subproject's own toolchain | 4 |
| 13 | Always targets the default branch | `repository.defaultBranch` for base and PR | Release or hotfix branches can't be fixed | 5 |
| 14 | Stops at the draft PR | No PR comment or CI integration | Review feedback and CI failures are never acted on | 7 |
| 15 | Can't run the app | Only file tools and check scripts | UI and runtime bugs can't be reproduced or confirmed | 14 |
| 16 | Single-shot is still the default | `EXECUTION_AGENT_MODE=single_shot` | Whole-file rewrites unless `tool_loop` is switched on, although it measured better | 4 |
| 17 | Tests that need secrets or environment config | No way to give a run environment variables or `.env` values | Suites that need API keys, config files or feature flags won't start | 4 |
| 18 | Flaky or slow test suites | Checks run once, as a whole, with a 5-minute timeout | A random failure looks like a bad fix and burns attempts; long suites always time out; failures that existed before the change are blamed on it | 4 |
| 19 | Few or no tests | Verification only runs what exists | A passing check proves nothing, and nobody is told; the agent doesn't write the missing tests first | 4, 6 |
| 20 | Infrastructure and config repositories (Terraform, Kubernetes, Helm, Ansible) | No checks beyond test scripts | Changes can't be validated; a real check (`terraform plan`) needs cloud or cluster access | 4 (static checks), 14 (real environments) |
| 21 | Very large repositories | Full clone per execution (`cloneGithubWorkspace`), `search_code` reads every file on each call, 250-file overview, 500-entry `list_files`, whole suite per check | Slow and expensive runs, a tiny view of the code, missed related code in other modules | 4, 12 |
| 22 | Quality depends on the model | Measured only on `gemini-flash-lite-latest` with Node scenarios | Results in other languages and on hard tickets are unknown; a weak model fails where a strong one would succeed | 4 (and every phase) |
| 23 | Prompt injection | Ticket text, attachments, comments and repository files reach the prompt | Text written to steer the agent (e.g. "also send the .env file to ...") could change what it does | 5, 7 (and every phase) |
| 24 | Newest OpenAI models can't run the tool loop | `OpenAICompatibleProvider.generateWithTools` uses `/v1/chat/completions` only | `gpt-6-luna`, `gpt-5.6-luna` reject function tools there with reasoning on (400, "use /v1/responses or set reasoning_effort to 'none'"); found 2026-10-29, benchmark switched to `gpt-5-mini` | 4 |

## Reference projects

The benchmark (8 bugs in one small Node repository) proves the agent can fix code, not that it copes with real projects. A code review found 23 limitations; others only show up when the agent runs on a real project (an unusual build, a test runner that needs a display, a package manager that behaves differently in a container). So every phase from Phase 4 is confirmed on a fixed set of small, real-world reference projects, each with a known bug and hidden tests, graded like the benchmark:

| Stack | What it exercises |
| --- | --- |
| Laravel (PHP) + MySQL | Composer, a database in tests, framework conventions |
| Spring Boot (Java, Maven) | JVM build, slow startup, memory |
| Django (Python) + Postgres | pip/poetry, migrations, a database in tests |
| Rails (Ruby) | Bundler, framework conventions |
| Go service | Go modules, `go test` |
| React frontend (TypeScript) | Frontend build, component tests |
| .NET (C#) | `dotnet` SDK, solution files |
| Monorepo (several packages) | Subprojects with their own toolchains |
| Terraform repository | Static checks without cloud access |

A project that can't be supported yet stays in the matrix as a known failure, linked to its limitation row, so progress is visible. The matrix grows with each phase (another tracker or source host in Phase 5, feature and refactor tickets in Phase 6, a UI bug in Phase 14).

## Why: what the project does not teach yet

Found while reviewing the code after the first passing end-to-end run (draft PR #1 on `zack10/agent-orchestration-test`, 2026-10-18):

| Gap | Where it shows up | Addressed by |
| --- | --- | --- |
| No way to measure coding quality; one easy pass proves plumbing, not ability | Only e2e ticket is "append a line to README" against a repo whose `test` script just echoes | Phase 0 |
| Execution prompts are hard-coded, unversioned and not recorded per run, so a prompt change can't be linked to a result | 5 inline prompt strings in `executionGraph.ts` (task, plan, implement, analyze, review); no system prompt; the agent's `baseInstructions` is ignored by this pipeline (only `promptBuilder.ts` uses it) | Phases 0, 9 |
| Skills are stored and assignable but have no effect | `Skill` model and `POST /api/skills/assign` exist; no prompt in either pipeline reads them | Phase 10 |
| Every new LLM needs its own code; only one OpenAI-compatible endpoint can be configured at a time | Provider list hard-coded in `LLMService.ts`, 4 Zod enums, `llmRoutes.ts`; single global `OPENAI_BASE_URL`; `listModels` keeps only `gpt-*`/`o1-*` | Phase 1 |
| No tool calling: the model never decides what to read, search or run | `implement_change` sends one prompt and gets whole files back | Phases 1–3 |
| Repo context is chosen by **file name** only | `repoContext.ts` scores paths by ticket words, max 12 files | Phases 2, 12 |
| Files are cut at **20 KB** but the agent returns **whole files** | `MAX_FILE_BYTES` in `repoContext.ts` + whole-file `FILE` blocks; large files can be silently truncated | Phase 2 |
| The agent can **edit or delete existing tests** to pass verification | Default `protectedPaths` covers only `package.json`, `package-lock.json`, `.github` | Phases 0 (hidden tests), 2 (tool policy) |
| ~~`Execution.budget.maxTokens` is stored but never enforced~~ Enforced for every model call of an execution, plus a daily limit across all of them (see "Cost guardrails") | `createExecution` in `executionService.ts` | Phase 3 |
| Nothing stops many executions from adding up to a large bill: budgets are per execution only | No usage records, no total across executions | Phase 3 (daily limit), Phase 8 (pause and resume, alerts) |
| Only Node/TypeScript repositories can be fixed | Sandbox image `node:20-bookworm` and `npm ci --ignore-scripts` (`workspaceService.ts`); `npm run <script>` in `verifyWorkspace` and the `run_check` tool; `verificationConfig` holds npm script names; `repoContext.ts` reads `package.json`; default protected paths are npm files; prompts say "Node/TypeScript" | Phase 4 |
| Tickets run one after another in a single process | Each consumer takes one message at a time (`channel.prefetch(1)`, `rabbitMQService.ts`); no concurrency setting | Phase 8 |
| Parallel runs would share LLM rate limits with nothing coordinating them | Retries exist per call (`retry.ts`), but no shared limiter | Phase 8 |
| API and workers always run in the same process | `src/index.ts` starts both | Phase 8 |
| A run always uses the project's **first** agent, in no guaranteed order | `execution.project.agents[0]` in `executionGraph.ts`; `Agent` has no role field (the `AgentRole` enum is only used by `WorkItem`) | Phase 9 |
| Plan approval approves almost nothing | `executionWorker.plan` submits a fixed template ("Investigate and fix: <title>") | Phase 9 |
| Not real MCP; MCP resources never reach prompts | `mcpService` + one allowlisted HTTP connector | Phase 11 |
| Vague tickets can miss the relevant code | File-name matching only | Phase 12 |
| Review is one LLM call by the same agent; no memory between runs | `review_diff` in `executionGraph.ts` uses the run's agent; nothing is carried between executions | Phase 13 |

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
- **There is no way to decline a ticket.** An impossible or unsafe ticket ends `BLOCKED` only after burning every attempt, with "no FILE blocks" as the recorded reason. Phase 3's `finish(summary)` needs an explicit "cannot do / needs clarification" outcome, and Phase 9's planner should be able to stop at plan time.
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

Registry done 2026-10-25 (`src/services/llm/registry.ts`, `providers/OpenAICompatibleProvider.ts`, `tests/llmRegistry.test.js`). Checked live 2026-10-26 with a config-only `LLM_PROVIDERS` profile for LM Studio (`google/gemma-4-e4b`, local).

**Tool calling**

- [x] Add a provider-neutral message and tool format, plus `generateWithTools(messages, tools) → { text, toolCalls, stopReason, usage }` to `LLMProvider`
- [x] Gemini mapping: `functionDeclarations` / `functionCall` / `functionResponse`
- [x] OpenAI-compatible mapping: `tools` / `tool_calls` / `role: "tool"` (shared by every profile with `supportsTools`)
- [x] Anthropic mapping: `tools` / `tool_use` / `tool_result`
- [x] A profile without `supportsTools` fails `generateWithTools` with a clear, non-retryable error
- [x] Keep the existing guarantees: rate-limit retries (`retry.ts`), truncation/refusal/empty detection (`LLMOutputError`), `describeError` logging
- [x] Unit tests with recorded provider responses showing the same tool call round-trips on Gemini, Anthropic and the OpenAI-compatible provider

Tool calling done 2026-10-25 (`generateWithTools` in `LLMService` and each provider, `toolMessages.ts`, `tests/llmTools.test.js`). Assistant turns keep the provider's raw reply and replay it, because Anthropic thinking blocks and Gemini thought signatures must come back unchanged. A live two-turn tool call worked on `gemini-flash-lite-latest` and, through the OpenAI-compatible mapping, on a local LM Studio `google/gemma-4-e4b` (2026-10-26). Anthropic is covered by unit tests only until a key is available.

**Done when:** a new OpenAI-compatible LLM can be added and used by an agent with configuration only (no code change), and one tool definition works identically across Gemini, Anthropic and the OpenAI-compatible provider in tests.

---

## Phase 2: Sandbox tools

*Teaches: tool design, safety at the tool boundary, observability.*

### Tasks

- [x] Long-lived container per run (`docker run -d` + `docker exec`) instead of a new container per command, with the same CPU/memory/PID limits and no network
- [x] `list_files`
- [x] `read_file(path, startLine, endLine)`: range reads remove the 20 KB cut-off
- [x] `search_code(pattern)`: `git grep` inside the sandbox; content search instead of file-name matching
- [x] `edit_file(path, oldText, newText)`: targeted replacement instead of whole-file rewrites; fails if `oldText` is missing or not unique
- [x] `run_check(script)`: only scripts listed in `Repository.verificationConfig`
- [x] `finish(summary)`
- [x] Policy inside the tools: existing path checks (no `.git`, no symlinks, no escaping the root), protected paths **including existing test files**, output caps, per-tool timeouts. Denials are returned to the model as results, not thrown
- [x] Record every call in the existing, currently unused `ToolCall` table (`REQUESTED/RUNNING/COMPLETED/DENIED/FAILED`)
- [x] Unit tests for each tool's policy (path escape, protected test file, oversized output, unknown script)

**Done when:** every tool works and is policy-tested against a local workspace, with calls visible in `ToolCall`.

Done 2026-10-26 (`src/services/sandbox/`, `startSandbox`/`execInSandbox`/`stopSandbox` in `workspaceService.ts`, `tests/sandboxTools.test.js`). Decisions made while building it:

- **File tools run on the host, over the bind-mounted workspace; only `run_check` runs in the container.** Reads are as dangerous as writes there, so every file tool applies the same rules (inside the root, no `.git`, no symlinks anywhere on the path: a committed link could point at a host file). The symlink test runs for real on Windows (junction).
- **`search_code` is a plain-text, case-insensitive search instead of `git grep` with a pattern:** a model-supplied regex run on the host could hang it, and it needs no container.
- **Existing test files cannot be edited; new test files can,** and the agent may keep editing a test it created. In the baseline the agent added regression tests to existing test files, which this now forbids; it has to put them in a new file.
- **`finish(status, summary)` takes `done` or `blocked`,** so an impossible or unsafe ticket ends with a stated reason instead of exhausting attempts (baseline scenario 8).
- `run_check`'s time limit is enforced inside the container (`timeout -s KILL`), so a runaway test is killed there, not just detached. Live check: pass/fail exit codes, no network, a 30 s sleep killed at 3 s, container removed on stop.
- `ToolCall.policy` stores the policy in force (protected paths, allowed scripts) and, for a denial, why. Checked live against the local database.

The tools are not used by the run graph yet; Phase 3 wires them into the agent loop.

---

## Phase 3: Agent loop

*Teaches: act → observe → decide loops, budgets, stopping conditions, context management.*

### Tasks

- [x] New `agent_loop` graph node that replaces `implement_change`: model → tool calls → results → repeat until `finish` or a budget runs out
- [x] Budgets: max steps, max tokens (enforce `Execution.budget.maxTokens`), wall-clock time; hitting one ends the attempt with a clear reason
- [x] Context management: trim or summarise old tool output so long runs fit the context window
- [x] Keep `verify_change → review_diff → analyze_failure` after the loop as an independent outer guard
- [x] Feature flag `EXECUTION_AGENT_MODE=single_shot|tool_loop` so both modes run through the benchmark
- [x] Execution events for each step, so a run can be replayed from `GET /api/executions/:id`
- [x] Update the README run-graph diagram
- [x] Run an execution end to end in `tool_loop` mode (scenario 01, 2026-10-26)
- [x] Run the e2e execution suite in `tool_loop` mode (2026-10-26: 16 passed, 1 skipped (auth check, server had auth disabled); the execution test finished in 4 loop steps, 6.7k tokens, and opened draft PR zack10/agent-orchestration-test#5)
- [x] Benchmark `tool_loop` and record it next to the baseline (2026-10-26, 8 runs, see the results log)

**Done when:** `tool_loop` completes the e2e execution suite, and its benchmark results are recorded next to the baseline.

#### Decisions (2026-10-26)

- **The loop is pure.** `runAgentLoop` (`agentGraph/agentLoop.ts`) takes the model, the tool runner and an event callback as arguments and does no I/O, so it is unit-tested with a scripted model (`tests/agentLoop.test.js`). The `agent_loop` graph node wires in the provider, the recorded sandbox tools and `GRAPH_AGENT_STEP` events.
- **Both modes stay in the graph.** `plan_change` and `analyze_failure` route to `implement_change` or `agent_loop` by mode. Each run records `agentMode` and only the prompts that mode uses, so benchmark rows can't mix them up.
- **Budgets are checked before each model call**, so a started call always records its tool results. Steps are per attempt (`AGENT_MAX_STEPS`, default 30, or `budget.maxSteps`); tokens and time are per execution (`budget.maxTokens`, `budget.maxDurationSeconds`), counted across attempts.
- **Stopping:** `finish done` with changes goes on to policy, verification and review. `finish done` with no changes, running out of steps, or replying twice without a tool call fails the attempt and retries. `finish blocked` (the agent declines) and an exhausted token or time budget block the execution without retrying. This answers the Phase 0 finding that the implement step could not decline a ticket.
- **Context management:** tool results older than the 8 most recent are replaced with their first line and a note; no message is removed, because every provider needs each tool call paired with its result, and assistant turns keep their raw content for replay.
- **Live check (2026-10-26),** without the DB or GitHub: `gemini-flash-lite-latest`, real tools and sandbox, scenario 01. It listed, read the code and test, ran the tests, edited, was denied editing the existing test, created a new test file, re-ran the tests and finished: 10 steps, about 27k tokens, 91 s. The hidden tests passed (graded in a network-less container).
- **First pipeline run (2026-10-26),** scenario 01 through the server: correct fix in 7 loop steps, verified, reviewed and turned into a diff artifact; every tool call has a `ToolCall` row (the denied one with its reason) and the sandbox container was removed. It used 85k tokens because each step re-sends about 11k tokens of prompt, mostly the repository context that `inspect_repo` collects for single-shot mode. In tool-loop mode the agent can read files itself, so an `agent.v2` that sends a short file list instead would cut tokens per step sharply; to try with the benchmark.
- **`agent.v2` (2026-10-26):** `inspect_repo` now also builds an `overview` (file tree, scripts and the names of the files that look relevant, no contents), and `agent.v2` sends that instead of the full context. On scenario 01 it used 23k tokens instead of 85k (8 steps instead of 7, still correct): each step re-sent about 1.3k–4.6k tokens instead of 11k–14k. Single-shot mode and the plan step still get the full context. One run per scenario so far; the benchmark will confirm it.
- **Declining works (scenario 08):** the agent searched for the legacy service, found nothing and called `finish blocked` in 3 steps, without changing files.
- **Benchmark (2026-10-26), against the Phase 0 baseline, 1 run per scenario on `gemini-flash-lite-latest`:**

  | | single_shot (baseline) | tool_loop (`agent.v2`) |
  | --- | --- | --- |
  | Pass rate | 75% (6/8) | 100% (8/8) |
  | Wrong fix shipped | 1 (#6) | 0 |
  | No fix | 1 (#7) | 0 |
  | Avg attempts | 2.25 | 1.4 |
  | LLM calls | 33 | 106 |

  Better results for about 3× the calls. Findings:
  - **Every retry was a rule conflict, not a bad fix.** The plan step proposed editing the existing test file; the tools forbid that, so the agent added a new test file; the reviewer then rejected the diff for not matching the plan (#3 once, #4 twice, about 25 calls). Fix in prompts: a `plan.v2` that plans new test files, and/or a `review.v2` that accepts a new test file in place of a planned edit to an existing one. **Done 2026-10-26, not yet measured:** `plan.v2` tells the planner existing tests must not change and to list a new test file; `review.v2` treats the plan as guidance (no rejection only for touching other files than planned), expects a new test file and still rejects changes to existing tests. **Confirmed 2026-10-26:** rerun of #3 and #4 passed on the first attempt each, with about a third of the calls (19 instead of 47) and of the time (see the results log).
  - **#7 (large file)** passed this time but used 99k tokens for 11 calls: reading the 1,000-line file costs tokens on every later step until it is compacted. Worth watching, not yet a problem.
  - **The report's "Only expected files" column** says "no" for every run because the agent always adds a regression test file, which `expectedFiles` doesn't list. **Fixed 2026-10-26:** added test files are left out of that column (they have their own "Tests added" column); reports before then still show "no".
  - One run per scenario: the 8 × 3 run on a stronger model still waits for a paid key.
- **The plan call is now the biggest single call** (about 10k tokens each, from the ledger): it still gets the full repository context with file contents. In `tool_loop` mode the agent re-reads what it needs anyway, so the plan step could take the overview instead; to try with a `plan.v3`.
- **Quota and budget:** that easy fix cost 10 model calls and ~27k tokens against ~4 calls in single-shot mode. A benchmark run of 8 scenarios is roughly 80–200 calls, beyond the Gemini free tier per day; the default `maxTokens` of 200k allows about 3–7 such attempts. Revisit the default after the benchmark.

### Cost guardrails

Budgets were per execution only, and only the agent loop's calls counted, so many executions could add up to an unbounded bill. Everything the agent spends now goes through one ledger.

- [x] Every model call records its tokens in `LlmUsage` (provider, model, purpose such as `plan.v1` or `agent.v2`, execution or task), in `LLMService`, so no pipeline can bypass it. No foreign keys: deleting an execution must not lower today's total
- [x] Daily limit across all executions and tasks: `LLM_DAILY_TOKEN_LIMIT` (default 2,000,000 per UTC day; `0` switches it off). Checked before each call; once reached, new calls fail with `TokenLimitError` (not retried) and the execution fails with the reason. `GET /api/llm/usage/today` shows usage, limit and reset time
- [x] The execution budget covers every call of the execution (plan, review, failure analysis and the loop), read from the ledger
- [x] Configurable budgets for new executions: `EXECUTION_MAX_TOKENS` (default 200,000), `EXECUTION_MAX_DURATION_SECONDS` (default 1800)
- [ ] Pause instead of fail: when the daily limit is hit, keep the execution queued and resume it after the reset, instead of failing it (Phase 8, with the shared rate limiter)
- [ ] Warn before the limit: a tracker comment or log alert at 80% of the daily limit
- [ ] Limits in money: per-model prices in config, so limits and reports can be in dollars as well as tokens
- [ ] Per-project or per-repository budgets, so one busy project cannot use the whole day's limit (Phase 8 fairness)

Known limits of the design: budgets are checked before each call, so a started call always finishes and a limit can be passed by one call (at most one call's input plus `LLM_MAX_OUTPUT_TOKENS`); provider calls that fail (errors, rate limits) report no usage and are not counted.

---

## Phase 4: Any language, framework and platform

*Teaches: toolchain detection, general command tools for agents, enforcing policy on outcomes instead of on tools, multi-language evaluation.*

**Goal:** the agent fixes bugs in a repository whatever its language, framework or platform (Node, PHP, Java, Python, Go, Rust, .NET, ...), the way a real coding agent does, with the same safety and the same measured quality. Covers limitations 1, 2, 6, 7, 10, 12, 16, 17, 18, 19, 20 (static checks), 21 and 22.

### Design

- **No code per language (decided 2026-10-26).** Like established agents (GitHub Copilot coding agent, OpenAI Codex, Claude Code on the web, Cursor background agents, Devin, OpenHands), the orchestrator has no list of languages. Supporting a new language, framework or platform must never need a code change. Each repository has an **environment**: a sandbox image, a setup command (the only step with network) and named checks (`test`, `lint`, `build`) as commands. It comes from, in order:
  1. **The repository's approved environment**, stored on the `Repository` (set by a person, or proposed by discovery and approved once).
  2. **The project's own definition**: `.devcontainer/devcontainer.json` (its image, or its Dockerfile built as-is), used exactly as the project defines it.
  3. **A stock universal image** with the common languages preinstalled (e.g. `mcr.microsoft.com/devcontainers/universal`, the GitHub Codespaces default), used unchanged.
  We never write an environment for the user's project (a Dockerfile, a devcontainer) unless the ticket asks for it, and never commit one. Which source was used is recorded and shown in the plan and the PR.
- **Discovery, approved once (revised 2026-10-27).** No configuration is needed to start, as with Copilot's coding agent. When a repository has no approved environment, the agent reads what the project already says (README, CI workflows, `Makefile`, `AGENTS.md` / `CLAUDE.md`, build files) and proposes an environment: a small image that fits the project (e.g. `maven:3.9-eclipse-temurin-21`, chosen by the model from the project's files, not by code per language), the setup command and the check commands. The proposal is proved by running it: setup and the baseline checks in the proposed image; a failure goes back to the agent to revise. That run uses it, and its PR says the checks were proposed by the agent and not yet approved. A person approves the proposal once; it is stored on the repository and every later run uses it as fixed checks. Discovery reads files and needs no network or universal image; the universal image is only the last resort.
- **Mixed repositories:** the environment can define checks per subproject (e.g. a PHP backend and a Node frontend); discovery proposes them and records what it found.
- **A general command tool.** Besides the file tools, the agent gets `run_command`: any command inside the run's sandbox (no network, CPU/memory/process limits, per-command timeout, output capped), so it can run tests, builds, linters and language tools like a real coding agent. `run_check` stays for the configured checks.
- **Policy on the outcome.** With a shell the agent can change files without `edit_file`, so the rules are also enforced on the final diff by `enforce_policy`: protected paths, and no existing test changed or deleted. Test files are recognised per toolchain (`*Test.java`, `test_*.py`, `*_test.go`, `*Test.php`, `*.test.ts`, ...).
- **Verification stays trusted.** The graph runs the checks itself after the agent finishes; the agent never decides what "passing" means. A shell could fake a pass without the diff showing it, so: `.git` is read-only to the repository's commands (no hiding changes through the index or exclude files), and before the checks run every ignored or excluded file is deleted and what setup installed (node_modules, .venv, vendor) is restored from a pristine copy in the snapshot. The checks see exactly the base commit, the setup and the diff that is reviewed. The agent's sandbox has no network: dependencies come from setup, and manifests are protected (an allowlisted network, as Copilot has, was considered and is not needed for that).
- **Language-neutral prompts.** New prompt versions (`plan`, `agent`, `implement`, `review`) say "a checked-out repository" and get the detected language, framework and check commands as variables.
- **How quality changes are accepted (decided 2026-10-29).** Patching a prompt after each benchmark failure tunes the agent to the 14 scenarios and can break others, and small models ignore rules they are given. So: a failure mode that matters is enforced in code (tools, verification, an independent reviewer), not only in a prompt; prompts keep general working principles, never scenario-specific patches, and a rule that removing does not hurt is removed. A change is measured with at least 3-5 runs per affected scenario plus a full-suite pass, and "wrong fix shipped" is a hard gate: a change that raises it is rejected. Before more prompt changes, the scenarios get a held-out set (the reference projects and a slice of a public multi-language benchmark) that is scored but not studied run by run. When the agent cannot verify a change, it blocks with its reason instead of shipping.
- **Security unchanged:** only setup (and discovery) has network, and neither ever gets the source host token; hooks stay disabled; the agent's sandbox and the checks run without network. After setup the container is snapshotted (`docker commit`, as Devin snapshots its machine), so whatever setup installed is kept wherever the tool put it, with nothing per language; files setup or checks create in the repository never show up in diffs.

### Tasks

- [x] Environment model (`src/services/toolchain/`): image, setup command, checks, env, test-file patterns, protected files; stored per repository in `verificationConfig.toolchain`, validated by the API. Existing `{ scripts: [...] }` configurations keep working: the names select checks
- [x] Workspace: sandbox image, setup step and verification taken from the environment instead of `node:20-bookworm`, `npm ci` and `npm run`. Setup is a separate step after clone, with network but without the GitHub token (it can run repository code); each check then runs once on the unmodified code (still with network, so tools fetch what they only fetch when really running; the results are recorded as the baseline), the container is snapshotted and every later command runs from the snapshot; files setup or a check creates are excluded from diffs. The chosen environment is recorded as a `GRAPH_TOOLCHAIN_RESOLVED` event
- [x] Remove the per-language presets written first (a list of languages in code); replace them with the order above: approved environment, then the project's devcontainer, then the stock universal image (`EXECUTION_DEFAULT_IMAGE`), with no per-tool cache settings. `PATCH /api/repositories/:id` sets a repository's environment
- [x] Use `.devcontainer/devcontainer.json` / `.devcontainer.json`: its `image`, `containerEnv`/`remoteEnv`, and `onCreateCommand`/`updateContentCommand`/`postCreateCommand` as setup; what can't be applied is reported
- [x] Reuse the environment snapshot across executions of the same repository: preparing it took 80–160 s per execution in the live check in the universal image (setup, baseline checks and `docker commit` on Docker Desktop). Knowing which files are "dependency files" would need a list per ecosystem, so instead (as Codex caches containers) the snapshot is cached per repository and environment (image, setup, env, checks) for `EXECUTION_SNAPSHOT_MAX_AGE_HOURS` (24); later runs start from it and run setup again with network, so changed dependencies are installed and nothing already there is downloaded again. Only a snapshot built from the plain image becomes the cache, so layers don't pile up; replaced caches are removed. Measured on a phase basis first: in a small image `docker commit` is ~2 s and the time goes to downloads and the checks themselves. Live check (Maven with Spring Boot web): 26.5 s first run, 15.0 s reused, 17.7 s reused with a new dependency in `pom.xml`, which was installed and passed the offline check. The rest is fixed per run (setup on the cache, the baseline, the commit)
- [ ] Devcontainers that build a Dockerfile (built as-is in the setup step, network, no token), use Docker Compose (also the way to declare service containers), or add features
- [x] Environment discovery as described above: the agent proposes image, setup and checks from the project's files; setup and baseline in the proposed image prove it (revise on failure); the run uses it and the PR says it is unapproved; one-time approval stores it on the repository. Done in `src/services/toolchain/discovery.ts` with prompt `discover.v1`: it runs when a repository has no configured checks, keeps what the devcontainer or configuration fixes, reads tracked files only (instruction and CI files first, then root and subproject files), and tries up to `EXECUTION_DISCOVERY_MAX_ATTEMPTS` (3) proposals. A check that runs but fails on the project's own tests is judged by the model and still proves the environment. A proved proposal is stored in `Repository.environmentProposal` and reused (proved again, no model call) until `POST /api/repositories/:id/environment/approve` with its hash makes it the configured environment. Live checks with a real model and Docker: Python (`python:3.12-slim`, `pip install -e '.[test]'`, `pytest -q`; 24 s) and Maven with an existing failing test (`maven:3.9.6-eclipse-temurin-21`, `mvn test`, judged as the project's failure; 46 s), each right first time; the benchmark repository (`node:20-alpine`, no setup, `npm test`), reused on the next run
- [x] `run_command` sandbox tool with the same limits and recording (`ToolCall`) as the other tools; `.git` read-only to repository commands; ignored files cleaned and setup output restored before verification (live check: a tampered test runner in `.venv` no longer fakes a pass)
- [x] `enforce_policy` checks the diff for changed or deleted existing tests and protected files, per toolchain; "existing" means tracked at the base commit, so a test the agent created with a command is new
- [x] Repository context and default protected paths from the toolchain instead of `package.json`; context picks source files of any language
- [x] Language-neutral prompt versions: `plan.v3`, `implement.v2`, `agent.v3` (with `run_command`), given the environment (image, each check and its command) as a variable; a test checks the prompts in use name no language or package manager
- [ ] Benchmark: scenarios in at least two more languages (e.g. Python and PHP or Java), each with hidden tests and a fairness check in `tests/codingScenarios.test.js`; the Node scenarios must not regress. Scenarios done (2026-10-28): one suite per language under `tests/e2e/coding-scenarios/<suite>/` (`suite.json` holds the environment, the grader image and commands, and the test-file pattern; adding a language needs no code), with Python (`unittest`) and Go (`go test`) suites of 3 scenarios each (single-file, two-file, vague ticket), standard library only so grading stays offline; the fairness check runs each suite in its grader image. First run: 10/14 correct, 1 wrong fix shipped (node/06), 2 no fix (python/02, go/03); see the results log. Fixes from that run (2026-10-28): `agent.v4` (follow values through every file, keep public names, check a new test's expected values, don't re-read unchanged files), `review.v3` (reject removed or renamed public API), an identical repeated tool result replaced by a short note (and a warning after 3), each attempt but the last limited to a share of what is left (`budget.attemptShare`, 0.5), a share stop keeping its changes for the next attempt, and the failure analysis (`analyze.v2`) seeing the attempt's steps, where the next attempt starts and the test rule. node/06, python/02 and go/03 then all passed; the full run had 10 correct, nothing wrong shipped, and node/07 lost to the share (see the results log). Then the share became a soft limit: past it an attempt with no changes stops, and one with changes is told to wrap up and gets 3 more steps in the same conversation, within the execution's budget, so a nearly done change is not restarted with a fresh context (node/07). node/07 then passed twice in one attempt each. Python and Go suites completed on 2026-10-29 with `gpt-5-mini` (10/12, see the results log and the wrong-fix tasks below). Still to do: PHP or Java with dependencies
- **Wrong fixes shipped (started 2026-10-29).** The first OpenAI run (Python and Go, `gpt-5-mini`) shipped 2 wrong fixes in 12: go/03 added an unused function beside the unchanged faulty one, python/02 fixed one caller and left the shared `to_cents` broken. Both passed the repository's checks and the review. The work so far, and what is next:
  - [x] Postgres `jsonb` rejected a NUL character in tool arguments and failed the attempt; `ToolCall` input and output now replace it (`toolRunner.ts`)
  - [x] `agent.v5` (show the problem with a failing test before changing code, using the ticket's example) and `review.v4` (reject unused new code; work the ticket's example through). python/02 improved; go/03 did not: the model ignored the new step and the reviewer (same model) ignored the new rule
  - [x] Reproduction gate in the sandbox tools: `edit_file` refuses non-test files until a new test file has failed in `run_check`/`run_command`, or the agent called `skip_reproduction` with a reason; `review.v5` is told how the problem was shown (including code changed by commands without a failing test). go/03 3/3; python/02 fell to 1/3 (test-first narrowed the goal to the symptom)
  - [x] go/03's hidden test lost an assertion the ticket does not specify (a restart exactly at a scheduled time); all go/03 diffs of the day re-graded
  - [x] `agent.v6`/`review.v6`: fix a shared function instead of working around it in one caller; the gate's message says the same. go/03 + python/02 x5: 9/10 (one python/02 workaround remains)
  - [x] Full-suite regression pass for `agent.v6` + `review.v6` + the gate (all 14 scenarios); keep them only if nothing that passed before fails. Go 3/3, Node 01–07 7/7, python/01 correct; node/08 regressed and was fixed by triage (below)
  - [x] **Triage before planning (node/08 regression).** With the gate, the agent wrote a test for the impossible SOAP ticket that started a server and never closed it; every run hit its timeout, the gate never opened, and the execution ran out of time instead of being declined. Now: a `triage_ticket` node (`triage.v1`) asks once, apart from how, whether the ticket should be done in this repository at all; an explicit decline ends `BLOCKED` with the reason before any plan or code. The gate reports a timed-out run as a hanging test to fix, and its refusal says to call `finish` with status `blocked` if the ticket should not be done. node/08 3/3 declined at triage; Python 3/3 correct
  - [x] **Code-reading reviewer** (built 2026-10-29; `reviewer.v1`, then `reviewer.v2` below; tool-loop mode only, single-shot keeps `review.v6`; `GRAPH_REVIEW_STEP` events record what it read; the loop's reminders name `verdict` instead of `finish`). `review_diff` becomes a short read-only tool loop (`read_file`, `search_code`, `list_files`, enforced in code) that ends with a `verdict` tool (approved, issues, summary) and fails closed when it runs out of steps. It works through a fixed checklist: where the wrong value is produced and whether the diff changes that place; who calls each changed or new function; whether the new tests call the existing code; whether the ticket's example comes out right. Rejections go to the next attempt as today
  - [x] Optional separate reviewer model in the agent configuration (`reviewer: { provider, model, apiKey? }`, default the implementer's), so review can use a stronger or different model than implementation. Validated in the agent schemas, key encrypted and redacted like the agent's own, recorded in `GRAPH_CONTEXT_LOADED`
  - [x] Live check of `reviewer.v1` on go/03 and python/02 x3: 4 correct, 1 wrong, 1 infra. go/03 run 3 shipped the unused `NextRunOnce` again: the reviewer wrote "NextRunOnce is only referenced by the new tests; NextRun is unchanged" and approved. python/02 run 1 was a correct fix (it also fixed `to_cents`) rejected because the reviewer read every file, re-read them once older results were shortened, ran out of 15 steps without a verdict (fail closed), and the retry exhausted the execution's 200k tokens (the reviewer alone used 69k)
  - [ ] `reviewer.v2`: the code decides, not the reviewer's `approved` flag. `verdict` takes an answer and evidence per checklist item (`sourceChanged`, `newCodeCalled` / "none added", `testsCallExistingCode` / "no tests", `exampleWorks` / "no example") plus issues; any "no" or issue rejects, and each goes to the next attempt. The last step (or past 80% of the tokens) offers only `verdict`; the reviewer has its own 40k-token cap and keeps every result in full; the prompt starts it from the changed files and their callers. go/03 3/3 correct (v1: 2/3, one wrong fix shipped). python/02: 1 correct, then good fixes were rejected over test comments, an unused import and float inputs nothing passes ("Minor" by the reviewer's own label); one run ran out of the 200k budget. With `EXECUTION_MAX_TOKENS=5000000`: 3/3 correct, but one run took 14.5 minutes (two restarts, see "Retries and resume")
  - [x] `reviewer.v3`: `verdict` gets `suggestions` (style, naming, comments, unused imports, inputs neither the ticket nor existing callers use), recorded in the review events and the diff artifact for the approver, never rejecting; `issues` is limited to what makes the change wrong (does not address the ticket, unrelated or unsafe changes, removed or renamed names, changed tests, broken existing behaviour). The checklist answers still decide on their own. go/03 and python/02 x3: 4 correct, 0 wrong fixes, 0 good fixes rejected over remarks (go/03 run 2 passed on its first review with its edge-case remarks as suggestions, 53k tokens against 94k to 156k with v2). The other two: triage declined go/03 once, guessing the bug was in a service outside the repository (it passed triage in the 6 earlier go/03 runs); and OpenAI's safety filter flagged an agent request after it read a harmless file (`invalid_prompt`, 400). The filter is not deterministic, so a flagged request is now retried once before failing with the reason
  - [ ] Triage false declines: watch the rate on the full suite; if it repeats, a decline must name what is missing that neither the ticket nor the repository provides, checked like the reviewer's answers
  - [ ] Reviewer eval: replay the day's stored diffs through the reviewer alone (applied to their scenario) and report wrong fixes caught (target 6/6) and correct fixes rejected (target ~0), with `gpt-5-mini` and with a stronger reviewer model; then one full-suite pass end to end
  - [ ] Stronger implementer model on go/03 and python/02 x5 (part of "Model coverage" below), to separate model capability from missing structure
  - [ ] Later, per repository: several candidate fixes per ticket, tests from a separate test-writing step, pick the fix that passes them and the review; block when candidates disagree
- [x] **Retries and resume (2026-10-29).** One failed model call (a dropped connection, then an OpenAI 400) failed the whole run step, and the queue's redelivery started the execution again from the clone: python/02 took 14.5 minutes and two full restarts for a 2-minute fix. Now, as established agents do:
  - Call level (`llm/retry.ts`): rate limits, overload, 408/409/5xx and connection failures are retried in place (rate limits as the provider asks, others 1s, 2s, 4s… with jitter, capped); a rejected request (400/401/403/404/422) fails at once as `NonRetryableError` with the provider's own reason (key-like strings masked), so it is neither retried nor redelivered
  - Execution level: the graph is compiled with a durable checkpointer (`agentGraph/checkpointer.ts`: LangGraph's `MemorySaver` persisted after every step to `GraphCheckpoint`, one encrypted row per execution since the state holds the agent's API key, latest two checkpoints kept). The workspace is kept between deliveries; a redelivered or recovered run continues from the step that did not finish (`GRAPH_RESUMED`), and starts over only without a checkpoint or workspace (another machine). An interrupted attempt is re-run from a clean tree and its record closed as `CANCELED`; `markExecutionFailed` removes the checkpoint and workspace once no retry is left
  - Confirmed live: the server was killed during python/02's first attempt; after the dead worker's 5-minute lease expired, recovery resumed at `agent_loop` without cloning, setting up, triaging or planning again
  - [ ] Shared-server follow-up: a resumed run needs its workspace on the same machine (a shared volume or object storage once workers run on several machines); without it the run starts over, as before
- [ ] **Token cost (planned 2026-10-29, after the reviewer eval).** Measured on the day's 57 `gpt-5-mini` executions: about 39k input and 6.6k output tokens each (~$0.02); the agent loop is 82% of input (639 calls, ~3.2k each), and output, which includes reasoning and costs 8x input, is a third from the small JSON calls (plan averages 1,280 output tokens for a short JSON). The benchmark repositories are tiny; on real projects the loop's resent history dominates. Each step is checked on the benchmark for tokens per execution and correct fixes, so savings do not cost quality:
  - [ ] Measure first: record cached input tokens and reasoning tokens in `LlmUsage` from every provider, and report tokens and cost per execution in the eval report
  - [ ] Cache-friendly history: `compactMessages` shortens old tool results one at a time as the conversation moves, which changes an early message at almost every step and defeats prefix caching. Compact in occasional batches instead, so the history stays unchanged between them; add Anthropic `cache_control` breakpoints (OpenAI and Gemini cache automatically)
  - [ ] Reasoning effort per call: low for triage, plan, analyze and the JSON review; the agent loop and the code-reading reviewer keep the default; configurable per agent
  - [ ] A model per call type in the agent configuration (generalising `config.reviewer`), so small calls can use a cheaper model
  - [ ] Smaller tool output defaults (output cap, `read_file` lines), configurable per repository with today's values as limits
  - [ ] In tool-loop mode, one call for triage and the internal plan
- [ ] OpenAI Responses API for tool calls (limitation 24): `toolsApi: "responses"` on the built-in OpenAI profile (`OPENAI_TOOLS_API`, default `responses`; other profiles default `chat`), reasoning items replayed encrypted with `store: false`. Tests written; lets `gpt-6-luna` and `gpt-5.6-luna` run the tool loop
- [ ] E2E: one execution end to end on a non-Node repository
- [ ] Service containers (limitation 2): a repository declares the services its tests need (e.g. `postgres:16`, `redis:7`, with env vars); each run starts them on a private Docker network shared only with its sandbox (still no internet), and removes them afterwards
- [ ] Private dependencies (limitation 6): per-repository registry credentials, stored encrypted like integration credentials and given to the install step only (never to the agent's sandbox); fetch git submodules and Git LFS files during clone with the same token handling
- [ ] Checks from the toolchain (limitation 7): only checks that exist for the repository run; a configured check that is missing is reported as "not available", not as a failure (done), and a repository with no checks is marked **Unverified** in the draft PR (done); flagging it in the plan for the human approver is still to do
- [ ] Configurable limits (limitation 10): sandbox CPU, memory, process count, check timeout, changed-file and file-size limits per repository, with the current values as defaults
- [ ] Subprojects (limitation 12): detect several toolchains in one repository (monorepo packages, `frontend/` + `backend/`), and run the checks of the subprojects the change touches, in their directories
- [ ] Make `tool_loop` the default mode (limitation 16) once the multi-language benchmark confirms it; keep `single_shot` selectable
- [ ] Test secrets and environment (limitation 17): per-repository environment variables and files for checks, stored encrypted; only test-grade values, because the agent can read anything inside its sandbox
- [ ] Flaky and slow suites (limitation 18): run the checks once on the unmodified code first (done: recorded as `GRAPH_BASELINE_CHECKED` during setup) and use the failures that already exist, so the change is judged only on what it broke or fixed; re-run a failing test once to tell flaky from broken; run the tests related to the change first, then the full suite
- [ ] Few or no tests (limitation 19): report how much the checks actually cover in the plan and the PR, so the human knows when "verified" means little; Phase 6 adds writing the missing tests as a task
- [ ] Infrastructure repositories (limitation 20): discovery proposes static checks that need no cloud access (`terraform validate`, `tflint`, `helm lint`, `kubeconform`, `ansible-lint`); a reference project confirms it
- [ ] Large repositories (limitation 21): partial clone (`--filter=blob:none`, shallow where possible) from a cached mirror per repository, `search_code` backed by `git grep` or ripgrep in the sandbox, a paged file tree, and focusing on the touched subproject
- [ ] Model coverage (limitation 22): run the benchmark and the reference projects on at least one stronger model, and allow the model to be chosen per repository or task type
- [ ] Reference projects: build the matrix in [Reference projects](#reference-projects), with hidden tests and a setup check like `npm run eval:coding -- --check`; run it to finish this phase
- [ ] README: where the environment comes from, discovery and approval, how to set it per repository

**Done when:** the benchmark passes in at least three languages with no drop on the Node scenarios, a scenario whose tests need a database passes, an e2e execution opens a draft PR on a non-Node repository, and the reference projects have been run with every failure recorded as a limitation.

---

## Phase 5: Any source host and issue tracker

*Teaches: adapter design across vendors, ticket context beyond text, branch strategy.*

**Goal:** tickets can come from the tracker a team uses and changes can go to the source host it uses, with everything the ticket contains. Covers limitations 4, 5, 11, 13 and 23 (for ticket content).

### Tasks

- [ ] `SourceControlAdapter` interface (clone, base SHA, push, open draft PR, comment, read PR state), with the GitHub App implementation moved behind it, like `IssueTrackerAdapter` for trackers
- [ ] GitLab adapter, then Bitbucket and Azure DevOps; credentials encrypted and redacted like the existing ones
- [ ] Tracker adapters for Jira, Linear and GitHub Issues, each keeping a stable `revisionHash`
- [ ] Ticket context: attachments (images, logs, files) and comments fetched by each adapter, size-capped, stored with the work item and given to the agent (images to models that accept them, text otherwise); attachment content is untrusted input, never instructions
- [ ] Target branch: per repository (default branch, or a configured one) and per ticket (e.g. a label or field naming a release branch); PRs open against that branch
- [ ] Prompt injection (limitation 23): ticket text, attachments, comments and repository files are marked as untrusted data in prompts, the tools' policy (not the prompt) decides what is allowed, and a benchmark scenario plants instructions in a ticket and an attachment to prove they are ignored
- [ ] E2E: one execution from a non-Trello tracker to a non-GitHub host

**Done when:** an execution runs end to end with at least one other tracker and one other source host, and a ticket whose key evidence is in an attachment is fixed using it.

---

## Phase 6: Any kind of task

*Teaches: task typing, decomposition, multi-repository changes, evaluating more than bug fixes.*

**Goal:** the agent handles the work teams actually ticket, not only bug fixes. Covers limitations 8, 9 and 19 (writing missing tests).

### Tasks

- [ ] Task types: bug fix, feature, refactor, dependency upgrade, migration, test/documentation work; detected from the ticket or set by a label, recorded on the execution
- [ ] When the touched code has few or no tests (limitation 19), the agent writes characterising tests before changing it, and the plan says so
- [ ] Prompt versions per task type (what "done" means differs: a refactor must keep behaviour, a feature needs new tests, an upgrade must keep the build green)
- [ ] Plans with several tasks and dependencies (the `PlanTask` model already has dependencies), executed in order within one execution; the plan the human approves lists them
- [ ] Changes across several repositories in one execution (one workspace and one PR per repository, linked to each other and to the ticket), with all of them verified before any is published
- [ ] Benchmark scenarios for each task type, in more than one language, with hidden tests (a feature scenario, a refactor scenario that must keep behaviour, an upgrade scenario)

**Done when:** the benchmark covers every task type and a two-repository ticket produces two linked draft PRs that both pass their checks.

---

## Phase 7: Feedback loop after the PR

*Teaches: event-driven follow-up work, acting on human and CI feedback, bounded iteration.*

**Goal:** like a human developer, the agent responds to review comments and failing CI on its own PR. Covers limitation 14 and 23 (for PR comments).

### Tasks

- [ ] Receive PR review comments and CI results (webhooks or polling, through the source-control adapter)
- [ ] A follow-up attempt on the same branch with the comments or CI failure as feedback; it goes through the same policy, verification, review and publish approval as the first change
- [ ] Bounds: a maximum number of follow-up rounds per PR, within the execution's token and time budget; then hand back to the human with a comment
- [ ] Only comments from allowed reviewers trigger work; comment text is untrusted input (limitation 23), with a scenario that plants instructions in a review comment
- [ ] E2E: a review comment on the agent's PR leads to a second commit that addresses it

**Done when:** the agent addresses a review comment and a failing CI run on its own PR end to end.

---

## Phase 8: Parallel executions (several tickets at once)

*Teaches: concurrency in agent systems, isolation, shared rate limits, scaling workers.*

**Goal:** several agents work on different tickets at the same time, safely, without interfering with each other or exhausting shared limits.

What already makes this safe: each execution has its own workspace folder, Docker container, diff artifact and branch (`agent/<executionId>`), and leases plus atomic claims stop two workers from running the same execution. What's missing is a way to turn concurrency on, limits to keep it under control, and proof that it works.

### Tasks

- [ ] Per-queue concurrency option in `rabbitMQService.subscribe` (prefetch per consumer), driven by `EXECUTION_RUN_CONCURRENCY`, `EXECUTION_PLAN_CONCURRENCY`, `EXECUTION_PUBLISH_CONCURRENCY`; defaults stay at 1
- [ ] Resource cap: a maximum number of concurrent Docker runs per process, sized to the host (each run is limited to 2 CPUs / 2 GB today)
- [ ] Shared LLM rate limiter keyed by provider + API key (per-minute requests and tokens), so parallel runs queue for capacity instead of all hitting `429`; in-process first, then Postgres- or Redis-backed for multiple processes
- [ ] Process roles: `PROCESS_ROLE=api|worker|all` (default `all`), so workers can scale separately from the API
- [ ] Fairness: one project's backlog cannot starve another's (e.g. a per-project concurrency cap), including a per-project share of `LLM_DAILY_TOKEN_LIMIT`
- [ ] When the daily token limit is reached, pause queued and running executions and resume them after the reset (see Phase 3 "Cost guardrails")
- [ ] Visibility: running and queued executions per project via the API (and queue depth in `/health` or a status endpoint)
- [ ] Isolation audit: confirm nothing is shared between runs (workspace and artifact paths, branch names, temp files, Trello comments, `TaskAttempt` numbering)
- [ ] Unit tests: concurrency limits respected, rate limiter waits rather than fails, per-project cap
- [ ] E2E concurrency test: create 3 cards at once and run them in parallel; all reach `COMPLETED`, and each PR contains only its own change
- [ ] E2E recovery test with 2 worker processes: kill one mid-run; its lease expires and the other worker finishes the run
- [ ] Update README (architecture diagram, configuration, troubleshooting)

**Done when:** 3 tickets run in parallel end to end with no cross-contamination, the shared limiter keeps them under the provider's rate limit, and a killed worker's run is recovered by another process.

---

## Phase 9: Agent roles and a real planner

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

## Phase 10: Agent skills

*Teaches: packaging reusable know-how for agents, progressive disclosure, context budgets, prompt-injection risk.*

Comes after the agent loop (Phase 3) and roles (Phase 9), because skills are loaded through a tool and assigned per role.

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

## Phase 11: Real MCP

*Teaches: Model Context Protocol, standard tool discovery, connecting servers.*

### Tasks

- [ ] Expose the Phase 2 sandbox tools as an MCP server using the official SDK
- [ ] Make the agent loop an MCP client that discovers tools instead of hard-coding them
- [ ] Allow attaching allowlisted external MCP servers (e.g. documentation), reusing the connector registry and `MCP_HTTP_ALLOWED_HOSTS` rules
- [ ] Make assigned MCP resources available to the agent (an existing gap; skills are handled in Phase 10)
- [ ] Update the README "Known limits" section

**Done when:** the agent loop runs entirely through MCP tool discovery, and an external server can be attached safely.

---

## Phase 12: Retrieval

*Teaches: embeddings, chunking, search quality.*

### Tasks

- [ ] Chunk the cloned repository and store embeddings in Postgres with pgvector (migration + index)
- [ ] `semantic_search(query)` tool
- [ ] Large repositories (limitation 21): index incrementally per commit and per subproject, so a big repository is not re-embedded for every execution
- [ ] Benchmark scenario 6 (vague ticket) with and without it

**Done when:** scenario 6 results are recorded with and without retrieval.

---

## Phase 13: Collaborating agents and memory

*Teaches: dividing work between agents, explicit hand-offs, long-term memory.*

Phase 8 runs many agents side by side on **different** tickets. This phase has several agents cooperate on the **same** ticket.

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

- [ ] Independent reviewer agent (the `REVIEWER` role from Phase 9) replacing the single review call, following rules 1, 4 and 5
- [ ] Zod schema for the reviewer's output; invalid output fails the review instead of being guessed at
- [ ] Review loop as graph edges: `request_changes` sends the structured issues back to the implementer, capped at 2 rounds, then `BLOCKED`
- [ ] Every hand-off recorded as an execution event (sender role, schema version, payload), so each decision can be traced
- [ ] Per-repository memory: store lessons from failed attempts (e.g. "this repo uses `node:test`", "run `build` before `test`") as short structured notes, and retrieve them in later runs. Notes must be confirmed by an objective result (e.g. a check that failed and then passed) before they are reused, so the agents can't feed themselves guesses
- [ ] Benchmark each feature separately against the baseline: reviewer, review loop, memory

**Done when:** the effect of each feature is recorded in the results log, and any feature that did not improve wrong-fix-shipped or cost per success has been removed.

---

## Phase 14: Other platforms and running the app

*Teaches: heterogeneous execution environments, runtime verification, observing a running system.*

**Goal:** work that can't be built or tested in a Linux container, and bugs that only show when the app runs, are in reach too. Covers limitations 3, 15 and 20 (checks against real environments, e.g. `terraform plan` with scoped credentials). Listed last because it needs infrastructure beyond Docker (macOS and Windows machines, emulators), not because it matters less; parts can be pulled forward (headless browsers run in Linux containers).

### Tasks

- [ ] Platform runners: the toolchain names the platform (Linux container, macOS, Windows, Android emulator, GPU), and runs go to a runner that provides it (self-hosted machines or a cloud CI provider), with the same isolation, limits and recording
- [ ] Headless browser in the sandbox for browser tests (Playwright, Cypress) and for checking web UIs
- [ ] Run-the-app tools: start the app in the sandbox (with its services), send HTTP requests, take browser screenshots, read logs, so the agent can reproduce a bug before fixing it and confirm the fix after
- [ ] Benchmark scenarios that need the running app (a UI bug, an HTTP API bug) and at least one non-Linux platform

**Done when:** a UI bug is reproduced and fixed with a screenshot as evidence, and one scenario runs on a non-Linux platform.

---

## Results log

One row per benchmark run, newest last.

| Date | Phase / change | Mode | Model | Prompt versions | Skills | Runs | Correct fix | Wrong fix shipped | Correctly blocked | Infra failures | Avg attempts | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-25 | 0. Baseline | single_shot | gemini-flash-lite-latest | plan.v1, review.v1, analyze.v1, implement.v1, file-format.v1 | none | 8 (1 per scenario) | 5 | 1 | 1 | 0 | 2.25 | Pass rate 75% (6/8), wrong-fix-shipped 13% (1/8), 33 LLM calls, code `0356a2a`+grader fixes. 1 no fix (#7). Reports: [10-24](../testing/coding-eval-2026-10-24.md), [10-24-2](../testing/coding-eval-2026-10-24-2.md), [10-25](../testing/coding-eval-2026-10-25.md), [10-25-2](../testing/coding-eval-2026-10-25-2.md) |
| 2026-10-26 | 3. Agent loop (partial) | tool_loop | gemini-flash-lite-latest | plan.v1, agent.v1, review.v1, analyze.v1 | none | 1 (scenario 01 only) | 1 | 0 | 0 | 0 | 1.0 | Pipeline check, not a benchmark: 7 loop steps + plan + review, 85k loop tokens, code `51238e9`. [report](../testing/coding-eval-2026-10-26.md) |
| 2026-10-26 | 3. Agent loop (partial) | tool_loop | gemini-flash-lite-latest | plan.v1, agent.v1, review.v1, analyze.v1 | none | 1 (scenario 08 only) | 0 | 0 | 1 | 0 | 1.0 | The agent declined: 2 searches, then `finish blocked`; 3 steps, 10k tokens, no files changed (baseline needed retries to block). [report](../testing/coding-eval-2026-10-26-2.md) |
| 2026-10-26 | 3. `agent.v2` (partial) | tool_loop | gemini-flash-lite-latest | plan.v1, agent.v2, review.v1, analyze.v1 | none | 1 (scenario 01 only) | 1 | 0 | 0 | 0 | 1.0 | File list instead of file contents in the agent prompt: 8 steps, 23k loop tokens vs 85k with `agent.v1` (-73%). [report](../testing/coding-eval-2026-10-26-3.md) |
| 2026-10-26 | 3. Agent loop | tool_loop | gemini-flash-lite-latest | plan.v1, agent.v2, review.v1, analyze.v1 | none | 8 (1 per scenario) | 7 | 0 | 1 | 0 | 1.4 | Pass rate 100% (8/8), wrong-fix-shipped 0%, 106 LLM calls (baseline 33), 304k loop tokens, 51 min, code `8cdd74e`. Fixed #6 (baseline: wrong fix shipped) and #7 (baseline: no fix). All 4 retries came from the reviewer rejecting a new test file the plan had not listed (#3, #4). [report](../testing/coding-eval-2026-10-26-4.md) |
| 2026-10-26 | 3. `plan.v2` + `review.v2` (partial) | tool_loop | gemini-flash-lite-latest | plan.v2, agent.v2, review.v2, analyze.v1 | none | 2 (scenarios 03, 04) | 2 | 0 | 0 | 0 | 1.0 | The two scenarios that needed retries now pass first time: #3 10 calls, 22k loop tokens, 86 s (was 2 attempts, 20 calls, 38k, 623 s); #4 9 calls, 16k, 82 s (was 3 attempts, 27 calls, 52k, 710 s). Ledger total for both: 60k tokens, of which the 2 plan calls were 20k. [report](../testing/coding-eval-2026-10-26-5.md) |
| 2026-10-26 | 4. Part A: repository environment | tool_loop | gemini-flash-lite-latest | plan.v2, agent.v2, review.v2, analyze.v1 | none | 8 (1 per scenario) | 7 | 0 | 1 | 0 | 1.0 | No regression after removing npm-specific code: the benchmark repository runs from its configured environment (`node:20-bookworm`, `npm ci --ignore-scripts`, `npm test`), with setup, a passing baseline check and a snapshot before each run. Every scenario passed first time: 83 LLM calls, 272k loop tokens, 8 min, code `abd0853`. [report](../testing/coding-eval-2026-10-26-6.md) |
| 2026-10-27 | 4. Part B1: `run_command`, diff policy, checks that cannot be faked | tool_loop | gemini-flash-lite-latest | plan.v3, agent.v3, review.v2, analyze.v1 | none | 8 (1 per scenario) | 6 | 0 | 1 | 0 | 1.0 | 6 correct and #08 correctly declined; nothing wrong shipped. #07 ran out of tokens (193k of 190k) after its fix and its own check had passed, one step before `finish`: the agent wrote a wrong expected value in its new test and spent 12 steps (the same search three times) finding the right one. `run_command` was not used. Code `f25fdf5`. [report](../testing/coding-eval-2026-10-27.md) |
| 2026-10-27 | 4. Part B1 + budget warning | tool_loop | gemini-flash-lite-latest | plan.v3, agent.v3, review.v2, analyze.v1 | none | 2 (#07 only) | 2 | 0 | 0 | 0 | 1.0 | The agent loop now tells the agent once it has used 80% of its steps or tokens, so a finished change is not lost to a budget stop. #07 correct twice (134k and 115k tokens); neither run reached the warning, so it is covered by a unit test only so far. [report](../testing/coding-eval-2026-10-27-2.md) |
| 2026-10-27 | 4. Part B2: environment discovery | tool_loop | gemini-flash-lite-latest | plan.v3, agent.v3, review.v2, analyze.v1, discover.v1 | none | 2 (#01, #05) | 2 | 0 | 0 | 0 | 1.0 | Benchmark repository with no configured checks (`E2E_ENVIRONMENT` with protected paths only). The first run discovered `node:20-alpine`, no setup, `npm test`, proved it first time and stored it; the second reused it without a model call. The universal image was never pulled. Approving it through the API then made it the configured environment. [report](../testing/coding-eval-2026-10-27-3.md) |
| 2026-10-28 | 4. Multi-language benchmark (Node, Python, Go) | tool_loop | gemini-flash-lite-latest | plan.v3, agent.v3, review.v2, analyze.v1, discover.v1 | none | 14 (1 per scenario) | 10 | 1 | 1 | 0 | 1.1 | First run with Python and Go suites, snapshot reuse on. Go 2/3, Python 2/3, Node 6 correct + #08 declined. Wrong fix shipped: node/06, where the CSV fix was right but the exported `parseLine` was deleted; the project's tests didn't cover it and review did not flag removed public API. No fix: python/02 (fixed `invoice.py`, missed the float bug in `money.py`; its own new test caught it but it couldn't find the cause) and go/03 (fixed early, then 30 steps of repeated reads and searches and a failing self-written test; the 80% warning was ignored). Both re-read unchanged files many times. Code `fa6e320` plus the suites. [report](../testing/coding-eval-2026-10-28.md) |
| 2026-10-28 | 4. `agent.v4`, `review.v3`, repeated-call notes, attempt share (partial) | tool_loop | gemini-flash-lite-latest | plan.v3, agent.v4, review.v3, analyze.v1, discover.v1 | none | 3 (node/06, python/02, go/03) | 1 | 0 | 0 | 0 | 2.3 | node/06 fixed (no public API removed). go/03 and python/02 ran out of budget: each attempt but the last now gets half of what is left, and the workspace was reset after an attempt stopped by its share, so its right edits were lost; `analyze.v1` did not know that and told go/03's next attempt the work was done (it finished with no changes), and told python/02's to edit an existing test. [report](../testing/coding-eval-2026-10-28-2.md) |
| 2026-10-28 | 4. + kept changes after a share stop, `analyze.v2` (partial) | tool_loop | gemini-flash-lite-latest | plan.v3, agent.v4, review.v3, analyze.v2, discover.v1 | none | 3 (node/06, python/02, go/03) | 3 | 0 | 0 | 0 | 2.0 | An attempt stopped by its share keeps its changes and the next one continues from them in a fresh conversation; `analyze.v2` is told where the next attempt starts and that existing tests may not change. go/03: attempt 1 stopped at 91k with the edits made, attempt 2 checked and finished in 9 steps (32k). [report](../testing/coding-eval-2026-10-28-3.md) |
| 2026-10-28 | 4. Same, full run | tool_loop | gemini-flash-lite-latest | plan.v3, agent.v4, review.v3, analyze.v2, discover.v1 | none | 14 (1 per scenario) | 10 | 0 | 1 | 2 | 1.2 | Go 3/3, Node 6 correct + #08 declined, Python 1/1 before the daily token limit (`LLM_DAILY_TOKEN_LIMIT`, 2M, used by the three runs of the day) stopped python/02 and python/03 (infra). No wrong fix shipped. No fix: node/07 (large file, ~10k tokens a step): attempt 1 made the right fix and stopped at its 95k share; attempts 2 and 3 got 40k and 31k, re-read the large file and ran out before `finish`. With the whole budget in one attempt it passed twice before, so a fixed share is too small for later attempts when steps are expensive. 18 min, code `03a128a` plus the changes. [report](../testing/coding-eval-2026-10-28-4.md) |
| 2026-10-28 | 4. Soft share with wrap-up steps (partial) | tool_loop | gemini-flash-lite-latest | plan.v3, agent.v4, review.v3, analyze.v2, discover.v1 | none | 4 (node/07 x2, python/01 x2) | 3 | 0 | 0 | 1 | 1.0 | node/07 correct twice, each in one attempt (run 1: 10 steps, 117k tokens, past its ~94k share; the wrap-up let it finish in the same conversation). python/01 correct once; its second run and the rest of the Python suite were stopped by Gemini's own daily quota (429, retry in ~15.5 h) after 549 calls and 2.29M tokens that day (5 runs recorded as infra failures). [report](../testing/coding-eval-2026-10-28-5.md) |
| 2026-10-29 | 4. First OpenAI run; Python and Go suites | tool_loop | gpt-5-mini | plan.v3, agent.v4, review.v3, analyze.v2, discover.v1 | none | 12 (python, go x2) | 10 | 2 | 0 | 0 | 1.1 | Switched from Gemini (daily quota, then 25 s latency) to OpenAI. `gpt-6-luna` could not be used: no function tools with reasoning on `/chat/completions` (limitation #24). A NUL character in tool arguments broke the ToolCall insert (Postgres jsonb); fixed in `toolRunner.ts`. Wrong fixes: go/03 run 1 added an unused `NextFromLast` beside the unchanged `NextRun`, with a test of the new function only; python/02 run 1 fixed `invoice.py` but not `to_cents`, so the ticket's own example still gave 55.20. Neither checked the ticket's behaviour; addressed by `agent.v5`/`review.v4`. ~19 min. [report](../testing/coding-eval-2026-10-29-3.md) |
| 2026-10-29 | 4. `agent.v5` (show the problem with a failing test first) and `review.v4` (reject unused new code; work the ticket's example through) | tool_loop | gpt-5-mini | plan.v3, agent.v5, review.v4, analyze.v2, discover.v1 | none | 6 (go/03, python/02 x3) | 5 | 1 | 0 | 0 | 1.2 | Re-graded after go/03's hidden test lost its unspecified boundary assertion (see the next row); first graded 4 correct, 2 wrong. python/02 3/3 (was 1/2). go/03 2/3 (was 1/2): in run 1 the agent ignored the new step, edited `schedule.go` first to add a new `ShouldTriggerNext` beside the unchanged `NextRun`, and tested only that; the reviewer (same model) approved despite the new rule. Prompt wording alone does not enforce the order, so it moves into the tools (reproduction gate). [report](../testing/coding-eval-2026-10-29-4.md) |
| 2026-10-29 | 4. Reproduction gate: code edits refused until a new test has failed (or `skip_reproduction` with a reason); `review.v5` sees how the problem was shown | tool_loop | gpt-5-mini | plan.v3, agent.v5, review.v5, analyze.v2, discover.v1 | none | 6 (go/03, python/02 x3) | 4 | 2 | 0 | 0 | 1.0 | go/03's hidden test lost an assertion the ticket does not specify (a restart exactly at a scheduled time must skip that run); all 8 go/03 diffs of the day were re-graded (first graded 3 correct, 3 wrong). go/03 3/3: every run wrote a failing test of `NextRun` before editing and changed `NextRun` itself (run 1's first failure was a build error, which also opens the gate). python/02 1/3 (3/3 without the gate): runs 1 and 3 tested the ticket's example through `invoice_total_cents`, then made it pass with `Decimal` inside `invoice.py`, leaving the shared `to_cents` broken. Test-first narrowed the goal to the symptom; a root-cause rule is next. [report](../testing/coding-eval-2026-10-29-5.md) |
| 2026-10-29 | 4. `agent.v6`/`review.v6` (fix a shared function, not one caller) with the gate | tool_loop | gpt-5-mini | plan.v3, agent.v6, review.v6, analyze.v2, discover.v1 | none | 10 (go/03, python/02 x5) | 9 | 1 | 0 | 0 | 1.0 | go/03 5/5, python/02 4/5 (one run still made `invoice_total_cents` right with `Decimal` and left `to_cents` broken). The full-suite pass that followed: Go 3/3, Node 01–07 7/7, python/01 correct; node/08 (impossible SOAP ticket, declined before the gate) regressed: the agent wrote a test that started a server and never closed it, every run timed out, the gate never opened, and the execution ran out of time. [report](../testing/coding-eval-2026-10-29-6.md) |
| 2026-10-29 | 4. Triage before planning (`triage.v1`: proceed or decline, with a reason); the gate reports a timed-out run as a hanging test and its refusal mentions `finish` blocked | tool_loop | gpt-5-mini | plan.v3, agent.v6, review.v6, triage.v1, analyze.v2, discover.v1 | none | 6 (node/08 x3, python x1) | 3 | 0 | 3 | 0 | 1.0 | node/08 3/3 declined at triage in ~25 s each, naming the missing endpoint, credentials and SOAP contract (before: every run timed out). Python 3/3 correct, including the vague python/03: triage let workable tickets through. Completes the regression pass for v6 + gate + triage. [report 1](../testing/coding-eval-2026-10-29-7.md), [report 2](../testing/coding-eval-2026-10-29-8.md) |
