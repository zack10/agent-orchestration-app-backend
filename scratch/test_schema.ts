import { agentMessageSchema } from '../src/schemas';
import { v4 as uuidv4 } from 'uuid';

const validMessage = {
  body: {
    id: uuidv4(),
    type: 'AGENT_MESSAGE',
    senderId: uuidv4(),
    receiverId: uuidv4(),
    payload: {
      text: 'Hello from agent'
    },
    metadata: {
      timestamp: new Date().toISOString(),
      correlationId: uuidv4()
    }
  }
};

const invalidMessage = {
  body: {
    id: 'not-a-uuid',
    type: 'INVALID_TYPE',
    senderId: uuidv4(),
    receiverId: null,
    payload: {},
    metadata: {
      timestamp: 'not-a-date'
    }
  }
};

console.log('Testing valid message...');
const result1 = agentMessageSchema.safeParse(validMessage);
if (result1.success) {
  console.log('✅ Valid message passed');
} else {
  console.error('❌ Valid message failed:', result1.error.format());
}

console.log('Testing invalid message...');
const result2 = agentMessageSchema.safeParse(invalidMessage);
if (!result2.success) {
  console.log('✅ Invalid message correctly rejected');
  // console.log('Errors:', result2.error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
} else {
  console.error('❌ Invalid message was incorrectly accepted');
}
