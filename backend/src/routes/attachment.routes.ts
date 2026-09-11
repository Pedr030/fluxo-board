import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { deleteAttachment } from "../controllers/attachment.controller";

export const attachmentRouter = Router();

attachmentRouter.use(requireAuth);

attachmentRouter.delete("/:id", deleteAttachment);
