# 🗺️ Orchestration Core Engine — Execution Roadmap

This roadmap focuses on building the **functional logic** of the orchestration engine. Each phase delivers a working unit that can be tested end-to-end.

---

## Phase 1: The Brain & The Hands [DONE]
**Goal**: Enable a single agent to reason using project context and output real files.
- [x] **Shared Project Context**: Centralized tech stack and decision store.
- [x] **Context-Aware Prompting**: Agents receive full project state before tasks.
- [x] **LLM Integration**: Real-world reasoning via Gemini 1.5 Flash.
- [x] **Code Output Sink**: Automatic file generation to `generated-code/`.

> **Testable Unit**: A single task like "Create a React Button" generates a physical file based on the project's tech stack.

---

## Phase 1.8: Provider Infrastructure & Discovery [DONE]
**Goal**: Transition from Gemini-only to a multi-provider system with auto-discovery.
- [x] **Universal Model Discovery**: API to list available models for any provided key (Gemini/OpenAI/Claude).Performance & Cost Targets
- [x] **Quota & Usage Intelligence**: Real-time checking of rate limits.
- [x] **Provider Abstraction**: A "LLM Service" that can swap engines seamlessly.

> **Testable Unit**: Providing an OpenAI key via API returns a list of models (gpt-4o, gpt-3.5) and their current usage status.

---

## Phase 2: Planning & Decomposition [TODO]
**Goal**: Enable agents to handle complex goals by breaking them into manageable tasks.
- [ ] **Planning Service**: Logic to take a "High-Level Goal" and generate sub-tasks.
- [ ] **Task Dependency Mapping**: Ensuring tasks are executed in the correct order.
- [ ] **Dynamic Re-planning**: Allowing agents to update the plan if they hit a wall.

> **Testable Unit**: Sending a Goal (e.g., "Build a full login feature") generates 5-10 distinct `Task` objects in the database.

---

## Phase 2.5: User Visibility & Live Feed [TODO]
**Goal**: Move from silent execution to real-time transparency for the user.
- [ ] **Agent Telemetry**: Instead of just logs, agents emit "Observation Events" (Thinking, Acting, Waiting).
- [ ] **Live Activity Stream**: Implement a Webhook or Server-Sent Events (SSE) feed that the frontend can listen to.
- [ ] **Plan Visualization API**: An endpoint to fetch the current graph of tasks and their statuses.

> **Testable Unit**: A browser/client can connect to a stream and see "Agent [Frontend] is figuring out the CSS..." in real-time.

---

## Phase 3: Multi-Agent Collaboration [TODO]
**Goal**: Multi-agent synchronization and consensus (e.g., API contracts).
- [ ] **Messaging Backbone**: Agents can send "Advice" or "Requests" to each other.
- [ ] **Contract Negotiation**: Formal flow for proposing and accepting JSON schemas.
- [ ] **Shared Memory**: Agents writing "Decisions" back to the Project Context for others to see.

> **Testable Unit**: A Backend agent proposes a schema; the Frontend agent accepts it and only then starts writing its component.

---

## Phase 4: External World Integration [TODO]
**Goal**: Connect the engine to real-world ticket boards and external tools.
- [ ] **Board Adapters**: Generic interface for Trello/Jira.
- [ ] **Ingestion Engine**: Automatically turning board tickets into internal Goals/Tasks.
- [ ] **Write-back**: Updating the board status (e.g., moving a card to "Done").

> **Testable Unit**: Changing a card on Trello triggers the engine, which completes the work and moves the card back.

---

## Phase 5: Self-Correction & QA Loop [TODO]
**Goal**: Ensure quality and reliability via a verification cycle.
- [ ] **Verification Agent**: A role specialized in reviewing code and logic.
- [ ] **Feedback Loops**: If a task fails (or QA rejects it), it is automatically re-queued with the failure reason.
- [ ] **Validation Middleware**: Automated syntax and lint checks on generated code.

> **Testable Unit**: An agent generates broken code; the QA agent flags it; the engine re-tasks the agent to fix it.

---

## 📌 Supplemental Implementation Guidelines

The following cross-cutting concerns must be addressed alongside the phase-specific deliverables to ensure the system meets the production-grade goals outlined in README.md.

### A. Explicit Contracts & Schemas
All inter-component communication must use versioned, typed contracts:
- **Phase 1**: Finalize `AgentMessagePayload` TypeScript interface and JSON schema (senderId, receiverId, content, timestamp, messageType).
- **Phase 2**: Define `Task` (id, goalId, description, status, dependencies, result) and `Plan` (id, goalId, tasks[], createdAt) interfaces.
- **Phase 3**: Define `ContractProposal` (proposerId, schema, version) and `ContractAcceptance` (acceptorId, proposalId, approved) payloads.
- **Phase 4**: Define `BoardTicket` (id, title, description, status, boardId) and `IngestionResult` (ticketId, goalId, taskIds[]) schemas.
- **Phase 5**: Define `VerificationResult` (taskId, passed, errors[], suggestedFix) and `FeedbackLoopPayload` (taskId, failureReason, retryCount) schemas.

### B. Failure Recovery & Reliability
Implement production-grade reliability patterns:
- **Phase 4/5**: Configure RabbitMQ dead-letter queues (DLQ) for unprocessable messages, with alerting on DLQ depth.
- **Phase 5**: Add exponential backoff retries (max 3 attempts) for failed task executions, with jitter to avoid thundering herds.
- **Phase 4**: Implement circuit breaker pattern for external API calls (Trello/Jira) to prevent cascading failures.
- **Phase 5**: Add idempotency keys to all task executions to avoid duplicate processing during retries.

### C. Security Model
Secure all agent interactions and external integrations:
- **Phase 1.8**: Encrypt all provider API keys at rest using AES-256-GCM, with key rotation support.
- **Phase 4**: Implement OAuth 2.0 flow for external tools (Trello/Jira) with scoped permissions and refresh token rotation.
- **All Phases**: Add audit logging for all agent actions, connector calls, and database mutations (store in `AuditLog` Prisma model).
- **Future**: Add role-based access control (RBAC) for multi-user environments, with agent-scoped permissions.

### D. Scalability Considerations
Prepare the system for horizontal scaling:
- **Phase 3**: Design `AgentRunner` to be stateless, allowing horizontal scaling behind a RabbitMQ consumer group.
- **Phase 4**: Use Prisma Accelerate for cloud database connection pooling, with read replicas for heavy query workloads.
- **Phase 3**: Configure RabbitMQ in cluster mode for high availability across regions.
- **Future**: Implement region-aware message routing to reduce cross-region latency for global agent deployments.

### E. Performance & Cost Targets
Define measurable goals to guide implementation:
- **Latency**: p95 message processing time < 500ms for local deployments, < 1s for cloud deployments.
- **Throughput**: Support 1000 tasks/sec per RabbitMQ node, with linear scaling as nodes are added.
- **Cost**: Cap LLM API usage at $500/month per agent pool, with real-time usage dashboards.
- **Database**: Keep Prisma query response times < 100ms for 95% of queries, with indexes on high-traffic fields (agentId, taskStatus).
