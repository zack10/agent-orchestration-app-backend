import prisma from '../../db';
import { runAgent } from '../agentRunner';
import { LLMService } from '../llm/LLMService';
import { writeGeneratedCode } from '../../utils/codeWriter';
import { updateProjectContext } from '../projectService';

jest.mock('../../db', () => ({
  __esModule: true,
  default: {
    task: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../llm/LLMService');
jest.mock('../../utils/codeWriter');
jest.mock('../projectService', () => ({
  updateProjectContext: jest.fn(),
  getProjectContext: jest.fn(),
}));
jest.mock('../../utils/crypto', () => ({
  decrypt: jest.fn((val) => val.replace('enc:', '')),
}));

describe('AgentRunner', () => {
  const taskId = 'task-123';
  const mockTask = {
    id: taskId,
    projectId: 'proj-1',
    agent: {
      id: 'agent-1',
      name: 'TestAgent',
      model: 'test-model',
      config: { apiKey: 'enc:secret-key' },
      skills: [],
      resources: [],
    },
    project: {
      id: 'proj-1',
      name: 'Test Project',
      contextData: {},
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should run the agent successfully and update task status', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue(mockTask);
    (LLMService.prototype.generateContent as jest.Mock).mockResolvedValue(`
THINKING: I will do it.

1. ACTIONS:
FILE: out.txt
\`\`\`
content
\`\`\`

2. CONTEXT_UPDATES:
{"key": "val"}

3. STATUS: COMPLETED
`);
    (writeGeneratedCode as jest.Mock).mockReturnValue(['out.txt']);

    await runAgent(taskId);

    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: taskId },
      data: { status: 'IN_PROGRESS' },
    });

    expect(LLMService.prototype.generateContent).toHaveBeenCalledWith(
      'test-model',
      expect.any(Object),
      'secret-key'
    );

    expect(writeGeneratedCode).toHaveBeenCalled();
    expect(updateProjectContext).toHaveBeenCalledWith('proj-1', { contextData: { key: 'val' } });

    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: taskId },
      data: expect.objectContaining({
        status: 'COMPLETED',
        result: expect.objectContaining({
          thinking: expect.stringContaining('I will do it.'),
          writtenFiles: ['out.txt'],
        }),
      }),
    });
  });

  it('should handle agent failure', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue(mockTask);
    (LLMService.prototype.generateContent as jest.Mock).mockResolvedValue(`
3. STATUS: FAILED
`);

    await runAgent(taskId);

    expect(prisma.task.update).toHaveBeenLastCalledWith({
      where: { id: taskId },
      data: expect.objectContaining({
        status: 'FAILED',
      }),
    });
  });

  it('should handle exceptions during execution', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue(mockTask);
    (prisma.task.update as jest.Mock).mockImplementationOnce(() => Promise.resolve()); // IN_PROGRESS
    (prisma.task.update as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error('DB Error'))); // result update

    await runAgent(taskId);

    expect(prisma.task.update).toHaveBeenLastCalledWith({
      where: { id: taskId },
      data: { status: 'FAILED', result: { error: 'DB Error' } },
    });
  });
});
