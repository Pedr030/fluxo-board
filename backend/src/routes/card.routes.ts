import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { deleteCard, updateCard } from "../controllers/card.controller";
import { createComment, listComments } from "../controllers/comment.controller";

export const cardRouter = Router();

cardRouter.use(requireAuth);

cardRouter.patch("/:id", updateCard);
cardRouter.delete("/:id", deleteCard);
cardRouter.get("/:id/comments", listComments);
cardRouter.post("/:id/comments", createComment);
