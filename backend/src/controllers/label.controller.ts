import { Response } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { isBoardMember } from "../lib/authorization";

const createLabelSchema = z.object({
  name: z.string().max(60).optional(),
  color: z.string().min(1),
});

/**
 * POST /boards/:id/labels  { name?, color }
 * Qualquer membro pode criar — mesma permissão de criar lista/card, não é
 * uma ação restrita ao dono do board.
 */
export async function createLabel(req: AuthRequest, res: Response) {
  const parsed = createLabelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const boardId = req.params.id;
  if (!(await isBoardMember(boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const label = await prisma.label.create({
    data: { boardId, name: parsed.data.name, color: parsed.data.color },
  });

  const io = req.app.get("io") as Server;
  io.to(boardId).emit("label:created", { label });

  return res.status(201).json({ label });
}

const updateLabelSchema = z.object({
  name: z.string().max(60).nullable().optional(),
  color: z.string().min(1).optional(),
});

/**
 * PATCH /labels/:id  { name?, color? }
 * Muda a cor/nome pra todo mundo que já usa essa etiqueta — é uma paleta
 * compartilhada do board, não algo por card.
 */
export async function updateLabel(req: AuthRequest, res: Response) {
  const parsed = updateLabelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const labelId = req.params.id;

  const label = await prisma.label.findUnique({ where: { id: labelId } });
  if (!label) {
    return res.status(404).json({ error: "Etiqueta não encontrada" });
  }
  if (!(await isBoardMember(label.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const { name, color } = parsed.data;
  if (name === undefined && color === undefined) {
    return res.status(400).json({ error: "Nada para atualizar" });
  }

  const updated = await prisma.label.update({
    where: { id: labelId },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(color !== undefined ? { color } : {}),
    },
  });

  const io = req.app.get("io") as Server;
  io.to(label.boardId).emit("label:updated", { label: updated });

  return res.json({ label: updated });
}

/**
 * DELETE /labels/:id
 * Remove a etiqueta e, via onDelete: Cascade, toda associação CardLabel
 * dela — some de todo card que usava, refletido no frontend removendo
 * esse labelId de cada card local ao receber o evento.
 */
export async function deleteLabel(req: AuthRequest, res: Response) {
  const labelId = req.params.id;

  const label = await prisma.label.findUnique({ where: { id: labelId } });
  if (!label) {
    return res.status(404).json({ error: "Etiqueta não encontrada" });
  }
  if (!(await isBoardMember(label.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  await prisma.label.delete({ where: { id: labelId } });

  const io = req.app.get("io") as Server;
  io.to(label.boardId).emit("label:deleted", { labelId, boardId: label.boardId });

  return res.status(204).send();
}

const attachLabelSchema = z.object({
  labelId: z.string().min(1),
});

/**
 * POST /cards/:id/labels  { labelId }
 * Aplica uma etiqueta (já existente na paleta do board) no card.
 * Idempotente: se já estava aplicada, só devolve sucesso sem tentar criar
 * duplicado (a chave composta cardId+labelId impediria mesmo, mas checar
 * antes evita um erro de constraint à toa nessa resposta).
 */
export async function attachLabel(req: AuthRequest, res: Response) {
  const parsed = attachLabelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const cardId = req.params.id;
  const { labelId } = parsed.data;

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

  const label = await prisma.label.findUnique({ where: { id: labelId } });
  if (!label || label.boardId !== list.boardId) {
    return res.status(404).json({ error: "Etiqueta não encontrada neste board" });
  }

  const existing = await prisma.cardLabel.findUnique({
    where: { cardId_labelId: { cardId, labelId } },
  });
  if (!existing) {
    await prisma.cardLabel.create({ data: { cardId, labelId } });
  }

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("card:label-added", { cardId, labelId });

  return res.status(204).send();
}

/**
 * DELETE /cards/:id/labels/:labelId
 */
export async function detachLabel(req: AuthRequest, res: Response) {
  const cardId = req.params.id;
  const labelId = req.params.labelId;

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

  await prisma.cardLabel.deleteMany({ where: { cardId, labelId } });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("card:label-removed", { cardId, labelId });

  return res.status(204).send();
}
