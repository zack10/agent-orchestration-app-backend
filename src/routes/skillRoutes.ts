import { Router } from "express";
import {
  assignSkillToAgent,
  createSkill,
  deleteSkill,
  getSkillById,
  getSkills,
  updateSkill,
} from "../controllers/skillController";
import { validate } from "../middleware/validate";
import {
  assignSkillSchema,
  createSkillSchema,
  idParamSchema,
  updateSkillSchema,
} from "../schemas";

const router = Router();

router.post("/", validate(createSkillSchema), createSkill);
router.get("/", getSkills);
router.get("/:id", validate(idParamSchema), getSkillById);
router.put("/:id", validate(updateSkillSchema), updateSkill);
router.delete("/:id", validate(idParamSchema), deleteSkill);
router.post("/assign", validate(assignSkillSchema), assignSkillToAgent);

export default router;
