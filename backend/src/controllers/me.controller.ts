import { Response } from "express";
import bcrypt from "bcryptjs";
import { Server } from "socket.io";
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

const deleteAccountSchema = z.object({
  resolutions: z
    .array(
      z.object({
        boardId: z.string(),
        action: z.enum(["transfer", "delete"]),
        newOwnerId: z.string().optional(),
      })
    )
    .default([]),
});

/**
 * DELETE /me  { resolutions: [{ boardId, action: "transfer"|"delete", newOwnerId? }] }
 *
 * Excluir a conta não pode simplesmente apagar o User: ele é dono de boards
 * (Board.ownerId não aceita null), e a FK falharia. Por board que a pessoa
 * é dona:
 * - só ela no board → exclui direto, sem perguntar (não tem pra quem
 *   transferir, e é o combinado com o usuário).
 * - tem outro membro → PRECISA de uma resolução no corpo da requisição
 *   ("transfer" pra outro membro existente, ou "delete"). Confere aqui de
 *   novo mesmo o frontend já forçando a escolha — nunca confia só na UI.
 *
 * Board que a pessoa só é MEMBRO comum (não dona) some sozinho: o
 * onDelete: Cascade em BoardMember.user cuida disso quando o User é
 * apagado no fim da transação.
 */
export async function deleteAccount(req: AuthRequest, res: Response) {
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.userId!;
  const resolutionByBoard = new Map(parsed.data.resolutions.map((r) => [r.boardId, r]));

  const ownedBoards = await prisma.board.findMany({
    where: { ownerId: userId },
    include: { members: true },
  });

  for (const board of ownedBoards) {
    const soloOwner = board.members.length <= 1;
    if (soloOwner) continue;

    const resolution = resolutionByBoard.get(board.id);
    if (!resolution) {
      return res.status(400).json({
        error: `Resolva o board "${board.title}" antes de continuar (transferir ou excluir)`,
      });
    }
    if (resolution.action === "transfer") {
      const isMember = board.members.some((m) => m.userId === resolution.newOwnerId);
      if (!isMember) {
        return res.status(400).json({
          error: `Membro inválido pra transferir o board "${board.title}"`,
        });
      }
    }
  }

  const deletedBoardIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const board of ownedBoards) {
      const resolution = resolutionByBoard.get(board.id);
      const soloOwner = board.members.length <= 1;

      if (soloOwner || resolution?.action === "delete") {
        await tx.board.delete({ where: { id: board.id } });
        deletedBoardIds.push(board.id);
      } else if (resolution?.action === "transfer" && resolution.newOwnerId) {
        await tx.board.update({
          where: { id: board.id },
          data: { ownerId: resolution.newOwnerId },
        });
        await tx.boardMember.update({
          where: { boardId_userId: { boardId: board.id, userId: resolution.newOwnerId } },
          data: { role: "OWNER" },
        });
      }
    }

    await tx.user.delete({ where: { id: userId } });
  });

  // Só depois de tudo persistido — quem estiver com algum desses boards
  // aberto vê a exclusão em tempo real, mesma regra de sempre.
  const io = req.app.get("io") as Server;
  for (const boardId of deletedBoardIds) {
    io.to(boardId).emit("board:deleted", { boardId });
  }

  return res.status(204).send();
}
