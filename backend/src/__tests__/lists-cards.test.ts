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
    lists: {
      id: string;
      title: string;
      position: number;
      cards: {
        id: string;
        title: string;
        position: number;
        dueDate: string | null;
        completed: boolean;
        assignee: { id: string; name: string; avatarUrl: string | null } | null;
      }[];
    }[];
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

  it("PATCH com dueDate e completed edita o prazo do card", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card com prazo");

    const created = await getBoard(token, boardId);
    expect(created.lists[0].cards[0].dueDate).toBeNull();
    expect(created.lists[0].cards[0].completed).toBe(false);

    const res = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dueDate: "2026-12-01", completed: true });

    expect(res.status).toBe(200);
    expect(new Date(res.body.card.dueDate).toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(res.body.card.completed).toBe(true);

    const clear = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dueDate: null });

    expect(clear.status).toBe(200);
    expect(clear.body.card.dueDate).toBeNull();
    expect(clear.body.card.completed).toBe(true); // não mexe em completed se não mandar
  });

  it("400 se dueDate for uma string inválida", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    const res = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dueDate: "não é uma data" });

    expect(res.status).toBe(400);
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

describe("Cards: atribuição de responsável", () => {
  async function registerUserWithId(email: string) {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: email.split("@")[0], email, password: "senha123" });
    return { token: res.body.token as string, userId: res.body.user.id as string };
  }

  it("atribui o card a um membro do board e devolve o assignee completo", async () => {
    const owner = await registerUserWithId("dona@teste.com");
    const member = await registerUserWithId("membro@teste.com");
    const boardId = await createBoard(owner.token);
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ email: "membro@teste.com" });
    const listId = await createList(owner.token, boardId, "Lista");
    const cardId = await createCard(owner.token, listId, "Card");

    const res = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: member.userId });

    expect(res.status).toBe(200);
    expect(res.body.card.assignee).toMatchObject({ id: member.userId, name: "membro" });

    const board = await getBoard(owner.token, boardId);
    expect(board.lists[0].cards[0].assignee).toMatchObject({ id: member.userId });
  });

  it("400 ao atribuir pra alguém que não é membro do board", async () => {
    const owner = await registerUserWithId("dona@teste.com");
    const outsider = await registerUserWithId("de-fora@teste.com");
    const boardId = await createBoard(owner.token);
    const listId = await createList(owner.token, boardId, "Lista");
    const cardId = await createCard(owner.token, listId, "Card");

    const res = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: outsider.userId });

    expect(res.status).toBe(400);
  });

  it("remove a atribuição mandando assigneeId: null", async () => {
    const owner = await registerUserWithId("dona@teste.com");
    const boardId = await createBoard(owner.token);
    const listId = await createList(owner.token, boardId, "Lista");
    const cardId = await createCard(owner.token, listId, "Card");
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: owner.userId });

    const res = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: null });

    expect(res.status).toBe(200);
    expect(res.body.card.assignee).toBeNull();
  });

  it("card recém-criado nasce sem assignee", async () => {
    const owner = await registerUserWithId("dona@teste.com");
    const boardId = await createBoard(owner.token);
    const listId = await createList(owner.token, boardId, "Lista");

    const res = await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Card novo" });

    expect(res.body.card.assignee).toBeNull();
  });

  it("atribuir de novo ao mesmo responsável não duplica entrada no histórico de atividade", async () => {
    const owner = await registerUserWithId("dona@teste.com");
    const boardId = await createBoard(owner.token);
    const listId = await createList(owner.token, boardId, "Lista");
    const cardId = await createCard(owner.token, listId, "Card");

    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: owner.userId });
    // clica de novo na mesma pessoa já atribuída — não é uma mudança de verdade
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: owner.userId });

    const activityRes = await request(app)
      .get(`/boards/${boardId}/activity`)
      .set("Authorization", `Bearer ${owner.token}`);
    const assignmentEntries = activityRes.body.activities.filter((a: { summary: string }) =>
      a.summary.startsWith("atribuiu")
    );
    expect(assignmentEntries).toHaveLength(1);
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

describe("Cards: duplicar (POST /cards/:id/duplicate)", () => {
  it("cria a cópia logo depois do original, na mesma lista, reindexando quem vem depois", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Original");
    await createCard(token, listId, "Depois"); // position 1

    const dup = await request(app)
      .post(`/cards/${cardId}/duplicate`)
      .set("Authorization", `Bearer ${token}`);
    expect(dup.status).toBe(201);
    expect(dup.body.card.title).toBe("Original (cópia)");

    const board = await getBoard(token, boardId);
    const cards = board.lists[0].cards;
    expect(cards.map((c) => c.title)).toEqual(["Original", "Original (cópia)", "Depois"]);
    expect(cards.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it("copia descrição e etiquetas, mas não responsável/prazo/conclusão", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Original");

    const label = await request(app)
      .post(`/boards/${boardId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Urgente", color: "#ef4444" });
    const labelId = label.body.label.id as string;
    await request(app)
      .post(`/cards/${cardId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ labelId });
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        description: "Instruções do modelo",
        dueDate: "2026-12-25T00:00:00.000Z",
        completed: true,
      });

    const dup = await request(app)
      .post(`/cards/${cardId}/duplicate`)
      .set("Authorization", `Bearer ${token}`);
    expect(dup.body.card.description).toBe("Instruções do modelo");
    expect(dup.body.card.labelIds).toEqual([labelId]);
    expect(dup.body.card.dueDate).toBeNull();
    expect(dup.body.card.completed).toBe(false);
    expect(dup.body.card.assignee).toBeNull();
  });

  it("copia a checklist com os itens desmarcados, mesmo se o original tinha item feito", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Original");

    const item = await request(app)
      .post(`/cards/${cardId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Passo 1" });
    await request(app)
      .patch(`/checklist-items/${item.body.item.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ done: true });

    const dup = await request(app)
      .post(`/cards/${cardId}/duplicate`)
      .set("Authorization", `Bearer ${token}`);
    expect(dup.body.card.checklistItems).toHaveLength(1);
    expect(dup.body.card.checklistItems[0]).toMatchObject({ text: "Passo 1", done: false });
  });

  it("membro restrito pode duplicar card atribuído a outra pessoa (mesma regra de criar card)", async () => {
    const tokenOwner = await registerUser("dona@teste.com");
    const tokenMember = await registerUser("membro@teste.com");
    const boardId = await createBoard(tokenOwner);
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ email: "membro@teste.com" });
    const membersRes = await request(app)
      .get(`/boards/${boardId}/members`)
      .set("Authorization", `Bearer ${tokenOwner}`);
    const memberRow = membersRes.body.members.find((m: { user: { email: string } }) => m.user.email === "membro@teste.com");
    await request(app)
      .patch(`/boards/${boardId}/members/${memberRow.id}`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ restricted: true });

    const listId = await createList(tokenOwner, boardId, "Lista");
    const cardId = await createCard(tokenOwner, listId, "Card da dona");

    const dup = await request(app)
      .post(`/cards/${cardId}/duplicate`)
      .set("Authorization", `Bearer ${tokenMember}`);
    expect(dup.status).toBe(201);
  });

  it("registra a duplicação no histórico de atividade", async () => {
    const token = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Original");

    await request(app).post(`/cards/${cardId}/duplicate`).set("Authorization", `Bearer ${token}`);

    const activity = await request(app)
      .get(`/boards/${boardId}/activity`)
      .set("Authorization", `Bearer ${token}`);
    expect(activity.body.activities[0].summary).toBe('duplicou o card "Original"');
  });

  it("card inexistente devolve 404, e quem não é membro do board não pode duplicar", async () => {
    const token = await registerUser("dona@teste.com");
    const outsider = await registerUser("de-fora@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Original");

    const notFound = await request(app)
      .post(`/cards/fantasma/duplicate`)
      .set("Authorization", `Bearer ${token}`);
    expect(notFound.status).toBe(404);

    const forbidden = await request(app)
      .post(`/cards/${cardId}/duplicate`)
      .set("Authorization", `Bearer ${outsider}`);
    expect(forbidden.status).toBe(403);
  });
});
