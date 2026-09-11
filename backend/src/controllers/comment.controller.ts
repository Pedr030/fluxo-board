import { Response } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { isBoardMember } from "../lib/authorization";

const authorSelect = { id: true, name: true, avatarUrl: true };

/**
 * GET /cards/:id/comments
 * Carregado só quando o modal de detalhes do card abre (não vem junto do
 * GET /boards/:id) — evita inflar o payload do board inteiro com threads de
 * comentário que a maioria dos cards nem tem.
 */
export async function listComments(req: AuthRequest, res: Response) {
  const cardId = req.params.id;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }
  const list = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(list.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const comments = await prisma.comment.findMany({
    where: { cardId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: authorSelect } },
  });

  return res.json({ comments });
}

const createCommentSchema = z.object({
  text: z.string().min(1).max(2000),
});

/**
 * POST /cards/:id/comments  { text: string }
 */
export async function createComment(req: AuthRequest, res: Response) {
  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const cardId = req.params.id;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }
  const list = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(list.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const comment = await prisma.comment.create({
    data: { text: parsed.data.text, cardId, authorId: req.userId },
    include: { author: { select: authorSelect } },
  });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("comment:created", { comment, cardId });

  return res.status(201).json({ comment });
}

/**
 * DELETE /comments/:id
 * Só quem escreveu o comentário pode excluir — sem moderação por dono do
 * board por enquanto (não foi pedido, e mantém a regra simples de explicar).
 */
export async function deleteComment(req: AuthRequest, res: Response) {
  const commentId = req.params.id;

  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) {
    return res.status(404).json({ error: "Comentário não encontrado" });
  }
  if (comment.authorId !== req.userId) {
    return res.status(403).json({ error: "Você só pode excluir seus próprios comentários" });
  }

  const card = await prisma.card.findUnique({ where: { id: comment.cardId } });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }
  const list = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }

  await prisma.comment.delete({ where: { id: commentId } });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("comment:deleted", { commentId, cardId: comment.cardId });

  return res.status(204).send();
}
