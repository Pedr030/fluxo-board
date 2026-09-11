import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { createImageUploadMiddleware } from "../middleware/imageUpload";
import { sensitiveActionLimiter } from "../middleware/rateLimit";
import {
  changePassword,
  deleteAccount,
  deleteAvatar,
  getMe,
  updateAvatar,
  updateProfile,
} from "../controllers/me.controller";

const uploadAvatarFile = createImageUploadMiddleware("avatar", 2 * 1024 * 1024);

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get("/", getMe);
meRouter.patch("/", updateProfile);
meRouter.patch("/password", sensitiveActionLimiter, changePassword);
meRouter.patch("/avatar", sensitiveActionLimiter, uploadAvatarFile, updateAvatar);
meRouter.delete("/avatar", deleteAvatar);
meRouter.delete("/", sensitiveActionLimiter, deleteAccount);
