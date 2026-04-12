import prisma from '../db';
import rabbitMQService from './rabbitMQService';
import { AgentMessagePayload } from '../types/messaging';
import { v4 as uuidv4 } from 'uuid';

export const sendMessage = async (senderId: string, receiverId: string, content: any) => {
  const message = await prisma.message.create({
    data: {
      senderId,
      receiverId,
      content,
    },
  });
  
  const payload: AgentMessagePayload = {
    id: message.id,
    type: 'AGENT_MESSAGE',
    senderId,
    receiverId,
    payload: content,
    metadata: {
      timestamp: new Date().toISOString(),
      correlationId: uuidv4(),
    },
  };

  // Publish to RabbitMQ
  // Routing key: agent.<receiverId>.message
  await rabbitMQService.publish(`agent.${receiverId}.message`, payload);

  console.log(`Inter-agent message published: ${senderId} -> ${receiverId}`, content);

  return message;
};
