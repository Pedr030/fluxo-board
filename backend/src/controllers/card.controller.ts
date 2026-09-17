import { ChecklistItem } from "@prisma/client";
import { Response } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { logActivity } from "../lib/activity";
import { canEditCard, getBoardMembership, isBoardMember } from "../lib/authorization";
import { attachmentObjectKey, removeAttachment } from "../lib/supabaseStorage";

const createCardSchema = z
  .object({
    title: z.string().min(1).optional(),
    // Alternativa a `title`: cria o card copiando de um card-modelo da aba
    // "Modelos" (ver comentário em createCard). Mutuamente exclusivo com
    // `title` — o próprio título vem do modelo.
    fromTemplateId: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.title) !== Boolean(data.fromTemplateId), {
    message: "Informe exatamente um entre title e fromTemplateId",
  });

const assigneeSelect = { id: true, name: true, avatarUrl: true };

// Card + cardLabels (join) -> card + labelIds (achatado). Usado sempre que
// um endpoint devolve um card inteiro via socket — o evento substitui o
// card por completo no estado do frontend (mesma regra de ouro do resto
// do app), então esquecer de incluir labelIds aqui apagaria as etiquetas
// da tela até o próximo reload, mesmo elas continuando no banco.
function withLabelIds<T extends { cardLabels: { labelId: string }[] }>(card: T) {
  const { cardLabels, ...rest } = card;
  return { ...rest, labelIds: cardLabels.map((cl) => cl.labelId) };
}

// Monta o pedaço de `data` do prisma.card.create que copia o conteúdo de
// outro card (descrição, etiquetas, checklist com itens desmarcados) —
// compartilhado por criar-a-partir-de-modelo e duplicar (abaixo). Nunca
// copia responsável/prazo/conclusão/comentários/anexos: são específicos
// do card de origem, não fazem sentido "herdados" por uma cópia.
function copyCardContent(source: {
  description: string | null;
  cardLabels: { labelId: string }[];
  checklistItems: { text: string }[];
}) {
  return {
    description: source.description,
    cardLabels: { create: source.cardLabels.map(({ labelId }) => ({ labelId })) },
    checklistItems: {
      create: source.checklistItems.map((item, index) => ({
        text: item.text,
        done: false,
        position: index,
      })),
    },
  };
}

/**
 * POST /lists/:id/cards  { title: string } ou { fromTemplateId: string }
 * Cria um card no fim da lista — position = quantidade de cards
 * existentes na lista. Com `fromTemplateId`, copia título/descrição/
 * etiquetas/checklist de um card-modelo da aba "Modelos" desse mesmo
 * board (404 se o id não existe, não é um modelo, ou é modelo de outro
 * board) em vez de usar `title` direto — é o mesmo mecanismo de cópia do
 * duplicateCard, só que o destino é uma lista qualquer (sempre no fim,
 * não logo depois de um card específico) e o título não ganha sufixo
 * "(cópia)": é pra ser um card novo de verdade, não uma cópia do modelo.
 */
export async function createCard(req: AuthRequest, res: Response) {
  const parsed = createCardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const listId = req.params.id;

  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(list.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  let title = parsed.data.title;
  let template: Awaited<ReturnType<typeof fetchTemplate>> = null;

  if (parsed.data.fromTemplateId) {
    template = await fetchTemplate(parsed.data.fromTemplateId);
    if (!template || !template.list.isTemplatesList || template.list.boardId !== list.boardId) {
      return res.status(404).json({ error: "Modelo não encontrado" });
    }
    title = template.title;
  }

  const position = await prisma.card.count({ where: { listId } });
  const card = await prisma.card.create({
    data: {
      title: title!,
      listId,
      position,
      creatorId: req.userId,
      ...(template ? copyCardContent(template) : {}),
    },
    include: {
      cardLabels: { select: { labelId: true } },
      checklistItems: { orderBy: { position: "asc" } },
      assignee: { select: assigneeSelect },
    },
  });
  const cardWithLabels = withLabelIds(card);

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("card:created", { card: cardWithLabels });
  await logActivity(
    io,
    list.boardId,
    req.userId,
    template
      ? `criou o card "${card.title}" a partir de um modelo, na lista "${list.title}"`
      : `criou o card "${card.title}" na lista "${list.title}"`
  );

  return res.status(201).json({ card: cardWithLabels });
}

function fetchTemplate(id: string) {
  return prisma.card.findUnique({
    where: { id },
    include: {
      cardLabels: { select: { labelId: true } },
      checklistItems: { orderBy: { position: "asc" } },
      list: { select: { boardId: true, isTemplatesList: true } },
    },
  });
}

/**
 * POST /cards/:id/duplicate
 * Cria uma cópia do card logo depois dele na mesma lista — copia título
 * (com sufixo "(cópia)"), descrição, etiquetas e checklist (itens
 * desmarcados, mesmo se o original já tivesse algum feito). Não copia
 * comentários, anexos, responsável, prazo nem o estado de concluído — são
 * específicos do card original, não fazem sentido "herdados" por uma
 * cópia nova. Aberto a qualquer membro do board, mesmo restrito — é uma
 * variação de criar card (sempre aberto), não uma edição do original.
 *
 * Serve também de "template" manual: guardar um card como modelo (com
 * checklist pronta) e duplicar sempre que precisar, sem precisar de um
 * sistema de templates à parte.
 */
export async function duplicateCard(req: AuthRequest, res: Response) {
  const cardId = req.params.id;

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: { cardLabels: { select: { labelId: true } }, checklistItems: { orderBy: { position: "asc" } } },
  });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }

  const list = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  if (!(await isBoardMember(list.boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const created = await prisma.$transaction(async (tx) => {
    const siblings = await tx.card.findMany({
      where: { listId: card.listId },
      orderBy: { position: "asc" },
    });
    const insertIndex = siblings.findIndex((c) => c.id === card.id) + 1;

    await Promise.all(
      siblings
        .slice(insertIndex)
        .map((c) => tx.card.update({ where: { id: c.id }, data: { position: c.position + 1 } }))
    );

    return tx.card.create({
      data: {
        title: `${card.title} (cópia)`,
        listId: card.listId,
        position: insertIndex,
        creatorId: req.userId,
        ...copyCardContent(card),
      },
      include: {
        cardLabels: { select: { labelId: true } },
        checklistItems: { orderBy: { position: "asc" } },
        assignee: { select: assigneeSelect },
      },
    });
  });
  const cardWithLabels = withLabelIds(created);

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("card:created", { card: cardWithLabels });
  await logActivity(io, list.boardId, req.userId, `duplicou o card "${card.title}"`);

  return res.status(201).json({ card: cardWithLabels });
}

const createTemplateSchema = z.object({
  title: z.string().min(1),
});

/**
 * POST /boards/:id/templates  { title: string }
 * Cria um card-modelo na aba "Modelos" do board. A lista especial que
 * guarda esses cards (`isTemplatesList: true`) é criada sob demanda, na
 * primeira vez que alguém salva um modelo nesse board — não existe até lá.
 * Fora isso, um modelo é um card normal (mesmo `updateCard`/`deleteCard`/
 * labels/checklist funcionam nele sem mudança nenhuma) — só o board
 * inteiro sabe filtrar essa lista pra fora do Quadro/"Por etiqueta".
 * Sem log de atividade: gerenciar modelo não é um evento de trabalho do
 * board, é configuração — entraria como ruído no histórico.
 */
export async function createTemplate(req: AuthRequest, res: Response) {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const boardId = req.params.id;

  if (!(await isBoardMember(boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  let templatesList = await prisma.list.findFirst({ where: { boardId, isTemplatesList: true } });
  let isNewList = false;
  if (!templatesList) {
    templatesList = await prisma.list.create({
      data: { boardId, title: "Modelos", position: 0, isTemplatesList: true },
    });
    isNewList = true;
  }

  const position = await prisma.card.count({ where: { listId: templatesList.id } });
  const card = await prisma.card.create({
    data: { title: parsed.data.title, listId: templatesList.id, position, creatorId: req.userId },
    include: {
      cardLabels: { select: { labelId: true } },
      checklistItems: { orderBy: { position: "asc" } },
      assignee: { select: assigneeSelect },
    },
  });
  const cardWithLabels = withLabelIds(card);

  const io = req.app.get("io") as Server;
  // Só emite list:created na primeira vez (lista recém-criada) — emitir de
  // novo em toda chamada faria os outros clientes tentarem adicionar uma
  // lista que já têm, duplicando ela no estado deles.
  if (isNewList) {
    io.to(boardId).emit("list:created", { list: { ...templatesList, cards: [] } });
  }
  io.to(boardId).emit("card:created", { card: cardWithLabels });

  return res.status(201).json({ card: cardWithLabels });
}

const updateCardSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  listId: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
  dueDate: z
    .string()
    .nullable()
    .optional()
    .refine((v) => v === undefined || v === null || !Number.isNaN(new Date(v).getTime()), {
      message: "Data inválida",
    }),
  completed: z.boolean().optional(),
  assigneeId: z.string().nullable().optional(),
});

/**
 * PATCH /cards/:id  { title?, description?, listId?, position?, dueDate?, completed?, assigneeId? }
 * Dois modos, mutuamente exclusivos por enquanto:
 *  - listId + position juntos: move o card (reindexa a(s) lista(s) — ver
 *    seção 3 do spec, posições inteiras 0..n-1 sem gaps).
 *  - title, description, dueDate, completed e/ou assigneeId: edita o
 *    conteúdo, sem mexer em posição.
 */
export async function updateCard(req: AuthRequest, res: Response) {
  const parsed = updateCardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const {
    title,
    description,
    listId: toListId,
    position: toPosition,
    dueDate,
    completed,
    assigneeId,
  } = parsed.data;
  const cardId = req.params.id;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }

  const sourceList = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!sourceList) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  const membership = await getBoardMembership(sourceList.boardId, req.userId!);
  if (!membership) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }
  if (!canEditCard(membership, card, req.userId!)) {
    return res.status(403).json({ error: "Esse card está atribuído a outra pessoa" });
  }

  const io = req.app.get("io") as Server;
  const isMove = toListId !== undefined && toPosition !== undefined;

  if (isMove) {
    const destList = await prisma.list.findUnique({ where: { id: toListId } });
    if (!destList) {
      return res.status(404).json({ error: "Lista de destino não encontrada" });
    }
    if (sourceList.boardId !== destList.boardId) {
      return res.status(400).json({ error: "Lista de destino precisa ser do mesmo board" });
    }

    const fromListId = card.listId;
    const updated = await prisma.$transaction(async (tx) => {
      if (fromListId === toListId) {
        const siblings = await tx.card.findMany({
          where: { listId: fromListId },
          orderBy: { position: "asc" },
        });
        const reordered = siblings.filter((c) => c.id !== cardId);
        reordered.splice(Math.min(toPosition, reordered.length), 0, card);

        await Promise.all(
          reordered.map((c, index) =>
            tx.card.update({ where: { id: c.id }, data: { position: index } })
          )
        );
      } else {
        const sourceSiblings = await tx.card.findMany({
          where: { listId: fromListId, id: { not: cardId } },
          orderBy: { position: "asc" },
        });
        await Promise.all(
          sourceSiblings.map((c, index) =>
            tx.card.update({ where: { id: c.id }, data: { position: index } })
          )
        );

        const destSiblings = await tx.card.findMany({
          where: { listId: toListId },
          orderBy: { position: "asc" },
        });
        destSiblings.splice(Math.min(toPosition, destSiblings.length), 0, card);

        await Promise.all(
          destSiblings.map((c, index) =>
            tx.card.update({ where: { id: c.id }, data: { position: index, listId: toListId } })
          )
        );
      }

      return tx.card.findUniqueOrThrow({
        where: { id: cardId },
        include: {
          cardLabels: { select: { labelId: true } },
          checklistItems: { orderBy: { position: "asc" } },
          assignee: { select: assigneeSelect },
        },
      });
    });
    const cardWithLabels = withLabelIds(updated);

    io.to(destList.boardId).emit("card:moved", { card: cardWithLabels, fromListId, toListId });
    // Só registra quando muda de lista — reordenar dentro da mesma lista
    // é ruído demais pro histórico (aconteceria a cada arrasto pequeno).
    if (fromListId !== toListId) {
      await logActivity(
        io,
        destList.boardId,
        req.userId,
        `moveu o card "${updated.title}" de "${sourceList.title}" para "${destList.title}"`
      );
    }
    return res.json({ card: cardWithLabels });
  }

  if (
    title === undefined &&
    description === undefined &&
    dueDate === undefined &&
    completed === undefined &&
    assigneeId === undefined
  ) {
    return res.status(400).json({ error: "Nada para atualizar" });
  }

  if (assigneeId !== undefined && assigneeId !== null) {
    if (!(await isBoardMember(sourceList.boardId, assigneeId))) {
      return res.status(400).json({ error: "Esse usuário não é membro do board" });
    }
  }

  const updated = await prisma.card.update({
    where: { id: cardId },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate === null ? null : new Date(dueDate) } : {}),
      ...(completed !== undefined ? { completed } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
    },
    include: {
      cardLabels: { select: { labelId: true } },
      checklistItems: { orderBy: { position: "asc" } },
      assignee: { select: assigneeSelect },
    },
  });
  const cardWithLabels = withLabelIds(updated);

  io.to(sourceList.boardId).emit("card:updated", { card: cardWithLabels });
  // Só o toggle de concluído e mudar o responsável viram entrada no
  // histórico — editar título/descrição/prazo é mudança de conteúdo, não
  // um evento de ciclo de vida.
  // Compara com o valor ANTES do update (`card`, buscado no começo da
  // função), não só se o campo veio na requisição — clicar de novo no
  // mesmo responsável (ou marcar/desmarcar clicando duas vezes rápido)
  // manda o campo igual ao que já era, e isso não é uma mudança de
  // verdade pro histórico.
  if (completed !== undefined && completed !== card.completed) {
    await logActivity(
      io,
      sourceList.boardId,
      req.userId,
      completed
        ? `marcou o card "${updated.title}" como concluído`
        : `reabriu o card "${updated.title}"`
    );
  }
  if (assigneeId !== undefined && assigneeId !== card.assigneeId) {
    await logActivity(
      io,
      sourceList.boardId,
      req.userId,
      assigneeId === null
        ? `removeu a atribuição do card "${updated.title}"`
        : `atribuiu o card "${updated.title}" a ${updated.assignee?.name}`
    );
  }
  return res.json({ card: cardWithLabels });
}

/**
 * DELETE /cards/:id
 * Remove o card e reindexa a lista (fecha o buraco de position) — sem
 * isso, uma criação futura poderia colidir na mesma position, já que
 * createCard usa count() pra decidir a próxima posição.
 */
export async function deleteCard(req: AuthRequest, res: Response) {
  const cardId = req.params.id;

  const card = await prisma.card.findUnique({ where: { id: cardId } });
  if (!card) {
    return res.status(404).json({ error: "Card não encontrado" });
  }

  const list = await prisma.list.findUnique({ where: { id: card.listId } });
  if (!list) {
    return res.status(404).json({ error: "Lista não encontrada" });
  }
  const membership = await getBoardMembership(list.boardId, req.userId!);
  if (!membership) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }
  if (!canEditCard(membership, card, req.userId!)) {
    return res.status(403).json({ error: "Esse card está atribuído a outra pessoa" });
  }

  // Precisa buscar os anexos ANTES da transação: onDelete: Cascade no
  // schema já apaga as linhas de Attachment junto com o card, mas o
  // Postgres não sabe nada sobre o arquivo de verdade no Supabase
  // Storage — essa limpeza é feita à parte, depois.
  const attachments = await prisma.attachment.findMany({ where: { cardId } });

  await prisma.$transaction(async (tx) => {
    await tx.card.delete({ where: { id: cardId } });
    const siblings = await tx.card.findMany({
      where: { listId: card.listId },
      orderBy: { position: "asc" },
    });
    await Promise.all(
      siblings.map((c, index) => tx.card.update({ where: { id: c.id }, data: { position: index } }))
    );
  });

  // Best-effort: as linhas já se foram do banco de qualquer forma, uma
  // falha aqui só deixaria um arquivo órfão no bucket, não motivo pra
  // desfazer a exclusão do card (que já aconteceu).
  await Promise.all(
    attachments.map((a) => removeAttachment(attachmentObjectKey(a.cardId, a.id)).catch(() => {}))
  );

  const io = req.app.get("io") as Server;
  io.to(list.boardId).emit("card:deleted", { cardId, listId: card.listId });
  await logActivity(io, list.boardId, req.userId, `excluiu o card "${card.title}"`);

  return res.status(204).send();
}
