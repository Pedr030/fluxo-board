import request from "supertest";
import { buildApp, resetDb } from "./helpers";
import { prisma } from "../prisma";

const app = buildApp();

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

async function registerUser(email: string) {
  const res = await request(app)
    .post("/auth/register")
    .send({ name: email.split("@")[0], email, password: "senha123" });
  return res.body.token as string;
}

async function createBoard(token: string, title = "Board") {
  const res = await request(app).post("/boards").set("Authorization", `Bearer ${token}`).send({ title });
  return res.body.board.id as string;
}

async function createList(token: string, boardId: string, title: string) {
  const res = await request(app)
    .post(`/boards/${boardId}/lists`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title });
  return res.body.list.id as string;
}

async function createCard(token: string, listId: string, title: string) {
  const res = await request(app)
    .post(`/lists/${listId}/cards`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title });
  return res.body.card.id as string;
}

async function createLabel(token: string, boardId: string, name: string, color = "#3b82f6") {
  const res = await request(app)
    .post(`/boards/${boardId}/labels`)
    .set("Authorization", `Bearer ${token}`)
    .send({ name, color });
  return res.body.label.id as string;
}

describe("Etiquetas", () => {
  it("todo board novo já nasce com as 3 etiquetas de prioridade (Alta/Média/Baixa)", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);

    const board = await request(app)
      .get(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(board.body.board.labels).toEqual([
      expect.objectContaining({ name: "Alta", color: "#ef4444" }),
      expect.objectContaining({ name: "Média", color: "#f97316" }),
      expect.objectContaining({ name: "Baixa", color: "#22c55e" }),
    ]);
  });

  it("cria uma etiqueta e ela aparece na paleta do board", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);

    const res = await request(app)
      .post(`/boards/${boardId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Urgente", color: "#ef4444" });
    expect(res.status).toBe(201);

    const board = await request(app)
      .get(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(board.body.board.labels).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Urgente", color: "#ef4444" })])
    );
  });

  it("edita nome/cor de uma etiqueta existente", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const labelId = await createLabel(token, boardId, "Bug", "#ef4444");

    const res = await request(app)
      .patch(`/labels/${labelId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ color: "#22c55e" });

    expect(res.status).toBe(200);
    expect(res.body.label).toMatchObject({ name: "Bug", color: "#22c55e" });
  });

  it("quem não é membro do board não pode criar nem editar etiqueta", async () => {
    const tokenOwner = await registerUser("dona@teste.com");
    const tokenOutsider = await registerUser("de-fora@teste.com");
    const boardId = await createBoard(tokenOwner);
    const labelId = await createLabel(tokenOwner, boardId, "Bug");

    const createRes = await request(app)
      .post(`/boards/${boardId}/labels`)
      .set("Authorization", `Bearer ${tokenOutsider}`)
      .send({ name: "Intruso", color: "#000000" });
    expect(createRes.status).toBe(403);

    const editRes = await request(app)
      .patch(`/labels/${labelId}`)
      .set("Authorization", `Bearer ${tokenOutsider}`)
      .send({ color: "#000000" });
    expect(editRes.status).toBe(403);
  });

  it("aplica e remove uma etiqueta de um card", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");
    const labelId = await createLabel(token, boardId, "Bug");

    const attach = await request(app)
      .post(`/cards/${cardId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ labelId });
    expect(attach.status).toBe(204);

    const board = await request(app)
      .get(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${token}`);
    const card = board.body.board.lists[0].cards[0];
    expect(card.labelIds).toEqual([labelId]);

    const detach = await request(app)
      .delete(`/cards/${cardId}/labels/${labelId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detach.status).toBe(204);

    const boardAfter = await request(app)
      .get(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(boardAfter.body.board.lists[0].cards[0].labelIds).toEqual([]);
  });

  it("aplicar a mesma etiqueta duas vezes é idempotente (não duplica)", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");
    const labelId = await createLabel(token, boardId, "Bug");

    await request(app)
      .post(`/cards/${cardId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ labelId });
    const second = await request(app)
      .post(`/cards/${cardId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ labelId });
    expect(second.status).toBe(204);

    const board = await request(app)
      .get(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(board.body.board.lists[0].cards[0].labelIds).toEqual([labelId]);
  });

  it("excluir a etiqueta remove a associação de todos os cards que a usavam", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");
    const labelId = await createLabel(token, boardId, "Bug");
    await request(app)
      .post(`/cards/${cardId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ labelId });

    const del = await request(app)
      .delete(`/labels/${labelId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const orphan = await prisma.cardLabel.findFirst({ where: { labelId } });
    expect(orphan).toBeNull();

    const board = await request(app)
      .get(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(board.body.board.labels.map((l: { id: string }) => l.id)).not.toContain(labelId);
    expect(board.body.board.lists[0].cards[0].labelIds).toEqual([]);
  });

  it("não deixa aplicar uma etiqueta de outro board", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId1 = await createBoard(token, "Board 1");
    const boardId2 = await createBoard(token, "Board 2");
    const listId = await createList(token, boardId1, "Lista");
    const cardId = await createCard(token, listId, "Card");
    const labelIdFromOtherBoard = await createLabel(token, boardId2, "De outro board");

    const res = await request(app)
      .post(`/cards/${cardId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ labelId: labelIdFromOtherBoard });

    expect(res.status).toBe(404);
  });
});
