import prisma from '../db';
import rabbitMQService from './rabbitMQService';
import { executeMcpAction } from './mcpService';
import { AgentMessagePayload } from '../types/messaging';

export const setupAgentSubscription = async (agentId: string) => {
  const queueName = `agent_${agentId}_queue`;
  const routingKey = `agent.${agentId}.message`;

  await rabbitMQService.subscribe(queueName, routingKey, async (msg: AgentMessagePayload) => {
    console.log(`Agent ${agentId} received message:`, msg);
    
    // Potentially auto-trigger a task based on the message
    // This is where "autonomous" behavior starts
  });

  console.log(`Subscribed agent ${agentId} to its message queue.`);
};

export const runAgent = async (taskId: string) => {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      agent: {
        include: {
          skills: true,
          resources: true,
        },
      },
    },
  });

  if (!task) return;

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'IN_PROGRESS' },
  });

  try {
    const { agent, payload } = task;
    console.log(`Agent ${agent.name} is executing task:`, payload);

    let result: any = { message: `Task started by ${agent.name}` };
    
    // If the tool/task requires a specific resource
    if (agent.resources.length > 0) {
      const resource = agent.resources[0]; // For now, use the first resource
      const mcpResult = await executeMcpAction(resource.id, 'PROCESS_TASK', payload);
      result.mcpOutput = mcpResult;
    }

    result.details = `Executed with ${agent.skills.length} skills and ${agent.resources.length} active resources.`;

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        result,
      },
    });
  } catch (error: any) {
    console.error(`Error running agent:`, error);
    await prisma.task.update({
      where: { id: taskId },
      data: { 
        status: 'FAILED',
        result: { error: error.message }
      },
    });
  }
};
