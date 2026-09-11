import "express-async-errors";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import http from "http";
import { Server } from "socket.io";
import { attachmentRouter } from "./routes/attachment.routes";
import { authRouter } from "./routes/auth.routes";
import { boardRouter } from "./routes/board.routes";
import { cardRouter } from "./routes/card.routes";
import { commentRouter } from "./routes/comment.routes";
import { listRouter } from "./routes/list.routes";
import { meRouter } from "./routes/me.routes";
import { globalLimiter } from "./middleware/rateLimit";
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

  // Northflank (e a maioria dos PaaS) fica atrás de um proxy reverso — sem
  // isso, req.ip sempre devolveria o IP do proxy, não do cliente de
  // verdade, e o rate limiting por IP acabaria tratando todo mundo como
  // uma pessoa só.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: frontendUrl }));
  app.use(express.json({ limit: "1mb" }));
  app.use(globalLimiter);

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/auth", authRouter);
  app.use("/me", meRouter);
  app.use("/boards", boardRouter);
  app.use("/lists", listRouter);
  app.use("/cards", cardRouter);
  app.use("/comments", commentRouter);
  app.use("/attachments", attachmentRouter);

  // Handler de erro global — precisa ser o último app.use. Com
  // "express-async-errors" importado lá em cima, um throw (ou rejection)
  // dentro de qualquer controller async cai aqui em vez de derrubar o
  // processo Node inteiro (era exatamente isso que estava acontecendo antes
  // dessa mudança: um erro não tratado em qualquer rota tirava o backend
  // do ar pra todo mundo, não só pra quem fez aquela requisição). Loga o
  // erro de verdade no servidor, mas devolve só uma mensagem genérica pro
  // cliente — nunca o stack trace/detalhe interno.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erro interno do servidor" });
  });

  const io = new Server(server, {
    cors: { origin: frontendUrl },
  });
  // Deixa o `io` acessível nos controllers via req.app.get("io"), pra emitir
  // eventos depois de persistir uma mutação (ver PROJECT_SPEC.md, seção 2).
  app.set("io", io);
  registerBoardSocket(io);

  return { app, server, io };
}
