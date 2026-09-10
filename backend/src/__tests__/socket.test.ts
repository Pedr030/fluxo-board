import { AddressInfo } from "net";
import { Express } from "express";
import { Server } from "http";
import request from "supertest";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../app";
import { prisma } from "../prisma";
import { resetDb } from "./helpers";

/**
 * Prova de conceito do que faz o Fluxo ser "colaborativo em tempo real" e
 * não só um CRUD: duas conexões de socket de verdade, uma mutação via REST
 * (o único jeito de mutar algo — ver PROJECT_SPEC.md seção 2) e a garantia
 * de que quem está na room recebe o evento sem precisar recarregar a página.
 *
 * Diferente dos outros arquivos de teste, aqui o servidor HTTP realmente
 * escuta numa porta (efêmera — server.listen(0)), porque socket.io-client
 * precisa de uma URL de verdade pra conectar; supertest sozinho (que só
 * simula requests contra o app Express) não basta pra isso.
 */
describe("Socket.io: sincronização em tempo real", () => {
  let app: Express;
  let server: Server;
  let baseUrl: string;
  const openSockets: ClientSocket[] = [];

  beforeAll((done) => {
    const created = createApp("http://localhost:3000");
    app = created.app;
    server = created.server;
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(resetDb);

  afterEach(() => {
    while (openSockets.length) {
      openSockets.pop()?.close();
    }
  });

  async function registerAndGetToken(email: string) {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: email.split("@")[0], email, password: "senha123" });
    return res.body.token as string;
  }

  function connectClient(token: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(baseUrl, { auth: { token }, transports: ["websocket"] });
      openSockets.push(socket);
      socket.on("connect", () => resolve(socket));
      socket.on("connect_error", (err) => reject(err));
    });
  }

  function waitForEvent<T = any>(socket: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, resolve));
  }

  it("recusa a conexão sem token", async () => {
    const message = await new Promise<string>((resolve) => {
      const socket = ioClient(baseUrl, { auth: {}, transports: ["websocket"] });
      openSockets.push(socket);
      socket.on("connect_error", (err) => resolve(err.message));
      socket.on("connect", () => resolve("conectou (não devia)"));
    });
    expect(message).toBe("Token não informado");
  });

  it("card:created chega em tempo real pra quem está na room do board", async () => {
    const tokenA = await registerAndGetToken("a@teste.com");
    const boardRes = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ title: "Board" });
    const boardId = boardRes.body.board.id;

    const listRes = await request(app)
      .post(`/boards/${boardId}/lists`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ title: "Lista" });
    const listId = listRes.body.list.id;

    const tokenB = await registerAndGetToken("b@teste.com");
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ email: "b@teste.com" });

    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);

    clientA.emit("board:join", boardId);
    clientB.emit("board:join", boardId);
    await new Promise((r) => setTimeout(r, 150));

    const eventPromise = waitForEvent(clientB, "card:created");

    await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ title: "Card ao vivo" });

    const payload = await eventPromise;
    expect(payload.card.title).toBe("Card ao vivo");
  });

  it("quem não é membro do board não entra na room (não recebe os eventos)", async () => {
    const tokenOwner = await registerAndGetToken("dona@teste.com");
    const tokenOutsider = await registerAndGetToken("de-fora@teste.com");

    const boardRes = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ title: "Board privado" });
    const boardId = boardRes.body.board.id;
    const listRes = await request(app)
      .post(`/boards/${boardId}/lists`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ title: "Lista" });
    const listId = listRes.body.list.id;

    const outsider = await connectClient(tokenOutsider);
    outsider.emit("board:join", boardId); // não é membro — join deve ser ignorado
    await new Promise((r) => setTimeout(r, 150));

    let receivedSomething = false;
    outsider.on("card:created", () => {
      receivedSomething = true;
    });

    await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ title: "Card privado" });

    await new Promise((r) => setTimeout(r, 150));
    expect(receivedSomething).toBe(false);
  });

  it("board:deleted chega em tempo real pra quem está na room quando o dono exclui o board", async () => {
    const tokenOwner = await registerAndGetToken("dona@teste.com");
    const tokenMember = await registerAndGetToken("membro@teste.com");

    const boardRes = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ title: "Board" });
    const boardId = boardRes.body.board.id;

    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ email: "membro@teste.com" });

    const member = await connectClient(tokenMember);
    member.emit("board:join", boardId);
    await new Promise((r) => setTimeout(r, 150));

    const eventPromise = waitForEvent<{ boardId: string }>(member, "board:deleted");

    await request(app)
      .delete(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${tokenOwner}`);

    const payload = await eventPromise;
    expect(payload.boardId).toBe(boardId);
  });

  it("profile:updated atualiza o nome na presença ao vivo sem precisar reconectar", async () => {
    const tokenA = await registerAndGetToken("a@teste.com");
    const tokenB = await registerAndGetToken("b@teste.com");

    const boardRes = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ title: "Board" });
    const boardId = boardRes.body.board.id;
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ email: "b@teste.com" });

    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);

    clientA.emit("board:join", boardId);
    await new Promise((r) => setTimeout(r, 100));
    clientB.emit("board:join", boardId);
    await new Promise((r) => setTimeout(r, 150));

    // A troca o nome via REST (equivalente ao PATCH /me da tela de Perfil)
    // e avisa o próprio socket — B (que está vendo a presença) deve
    // receber o nome novo sem que A precise reconectar.
    await request(app)
      .patch("/me")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "A renomeada" });

    const updatePromise = waitForEvent<{ users: { name: string }[] }>(clientB, "presence:update");
    clientA.emit("profile:updated");
    const payload = await updatePromise;

    expect(payload.users.map((u) => u.name).sort()).toEqual(["A renomeada", "b"]);
  });

  it("presence:update mostra quem entrou e reflete quem saiu", async () => {
    const tokenA = await registerAndGetToken("a@teste.com");
    const tokenB = await registerAndGetToken("b@teste.com");
    const boardRes = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ title: "Board" });
    const boardId = boardRes.body.board.id;
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ email: "b@teste.com" });

    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);

    clientA.emit("board:join", boardId);
    await new Promise((r) => setTimeout(r, 100));

    const bothPresent = waitForEvent<{ users: { name: string }[] }>(clientA, "presence:update");
    clientB.emit("board:join", boardId);
    const afterJoin = await bothPresent;
    expect(afterJoin.users.map((u) => u.name).sort()).toEqual(["a", "b"]);

    const onlyOneLeft = waitForEvent<{ users: { name: string }[] }>(clientA, "presence:update");
    clientB.close();
    openSockets.splice(openSockets.indexOf(clientB), 1);
    const afterLeave = await onlyOneLeft;
    expect(afterLeave.users.map((u) => u.name)).toEqual(["a"]);
  });
});
