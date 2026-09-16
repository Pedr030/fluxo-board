import { Response } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { logActivity } from "../lib/activity";
import { isBoardMember } from "../lib/authorization";

/**
 * GET /boards
 * Lista os boards em que o usuário logado é dono ou membro. Inclui `myRole`
 * de cada um (mesma ideia do getBoard) pro frontend decidir se mostra o
 * botão de excluir, que só o dono pode usar.
 */
export async function listBoards(req: AuthRequest, res: Response) {
  const boards = await prisma.board.findMany({
    where: { members: { some: { userId: req.userId } } },
    orderBy: { createdAt: "desc" },
    include: { members: { where: { userId: req.userId }, select: { role: true } } },
  });
  const withRole = boards.map(({ members, ...board }) => ({
    ...board,
    myRole: members[0].role,
  }));
  return res.json({ boards: withRole });
}

const createBoardSchema = z.object({
  title: z.string().min(1),
});

// Toda board nova já nasce com essas 3 — cobre o caso de uso mais comum
// (priorizar tarefas) sem exigir que a pessoa abra o seletor de etiquetas
// e crie do zero. Só se aplica a boards criados a partir de agora — não
// mexe retroativamente em boards existentes, que podem já ter etiquetas
// próprias.
const DEFAULT_LABELS = [
  { name: "Alta", color: "#ef4444" },
  { name: "Média", color: "#f97316" },
  { name: "Baixa", color: "#22c55e" },
];

/**
 * POST /boards  { title: string }
 * Cria o board com ownerId = req.userId e já cria o BoardMember
 * correspondente com role OWNER, numa transação (as duas escritas têm
 * que ter sucesso juntas — não faz sentido existir um board sem membro).
 */
export async function createBoard(req: AuthRequest, res: Response) {
  const parsed = createBoardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { title } = parsed.data;
  const userId = req.userId!;

  const board = await prisma.$transaction(async (tx) => {
    const created = await tx.board.create({
      data: { title, ownerId: userId },
    });
    await tx.boardMember.create({
      data: { boardId: created.id, userId, role: "OWNER" },
    });
    await tx.label.createMany({
      data: DEFAULT_LABELS.map((label) => ({ ...label, boardId: created.id })),
    });
    return created;
  });

  // Quem cria é sempre OWNER (ver transação acima) — devolve já com myRole,
  // no mesmo formato de listBoards/getBoard, pro frontend não precisar
  // recarregar a lista pra saber que pode excluir o board recém-criado.
  return res.status(201).json({ board: { ...board, myRole: "OWNER" as const } });
}

/**
 * GET /boards/:id
 * Busca o board com lists e cards aninhados, ordenados por `position`.
 * Verifica que o usuário logado é membro antes de devolver (senão 403).
 * Devolve também `myRole` — o papel do usuário logado nesse board — pro
 * frontend decidir o que mostrar (ex: esconder "Convidar" de quem não é
 * OWNER). É só UX: o backend já bloqueia a ação em si independente do que
 * a tela mostra (ver inviteMember).
 */
export async function getBoard(req: AuthRequest, res: Response) {
  const { id } = req.params;

  const board = await prisma.board.findUnique({
    where: { id },
    include: {
      lists: {
        orderBy: { position: "asc" },
        include: {
          cards: {
            orderBy: { position: "asc" },
            include: {
              cardLabels: { select: { labelId: true } },
              checklistItems: { orderBy: { position: "asc" } },
              assignee: { select: { id: true, name: true, avatarUrl: true } },
            },
          },
        },
      },
      // Paleta de etiquetas do board inteiro — pequena o bastante (ao
      // contrário de comentários/anexos) pra vir junto do board sem
      // precisar de outra requisição. Cada card só carrega os `labelId`s
      // que usa (cardLabels acima); nome/cor de cada etiqueta o frontend
      // resolve cruzando com essa paleta.
      labels: true,
    },
  });

  if (!board) {
    return res.status(404).json({ error: "Board não encontrado" });
  }

  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: id, userId: req.userId! } },
  });
  if (!membership) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const lists = board.lists.map((list) => ({
    ...list,
    cards: list.cards.map(({ cardLabels, ...card }) => ({
      ...card,
      labelIds: cardLabels.map((cl) => cl.labelId),
    })),
  }));

  return res.json({
    board: { ...board, lists, myRole: membership.role, myRestricted: membership.restricted },
  });
}

const inviteSchema = z.object({
  email: z.string().email(),
});

/**
 * POST /boards/:id/invite  { email: string }
 * Adiciona o usuário desse email como membro (role MEMBER). Exige um
 * usuário já cadastrado — convite por link/token pra quem ainda não tem
 * conta fica pra uma versão futura (ver PROJECT_SPEC.md). OWNER e ADMIN
 * podem convidar — é justamente a diferença entre ADMIN e MEMBER comum.
 */
export async function inviteMember(req: AuthRequest, res: Response) {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const boardId = req.params.id;

  const requester = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: req.userId! } },
  });
  if (!requester) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }
  if (requester.role !== "OWNER" && requester.role !== "ADMIN") {
    return res.status(403).json({ error: "Só o dono ou um admin do board pode convidar membros" });
  }

  const invitedUser = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!invitedUser) {
    return res.status(404).json({ error: "Não existe usuário cadastrado com esse email" });
  }

  const existingMembership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: invitedUser.id } },
  });
  if (existingMembership) {
    return res.status(409).json({ error: "Esse usuário já é membro do board" });
  }

  const member = await prisma.boardMember.create({
    data: { boardId, userId: invitedUser.id, role: "MEMBER" },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });

  const io = req.app.get("io") as Server;
  await logActivity(io, boardId, req.userId, `convidou ${invitedUser.name} pro board`);

  return res.status(201).json({ member });
}

/**
 * GET /boards/:id/members
 * Lista os membros do board com nome/email/role. Qualquer membro pode ver
 * (não só o dono) — é só leitura, diferente de convidar.
 */
export async function listMembers(req: AuthRequest, res: Response) {
  const boardId = req.params.id;

  if (!(await isBoardMember(boardId, req.userId!))) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }

  const members = await prisma.boardMember.findMany({
    where: { boardId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });
  // OWNER, depois ADMIN, depois MEMBER — mais natural na tela do que a
  // ordem de entrada.
  const roleOrder = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
  members.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);

  return res.json({ members });
}

const updateMemberSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
  restricted: z.boolean().optional(),
});

/**
 * PATCH /boards/:id/members/:memberId  { role?, restricted? }
 * Só o OWNER gerencia isso — promover/rebaixar ADMIN↔MEMBER, ou ligar/
 * desligar a restrição "só edita os próprios cards". O alvo não pode ser
 * o próprio OWNER (trocar quem é dono é a exclusão de conta com
 * transferência de posse, um fluxo totalmente à parte). Promover a ADMIN
 * sempre limpa `restricted` — não faz sentido alguém que já pode convidar
 * gente nova ficar travado nos próprios cards.
 */
export async function updateMember(req: AuthRequest, res: Response) {
  const parsed = updateMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { role, restricted } = parsed.data;
  if (role === undefined && restricted === undefined) {
    return res.status(400).json({ error: "Nada para atualizar" });
  }
  const boardId = req.params.id;
  const memberId = req.params.memberId;

  const requester = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: req.userId! } },
  });
  if (!requester) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }
  if (requester.role !== "OWNER") {
    return res.status(403).json({ error: "Só o dono do board pode gerenciar membros" });
  }

  const target = await prisma.boardMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { name: true } } },
  });
  if (!target || target.boardId !== boardId) {
    return res.status(404).json({ error: "Membro não encontrado" });
  }
  if (target.role === "OWNER") {
    return res.status(400).json({ error: "Não dá pra mudar o cargo do dono por aqui" });
  }

  const effectiveRole = role ?? target.role;
  if (restricted === true && effectiveRole === "ADMIN") {
    return res.status(400).json({ error: "Admin não pode ficar restrito aos próprios cards" });
  }
  const effectiveRestricted = effectiveRole === "ADMIN" ? false : restricted ?? target.restricted;

  const updated = await prisma.boardMember.update({
    where: { id: memberId },
    data: { ...(role !== undefined ? { role } : {}), restricted: effectiveRestricted },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });

  const io = req.app.get("io") as Server;
  io.to(boardId).emit("member:updated", { member: updated });

  if (role !== undefined && role !== target.role) {
    await logActivity(
      io,
      boardId,
      req.userId,
      role === "ADMIN" ? `promoveu ${target.user.name} a admin` : `removeu ${target.user.name} de admin`
    );
  }
  if (effectiveRestricted !== target.restricted) {
    await logActivity(
      io,
      boardId,
      req.userId,
      effectiveRestricted
        ? `restringiu ${target.user.name} aos próprios cards`
        : `removeu a restrição de ${target.user.name}`
    );
  }

  return res.json({ member: updated });
}

/**
 * DELETE /boards/:id
 * Remove o board (lists, cards e memberships somem junto, via
 * onDelete: Cascade no schema). Só o OWNER pode excluir — mesmo critério
 * usado em inviteMember, e faz sentido: é uma ação irreversível.
 */
export async function deleteBoard(req: AuthRequest, res: Response) {
  const boardId = req.params.id;

  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: req.userId! } },
  });
  if (!membership) {
    return res.status(403).json({ error: "Você não é membro deste board" });
  }
  if (membership.role !== "OWNER") {
    return res.status(403).json({ error: "Só o dono do board pode excluí-lo" });
  }

  await prisma.board.delete({ where: { id: boardId } });

  // Avisa quem estiver com o board aberto (ex: outra aba do próprio dono,
  // ou um membro vendo em tempo real) antes de já não existir mais.
  const io = req.app.get("io") as Server;
  io.to(boardId).emit("board:deleted", { boardId });

  return res.status(204).send();
}
