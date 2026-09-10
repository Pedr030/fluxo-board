import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../prisma";

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

function signToken(userId: string) {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: "7d" });
}

// Remove o hash da senha antes de devolver o usuário pro cliente. Exportado
// porque me.controller.ts usa o mesmo formato pra GET /me e afins.
export function toPublicUser(user: {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}) {
  return { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
}

/**
 * POST /auth/register
 */
export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Já existe um usuário com esse email" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, password: hashed },
  });

  const token = signToken(user.id);
  return res.status(201).json({ user: toPublicUser(user), token });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /auth/login
 */
export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Email ou senha inválidos" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: "Email ou senha inválidos" });
  }

  const token = signToken(user.id);
  return res.json({ user: toPublicUser(user), token });
}
