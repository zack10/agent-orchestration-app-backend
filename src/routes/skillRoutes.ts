import { Router } from 'express';
import {
  createSkill,
  getSkills,
  getSkillById,
  updateSkill,
  deleteSkill,
  assignSkillToAgent,
} from '../controllers/skillController';

const router = Router();

router.post('/', createSkill);
router.get('/', getSkills);
router.get('/:id', getSkillById);
router.put('/:id', updateSkill);
router.delete('/:id', deleteSkill);
router.post('/assign', assignSkillToAgent);

export default router;
