import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { isBoardMember } from "../lib/authorization";

interface PresenceUser {
  id: string;
  name: string;
}

// Quem está em cada room agora, por socket (uma pessoa pode ter mais de um
// socket na mesma room — duas abas do mesmo board — por isso a chave
// interna é o socketId, não o userId; broadcastPresence deduplica por
// userId na hora de montar a lista que o cliente recebe).
const presence = new Map<string, Map<string, PresenceUser>>();

function broadcastPresence(io: Server, boardId: string) {
  const room = presence.get(boardId);
  const users = room ? Array.from(room.values()) : [];
  const unique = Array.from(new Map(users.map((u) => [u.id, u])).values());
  io.to(boardId).emit("presence:update", { users: unique });
}

function removeFromRoom(io: Server, boardId: string, socketId: string) {
  const room = presence.get(boardId);
  if (!room?.delete(socketId)) return;
  if (room.size === 0) {
    presence.delete(boardId);
  }
  broadcastPresence(io, boardId);
}

/**
 * Cada board vira uma "room" do Socket.io (nome da room = boardId).
 * Quem abre um board entra na room; toda mudança nesse board (mover
 * card, criar lista, etc.) é emitida só pra quem está na room.
 *
 * Autenticação: o cliente manda o JWT em `auth: { token }` na conexão (ver
 * lib/socket.ts do frontend) — validado aqui em io.use(), igual o
 * requireAuth do REST faz com o header Authorization. Sem isso não dava
 * pra saber de quem é cada socket, e presença exige saber quem é quem.
 */
export function registerBoardSocket(io: Server) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error("Token não informado"));
    }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, name: true },
      });
      if (!user) {
        return next(new Error("Usuário não encontrado"));
      }
      socket.data.user = user;
      next();
    } catch {
      next(new Error("Token inválido ou expirado"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as PresenceUser;

    socket.on("board:join", async (boardId: string) => {
      // Mesma checagem que toda rota REST já faz (isBoardMember) — sem
      // isso, qualquer usuário autenticado (com um JWT válido, mas de
      // qualquer conta) conseguia entrar na room de um board que não é
      // dele só sabendo o id, e ver presença/eventos ao vivo de gente que
      // nem convidou ele.
      if (!(await isBoardMember(boardId, user.id))) {
        return;
      }
      socket.join(boardId);
      if (!presence.has(boardId)) {
        presence.set(boardId, new Map());
      }
      presence.get(boardId)!.set(socket.id, user);
      broadcastPresence(io, boardId);
    });

    socket.on("board:leave", (boardId: string) => {
      socket.leave(boardId);
      removeFromRoom(io, boardId, socket.id);
    });

    // Todos os eventos de mutação ("list:created", "list:updated",
    // "list:deleted", "card:created", "card:moved", "card:updated",
    // "card:deleted") já são emitidos pelos controllers via
    // req.app.get("io"), depois do prisma.create/update/delete ter
    // sucesso — não tem handler aqui porque quem dispara esses eventos é a
    // rota REST, não o socket em si.

    socket.on("disconnect", () => {
      // Não sabemos em que room(s) esse socket estava sem procurar — ele
      // pode ter saído sem emitir "board:leave" (fechou a aba, caiu a rede).
      for (const boardId of presence.keys()) {
        removeFromRoom(io, boardId, socket.id);
      }
    });
  });
}
