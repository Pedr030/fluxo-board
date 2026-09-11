import { Response } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { isBoardMember } from "../lib/authorization";

const createItemSchema = z.object({
  text: z.string().min(1).max(300),
});

/**
 * POST /cards/:id/checklist-items  { text }
 * Entra no fim da checklist — position = quantidade de itens já
 * existentes, mesmo padrão de createCard/createList.
 */
export async function createChecklistItem(req: AuthRequest, res: Response) {
  const parsed = createItemSchema.safeParse(req.body);
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

  const position = await prisma.checklistItem.count({ where: { cardId } });
  const item = await prisma.checklistItem.create({
    data: { cardId, text: parsed.data.text, position },
  });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("checklist-item:created", { item, cardId });

  return res.status(201).json({ item });
}

const updateItemSchema = z.object({
  text: z.string().min(1).max(300).optional(),
  done: z.boolean().optional(),
});

/**
 * PATCH /checklist-items/:id  { text?, done? }
 * Sem "só o autor" aqui — igual etiqueta, qualquer membro do board marca/
 * desmarca/edita, é uma lista de tarefas do time, não de uma pessoa.
 */
export async function updateChecklistItem(req: AuthRequest, res: Response) {
  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const itemId = req.params.id;

  const item = await prisma.checklistItem.findUnique({ where: { id: itemId } });
  if (!item) {
    return res.status(404).json({ error: "Item não encontrado" });
  }
  const card = await prisma.card.findUnique({ where: { id: item.cardId } });
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

  const { text, done } = parsed.data;
  if (text === undefined && done === undefined) {
    return res.status(400).json({ error: "Nada para atualizar" });
  }

  const updated = await prisma.checklistItem.update({
    where: { id: itemId },
    data: {
      ...(text !== undefined ? { text } : {}),
      ...(done !== undefined ? { done } : {}),
    },
  });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("checklist-item:updated", { item: updated, cardId: item.cardId });

  return res.json({ item: updated });
}

/**
 * DELETE /checklist-items/:id
 * Reindexa os itens restantes do card — fecha o buraco de position,
 * mesmo padrão de deleteCard/deleteList.
 */
export async function deleteChecklistItem(req: AuthRequest, res: Response) {
  const itemId = req.params.id;

  const item = await prisma.checklistItem.findUnique({ where: { id: itemId } });
  if (!item) {
    return res.status(404).json({ error: "Item não encontrado" });
  }
  const card = await prisma.card.findUnique({ where: { id: item.cardId } });
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

  await prisma.$transaction(async (tx) => {
    await tx.checklistItem.delete({ where: { id: itemId } });
    const siblings = await tx.checklistItem.findMany({
      where: { cardId: item.cardId },
      orderBy: { position: "asc" },
    });
    await Promise.all(
      siblings.map((s, index) => tx.checklistItem.update({ where: { id: s.id }, data: { position: index } }))
    );
  });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("checklist-item:deleted", { itemId, cardId: item.cardId });

  return res.status(204).send();
}
