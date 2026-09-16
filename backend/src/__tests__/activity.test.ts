import request from "supertest";
import { buildApp, resetDb } from "./helpers";
import { prisma } from "../prisma";

const app = buildApp();

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

async function registerUser(email: string, name?: string) {
  const res = await request(app)
    .post("/auth/register")
    .send({ name: name ?? email.split("@")[0], email, password: "senha123" });
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

async function getActivity(token: string, boardId: string) {
  const res = await request(app)
    .get(`/boards/${boardId}/activity`)
    .set("Authorization", `Bearer ${token}`);
  return res.body.activities as { summary: string; user: { name: string } | null }[];
}

describe("Histórico de atividade", () => {
  it("registra a criação de lista e card", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "A Fazer");
    await createCard(token, listId, "Comprar leite");

    const activities = await getActivity(token, boardId);
    // Mais recente primeiro.
    expect(activities.map((a) => a.summary)).toEqual([
      'criou o card "Comprar leite" na lista "A Fazer"',
      'criou a lista "A Fazer"',
    ]);
    expect(activities.every((a) => a.user?.name === "dona")).toBe(true);
  });

  it("registra mover um card entre listas, mas não reordenar dentro da mesma lista", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listA = await createList(token, boardId, "A");
    const listB = await createList(token, boardId, "B");
    const cardId = await createCard(token, listA, "Card");
    await createCard(token, listA, "Card 2");

    // reordena dentro da mesma lista — não deve gerar entrada
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ listId: listA, position: 1 });

    let activities = await getActivity(token, boardId);
    expect(activities.some((a) => a.summary.startsWith("moveu"))).toBe(false);

    // move de fato pra outra lista — deve gerar entrada
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ listId: listB, position: 0 });

    activities = await getActivity(token, boardId);
    expect(activities[0].summary).toBe('moveu o card "Card" de "A" para "B"');
  });

  it("registra excluir card e excluir lista", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    await request(app).delete(`/cards/${cardId}`).set("Authorization", `Bearer ${token}`);
    await request(app).delete(`/lists/${listId}`).set("Authorization", `Bearer ${token}`);

    const activities = await getActivity(token, boardId);
    expect(activities[0].summary).toBe('excluiu a lista "Lista"');
    expect(activities[1].summary).toBe('excluiu o card "Card"');
  });

  it("registra marcar/desmarcar um card como concluído, mas não editar título/descrição", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Card editado", description: "Nova descrição" });

    let activities = await getActivity(token, boardId);
    expect(activities.some((a) => a.summary.includes("editado"))).toBe(false);

    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ completed: true });
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ completed: false });

    activities = await getActivity(token, boardId);
    expect(activities[0].summary).toBe('reabriu o card "Card editado"');
    expect(activities[1].summary).toBe('marcou o card "Card editado" como concluído');
  });

  it("registra comentário e convite de membro", async () => {
    const token = await registerUser("dona@teste.com");
    await registerUser("membro@teste.com", "Fulano");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "membro@teste.com" });
    await request(app)
      .post(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Oi" });

    const activities = await getActivity(token, boardId);
    expect(activities[0].summary).toBe('comentou no card "Card"');
    expect(activities[1].summary).toBe("convidou Fulano pro board");
  });

  it("uma entrada de atividade sobre um card sobrevive à exclusão do card (não é uma junção viva)", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Vai sumir");

    await request(app).delete(`/cards/${cardId}`).set("Authorization", `Bearer ${token}`);

    const activities = await getActivity(token, boardId);
    expect(activities.map((a) => a.summary)).toEqual([
      'excluiu o card "Vai sumir"',
      'criou o card "Vai sumir" na lista "Lista"',
      'criou a lista "Lista"',
    ]);
  });

  it("quem não é membro do board não pode ver o histórico", async () => {
    const tokenOwner = await registerUser("dona@teste.com");
    const tokenOutsider = await registerUser("de-fora@teste.com");
    const boardId = await createBoard(tokenOwner);

    const res = await request(app)
      .get(`/boards/${boardId}/activity`)
      .set("Authorization", `Bearer ${tokenOutsider}`);
    expect(res.status).toBe(403);
  });
});
