import { Response } from "express";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { isBoardMember } from "../lib/authorization";

const actorSelect = { id: true, name: true, avatarUrl: true };

const PAGE_SIZE = 50;

/**
 * GET /boards/:id/activity?page=<n>
 * Lista o histórico do board em páginas de 50, mais recente primeiro,
 * com `totalPages` na resposta pra dar uma barra de paginação numerada
 * de verdade (salto direto pra qualquer página, sem precisar visitar as
 * anteriores). Offset (`skip`/`take`) em vez de cursor: é o que permite
 * saber o total de páginas e pular direto — o preço é que atividade nova
 * chegando ao vivo (socket) enquanto alguém navega pode deslocar em um a
 * fronteira entre duas páginas (uma entrada aparecendo em ambas por um
 * instante). Aceitável aqui porque é um histórico de leitura, não uma
 * fila sendo processada — ninguém perde dado, na pior hipótese vê uma
 * linha repetida até recarregar. `page` fora do intervalo (ou omitido/
 * inválido) simplesmente cai pra 1 ou devolve uma lista vazia, sem erro.
 * Carregado só quando a aba de atividade abre (não vem junto do GET
 * /boards/:id) — mesma decisão já tomada pra comentários/anexos, é
 * conteúdo que cresce sem limite ao longo da vida do board.
 */
export async function listActivity(req: AuthRequest, res: Response) {
  const boardId = req.params.id;
  const parsedPage = Number(req.query.page);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  if (!(await isBoardMember(boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const [activities, totalCount] = await Promise.all([
    prisma.activity.findMany({
      where: { boardId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: actorSelect } },
    }),
    prisma.activity.count({ where: { boardId } }),
  ]);

  return res.json({
    activities,
    page,
    pageSize: PAGE_SIZE,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
  });
}
