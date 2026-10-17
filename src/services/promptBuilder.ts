import { Agent, Project, Task } from "@prisma/client";

type PromptProject = Pick<
  Project,
  "name" | "techStack" | "architectureDecisions" | "contextData"
>;
type PromptAgent = Pick<Agent, "name" | "baseInstructions">;

/**
 * Utility to assemble a comprehensive prompt for the LLM.
 * Aggregates agent identity, project context, and task requirements.
 */
export const buildAgentPrompt = (params: {
  project: PromptProject;
  agent: PromptAgent;
  task: Task;
}) => {
  const { project, agent, task } = params;

  const systemPrompt = `
You are an AI Agent named "${agent.name}".
Your role and base instructions:
${agent.baseInstructions || "You are a professional software engineer."}

PROJECT CONTEXT:
Project Name: ${project.name}
Tech Stack: ${project.techStack || "Not specified"}
Architecture Decisions: ${project.architectureDecisions || "None recorded"}

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

Return one JSON object with this exact shape and no markdown wrapper:
{
  "summary": "brief description of work performed; do not include private reasoning",
  "actions": "FILE: path/to/file.ext\\n\`\`\`language\\ncode\\n\`\`\` or an empty string",
  "contextUpdates": {},
  "status": "COMPLETED or FAILED"
}
`;

  return {
    system: systemPrompt.trim(),
    user: userPrompt.trim(),
  };
};
