import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { deleteChecklistItem, updateChecklistItem } from "../controllers/checklistItem.controller";

export const checklistItemRouter = Router();

checklistItemRouter.use(requireAuth);

checklistItemRouter.patch("/:id", updateChecklistItem);
checklistItemRouter.delete("/:id", deleteChecklistItem);
