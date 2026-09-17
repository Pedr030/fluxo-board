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

async function createTemplate(token: string, boardId: string, title: string) {
  const res = await request(app)
    .post(`/boards/${boardId}/templates`)
    .set("Authorization", `Bearer ${token}`)
    .send({ title });
  return res.body.card as { id: string; title: string };
}

async function getBoard(token: string, boardId: string) {
  const res = await request(app).get(`/boards/${boardId}`).set("Authorization", `Bearer ${token}`);
  return res.body.board as {
    lists: {
      id: string;
      title: string;
      position: number;
      isTemplatesList: boolean;
      cards: { id: string; title: string; description: string | null; labelIds: string[] }[];
    }[];
  };
}

describe("Modelos de card (POST /boards/:id/templates)", () => {
  it("cria a lista especial 'Modelos' sob demanda, na primeira vez", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);

    const board = await getBoard(token, boardId);
    expect(board.lists).toHaveLength(0);

    const template = await createTemplate(token, boardId, "Relatório semanal");
    expect(template.title).toBe("Relatório semanal");

    const boardAfter = await getBoard(token, boardId);
    expect(boardAfter.lists).toHaveLength(1);
    expect(boardAfter.lists[0].isTemplatesList).toBe(true);
    expect(boardAfter.lists[0].cards.map((c) => c.title)).toEqual(["Relatório semanal"]);
  });

  it("segundo modelo entra na mesma lista de modelos, não cria outra", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);

    await createTemplate(token, boardId, "Modelo 1");
    await createTemplate(token, boardId, "Modelo 2");

    const board = await getBoard(token, boardId);
    const templateLists = board.lists.filter((l) => l.isTemplatesList);
    expect(templateLists).toHaveLength(1);
    expect(templateLists[0].cards.map((c) => c.title)).toEqual(["Modelo 1", "Modelo 2"]);
  });

  it("a lista de modelos não atrapalha a position das listas normais", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);

    await createTemplate(token, boardId, "Modelo 1"); // cria a lista "Modelos" antes de qualquer lista normal
    const listA = await createList(token, boardId, "A");
    await createList(token, boardId, "B");

    const board = await getBoard(token, boardId);
    const normalLists = board.lists.filter((l) => !l.isTemplatesList);
    expect(normalLists.map((l) => l.title)).toEqual(["A", "B"]);
    expect(normalLists.map((l) => l.position)).toEqual([0, 1]);

    // Excluir uma lista normal reindexa só as normais, sem mexer na de modelos.
    await request(app).delete(`/lists/${listA}`).set("Authorization", `Bearer ${token}`);
    const boardAfter = await getBoard(token, boardId);
    const normalAfter = boardAfter.lists.filter((l) => !l.isTemplatesList);
    expect(normalAfter.map((l) => l.title)).toEqual(["B"]);
    expect(normalAfter.map((l) => l.position)).toEqual([0]);
    expect(boardAfter.lists.some((l) => l.isTemplatesList)).toBe(true);
  });

  it("quem não é membro do board não pode criar modelo", async () => {
    const token = await registerUser("dona@teste.com");
    const outsider = await registerUser("de-fora@teste.com");
    const boardId = await createBoard(token);

    const res = await request(app)
      .post(`/boards/${boardId}/templates`)
      .set("Authorization", `Bearer ${outsider}`)
      .send({ title: "Modelo" });
    expect(res.status).toBe(403);
  });
});

describe("Criar card a partir de modelo (POST /lists/:id/cards com fromTemplateId)", () => {
  it("copia título/descrição/etiquetas/checklist do modelo, sem sufixo, no fim da lista", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const template = await createTemplate(token, boardId, "Relatório semanal");

    const label = await request(app)
      .post(`/boards/${boardId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Recorrente", color: "#3b82f6" });
    const labelId = label.body.label.id as string;
    await request(app)
      .post(`/cards/${template.id}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ labelId });
    await request(app)
      .patch(`/cards/${template.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "Preencher os números da semana" });
    await request(app)
      .post(`/cards/${template.id}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Coletar métricas" });

    const listId = await createList(token, boardId, "A fazer");
    await createList(token, boardId, "Depois"); // só pra garantir que o card entra em "A fazer", não no fim do board

    const res = await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${token}`)
      .send({ fromTemplateId: template.id });
    expect(res.status).toBe(201);
    expect(res.body.card.title).toBe("Relatório semanal");
    expect(res.body.card.description).toBe("Preencher os números da semana");
    expect(res.body.card.labelIds).toEqual([labelId]);
    expect(res.body.card.checklistItems).toHaveLength(1);
    expect(res.body.card.checklistItems[0]).toMatchObject({ text: "Coletar métricas", done: false });
  });

  it("404 se o id não for um modelo (card comum) ou não existir", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const realCard = await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Card comum" });

    const usingRealCard = await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${token}`)
      .send({ fromTemplateId: realCard.body.card.id });
    expect(usingRealCard.status).toBe(404);

    const usingFakeId = await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${token}`)
      .send({ fromTemplateId: "fantasma" });
    expect(usingFakeId.status).toBe(404);
  });

  it("404 se o modelo for de outro board", async () => {
    const token = await registerUser("dona@teste.com");
    const boardA = await createBoard(token, "Board A");
    const boardB = await createBoard(token, "Board B");
    const template = await createTemplate(token, boardA, "Modelo do board A");
    const listB = await createList(token, boardB, "Lista");

    const res = await request(app)
      .post(`/lists/${listB}/cards`)
      .set("Authorization", `Bearer ${token}`)
      .send({ fromTemplateId: template.id });
    expect(res.status).toBe(404);
  });

  it("400 se mandar title e fromTemplateId juntos, ou nenhum dos dois", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const template = await createTemplate(token, boardId, "Modelo");
    const listId = await createList(token, boardId, "Lista");

    const both = await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "X", fromTemplateId: template.id });
    expect(both.status).toBe(400);

    const neither = await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(neither.status).toBe(400);
  });
});
