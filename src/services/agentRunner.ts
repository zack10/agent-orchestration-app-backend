import prisma from '../db';
import { writeGeneratedCode } from '../utils/codeWriter';
import { LLMService } from './llm/LLMService';
import { parseAgentOutput } from '../utils/llmUtils';
import { getProjectContext, updateProjectContext } from './projectService';
import { buildAgentPrompt } from './promptBuilder';
import { decrypt } from '../utils/crypto';

const llmService = new LLMService();

export const runAgent = async (taskId: string) => {
  // ... (lines 20-65) fetch task, mark status, build prompt, call LLM, parse output
  const task = await (prisma.task as any).findUnique({
    where: { id: taskId },
    include: {
      agent: {
        include: { skills: true, resources: true },
      },
      project: {
        include: { agents: true }
      }
    },
  });

  if (!task || !task.agent) return;

  await prisma.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } });

  try {
    const { agent, project } = task;
    const context = project || await getProjectContext(agent.projectId || '') || { name: 'Unknown Project', contextData: {} };

    const prompt = buildAgentPrompt({ project: context as any, agent, task });
    
    // Extract API key from config if available (encrypted)
    let apiKey: string | undefined;
    const config = agent.config as any;
    if (config?.apiKey) {
      try {
        // Try to decrypt. If it's not encrypted (no colons), it will throw,
        // in which case we might fallback to raw value or environment.
        if (config.apiKey.includes(':')) {
          apiKey = decrypt(config.apiKey);
        } else {
          apiKey = config.apiKey;
        }
      } catch (e) {
        console.warn(`Failed to decrypt API key for agent ${agent.name}, using as-is or falling back to env.`);
        apiKey = config.apiKey;
      }
    }

    const rawOutput = await llmService.generateContent(
      (agent as any).model || 'gemini-flash-latest',
      prompt,
      apiKey
    );
    const parsed = parseAgentOutput(rawOutput);

    // Write generated code if any
    let writtenFiles: string[] = [];
    if (parsed.actions) {
      writtenFiles = writeGeneratedCode(parsed.actions, context.name);
      if (writtenFiles.length > 0) {
        console.log(`Agent ${agent.name} wrote ${writtenFiles.length} files to generated-code/.`);
      }
    }

    if (parsed.contextUpdates && task.projectId) {
      try {
        const updates = JSON.parse(parsed.contextUpdates);
        await updateProjectContext(task.projectId, { contextData: updates });
      } catch (e) {
        console.warn('Invalid context updates from agent:', parsed.contextUpdates);
      }
    }

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: parsed.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        result: {
          thinking: parsed.thinking,
          actions: parsed.actions,
          writtenFiles,
          raw: parsed.raw,
        },
      },
    });

  } catch (error: any) {
    console.error(`Error running agent execution loop:`, error);
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'FAILED', result: { error: error.message } },
    });
  }
};
