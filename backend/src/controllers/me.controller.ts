import { Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { removeAvatar, uploadAvatar } from "../lib/supabaseStorage";
import { toPublicUser } from "./auth.controller";

/**
 * GET /me
 * Perfil do usuário logado. O frontend nunca guarda o objeto `user` (só o
 * token) depois do login/registro, então a tela de perfil precisa desse
 * jeito de buscar quem é o usuário atual.
 */
export async function getMe(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  return res.json({ user: toPublicUser(user!) });
}

const updateProfileSchema = z.object({
  name: z.string().min(1),
});

/**
 * PATCH /me  { name: string }
 * Por enquanto só o nome é editável aqui — email exigiria reverificação
 * (fica pra quando a etapa de verificação de email existir).
 */
export async function updateProfile(req: AuthRequest, res: Response) {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { name: parsed.data.name },
  });
  return res.json({ user: toPublicUser(user) });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

/**
 * PATCH /me/password  { currentPassword, newPassword }
 * Exige a senha atual antes de trocar — sem isso, um token roubado (ex:
 * sessão esquecida aberta) bastaria pra sequestrar a conta trocando a senha.
 */
export async function changePassword(req: AuthRequest, res: Response) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  const valid = await bcrypt.compare(currentPassword, user!.password);
  if (!valid) {
    return res.status(401).json({ error: "Senha atual incorreta" });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: req.userId! }, data: { password: hashed } });
  return res.status(204).send();
}

/**
 * PATCH /me/avatar  (multipart/form-data, campo "avatar")
 * O middleware de upload (ver me.routes.ts) já valida tamanho/tipo antes
 * de chegar aqui — se caiu aqui, req.file existe e é uma imagem válida.
 */
export async function updateAvatar(req: AuthRequest, res: Response) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado" });
  }

  const avatarUrl = await uploadAvatar(req.userId!, file.buffer, file.mimetype);
  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { avatarUrl },
  });
  return res.json({ user: toPublicUser(user) });
}

/**
 * DELETE /me/avatar
 * Remove a foto — volta a mostrar a inicial colorida no lugar.
 */
export async function deleteAvatar(req: AuthRequest, res: Response) {
  await removeAvatar(req.userId!);
  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { avatarUrl: null },
  });
  return res.json({ user: toPublicUser(user) });
}
