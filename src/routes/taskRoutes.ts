import { Router } from 'express';
import {
  createTask,
  getTasks,
  getTaskById,
} from '../controllers/taskController';
import { validate } from '../middleware/validate';
import { createTaskSchema, idParamSchema } from '../schemas';

const router = Router();

router.post('/', validate(createTaskSchema), createTask);
router.get('/', getTasks);
router.get('/:id', validate(idParamSchema), getTaskById);

export default router;
