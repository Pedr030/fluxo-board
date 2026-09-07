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
  title: z.string().min(1),
});

/**
 * PATCH /lists/:id  { title: string }
 * Renomeia a lista. Reordenar lista entre boards não existe nesse projeto
 * (só cards se movem entre listas — ver etapa de drag-and-drop).
 */
export async function updateList(req: AuthRequest, res: Response) {
  const parsed = updateListSchema.safeParse(req.body);
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

  const updated = await prisma.list.update({
    where: { id: listId },
    data: { title: parsed.data.title },
  });

  const io = req.app.get("io") as Server;
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
