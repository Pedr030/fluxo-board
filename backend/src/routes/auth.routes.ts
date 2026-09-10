import { Router } from "express";
import { login, register } from "../controllers/auth.controller";
import { authLimiter } from "../middleware/rateLimit";

export const authRouter = Router();

authRouter.post("/register", authLimiter, register);
authRouter.post("/login", authLimiter, login);
