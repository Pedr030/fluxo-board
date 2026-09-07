import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { deleteCard, updateCard } from "../controllers/card.controller";

export const cardRouter = Router();

cardRouter.use(requireAuth);

cardRouter.patch("/:id", updateCard);
cardRouter.delete("/:id", deleteCard);
