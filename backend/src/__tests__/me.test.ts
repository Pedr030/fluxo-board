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
