import { prisma } from "../prisma";

// Usado em toda rota que mexe num board (ou lista/card dele) pra garantir
// que o usuário logado tem acesso — dono e membros convidados passam aqui
// pelo mesmo caminho, já que ambos viram BoardMember.
export async function isBoardMember(boardId: string, userId: string): Promise<boolean> {
  const member = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
  });
  return !!member;
}
