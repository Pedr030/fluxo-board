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

async function getActivity(token: string, boardId: string, page?: number) {
  const res = await request(app)
    .get(`/boards/${boardId}/activity`)
    .query(page ? { page } : {})
    .set("Authorization", `Bearer ${token}`);
  return res.body.activities as { summary: string; user: { name: string } | null }[];
}

async function getActivityPage(token: string, boardId: string, page?: number) {
  const res = await request(app)
    .get(`/boards/${boardId}/activity`)
    .query(page ? { page } : {})
    .set("Authorization", `Bearer ${token}`);
  return res.body as {
    activities: { id: string; summary: string }[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
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

  describe("paginação por página numerada (offset)", () => {
    it("com 50 entradas ou menos, cabe tudo na página 1 e totalPages é 1", async () => {
      const token = await registerUser("dona@teste.com");
      const boardId = await createBoard(token);
      const listId = await createList(token, boardId, "Lista");
      for (let i = 0; i < 49; i++) {
        await createCard(token, listId, `Card ${i}`);
      }
      // 49 cards + 1 lista = 50 entradas de atividade.

      const page = await getActivityPage(token, boardId);
      expect(page.activities).toHaveLength(50);
      expect(page.page).toBe(1);
      expect(page.totalCount).toBe(50);
      expect(page.totalPages).toBe(1);
    });

    it("com mais de 50 entradas, divide em páginas sem pular nem repetir nenhuma", async () => {
      const token = await registerUser("dona@teste.com");
      const boardId = await createBoard(token);
      const listId = await createList(token, boardId, "Lista");
      for (let i = 0; i < 60; i++) {
        await createCard(token, listId, `Card ${i}`);
      }
      // 60 cards + 1 lista = 61 entradas de atividade.

      const firstPage = await getActivityPage(token, boardId);
      expect(firstPage.activities).toHaveLength(50);
      expect(firstPage.totalCount).toBe(61);
      expect(firstPage.totalPages).toBe(2);

      const secondPage = await getActivityPage(token, boardId, 2);
      expect(secondPage.activities).toHaveLength(11);
      expect(secondPage.totalPages).toBe(2);

      const allIds = [...firstPage.activities, ...secondPage.activities].map((a) => a.id);
      expect(new Set(allIds).size).toBe(61);

      // Mais recente primeiro, sem furo entre as páginas: a entrada mais
      // antiga de todas (criar a lista, o primeiro evento do board) é a
      // última da última página.
      expect(secondPage.activities[secondPage.activities.length - 1].summary).toBe(
        'criou a lista "Lista"'
      );
    });

    it("página fora do intervalo devolve lista vazia, sem erro", async () => {
      const token = await registerUser("dona@teste.com");
      const boardId = await createBoard(token);
      await createList(token, boardId, "Lista");

      const page = await getActivityPage(token, boardId, 99);
      expect(page.activities).toHaveLength(0);
      expect(page.totalCount).toBe(1);
      expect(page.totalPages).toBe(1);
    });

    it("página inválida (0, negativa ou não numérica) cai pra página 1", async () => {
      const token = await registerUser("dona@teste.com");
      const boardId = await createBoard(token);
      await createList(token, boardId, "Lista");

      for (const raw of [0, -1, "abc"]) {
        const res = await request(app)
          .get(`/boards/${boardId}/activity`)
          .query({ page: raw })
          .set("Authorization", `Bearer ${token}`);
        expect(res.body.page).toBe(1);
        expect(res.body.activities).toHaveLength(1);
      }
    });
  });
});
