import { Server } from "socket.io";
import { prisma } from "../prisma";

const actorSelect = { id: true, name: true, avatarUrl: true };

/**
 * Registra uma entrada no histórico de atividade do board e avisa quem
 * estiver com ele aberto em tempo real — mesma regra de ouro do resto do
 * app (persiste, depois emite). Chamado no fim de cada controller que
 * gera um evento de alto sinal (ver comentário do model Activity no
 * schema.prisma pra lista do que conta), sempre depois da mutação
 * principal já ter tido sucesso.
 */
export async function logActivity(
  io: Server,
  boardId: string,
  userId: string | undefined,
  summary: string
) {
  const activity = await prisma.activity.create({
    data: { boardId, userId, summary },
    include: { user: { select: actorSelect } },
  });
  io.to(boardId).emit("activity:created", { activity });
}
