import prisma from '../../db';
import { getProjectContext, updateProjectContext, createProject } from '../projectService';

jest.mock('../../db', () => ({
  __esModule: true,
  default: {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}));

describe('ProjectService', () => {
  const mockProject = {
    id: 'project-1',
    name: 'Test Project',
    description: 'A test project',
    techStack: 'React, Node.js',
    contextData: { existing: 'data' },
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getProjectContext', () => {
    it('should fetch project context with agents and recent tasks', async () => {
      (prisma.project.findUnique as jest.Mock).mockResolvedValue(mockProject);

      const result = await getProjectContext('project-1');

      expect(prisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        include: {
          agents: true,
          tasks: {
            orderBy: { updatedAt: 'desc' },
            take: 10,
          },
        },
      });
      expect(result).toEqual(mockProject);
    });
  });

  describe('updateProjectContext', () => {
    it('should merge contextData and update project', async () => {
      (prisma.project.findUnique as jest.Mock).mockResolvedValue(mockProject);
      (prisma.project.update as jest.Mock).mockResolvedValue({ ...mockProject, contextData: { existing: 'data', new: 'stuff' } });

      const updates = { contextData: { new: 'stuff' } };
      const result = await updateProjectContext('project-1', updates);

      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: 'project-1' } });
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: {
          contextData: { existing: 'data', new: 'stuff' },
        },
      });
      expect(result.contextData).toEqual({ existing: 'data', new: 'stuff' });
    });

    it('should throw error if project not found', async () => {
      (prisma.project.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(updateProjectContext('non-existent', {})).rejects.toThrow('Project non-existent not found');
    });
  });

  describe('createProject', () => {
    it('should create a new project with empty contextData', async () => {
      const newProjectData = { name: 'New Project', description: 'Desc' };
      (prisma.project.create as jest.Mock).mockResolvedValue({ ...newProjectData, id: 'new-id', contextData: {} });

      const result = await createProject(newProjectData);

      expect(prisma.project.create).toHaveBeenCalledWith({
        data: {
          ...newProjectData,
          contextData: {},
        },
      });
      expect(result.id).toBe('new-id');
    });
  });
});
