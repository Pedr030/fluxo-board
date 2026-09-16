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
  return { token: res.body.token as string, userId: res.body.user.id as string };
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

async function invite(ownerToken: string, boardId: string, email: string) {
  const res = await request(app)
    .post(`/boards/${boardId}/invite`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ email });
  return res.body.member.id as string;
}

describe("PATCH /boards/:id/members/:memberId — gerenciar cargo e restrição", () => {
  it("dono promove um membro a admin", async () => {
    const owner = await registerUser("dona@teste.com");
    const member = await registerUser("membro@teste.com");
    const boardId = await createBoard(owner.token);
    const memberId = await invite(owner.token, boardId, "membro@teste.com");

    const res = await request(app)
      .patch(`/boards/${boardId}/members/${memberId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "ADMIN" });

    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ role: "ADMIN", restricted: false, userId: member.userId });
  });

  it("promover a admin limpa a restrição, mesmo que estivesse restrito antes", async () => {
    const owner = await registerUser("dona@teste.com");
    await registerUser("membro@teste.com");
    const boardId = await createBoard(owner.token);
    const memberId = await invite(owner.token, boardId, "membro@teste.com");
    await request(app)
      .patch(`/boards/${boardId}/members/${memberId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ restricted: true });

    const res = await request(app)
      .patch(`/boards/${boardId}/members/${memberId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "ADMIN" });

    expect(res.body.member.restricted).toBe(false);
  });

  it("400 ao tentar restringir alguém que é (ou vai virar) admin", async () => {
    const owner = await registerUser("dona@teste.com");
    await registerUser("membro@teste.com");
    const boardId = await createBoard(owner.token);
    const memberId = await invite(owner.token, boardId, "membro@teste.com");
    await request(app)
      .patch(`/boards/${boardId}/members/${memberId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "ADMIN" });

    const res = await request(app)
      .patch(`/boards/${boardId}/members/${memberId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ restricted: true });

    expect(res.status).toBe(400);
  });

  it("400 ao tentar mudar o cargo do próprio dono", async () => {
    const owner = await registerUser("dona@teste.com");
    const boardId = await createBoard(owner.token);
    const membersRes = await request(app)
      .get(`/boards/${boardId}/members`)
      .set("Authorization", `Bearer ${owner.token}`);
    const ownerMemberId = membersRes.body.members[0].id;

    const res = await request(app)
      .patch(`/boards/${boardId}/members/${ownerMemberId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "ADMIN" });

    expect(res.status).toBe(400);
  });

  it("membro comum (não-dono) não pode gerenciar cargo/restrição de ninguém — 403", async () => {
    const owner = await registerUser("dona@teste.com");
    const memberA = await registerUser("membro-a@teste.com");
    await registerUser("membro-b@teste.com");
    const boardId = await createBoard(owner.token);
    await invite(owner.token, boardId, "membro-a@teste.com");
    const memberBId = await invite(owner.token, boardId, "membro-b@teste.com");

    const res = await request(app)
      .patch(`/boards/${boardId}/members/${memberBId}`)
      .set("Authorization", `Bearer ${memberA.token}`)
      .send({ restricted: true });

    expect(res.status).toBe(403);
  });

  it("admin promovido pelo dono pode convidar novos membros", async () => {
    const owner = await registerUser("dona@teste.com");
    const admin = await registerUser("admin@teste.com");
    await registerUser("novo@teste.com");
    const boardId = await createBoard(owner.token);
    const adminMemberId = await invite(owner.token, boardId, "admin@teste.com");
    await request(app)
      .patch(`/boards/${boardId}/members/${adminMemberId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "ADMIN" });

    const res = await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: "novo@teste.com" });

    expect(res.status).toBe(201);
  });

  it("promover/restringir vira entrada no histórico de atividade", async () => {
    const owner = await registerUser("dona@teste.com");
    await registerUser("membro@teste.com");
    const boardId = await createBoard(owner.token);
    const memberId = await invite(owner.token, boardId, "membro@teste.com");

    await request(app)
      .patch(`/boards/${boardId}/members/${memberId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ restricted: true });

    const activityRes = await request(app)
      .get(`/boards/${boardId}/activity`)
      .set("Authorization", `Bearer ${owner.token}`);
    expect(activityRes.body.activities[0].summary).toBe("restringiu membro aos próprios cards");
  });
});

describe("Membro restrito ('restricted') só edita/move/exclui os próprios cards", () => {
  async function setupRestrictedMember() {
    const owner = await registerUser("dona@teste.com");
    const member = await registerUser("membro@teste.com");
    const boardId = await createBoard(owner.token);
    const memberId = await invite(owner.token, boardId, "membro@teste.com");
    await request(app)
      .patch(`/boards/${boardId}/members/${memberId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ restricted: true });
    return { owner, member, boardId };
  }

  it("edita e move um card atribuído a si mesmo", async () => {
    const { owner, member, boardId } = await setupRestrictedMember();
    const listA = await createList(owner.token, boardId, "A");
    const listB = await createList(owner.token, boardId, "B");
    const cardId = await createCard(owner.token, listA, "Card");
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: member.userId });

    const editRes = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ title: "Editado pelo restrito" });
    expect(editRes.status).toBe(200);

    const moveRes = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ listId: listB, position: 0 });
    expect(moveRes.status).toBe(200);
  });

  it("edita e exclui um card sem responsável nenhum (livre pra pegar)", async () => {
    const { member, owner, boardId } = await setupRestrictedMember();
    const listId = await createList(owner.token, boardId, "Lista");
    const cardId = await createCard(owner.token, listId, "Card livre");

    const editRes = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ title: "Peguei essa" });
    expect(editRes.status).toBe(200);

    const delRes = await request(app)
      .delete(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(delRes.status).toBe(204);
  });

  it("403 ao tentar editar, mover ou excluir um card atribuído a outra pessoa", async () => {
    const { owner, member, boardId } = await setupRestrictedMember();
    const listA = await createList(owner.token, boardId, "A");
    const listB = await createList(owner.token, boardId, "B");
    const cardId = await createCard(owner.token, listA, "Card da dona");
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: owner.userId });

    const editRes = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ title: "Não devia dar certo" });
    expect(editRes.status).toBe(403);

    const moveRes = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ listId: listB, position: 0 });
    expect(moveRes.status).toBe(403);

    const delRes = await request(app)
      .delete(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(delRes.status).toBe(403);
  });

  it("continua podendo criar cards e comentar em card de outra pessoa", async () => {
    const { owner, member, boardId } = await setupRestrictedMember();
    const listId = await createList(owner.token, boardId, "Lista");
    const cardId = await createCard(owner.token, listId, "Card da dona");
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: owner.userId });

    const createRes = await request(app)
      .post(`/lists/${listId}/cards`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ title: "Card novo do restrito" });
    expect(createRes.status).toBe(201);

    const commentRes = await request(app)
      .post(`/cards/${cardId}/comments`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ text: "Posso comentar mesmo não sendo meu" });
    expect(commentRes.status).toBe(201);
  });

  it("admin e membro não-restrito continuam sem nenhuma limitação", async () => {
    const owner = await registerUser("dona@teste.com");
    const boardId = await createBoard(owner.token);
    const listId = await createList(owner.token, boardId, "Lista");
    const cardId = await createCard(owner.token, listId, "Card");
    await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ assigneeId: owner.userId });

    // outro board member, sem restricted, mexendo num card que não é dele
    const other = await registerUser("outro@teste.com");
    await invite(owner.token, boardId, "outro@teste.com");

    const res = await request(app)
      .patch(`/cards/${cardId}`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ title: "Sem restrição, pode editar" });
    expect(res.status).toBe(200);
  });
});
