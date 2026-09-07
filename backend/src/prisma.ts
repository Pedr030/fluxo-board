import { PrismaClient } from "@prisma/client";

// Instância única do Prisma Client compartilhada pela aplicação.
// (Evita esgotar conexões com o banco em dev, com hot-reload do tsx.)
export const prisma = new PrismaClient();
