import { Request, Response } from 'express';
import prisma from '../db';

export const createSkill = async (req: Request, res: Response) => {
  try {
    const { name, description, logic } = req.body;
    const skill = await prisma.skill.create({
      data: {
        name,
        description,
        logic,
      },
    });
    res.status(201).json(skill);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create skill' });
  }
};

export const getSkills = async (req: Request, res: Response) => {
  try {
    const skills = await prisma.skill.findMany();
    res.status(200).json(skills);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
};

export const getSkillById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const skill = await prisma.skill.findUnique({
      where: { id },
    });
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.status(200).json(skill);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch skill' });
  }
};

export const updateSkill = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, logic } = req.body;
    const skill = await prisma.skill.update({
      where: { id },
      data: {
        name,
        description,
        logic,
      },
    });
    res.status(200).json(skill);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update skill' });
  }
};

export const deleteSkill = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.skill.delete({
      where: { id },
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete skill' });
  }
};

export const assignSkillToAgent = async (req: Request, res: Response) => {
  try {
    const { agentId, skillId } = req.body;
    const agent = await prisma.agent.update({
      where: { id: agentId },
      data: {
        skills: {
          connect: { id: skillId },
        },
      },
      include: {
        skills: true,
      },
    });
    res.status(200).json(agent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign skill to agent' });
  }
};
