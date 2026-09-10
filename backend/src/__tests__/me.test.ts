import request from "supertest";
import { buildApp, resetDb } from "./helpers";
import { prisma } from "../prisma";

const app = buildApp();

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

async function registerUser(email: string, password = "senha123") {
  const res = await request(app)
    .post("/auth/register")
    .send({ name: email.split("@")[0], email, password });
  return { token: res.body.token as string, user: res.body.user };
}

describe("GET /me", () => {
  it("devolve o perfil do usuário logado, sem a senha", async () => {
    const { token, user } = await registerUser("dona@teste.com");

    const res = await request(app).get("/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("dona@teste.com");
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.password).toBeUndefined();
  });

  it("401 sem token", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /me", () => {
  it("atualiza o nome", async () => {
    const { token } = await registerUser("dona@teste.com");

    const res = await request(app)
      .patch("/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Novo Nome" });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Novo Nome");

    const check = await request(app).get("/me").set("Authorization", `Bearer ${token}`);
    expect(check.body.user.name).toBe("Novo Nome");
  });

  it("400 com nome vazio", async () => {
    const { token } = await registerUser("dona@teste.com");
    const res = await request(app)
      .patch("/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /me/password", () => {
  it("troca a senha com a senha atual correta, e permite login com a nova", async () => {
    const { token } = await registerUser("dona@teste.com", "senhaAntiga");

    const res = await request(app)
      .patch("/me/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "senhaAntiga", newPassword: "senhaNova123" });
    expect(res.status).toBe(204);

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "dona@teste.com", password: "senhaNova123" });
    expect(login.status).toBe(200);

    const oldLogin = await request(app)
      .post("/auth/login")
      .send({ email: "dona@teste.com", password: "senhaAntiga" });
    expect(oldLogin.status).toBe(401);
  });

  it("401 se a senha atual estiver errada", async () => {
    const { token } = await registerUser("dona@teste.com", "senhaAntiga");

    const res = await request(app)
      .patch("/me/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "chuta", newPassword: "senhaNova123" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /me", () => {
  it("exclui a conta e os boards em que era a única pessoa, sem precisar de resolução", async () => {
    const { token } = await registerUser("dona@teste.com");
    const board = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Board solo" });

    const res = await request(app).delete("/me").set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(204);

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "dona@teste.com", password: "senha123" });
    expect(login.status).toBe(401);

    const boardCheck = await prisma.board.findUnique({ where: { id: board.body.board.id } });
    expect(boardCheck).toBeNull();
  });

  it("400 se um board com outro membro não tem resolução", async () => {
    const { token: ownerToken } = await registerUser("dona@teste.com");
    await registerUser("membro@teste.com");
    const board = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Board compartilhado" });
    await request(app)
      .post(`/boards/${board.body.board.id}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "membro@teste.com" });

    const res = await request(app)
      .delete("/me")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(400);

    // a conta não foi excluída — login continua funcionando
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "dona@teste.com", password: "senha123" });
    expect(login.status).toBe(200);
  });

  it("resolução 'delete' exclui o board compartilhado junto com a conta", async () => {
    const { token: ownerToken } = await registerUser("dona@teste.com");
    const { token: memberToken } = await registerUser("membro@teste.com");
    const board = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Board compartilhado" });
    const boardId = board.body.board.id;
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "membro@teste.com" });

    const res = await request(app)
      .delete("/me")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ resolutions: [{ boardId, action: "delete" }] });
    expect(res.status).toBe(204);

    const memberBoards = await request(app)
      .get("/boards")
      .set("Authorization", `Bearer ${memberToken}`);
    expect(memberBoards.body.boards).toHaveLength(0);
  });

  it("resolução 'transfer' passa a posse pro membro escolhido, board continua existindo", async () => {
    const { token: ownerToken } = await registerUser("dona@teste.com");
    const { token: memberToken, user: member } = await registerUser("membro@teste.com");
    const board = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Board compartilhado" });
    const boardId = board.body.board.id;
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "membro@teste.com" });

    const res = await request(app)
      .delete("/me")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ resolutions: [{ boardId, action: "transfer", newOwnerId: member.id }] });
    expect(res.status).toBe(204);

    const check = await request(app)
      .get(`/boards/${boardId}`)
      .set("Authorization", `Bearer ${memberToken}`);
    expect(check.status).toBe(200);
    expect(check.body.board.myRole).toBe("OWNER");
    expect(check.body.board.ownerId).toBe(member.id);
  });

  it("400 ao tentar transferir pra alguém que não é membro do board", async () => {
    const { token: ownerToken } = await registerUser("dona@teste.com");
    const { user: outsider } = await registerUser("de-fora@teste.com");
    const board = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Board compartilhado" });
    const boardId = board.body.board.id;
    await registerUser("membro@teste.com");
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "membro@teste.com" });

    const res = await request(app)
      .delete("/me")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ resolutions: [{ boardId, action: "transfer", newOwnerId: outsider.id }] });
    expect(res.status).toBe(400);
  });

  it("excluir a conta também remove a participação como membro comum em board de outra pessoa", async () => {
    const { token: ownerToken } = await registerUser("dona@teste.com");
    const { token: memberToken } = await registerUser("membro@teste.com");
    const board = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Board da dona" });
    const boardId = board.body.board.id;
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "membro@teste.com" });

    const res = await request(app)
      .delete("/me")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({});
    expect(res.status).toBe(204);

    const membersCheck = await request(app)
      .get(`/boards/${boardId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(membersCheck.body.members).toHaveLength(1);
    expect(membersCheck.body.members[0].user.email).toBe("dona@teste.com");
  });
});
