import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { deleteLabel, updateLabel } from "../controllers/label.controller";

export const labelRouter = Router();

labelRouter.use(requireAuth);

labelRouter.patch("/:id", updateLabel);
labelRouter.delete("/:id", deleteLabel);
