import { Response } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { isBoardMember } from "../lib/authorization";

const createListSchema = z.object({
  title: z.string().min(1),
});

/**
 * POST /boards/:id/lists  { title: string }
 * Cria uma lista no fim do board — position = quantidade de listas
 * existentes (sem reordenação por enquanto, isso é assunto da etapa de
 * drag-and-drop).
 */
export async function createList(req: AuthRequest, res: Response) {
  const parsed = createListSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const boardId = req.params.id;

  if (!(await isBoardMember(boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const position = await prisma.list.count({ where: { boardId } });
  const list = await prisma.list.create({
    data: { title: parsed.data.title, boardId, position },
  });
  const listWithCards = { ...list, cards: [] as never[] };

  // Persistiu com sucesso — agora sim emite pra todo mundo na room do board
  // (incluindo quem criou, pra todo cliente reagir do mesmo jeito ao evento).
  const io = req.app.get("io") as Server;
  io.to(boardId).emit("list:created", { list: listWithCards });

  return res.status(201).json({ list: listWithCards });
}

const updateListSchema = z.object({
  title: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
});

/**
 * PATCH /lists/:id  { title? } ou { position? }
 * Dois modos mutuamente exclusivos, mesma ideia do updateCard:
 *  - title: renomeia.
 *  - position: reordena a lista dentro do próprio board (lista não muda
 *    de board, diferente de card que muda de lista — não precisa de
 *    "board de destino").
 */
export async function updateList(req: AuthRequest, res: Response) {
  const parsed = updateListSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { title, position: toPosition } = parsed.data;
  const listId = req.params.id;

  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(list.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const io = req.app.get("io") as Server;

  if (toPosition !== undefined) {
    const orderedListIds = await prisma.$transaction(async (tx) => {
      const siblings = await tx.list.findMany({
        where: { boardId: list.boardId },
        orderBy: { position: "asc" },
      });
      const reordered = siblings.filter((l) => l.id !== listId);
      reordered.splice(Math.min(toPosition, reordered.length), 0, list);

      await Promise.all(
        reordered.map((l, index) => tx.list.update({ where: { id: l.id }, data: { position: index } }))
      );
      return reordered.map((l) => l.id);
    });

    io.to(list.boardId).emit("list:moved", { orderedListIds });
    return res.status(204).send();
  }

  if (title === undefined) {
    return res.status(400).json({ error: "Nada para atualizar" });
  }

  const updated = await prisma.list.update({
    where: { id: listId },
    data: { title },
  });

  io.to(list.boardId).emit("list:updated", { list: updated });

  return res.json({ list: updated });
}

/**
 * DELETE /lists/:id
 * Remove a lista (e os cards dela, via onDelete: Cascade no schema) e
 * reindexa as listas restantes do board — mesmo motivo do deleteCard: sem
 * isso, createList (que usa count()) poderia gerar position duplicada.
 */
export async function deleteList(req: AuthRequest, res: Response) {
  const listId = req.params.id;

  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(list.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.list.delete({ where: { id: listId } });
    const siblings = await tx.list.findMany({
      where: { boardId: list.boardId },
      orderBy: { position: "asc" },
    });
    await Promise.all(
      siblings.map((l, index) => tx.list.update({ where: { id: l.id }, data: { position: index } }))
    );
  });

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("list:deleted", { listId });

  return res.status(204).send();
}
