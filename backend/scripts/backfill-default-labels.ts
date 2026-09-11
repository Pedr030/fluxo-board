import { prisma } from "../src/prisma";

// Board.createBoard só passou a semear as 3 etiquetas de prioridade
// (Alta/Média/Baixa) em boards criados a partir de agora — boards que já
// existiam antes disso nunca ganham elas. Esse script preenche essa
// lacuna: pra cada board, adiciona só as etiquetas (por nome) que ainda
// não existem ali, sem duplicar nem mexer em etiquetas próprias que a
// pessoa já tenha criado. Rode uma vez local (DATABASE_URL do .env já
// aponta pro Postgres local) e de novo apontando pro banco de produção
// quando for a hora de subir essa feature lá.
const DEFAULT_LABELS = [
  { name: "Alta", color: "#ef4444" },
  { name: "Média", color: "#f97316" },
  { name: "Baixa", color: "#22c55e" },
];

async function main() {
  const boards = await prisma.board.findMany({ include: { labels: true } });
  let totalCreated = 0;

  for (const board of boards) {
    const existingNames = new Set(board.labels.map((l) => l.name));
    const missing = DEFAULT_LABELS.filter((l) => !existingNames.has(l.name));
    if (missing.length === 0) continue;

    await prisma.label.createMany({
      data: missing.map((l) => ({ ...l, boardId: board.id })),
    });
    totalCreated += missing.length;
    console.log(`Board "${board.title}" (${board.id}): +${missing.length} etiqueta(s)`);
  }

  console.log(`Pronto — ${totalCreated} etiqueta(s) criada(s) em ${boards.length} board(s) verificados.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
