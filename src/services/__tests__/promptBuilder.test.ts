import { buildAgentPrompt } from '../promptBuilder';

describe('PromptBuilder', () => {
  it('should correctly build agent prompts', () => {
    const project = {
      name: 'Test Project',
      techStack: 'Node, TypeScript',
      architectureDecisions: 'Use hexagonal architecture',
      contextData: { appName: 'MyApp' },
    };

    const agent = {
      name: 'DevAgent',
      baseInstructions: 'Write clean code.',
    };

    const task = {
      id: 'task-1',
      payload: { goal: 'Create a login service' },
    } as any;

    const result = buildAgentPrompt({ project, agent, task });

    expect(result.system).toContain('You are an AI Agent named "DevAgent"');
    expect(result.system).toContain('Project Name: Test Project');
    expect(result.system).toContain('Tech Stack: Node, TypeScript');
    expect(result.system).toContain('Write clean code.');
    expect(result.system).toContain('"appName": "MyApp"');

    expect(result.user).toContain('TASK ASSIGNMENT:');
    expect(result.user).toContain('Task ID: task-1');
    expect(result.user).toContain('"goal": "Create a login service"');
    expect(result.user).toContain('THINKING:');
    expect(result.user).toContain('ACTIONS:');
    expect(result.user).toContain('STATUS:');
  });

  it('should use default instructions if not provided', () => {
    const project = { name: 'P' };
    const agent = { name: 'A' };
    const task = { id: 'T', payload: {} } as any;

    const result = buildAgentPrompt({ project, agent, task });
    expect(result.system).toContain('You are a professional software engineer.');
  });
});
