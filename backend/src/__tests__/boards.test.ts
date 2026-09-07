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
  return { token: res.body.token as string, user: res.body.user };
}

describe("POST /boards", () => {
  it("cria o board com o criador como OWNER", async () => {
    const { token } = await registerUser("dona@teste.com");

    const res = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Meu board" });

    expect(res.status).toBe(201);
    expect(res.body.board.title).toBe("Meu board");

    const listRes = await request(app).get("/boards").set("Authorization", `Bearer ${token}`);
    expect(listRes.body.boards).toHaveLength(1);
  });
});

describe("GET /boards (isolamento entre usuários)", () => {
  it("não mostra boards de outro usuário", async () => {
    const { token: tokenA } = await registerUser("a@teste.com");
    const { token: tokenB } = await registerUser("b@teste.com");

    await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ title: "Board da A" });

    const resB = await request(app).get("/boards").set("Authorization", `Bearer ${tokenB}`);
    expect(resB.body.boards).toHaveLength(0);
  });
});

describe("GET /boards/:id", () => {
  it("404 pra board inexistente", async () => {
    const { token } = await registerUser("a@teste.com");
    const res = await request(app).get("/boards/naoexiste").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("403 pra quem não é membro", async () => {
    const { token: tokenA } = await registerUser("a@teste.com");
    const { token: tokenB } = await registerUser("b@teste.com");

    const { body } = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ title: "Board da A" });

    const res = await request(app)
      .get(`/boards/${body.board.id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  it("devolve myRole correto pro dono", async () => {
    const { token } = await registerUser("a@teste.com");
    const { body: created } = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Board" });

    const res = await request(app)
      .get(`/boards/${created.board.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.board.myRole).toBe("OWNER");
    expect(res.body.board.lists).toEqual([]);
  });
});

describe("POST /boards/:id/invite", () => {
  it("dono convida usuário existente com sucesso", async () => {
    const { token: ownerToken } = await registerUser("dona@teste.com");
    await registerUser("convidado@teste.com");

    const { body: created } = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Board" });

    const res = await request(app)
      .post(`/boards/${created.board.id}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "convidado@teste.com" });

    expect(res.status).toBe(201);
    expect(res.body.member.role).toBe("MEMBER");

    // o convidado agora enxerga o board
    const { token: guestToken } = await request(app)
      .post("/auth/login")
      .send({ email: "convidado@teste.com", password: "senha123" })
      .then((r) => r.body);
    const guestBoards = await request(app).get("/boards").set("Authorization", `Bearer ${guestToken}`);
    expect(guestBoards.body.boards).toHaveLength(1);
  });

  it("membro comum (não-dono) não pode convidar — 403", async () => {
    const { token: ownerToken } = await registerUser("dona@teste.com");
    const { token: memberToken } = await registerUser("membro@teste.com");
    await registerUser("terceiro@teste.com");

    const { body: created } = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Board" });

    await request(app)
      .post(`/boards/${created.board.id}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "membro@teste.com" });

    const res = await request(app)
      .post(`/boards/${created.board.id}/invite`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ email: "terceiro@teste.com" });

    expect(res.status).toBe(403);
  });

  it("409 ao convidar quem já é membro, 404 pra email desconhecido", async () => {
    const { token: ownerToken } = await registerUser("dona@teste.com");
    await registerUser("convidado@teste.com");

    const { body: created } = await request(app)
      .post("/boards")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Board" });

    await request(app)
      .post(`/boards/${created.board.id}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "convidado@teste.com" });

    const duplicate = await request(app)
      .post(`/boards/${created.board.id}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "convidado@teste.com" });
    expect(duplicate.status).toBe(409);

    const unknown = await request(app)
      .post(`/boards/${created.board.id}/invite`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "fantasma@teste.com" });
    expect(unknown.status).toBe(404);
  });
});
