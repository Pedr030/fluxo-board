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

describe("Checklist", () => {
  it("cria itens em sequência (position 0..n-1) e eles aparecem no GET /boards/:id", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Primeiro" });
    await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Segundo" });

    const board = await request(app)
      .get(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${token}`);
    const items = board.body.board.lists[0].cards[0].checklistItems;
    expect(items.map((i: { text: string }) => i.text)).toEqual(["Primeiro", "Segundo"]);
    expect(items.map((i: { position: number }) => i.position)).toEqual([0, 1]);
    expect(items.every((i: { done: boolean }) => i.done === false)).toBe(true);
  });

  it("400 com texto vazio", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    const res = await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "" });
    expect(res.status).toBe(400);
  });

  it("marca um item como feito", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");
    const created = await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Fazer x" });
    const itemId = created.body.item.id;

    const res = await request(app)
      .patch(`/checklist-items/${itemId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ done: true });

    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ text: "Fazer x", done: true });
  });

  it("qualquer membro do board (não só quem criou) marca/edita um item", async () => {
    const tokenOwner = await registerUser("dona@teste.com");
    const tokenMember = await registerUser("membro@teste.com");
    const boardId = await createBoard(tokenOwner);
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ email: "membro@teste.com" });
    const listId = await createList(tokenOwner, boardId, "Lista");
    const cardId = await createCard(tokenOwner, listId, "Card");
    const created = await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ text: "Tarefa do time" });

    const res = await request(app)
      .patch(`/checklist-items/${created.body.item.id}`)
      .set("Authorization", `Bearer ${tokenMember}`)
      .send({ done: true });

    expect(res.status).toBe(200);
  });

  it("quem não é membro do board não pode criar nem editar item", async () => {
    const tokenOwner = await registerUser("dona@teste.com");
    const tokenOutsider = await registerUser("de-fora@teste.com");
    const boardId = await createBoard(tokenOwner);
    const listId = await createList(tokenOwner, boardId, "Lista");
    const cardId = await createCard(tokenOwner, listId, "Card");

    const createRes = await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${tokenOutsider}`)
      .send({ text: "Não devia dar certo" });
    expect(createRes.status).toBe(403);
  });

  it("excluir um item reindexa os restantes (fecha o buraco de position)", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");
    const item1 = await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Um" });
    const item2 = await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Dois" });
    await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Três" });

    const del = await request(app)
      .delete(`/checklist-items/${item2.body.item.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const board = await request(app)
      .get(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${token}`);
    const items = board.body.board.lists[0].cards[0].checklistItems;
    expect(items.map((i: { text: string }) => i.text)).toEqual(["Um", "Três"]);
    expect(items.map((i: { position: number }) => i.position)).toEqual([0, 1]);
    expect(items.find((i: { id: string }) => i.id === item1.body.item.id)).toBeDefined();
  });

  it("excluir o card cascade-deleta os itens da checklist dele", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");
    await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Vai sumir junto" });

    await request(app).delete(`/cards/${cardId}`).set("Authorization", `Bearer ${token}`);

    const orphan = await prisma.checklistItem.findFirst({ where: { cardId } });
    expect(orphan).toBeNull();
  });
});
