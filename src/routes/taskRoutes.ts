import { Router } from 'express';
import {
  createTask,
  getTasks,
  getTaskById,
} from '../controllers/taskController';

const router = Router();

router.post('/', createTask);
router.get('/', getTasks);
router.get('/:id', getTaskById);

export default router;
