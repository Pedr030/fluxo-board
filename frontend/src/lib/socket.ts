import { io, Socket } from "socket.io-client";
import { getToken } from "./api";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

let socket: Socket | null = null;

/**
 * Singleton do socket — reaproveita a mesma conexão entre navegações.
 * Manda o JWT da aba atual na conexão (validado em boardSocket.ts via
 * io.use()); é assim que o servidor sabe de quem é cada socket pra
 * presença ("quem está no board agora").
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { auth: { token: getToken() } });
  }
  return socket;
}

/**
 * Derruba o socket singleton — usado no logout, senão a próxima conexão
 * (com outra conta, na mesma aba) continuaria carregando o token velho
 * (o `auth` só é lido na hora de conectar, não muda depois).
 */
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
