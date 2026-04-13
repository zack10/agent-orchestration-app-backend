export type MessageType =
  | 'AGENT_MESSAGE'
  | 'TASK_UPDATE'
  | 'RESOURCE_REQUEST'
  | 'WORKITEM_STATUS'
  | 'CONTRACT_PROPOSAL'
  | 'CONTRACT_ACCEPTED'
  | 'CONTRACT_REJECTED';

export interface MessageMetadata {
  timestamp: string;
  conversationId?: string;
  correlationId?: string;
}

export interface AgentMessagePayload {
  id: string;
  type: MessageType;
  senderId: string;
  receiverId: string | null;
  payload: any;
  metadata: MessageMetadata;
}
