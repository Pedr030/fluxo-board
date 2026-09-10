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

async function getBoard(token: string, boardId: string) {
  const res = await request(app).get(`/boards/${boardId}`).set("Authorization", `Bearer ${token}`);
  return res.body.board as {
    lists: { id: string; title: string; position: number; cards: { id: string; title: string; position: number }[] }[];
  };
}

describe("Lists: criação e posição", () => {
  it("cada lista nova entra na próxima posição, sem reindexar as outras", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);

    await createList(token, boardId, "A Fazer");
    await createList(token, boardId, "Em Progresso");
    await createList(token, boardId, "Feito");

    const board = await getBoard(token, boardId);
    expect(board.lists.map((l) => l.title)).toEqual(["A Fazer", "Em Progresso", "Feito"]);
    expect(board.lists.map((l) => l.position)).toEqual([0, 1, 2]);
  });
});

describe("Lists: mover (PATCH /lists/:id com position)", () => {
  it("reordena as listas do board, reindexando 0..n-1 sem buracos", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);

    const idA = await createList(token, boardId, "A Fazer");
    await createList(token, boardId, "Em Progresso");
    const idC = await createList(token, boardId, "Feito");

    // Move "A Fazer" (posição 0) pro final (posição 2)
    const res = await request(app)
      .patch(`/lists/${idA}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ position: 2 });
    expect(res.status).toBe(204);

    const board = await getBoard(token, boardId);
    expect(board.lists.map((l) => l.title)).toEqual(["Em Progresso", "Feito", "A Fazer"]);
    expect(board.lists.map((l) => l.position)).toEqual([0, 1, 2]);
    expect(board.lists.map((l) => l.id)).toEqual([
      board.lists.find((l) => l.title === "Em Progresso")!.id,
      idC,
      idA,
    ]);
  });

  it("400 se não mandar nem title nem position", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "A Fazer");

    const res = await request(app)
      .patch(`/lists/${listId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("Cards: mover (PATCH /cards/:id)", () => {
  it("reordena dentro da mesma lista", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const card1 = await createCard(token, listId, "Um");
    const card2 = await createCard(token, listId, "Dois");
    await createCard(token, listId, "Três");

    // move "Dois" (position 1) pra position 0 — deve ficar Dois, Um, Três
    await request(app)
      .patch(`/cards/${card2}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ listId, position: 0 });

    const board = await getBoard(token, boardId);
    const cards = board.lists[0].cards;
    expect(cards.map((c) => c.title)).toEqual(["Dois", "Um", "Três"]);
    expect(cards.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(cards.find((c) => c.id === card1)?.position).toBe(1);
  });

  it("move entre listas e reindexa origem e destino", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listA = await createList(token, boardId, "A");
    const listB = await createList(token, boardId, "B");
    const cardA1 = await createCard(token, listA, "A1");
    const cardA2 = await createCard(token, listA, "A2");
    await createCard(token, listB, "B1");

    // move A1 (position 0 em A) pro início de B
    await request(app)
      .patch(`/cards/${cardA1}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ listId: listB, position: 0 });

    const board = await getBoard(token, boardId);
    const [resultA, resultB] = board.lists;

    // A perdeu o card e reindexou — A2 agora é o único, position 0
    expect(resultA.cards.map((c) => c.title)).toEqual(["A2"]);
    expect(resultA.cards[0].position).toBe(0);
    expect(resultA.cards[0].id).toBe(cardA2);

    // B ganhou o card na posição pedida, sem duplicar position com B1
    expect(resultB.cards.map((c) => c.title)).toEqual(["A1", "B1"]);
    expect(resultB.cards.map((c) => c.position)).toEqual([0, 1]);
  });

  it("400 ao mover pra lista de outro board", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId1 = await createBoard(token, "Board 1");
    const boardId2 = await createBoard(token, "Board 2");
    const listId1 = await createList(token, boardId1, "Lista 1");
    const listId2 = await createList(token, boardId2, "Lista 2");
    const cardId = await createCard(token, listId1, "Card");

    const res = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ listId: listId2, position: 0 });

    expect(res.status).toBe(400);
  });
});

describe("Cards: editar e excluir", () => {
  it("PATCH só com title edita sem mexer em position/listId", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Original");

    const res = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Editado" });

    expect(res.status).toBe(200);
    expect(res.body.card.title).toBe("Editado");
    expect(res.body.card.position).toBe(0);
  });

  it("excluir reindexa a lista — sem buraco, sem position duplicada na próxima criação", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const card1 = await createCard(token, listId, "Um");
    const card2 = await createCard(token, listId, "Dois");
    await createCard(token, listId, "Três"); // position 2

    // exclui o do meio (position 1)
    const del = await request(app).delete(`/cards/${card2}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const afterDelete = await getBoard(token, boardId);
    expect(afterDelete.lists[0].cards.map((c) => c.position)).toEqual([0, 1]);

    // cria mais um card — não pode colidir com a position 1 que já existe
    const newCardId = await createCard(token, listId, "Quatro");
    const final = await getBoard(token, boardId);
    const positions = final.lists[0].cards.map((c) => c.position);
    expect(new Set(positions).size).toBe(positions.length); // todas únicas
    expect(final.lists[0].cards.find((c) => c.id === newCardId)?.position).toBe(2);
    expect(final.lists[0].cards.map((c) => c.id)).toContain(card1);
  });
});

describe("Lists: editar e excluir", () => {
  it("renomeia a lista", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Nome Velho");

    const res = await request(app)
      .patch(`/lists/${listId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Nome Novo" });

    expect(res.status).toBe(200);
    expect(res.body.list.title).toBe("Nome Novo");
  });

  it("excluir lista cascade-deleta os cards e reindexa as listas restantes", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listA = await createList(token, boardId, "A"); // position 0
    const listB = await createList(token, boardId, "B"); // position 1
    await createList(token, boardId, "C"); // position 2
    await createCard(token, listB, "Card em B");

    const del = await request(app).delete(`/lists/${listB}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const board = await getBoard(token, boardId);
    expect(board.lists.map((l) => l.title)).toEqual(["A", "C"]);
    expect(board.lists.map((l) => l.position)).toEqual([0, 1]);

    const orphanCard = await prisma.card.findFirst({ where: { listId: listB } });
    expect(orphanCard).toBeNull();
    expect(board.lists[0].id).toBe(listA);
  });
});
