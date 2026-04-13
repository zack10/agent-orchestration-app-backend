import { Router } from 'express';
import {
  createAgent,
  getAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
} from '../controllers/agentController';
import { validate } from '../middleware/validate';
import { createAgentSchema, updateAgentSchema, idParamSchema } from '../schemas';

const router = Router();

router.post('/', validate(createAgentSchema), createAgent);
router.get('/', getAgents);
router.get('/:id', validate(idParamSchema), getAgentById);
router.put('/:id', validate(updateAgentSchema), updateAgent);
router.delete('/:id', validate(idParamSchema), deleteAgent);

export default router;
