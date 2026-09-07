import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { createCard } from "../controllers/card.controller";
import { deleteList, updateList } from "../controllers/list.controller";

export const listRouter = Router();

listRouter.use(requireAuth);

listRouter.post("/:id/cards", createCard);
listRouter.patch("/:id", updateList);
listRouter.delete("/:id", deleteList);
