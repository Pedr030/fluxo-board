import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { createImageUploadMiddleware } from "../middleware/imageUpload";
import { sensitiveActionLimiter } from "../middleware/rateLimit";
import { createAttachment, listAttachments } from "../controllers/attachment.controller";
import { deleteCard, updateCard } from "../controllers/card.controller";
import { createChecklistItem } from "../controllers/checklistItem.controller";
import { createComment, listComments } from "../controllers/comment.controller";
import { attachLabel, detachLabel } from "../controllers/label.controller";

const uploadAttachmentFile = createImageUploadMiddleware("file", 5 * 1024 * 1024);

export const cardRouter = Router();

cardRouter.use(requireAuth);

cardRouter.patch("/:id", updateCard);
cardRouter.delete("/:id", deleteCard);
cardRouter.get("/:id/comments", listComments);
cardRouter.post("/:id/comments", createComment);
cardRouter.get("/:id/attachments", listAttachments);
cardRouter.post("/:id/attachments", sensitiveActionLimiter, uploadAttachmentFile, createAttachment);
cardRouter.post("/:id/labels", attachLabel);
cardRouter.delete("/:id/labels/:labelId", detachLabel);
cardRouter.post("/:id/checklist-items", createChecklistItem);
