import { Response } from "express";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { isBoardMember } from "../lib/authorization";

const actorSelect = { id: true, name: true, avatarUrl: true };

/**
 * GET /boards/:id/activity
 * Lista as últimas 100 entradas do histórico do board, mais recente
 * primeiro. Carregado só quando a aba de atividade abre (não vem junto
 * do GET /boards/:id) — mesma decisão já tomada pra comentários/anexos,
 * é conteúdo que cresce sem limite ao longo da vida do board.
 */
export async function listActivity(req: AuthRequest, res: Response) {
  const boardId = req.params.id;

  if (!(await isBoardMember(boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const activities = await prisma.activity.findMany({
    where: { boardId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: actorSelect } },
  });

  return res.json({ activities });
}
