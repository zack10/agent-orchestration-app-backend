import { Router } from 'express';
import {
  createSkill,
  getSkills,
  getSkillById,
  updateSkill,
  deleteSkill,
  assignSkillToAgent,
} from '../controllers/skillController';
import { validate } from '../middleware/validate';
import { createSkillSchema, updateSkillSchema, idParamSchema, assignSkillSchema } from '../schemas';

const router = Router();

router.post('/', validate(createSkillSchema), createSkill);
router.get('/', getSkills);
router.get('/:id', validate(idParamSchema), getSkillById);
router.put('/:id', validate(updateSkillSchema), updateSkill);
router.delete('/:id', validate(idParamSchema), deleteSkill);
router.post('/assign', validate(assignSkillSchema), assignSkillToAgent);

export default router;
