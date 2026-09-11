import { Response } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { isBoardMember } from "../lib/authorization";
import { attachmentObjectKey, removeAttachment } from "../lib/supabaseStorage";

const createCardSchema = z.object({
  title: z.string().min(1),
});

/**
 * POST /lists/:id/cards  { title: string }
 * Cria um card no fim da lista — position = quantidade de cards
 * existentes na lista.
 */
export async function createCard(req: AuthRequest, res: Response) {
  const parsed = createCardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const listId = req.params.id;

  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(list.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const position = await prisma.card.count({ where: { listId } });
  const card = await prisma.card.create({
    data: { title: parsed.data.title, listId, position, creatorId: req.userId },
  });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("card:created", { card });

  return res.status(201).json({ card });
}

const updateCardSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  listId: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
});

/**
 * PATCH /cards/:id  { title?, description?, listId?, position? }
 * Dois modos, mutuamente exclusivos por enquanto:
 *  - listId + position juntos: move o card (reindexa a(s) lista(s) — ver
 *    seção 3 do spec, posições inteiras 0..n-1 sem gaps).
 *  - title e/ou description: edita o conteúdo, sem mexer em posição.
 */
export async function updateCard(req: AuthRequest, res: Response) {
  const parsed = updateCardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { title, description, listId: toListId, position: toPosition } = parsed.data;
  const cardId = req.params.id;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }

  const sourceList = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!sourceList) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(sourceList.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const io = req.app.get("io") as Server;
  const isMove = toListId !== undefined && toPosition !== undefined;

  if (isMove) {
    const destList = await prisma.list.findUnique({ where: { id: toListId } });
    if (!destList) {
      return res.status(404).json({ error: "Lista de destino não encontrada" });
    }
    if (sourceList.boardId !== destList.boardId) {
      return res.status(400).json({ error: "Lista de destino precisa ser do mesmo board" });
    }

    const fromListId = card.listId;
    const updated = await prisma.$transaction(async (tx) => {
      if (fromListId === toListId) {
        const siblings = await tx.card.findMany({
          where: { listId: fromListId },
          orderBy: { position: "asc" },
        });
        const reordered = siblings.filter((c) => c.id !== cardId);
        reordered.splice(Math.min(toPosition, reordered.length), 0, card);

        await Promise.all(
          reordered.map((c, index) =>
            tx.card.update({ where: { id: c.id }, data: { position: index } })
          )
        );
      } else {
        const sourceSiblings = await tx.card.findMany({
          where: { listId: fromListId, id: { not: cardId } },
          orderBy: { position: "asc" },
        });
        await Promise.all(
          sourceSiblings.map((c, index) =>
            tx.card.update({ where: { id: c.id }, data: { position: index } })
          )
        );

        const destSiblings = await tx.card.findMany({
          where: { listId: toListId },
          orderBy: { position: "asc" },
        });
        destSiblings.splice(Math.min(toPosition, destSiblings.length), 0, card);

        await Promise.all(
          destSiblings.map((c, index) =>
            tx.card.update({ where: { id: c.id }, data: { position: index, listId: toListId } })
          )
        );
      }

      return tx.card.findUniqueOrThrow({ where: { id: cardId } });
    });

    io.to(destList.boardId).emit("card:moved", { card: updated, fromListId, toListId });
    return res.json({ card: updated });
  }

  if (title === undefined && description === undefined) {
    return res.status(400).json({ error: "Nada para atualizar" });
  }

  const updated = await prisma.card.update({
    where: { id: cardId },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
    },
  });

  io.to(sourceList.boardId).emit("card:updated", { card: updated });
  return res.json({ card: updated });
}

/**
 * DELETE /cards/:id
 * Remove o card e reindexa a lista (fecha o buraco de position) — sem
 * isso, uma criação futura poderia colidir na mesma position, já que
 * createCard usa count() pra decidir a próxima posição.
 */
export async function deleteCard(req: AuthRequest, res: Response) {
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

  // Precisa buscar os anexos ANTES da transação: onDelete: Cascade no
  // schema já apaga as linhas de Attachment junto com o card, mas o
  // Postgres não sabe nada sobre o arquivo de verdade no Supabase
  // Storage — essa limpeza é feita à parte, depois.
  const attachments = await prisma.attachment.findMany({ where: { cardId } });

  await prisma.$transaction(async (tx) => {
    await tx.card.delete({ where: { id: cardId } });
    const siblings = await tx.card.findMany({
      where: { listId: card.listId },
      orderBy: { position: "asc" },
    });
    await Promise.all(
      siblings.map((c, index) => tx.card.update({ where: { id: c.id }, data: { position: index } }))
    );
  });

  // Best-effort: as linhas já se foram do banco de qualquer forma, uma
  // falha aqui só deixaria um arquivo órfão no bucket, não motivo pra
  // desfazer a exclusão do card (que já aconteceu).
  await Promise.all(
    attachments.map((a) => removeAttachment(attachmentObjectKey(a.cardId, a.id)).catch(() => {}))
  );

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("card:deleted", { cardId, listId: card.listId });

  return res.status(204).send();
}
