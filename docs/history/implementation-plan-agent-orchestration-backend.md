# Integration of Message Broker and Service Enhancements

This plan outlines the next phase of development for the **Agent Orchestration Backend**. We will transition from simple simulated services to a robust, message-driven architecture using **RabbitMQ** and a standardized protocol for inter-agent communication.

## User Review Required

> [!IMPORTANT]
> **Infrastructure Dependency**: This plan requires a running RabbitMQ instance. I will provide a `docker-compose.yml` to simplify local setup, but ensure you have Docker installed.
> **Standardized Message Protocol**: I am proposing a specific JSON schema for agent-to-agent messages. Please review the 'Standardized Message Format' section below.

## Proposed Changes

### Infrastructure

#### [NEW] [docker-compose.yml](file:///f:/code/agent-orchestration-app-backend/docker-compose.yml)
Set up RabbitMQ and PostgreSQL containers to ensure a consistent local development environment.

### Messaging & Communication (Tasks 17, 18)

#### [MODIFY] [messagingService.ts](file:///f:/code/agent-orchestration-app-backend/src/services/messagingService.ts)
Update to use `amqplib` for publishing messages to RabbitMQ.
#### [NEW] [rabbitMQService.ts](file:///f:/code/agent-orchestration-app-backend/src/services/rabbitMQService.ts) [NEW]
Create a singleton service to manage RabbitMQ connections, channels, and exchange assertions.

#### Standardized Message Format:
```json
{
  "id": "uuid",
  "type": "AGENT_MESSAGE | TASK_UPDATE | RESOURCE_REQUEST",
  "senderId": "uuid",
  "receiverId": "uuid | null",
  "payload": {},
  "metadata": {
    "timestamp": "iso-date",
    "conversationId": "uuid",
    "correlationId": "uuid"
  }
}
```

### Resource Proxy (MCP Service) (Task 20)

#### [MODIFY] [mcpService.ts](file:///f:/code/agent-orchestration-app-backend/src/services/mcpService.ts)
Implement a pluggable interface for connectors.
#### [NEW] [connectors/](file:///f:/code/agent-orchestration-app-backend/src/services/connectors/) [NEW]
- `baseConnector.ts`: Abstract class/interface for all external connectors.
- `httpConnector.ts`: Generic connector for external REST APIs.
- `databaseConnector.ts`: Connector for direct database interactions.

### Agent Runner (Task 22)

#### [MODIFY] [agentRunner.ts](file:///f:/code/agent-orchestration-app-backend/src/services/agentRunner.ts)
Update the runner to:
1.  Subscribe to its assigned RabbitMQ queue.
2.  Process incoming messages and tasks.
3.  Use the `McpService` to fetch real data when required by a task.

---

## Open Questions

> [!CAUTION]
> **Priority Connectors**: Which specific external service (Jira, GitHub, Slack, etc.) should I implement first as a concrete example of an MCP connector?
> **Security**: For Task 21 (Secure credential handling), should I implement a basic encryption layer for the database-stored `config` fields now, or stick to `.env` variables for the initial implementation?

## Verification Plan

### Automated Tests
- Integration tests using a test RabbitMQ container.
- Unit tests for the message serialization/deserialization logic.

### Manual Verification
- Trigger a task via the API and monitor the logs to see the Agent Runner publish a "success" message back to the broker.
- Use RabbitMQ Management UI to verify queue bindings and message flow.
