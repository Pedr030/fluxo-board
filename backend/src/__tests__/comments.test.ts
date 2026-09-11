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

describe("Comentários", () => {
  it("cria um comentário e devolve junto o autor (nome/avatar)", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    const res = await request(app)
      .post(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Primeiro comentário" });

    expect(res.status).toBe(201);
    expect(res.body.comment.text).toBe("Primeiro comentário");
    expect(res.body.comment.author).toMatchObject({ name: "dona" });
  });

  it("400 com texto vazio", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    const res = await request(app)
      .post(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "" });

    expect(res.status).toBe(400);
  });

  it("lista os comentários em ordem cronológica", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    await request(app)
      .post(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Primeiro" });
    await request(app)
      .post(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Segundo" });

    const res = await request(app)
      .get(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.comments.map((c: { text: string }) => c.text)).toEqual(["Primeiro", "Segundo"]);
  });

  it("quem não é membro do board não pode ver nem criar comentário", async () => {
    const tokenOwner = await registerUser("dona@teste.com");
    const tokenOutsider = await registerUser("de-fora@teste.com");
    const boardId = await createBoard(tokenOwner);
    const listId = await createList(tokenOwner, boardId, "Lista");
    const cardId = await createCard(tokenOwner, listId, "Card");

    const getRes = await request(app)
      .get(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${tokenOutsider}`);
    expect(getRes.status).toBe(403);

    const postRes = await request(app)
      .post(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${tokenOutsider}`)
      .send({ text: "Não devia dar certo" });
    expect(postRes.status).toBe(403);
  });

  it("só o autor pode excluir o próprio comentário", async () => {
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
      .post(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ text: "Comentário da dona" });
    const commentId = created.body.comment.id;

    const deniedDelete = await request(app)
      .delete(`/comments/${commentId}`)
      .set("Authorization", `Bearer ${tokenMember}`);
    expect(deniedDelete.status).toBe(403);

    const okDelete = await request(app)
      .delete(`/comments/${commentId}`)
      .set("Authorization", `Bearer ${tokenOwner}`);
    expect(okDelete.status).toBe(204);
  });

  it("excluir o card cascade-deleta os comentários dele", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    await request(app)
      .post(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Vai sumir junto" });

    await request(app).delete(`/cards/${cardId}`).set("Authorization", `Bearer ${token}`);

    const orphan = await prisma.comment.findFirst({ where: { cardId } });
    expect(orphan).toBeNull();
  });
});
