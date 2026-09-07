import { prisma } from "../prisma";
import { createApp } from "../app";

/**
 * Limpa as tabelas entre testes — na ordem certa por causa das FKs (Card
 * depende de List, List de Board, BoardMember de Board+User). Roda antes de
 * cada teste (não depois) pra deixar o banco inspecionável se um teste falhar.
 */
export async function resetDb() {
  await prisma.card.deleteMany();
  await prisma.list.deleteMany();
  await prisma.boardMember.deleteMany();
  await prisma.board.deleteMany();
  await prisma.user.deleteMany();
}

export function buildApp() {
  return createApp("http://localhost:3000").app;
}
