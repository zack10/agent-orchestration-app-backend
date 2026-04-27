import { Task } from '@prisma/client';

/**
 * Utility to assemble a comprehensive prompt for the LLM.
 * Aggregates agent identity, project context, and task requirements.
 */
export const buildAgentPrompt = (params: {
  project: any;
  agent: any;
  task: Task;
}) => {
  const { project: projectRaw, agent: agentRaw, task } = params;
  const project = projectRaw as any;
  const agent = agentRaw as any;

  const systemPrompt = `
You are an AI Agent named "${agent.name}".
Your role and base instructions:
${agent.baseInstructions || 'You are a professional software engineer.'}

PROJECT CONTEXT:
Project Name: ${project.name}
Tech Stack: ${project.techStack || 'Not specified'}
Architecture Decisions: ${project.architectureDecisions || 'None recorded'}

CURRENT PROJECT STATE:
${JSON.stringify(project.contextData, null, 2)}

CORE MISSION:
You must execute the task assigned to you.
The shared project context above is the "source of truth" all agents use.
If you make decisions or build components, you must output them clearly.
`;

  const userPrompt = `
TASK ASSIGNMENT:
Task ID: ${task.id}
Payload: ${JSON.stringify(task.payload, null, 2)}

PLEASE PROVIDE YOUR RESPONSE IN THE FOLLOWING FORMAT:
1. THINKING: Your reasoning process.
2. ACTIONS:
   If you generate code, use this format for each file:
   FILE: path/to/file.ext
   \`\`\`language
   // code here
   \`\`\`
3. CONTEXT_UPDATES: Any updates that should be written back to the Shared Project Context (valid JSON).
4. STATUS: The outcome of the task (COMPLETED/FAILED).
`;

  return {
    system: systemPrompt.trim(),
    user: userPrompt.trim(),
  };
};
