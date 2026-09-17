import request from "supertest";
import jwt from "jsonwebtoken";
import { buildApp, resetDb } from "./helpers";
import { prisma } from "../prisma";
import { TOKEN_TTL_MS } from "../lib/jwt";

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

describe("requireAuth — sessão deslizante", () => {
  it("reemite o token (header X-Refreshed-Token) quando já passou da metade da validade", async () => {
    const { body } = await request(app)
      .post("/auth/register")
      .send({ name: "Ana", email: "ana@teste.com", password: "senha123" });

    // Bem menos que metade de TOKEN_TTL_MS (7 dias) — força o reemite.
    const nearExpiryToken = jwt.sign({ userId: body.user.id }, process.env.JWT_SECRET!, {
      expiresIn: "1h",
    });

    const res = await request(app).get("/boards").set("Authorization", `Bearer ${nearExpiryToken}`);

    expect(res.status).toBe(200);
    const refreshed = res.headers["x-refreshed-token"];
    expect(refreshed).toEqual(expect.any(String));
    expect(refreshed).not.toBe(nearExpiryToken);

    const decoded = jwt.verify(refreshed, process.env.JWT_SECRET!) as {
      userId: string;
      exp: number;
    };
    expect(decoded.userId).toBe(body.user.id);
    // Prazo renovado (~7 dias), não os minutos que sobravam do token antigo.
    expect(decoded.exp * 1000 - Date.now()).toBeGreaterThan(TOKEN_TTL_MS - 60_000);
  });

  it("não reemite quando o token ainda tem mais da metade da validade", async () => {
    const { body } = await request(app)
      .post("/auth/register")
      .send({ name: "Ana", email: "ana@teste.com", password: "senha123" });

    const res = await request(app).get("/boards").set("Authorization", `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    expect(res.headers["x-refreshed-token"]).toBeUndefined();
  });
});
