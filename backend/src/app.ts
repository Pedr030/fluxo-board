import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { authRouter } from "./routes/auth.routes";
import { boardRouter } from "./routes/board.routes";
import { cardRouter } from "./routes/card.routes";
import { listRouter } from "./routes/list.routes";
import { meRouter } from "./routes/me.routes";
import { registerBoardSocket } from "./sockets/boardSocket";

/**
 * Monta o app Express + servidor HTTP + Socket.io, sem escutar em nenhuma
 * porta — quem decide isso é o chamador (index.ts em produção/dev, ou os
 * testes, que precisam de uma porta efêmera pra rodar em paralelo sem
 * conflito). Separar "montar" de "escutar" é o que permite os testes de
 * integração importarem exatamente o mesmo app que roda de verdade, em vez
 * de reimplementar as rotas ou mockar tudo.
 */
export function createApp(frontendUrl: string) {
  const app = express();
  const server = http.createServer(app);

  app.use(cors({ origin: frontendUrl }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/auth", authRouter);
  app.use("/me", meRouter);
  app.use("/boards", boardRouter);
  app.use("/lists", listRouter);
  app.use("/cards", cardRouter);

  const io = new Server(server, {
    cors: { origin: frontendUrl },
  });
  // Deixa o `io` acessível nos controllers via req.app.get("io"), pra emitir
  // eventos depois de persistir uma mutação (ver PROJECT_SPEC.md, seção 2).
  app.set("io", io);
  registerBoardSocket(io);

  return { app, server, io };
}
