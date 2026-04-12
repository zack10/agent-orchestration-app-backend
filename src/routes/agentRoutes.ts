import { Router } from 'express';
import {
  createAgent,
  getAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
} from '../controllers/agentController';

const router = Router();

router.post('/', createAgent);
router.get('/', getAgents);
router.get('/:id', getAgentById);
router.put('/:id', updateAgent);
router.delete('/:id', deleteAgent);

export default router;
