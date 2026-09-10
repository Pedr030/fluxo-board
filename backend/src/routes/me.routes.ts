import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { changePassword, getMe, updateProfile } from "../controllers/me.controller";

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get("/", getMe);
meRouter.patch("/", updateProfile);
meRouter.patch("/password", changePassword);
