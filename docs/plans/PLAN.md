# Agent Orchestration App Project Plan

## Overview
An interactive application to manage AI agents, assign them skills, enable MCP resource access, and facilitate inter-agent communication. MVP goal: role-based agents (frontend/backend/qa) pull work items from an external board (start with Trello polling; later Jira) and transition tickets through `TODO → IN_PROGRESS → READY_FOR_TEST → DONE`, coordinating via explicit API contract proposals/acceptance.

## Backend (Node.js/TypeScript/Express/Prisma)
- [x] Initialize project repository.
- [x] Create package.json and install dependencies.
- [x] Set up API endpoints for Agent CRUD operations.
- [x] Design and implement database schema for Agents, Skills, and Tasks.
- [x] Extend schema for skill-agent relationships.
- [x] Implement API endpoints for Skill CRUD.
- [x] Implement API endpoints for assigning tasks to agents.
- [x] Develop basic "Agent Runner" module for simple task execution.
- [x] Develop messaging service for inter-agent communication.
- [x] Develop "Resource Proxy" (MCP Service) module.
- [x] Integrate a message broker (RabbitMQ).
- [x] Define a standardized message format/protocol for inter-agent communication.
- [x] Define a connector registry within MCP Service for resource requests.
- [x] Add WorkItem domain model (canonical ticket representation).
- [x] Add work-item lock/claim helpers (DB lock primitives).
- [x] Add role routing keys/queues (e.g., `role.frontend.work`).
- [x] Add ApiContract persistence primitives + message types (proposal/accept/reject).
- [ ] Add tool-agnostic BoardAdapter interface (Trello/Jira interchangeable).
- [ ] Implement Trello adapter (polling ingestor) and WorkItem upsert.
- [ ] Add role-based agent workers (frontend/backend/qa) with work-item claiming/locking.
- [ ] Implement contract negotiation workflow (endpoints + gating work on accepted contracts).
- [ ] Implement QA workflow (READY_FOR_TEST → DONE or reopen).
- [ ] Ensure secure handling of credentials for external services.
- [ ] Set up logging/monitoring (correlation ids across work items + messages).

## Frontend (React/TypeScript/Material-UI)
- [x] Initialize project repository.
- [x] Create package.json and install dependencies.
- [x] Develop UI for listing and creating agents.
- [ ] Enhance Agent creation/editing UI to allow selecting and assigning skills.
- [ ] Create UI for assigning text-based tasks to agents and monitoring status.
- [ ] Create UI for WorkItems (list/filter/status timeline).
- [ ] Create UI for board configuration (Trello first; Jira later).
- [ ] Create UI for contract proposals/acceptance (API schema agreement).
- [ ] Develop visual representation of agent communication.
- [ ] Implement real-time updates for task statuses and interactions.

## Infrastructure
- [ ] Containerize frontend, backend, and database using Docker/Docker Compose.
