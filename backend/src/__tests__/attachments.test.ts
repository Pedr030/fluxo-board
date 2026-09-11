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

// O upload de verdade (POST /cards/:id/attachments com multipart, indo pro
// Supabase Storage de verdade) não tem teste automatizado aqui — mesma
// decisão já tomada pro upload de avatar (ver me.test.ts): testado na mão
// no navegador, não na suíte, pra não depender de rede/Storage real a cada
// `npm test`. O que dá pra testar sem subir arquivo nenhum (autorização,
// listagem, exclusão, cascade) usa uma linha de Attachment criada direto
// via Prisma, com uma chave de objeto que nunca existiu no bucket de
// verdade — removeAttachment() já trata "objeto não existe" como sucesso
// (ver supabaseStorage.ts), então o DELETE ainda funciona sem precisar de
// upload nenhum antes.
async function seedAttachment(cardId: string, uploaderId: string) {
  return prisma.attachment.create({
    data: {
      cardId,
      uploaderId,
      filename: "print.png",
      mimeType: "image/png",
      size: 1234,
      url: "https://example.com/attachments/fake.png",
    },
  });
}

describe("Anexos", () => {
  it("lista os anexos de um card em ordem cronológica", async () => {
    const { token, userId } = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");

    await seedAttachment(cardId, userId);

    const res = await request(app)
      .get(`/cards/${cardId}/attachments`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0]).toMatchObject({ filename: "print.png" });
    expect(res.body.attachments[0].uploader).toMatchObject({ name: "dona" });
  });

  it("quem não é membro do board não pode ver os anexos", async () => {
    const { token: tokenOwner, userId } = await registerUser("dona@teste.com");
    const { token: tokenOutsider } = await registerUser("de-fora@teste.com");
    const boardId = await createBoard(tokenOwner);
    const listId = await createList(tokenOwner, boardId, "Lista");
    const cardId = await createCard(tokenOwner, listId, "Card");
    await seedAttachment(cardId, userId);

    const res = await request(app)
      .get(`/cards/${cardId}/attachments`)
      .set("Authorization", `Bearer ${tokenOutsider}`);

    expect(res.status).toBe(403);
  });

  it("só quem subiu pode excluir o próprio anexo", async () => {
    const { token: tokenOwner, userId: ownerId } = await registerUser("dona@teste.com");
    const { token: tokenMember } = await registerUser("membro@teste.com");
    const boardId = await createBoard(tokenOwner);
    await request(app)
      .post(`/boards/${boardId}/invite`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ email: "membro@teste.com" });
    const listId = await createList(tokenOwner, boardId, "Lista");
    const cardId = await createCard(tokenOwner, listId, "Card");
    const attachment = await seedAttachment(cardId, ownerId);

    const deniedDelete = await request(app)
      .delete(`/attachments/${attachment.id}`)
      .set("Authorization", `Bearer ${tokenMember}`);
    expect(deniedDelete.status).toBe(403);

    const okDelete = await request(app)
      .delete(`/attachments/${attachment.id}`)
      .set("Authorization", `Bearer ${tokenOwner}`);
    expect(okDelete.status).toBe(204);
  });

  it("excluir o card cascade-deleta os anexos dele", async () => {
    const { token, userId } = await registerUser("dona@teste.com");
    const boardId = await createBoard(token);
    const listId = await createList(token, boardId, "Lista");
    const cardId = await createCard(token, listId, "Card");
    await seedAttachment(cardId, userId);

    await request(app).delete(`/cards/${cardId}`).set("Authorization", `Bearer ${token}`);

    const orphan = await prisma.attachment.findFirst({ where: { cardId } });
    expect(orphan).toBeNull();
  });
});
