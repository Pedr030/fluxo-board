import { BoardMember } from "@prisma/client";
import { prisma } from "../prisma";

// Usado em toda rota que mexe num board (ou lista/card dele) pra garantir
// que o usuário logado tem acesso — dono e membros convidados passam aqui
// pelo mesmo caminho, já que ambos viram BoardMember.
export async function isBoardMember(boardId: string, userId: string): Promise<boolean> {
  return !!(await getBoardMembership(boardId, userId));
}

// Versão que devolve a linha inteira (role, restricted) em vez de só
// true/false — usada onde a rota precisa saber não só "é membro?" mas
// também "pode mexer nesse card específico?" (ver canEditCard).
export async function getBoardMembership(
  boardId: string,
  userId: string
): Promise<BoardMember | null> {
  return prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
  });
}

// Um membro "restricted" só edita/move/exclui cards atribuídos a ele
// (ou sem responsável nenhum — livres pra qualquer um pegar). ADMIN/OWNER
// e membros não-restritos passam sempre — essa checagem só existe pra
// bloquear MEMBER restrito mexendo no card de outra pessoa.
export function canEditCard(
  membership: Pick<BoardMember, "restricted">,
  card: { assigneeId: string | null },
  userId: string
): boolean {
  if (!membership.restricted) return true;
  return card.assigneeId === null || card.assigneeId === userId;
}
