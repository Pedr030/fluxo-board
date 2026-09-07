import request from "supertest";
import { buildApp, resetDb } from "./helpers";
import { prisma } from "../prisma";

const app = buildApp();

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /auth/register", () => {
  it("cria o usuário e devolve token + user sem o hash da senha", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Ana", email: "ana@teste.com", password: "senha123" });

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: "Ana", email: "ana@teste.com" });
    expect(res.body.user.password).toBeUndefined();
  });

  it("rejeita email duplicado com 409", async () => {
    await request(app)
      .post("/auth/register")
      .send({ name: "Ana", email: "ana@teste.com", password: "senha123" });

    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Outra Ana", email: "ana@teste.com", password: "outrasenha" });

    expect(res.status).toBe(409);
  });

  it("rejeita email inválido com 400", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Ana", email: "nao-e-email", password: "senha123" });

    expect(res.status).toBe(400);
  });

  it("rejeita senha curta com 400", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Ana", email: "ana2@teste.com", password: "123" });

    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await request(app)
      .post("/auth/register")
      .send({ name: "Ana", email: "ana@teste.com", password: "senha123" });
  });

  it("autentica com credenciais corretas", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "ana@teste.com", password: "senha123" });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it("rejeita senha errada com 401 — mesma mensagem de email inexistente", async () => {
    const wrongPassword = await request(app)
      .post("/auth/login")
      .send({ email: "ana@teste.com", password: "senhaerrada" });
    const unknownEmail = await request(app)
      .post("/auth/login")
      .send({ email: "naoexiste@teste.com", password: "qualquer" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Não pode dar pra descobrir por tentativa e erro quais emails existem.
    expect(wrongPassword.body.error).toBe(unknownEmail.body.error);
  });
});

describe("requireAuth (middleware)", () => {
  it("bloqueia sem header Authorization", async () => {
    const res = await request(app).get("/boards");
    expect(res.status).toBe(401);
  });

  it("bloqueia com token inválido", async () => {
    const res = await request(app).get("/boards").set("Authorization", "Bearer token.invalido.aqui");
    expect(res.status).toBe(401);
  });

  it("deixa passar com token válido", async () => {
    const { body } = await request(app)
      .post("/auth/register")
      .send({ name: "Ana", email: "ana@teste.com", password: "senha123" });

    const res = await request(app).get("/boards").set("Authorization", `Bearer ${body.token}`);
    expect(res.status).toBe(200);
  });
});
