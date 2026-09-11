import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { deleteComment } from "../controllers/comment.controller";

export const commentRouter = Router();

commentRouter.use(requireAuth);

commentRouter.delete("/:id", deleteComment);
