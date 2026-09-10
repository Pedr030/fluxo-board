"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { getSocket } from "@/lib/socket";
import {
  ApiError,
  Member,
  createList as apiCreateList,
  getBoard,
  inviteMember as apiInviteMember,
  listMembers,
  moveCard as apiMoveCard,
} from "@/lib/api";
import { Avatar } from "./Avatar";
import { CardData, CardView } from "./Card";
import { ArrowLeftIcon, UserIcon } from "./icons";
import { List, ListData } from "./List";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Remove o card `cardId` de onde estiver e insere na lista `toListId`, no
 * índice `toIndex`. Usada tanto pro update otimista local (durante o
 * drag-and-drop, precisa ser instantâneo) quanto pela reconciliação via
 * socket (evento "card:moved") — nos dois casos é a mesma operação
 * "tira dali, bota aqui", o que também a torna idempotente: aplicar de
 * novo o mesmo evento não duplica nem desalinha nada.
 */
interface PresenceUser {
  id: string;
  name: string;
  avatarUrl: string | null;
}

// Ciclo de cores da marca pros avatares de presença — ver docs/identidade-visual.html,
// seção "Presença" (os três avatares de exemplo usam brand/flow/signal).
const AVATAR_COLORS = ["bg-brand-500", "bg-flow-500", "bg-accent-500"];

function moveCardInLists(
  lists: ListData[],
  cardId: string,
  toListId: string,
  toIndex: number
): ListData[] {
  let moving: CardData | undefined;
  const withoutCard = lists.map((list) => {
    const found = list.cards.find((c) => c.id === cardId);
    if (!found) return list;
    moving = found;
    return { ...list, cards: list.cards.filter((c) => c.id !== cardId) };
  });
  if (!moving) return lists;

  return withoutCard.map((list) => {
    if (list.id !== toListId) return list;
    const cards = [...list.cards];
    cards.splice(Math.min(toIndex, cards.length), 0, moving!);
    return { ...list, cards };
  });
}

/**
 * Componente principal de um board: busca os dados iniciais via REST e
 * entra na room do socket pra receber as mutações de qualquer cliente
 * (incluindo as próprias — ver PROJECT_SPEC.md seção 2).
 *
 * Exceção à regra "só atualiza via evento de socket" (usada pra criar
 * lista/card): mover um card por drag-and-drop precisa de feedback visual
 * instantâneo enquanto solta — esperar o round-trip do socket faria o card
 * "voltar" pro lugar antigo por um instante e "pular" pro novo depois, o
 * que pareceria quebrado. Por isso o drop atualiza o estado local na hora
 * (otimista) e ainda assim persiste via REST + reage ao "card:moved" que
 * volta — como moveCardInLists é idempotente, receber o próprio evento de
 * volta não causa duplicação, só confirma o que já foi aplicado.
 */
export function Board({ boardId }: { boardId: string }) {
  const [lists, setLists] = useState<ListData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newListTitle, setNewListTitle] = useState("");
  const [creatingList, setCreatingList] = useState(false);
  const [createListError, setCreateListError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<CardData | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [myRole, setMyRole] = useState<"OWNER" | "MEMBER" | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<"board" | "members">("board");
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // Mensagem passageira (ex: drag-and-drop que falhou e já foi ressincronizado
  // sozinho) — some depois de alguns segundos, não precisa de botão pra fechar.
  function flashError(message: string) {
    setActionError(message);
    setTimeout(() => setActionError((current) => (current === message ? null : current)), 4000);
  }

  function loadBoard() {
    setLoading(true);
    setLoadError(null);
    Promise.all([getBoard(boardId), listMembers(boardId)])
      .then(([{ board }, { members }]) => {
        setLists(board.lists);
        setMyRole(board.myRole);
        setMembers(members);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setLoadError("Você não é membro deste board.");
        } else if (err instanceof ApiError && err.status === 404) {
          setLoadError("Esse board não existe (ou foi excluído).");
        } else {
          setLoadError("Não foi possível carregar o board. Verifique sua conexão.");
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    const socket = getSocket();
    socket.emit("board:join", boardId);

    function handleListCreated({ list }: { list: ListData }) {
      setLists((prev) => [...prev, list]);
    }

    function handleCardCreated({ card }: { card: CardData & { listId: string } }) {
      setLists((prev) =>
        prev.map((list) =>
          list.id === card.listId ? { ...list, cards: [...list.cards, card] } : list
        )
      );
    }

    function handleCardMoved({
      card,
      toListId,
    }: {
      card: CardData & { position: number };
      fromListId: string;
      toListId: string;
    }) {
      setLists((prev) => moveCardInLists(prev, card.id, toListId, card.position));
    }

    function handleCardUpdated({ card }: { card: CardData & { listId: string } }) {
      setLists((prev) =>
        prev.map((list) =>
          list.id === card.listId
            ? { ...list, cards: list.cards.map((c) => (c.id === card.id ? card : c)) }
            : list
        )
      );
    }

    function handleCardDeleted({ cardId, listId }: { cardId: string; listId: string }) {
      setLists((prev) =>
        prev.map((list) =>
          list.id === listId ? { ...list, cards: list.cards.filter((c) => c.id !== cardId) } : list
        )
      );
    }

    function handleListUpdated({ list }: { list: { id: string; title: string } }) {
      setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, title: list.title } : l)));
    }

    function handleListDeleted({ listId }: { listId: string }) {
      setLists((prev) => prev.filter((l) => l.id !== listId));
    }

    function handlePresenceUpdate({ users }: { users: PresenceUser[] }) {
      setOnlineUsers(users);
    }

    function handleBoardDeleted() {
      setLoadError("Esse board foi excluído pelo dono.");
    }

    socket.on("list:created", handleListCreated);
    socket.on("list:updated", handleListUpdated);
    socket.on("list:deleted", handleListDeleted);
    socket.on("card:created", handleCardCreated);
    socket.on("card:moved", handleCardMoved);
    socket.on("card:updated", handleCardUpdated);
    socket.on("card:deleted", handleCardDeleted);
    socket.on("presence:update", handlePresenceUpdate);
    socket.on("board:deleted", handleBoardDeleted);

    return () => {
      socket.emit("board:leave", boardId);
      socket.off("list:created", handleListCreated);
      socket.off("list:updated", handleListUpdated);
      socket.off("list:deleted", handleListDeleted);
      socket.off("card:created", handleCardCreated);
      socket.off("card:moved", handleCardMoved);
      socket.off("card:updated", handleCardUpdated);
      socket.off("card:deleted", handleCardDeleted);
      socket.off("presence:update", handlePresenceUpdate);
      socket.off("board:deleted", handleBoardDeleted);
      setOnlineUsers([]);
    };
  }, [boardId]);

  async function handleCreateList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListTitle.trim()) return;
    setCreatingList(true);
    setCreateListError(null);
    try {
      await apiCreateList(boardId, newListTitle.trim());
      setNewListTitle("");
    } catch {
      setCreateListError("Não foi possível criar a lista. Tente de novo.");
    } finally {
      setCreatingList(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteStatus(null);
    try {
      const { member } = await apiInviteMember(boardId, inviteEmail.trim());
      setMembers((prev) => [...prev, member]);
      setInviteStatus({ ok: true, message: `${member.user.name} agora é membro do board.` });
      setInviteEmail("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setInviteStatus({ ok: false, message: "Não existe usuário cadastrado com esse email." });
      } else if (err instanceof ApiError && err.status === 409) {
        setInviteStatus({ ok: false, message: "Esse usuário já é membro do board." });
      } else if (err instanceof ApiError && err.status === 403) {
        setInviteStatus({ ok: false, message: "Só o dono do board pode convidar membros." });
      } else {
        setInviteStatus({ ok: false, message: "Não foi possível convidar. Confira o email." });
      }
    } finally {
      setInviting(false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const card = lists.flatMap((l) => l.cards).find((c) => c.id === event.active.id);
    setActiveCard(card ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const cardId = active.id as string;
    const overId = over.id as string;

    const overIsList = lists.some((l) => l.id === overId);
    const toList = overIsList
      ? lists.find((l) => l.id === overId)
      : lists.find((l) => l.cards.some((c) => c.id === overId));
    if (!toList) return;

    const toIndex = overIsList
      ? toList.cards.length
      : toList.cards.findIndex((c) => c.id === overId);

    const fromList = lists.find((l) => l.cards.some((c) => c.id === cardId));
    const alreadyThere =
      fromList?.id === toList.id && fromList.cards.findIndex((c) => c.id === cardId) === toIndex;
    if (alreadyThere) return;

    setLists((prev) => moveCardInLists(prev, cardId, toList.id, toIndex));

    apiMoveCard(cardId, toList.id, toIndex).catch(() => {
      // Deu errado persistir — ressincroniza com o servidor em vez de
      // tentar calcular um "desfazer" manual.
      flashError("Não foi possível mover o card — desfazendo.");
      getBoard(boardId).then(({ board }) => setLists(board.lists));
    });
  }

  if (loading) {
    return (
      <main className="flex h-screen items-center justify-center bg-surface-muted text-sm text-ink-soft">
        Carregando board...
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-surface-muted p-4 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        <div className="flex gap-3 text-sm">
          <button onClick={loadBoard} className="font-medium text-brand-500 hover:underline">
            Tentar de novo
          </button>
          <Link href="/boards" className="text-ink-soft hover:text-brand-500">
            ← Voltar pros boards
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-surface-muted">
      {actionError && (
        <div className="bg-red-50 p-2 text-center text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {actionError}
        </div>
      )}
      <div className="flex items-center justify-between gap-4 p-6 pb-0">
        <Link
          href="/boards"
          aria-label="Voltar pros boards"
          title="Voltar pros boards"
          className="flex h-10 w-10 items-center justify-center rounded-card border border-surface-border text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-500"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>

        <div className="flex items-center gap-4">
          {onlineUsers.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2" title={onlineUsers.map((u) => u.name).join(", ")}>
                {onlineUsers.map((u, i) => (
                  <Avatar
                    key={u.id}
                    name={u.name}
                    avatarUrl={u.avatarUrl}
                    className="h-11 w-11 border-2 border-surface-muted text-base"
                    colorClassName={AVATAR_COLORS[i % AVATAR_COLORS.length]}
                  />
                ))}
              </div>
              <span className="hidden items-center gap-1.5 rounded-full bg-flow-100 px-3 py-1.5 text-sm font-semibold text-flow-600 dark:bg-flow-500/20 dark:text-flow-400 sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-flow-500" />
                ao vivo
              </span>
            </div>
          )}

          <div className="flex gap-1 rounded-card bg-surface-border/50 p-1">
            <button
              onClick={() => setView("board")}
              className={`rounded-card px-4 py-1.5 text-sm font-medium transition-colors ${
                view === "board" ? "bg-surface text-ink shadow-card" : "text-ink-soft"
              }`}
            >
              Quadro
            </button>
            <button
              onClick={() => setView("members")}
              className={`rounded-card px-4 py-1.5 text-sm font-medium transition-colors ${
                view === "members" ? "bg-surface text-ink shadow-card" : "text-ink-soft"
              }`}
            >
              Membros ({members.length})
            </button>
          </div>

          <ThemeToggle />
          <Link
            href="/profile"
            aria-label="Perfil"
            title="Perfil"
            className="flex h-10 w-10 items-center justify-center rounded-card border border-surface-border text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-500"
          >
            <UserIcon className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {view === "members" ? (
        <div className="mx-auto w-full max-w-xl p-6">
          <ul className="flex flex-col gap-3">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-card border border-surface-border bg-surface p-4 text-base shadow-card"
              >
                <div>
                  <p className="font-medium text-ink">{m.user.name}</p>
                  <p className="text-sm text-ink-soft">{m.user.email}</p>
                </div>
                <span
                  className={`rounded-card px-3 py-1 text-sm font-medium ${
                    m.role === "OWNER"
                      ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                      : "bg-surface-muted text-ink-soft"
                  }`}
                >
                  {m.role === "OWNER" ? "Dono" : "Membro"}
                </span>
              </li>
            ))}
          </ul>

          {myRole === "OWNER" && (
            <form onSubmit={handleInvite} className="mt-5 flex gap-3">
              <input
                type="email"
                className="flex-1 rounded-card border border-surface-border bg-surface p-3 text-base text-ink outline-none transition-colors focus:border-brand-500"
                placeholder="Convidar por email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <button
                type="submit"
                disabled={inviting}
                className="rounded-card bg-flow-500 px-4 text-base font-medium text-white transition-colors hover:bg-flow-600 disabled:opacity-60"
              >
                Convidar
              </button>
            </form>
          )}
          {inviteStatus && (
            <p
              className={`mt-2 text-xs ${
                inviteStatus.ok ? "text-flow-600 dark:text-flow-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {inviteStatus.message}
            </p>
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <main className="flex flex-1 gap-5 overflow-x-auto p-6">
            {lists.map((list) => (
              <List key={list.id} list={list} />
            ))}

            <form onSubmit={handleCreateList} className="flex w-80 shrink-0 flex-col gap-2">
              <input
                className="rounded-card border border-surface-border bg-surface p-3 text-base text-ink outline-none transition-colors focus:border-brand-500"
                placeholder="Nova lista"
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value)}
              />
              <button
                type="submit"
                disabled={creatingList}
                className="rounded-card bg-brand-500 p-3 text-base font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
              >
                {creatingList ? "Criando..." : "+ Adicionar lista"}
              </button>
              {createListError && (
                <p className="text-xs text-red-600 dark:text-red-400">{createListError}</p>
              )}
            </form>
          </main>
          <DragOverlay>{activeCard && <CardView card={activeCard} />}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
