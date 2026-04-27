import { Router } from 'express';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
} from '../controllers/projectController';
import { validate } from '../middleware/validate';
import { createProjectSchema, updateProjectSchema, idParamSchema } from '../schemas';

const router = Router();

router.post('/', validate(createProjectSchema), createProject);
router.get('/', getProjects);
router.get('/:id', validate(idParamSchema), getProjectById);
router.patch('/:id', validate(updateProjectSchema), updateProject);
router.delete('/:id', validate(idParamSchema), deleteProject);

export default router;
