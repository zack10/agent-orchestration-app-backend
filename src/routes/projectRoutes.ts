import { Router } from "express";
import {
  createProject,
  deleteProject,
  getProjectById,
  getProjects,
  updateProject,
} from "../controllers/projectController";
import { validate } from "../middleware/validate";
import {
  createProjectSchema,
  idParamSchema,
  updateProjectSchema,
} from "../schemas";

const router = Router();

router.post("/", validate(createProjectSchema), createProject);
router.get("/", getProjects);
router.get("/:id", validate(idParamSchema), getProjectById);
router.patch("/:id", validate(updateProjectSchema), updateProject);
router.delete("/:id", validate(idParamSchema), deleteProject);

export default router;
