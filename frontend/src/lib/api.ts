const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Sessão por aba: cada aba tem seu próprio id (em sessionStorage, que já é
 * isolado por aba nativamente) e guarda o token sob uma chave própria em
 * localStorage (`fluxo_token_<tabId>`). Isso permite logar em contas
 * diferentes em abas diferentes sem que logout/troca de conta numa aba
 * afete as outras — o problema de usar uma chave única (`fluxo_token`)
 * compartilhada por todas as abas da mesma origem.
 *
 * Por conveniência, uma aba nova sem sessão própria "herda" o token de
 * alguma outra aba já logada (uma cópia, feita uma vez) — depois disso ela
 * fica independente.
 *
 * Pegadinha real (achada testando): "duplicar aba" no navegador copia o
 * sessionStorage inteiro pra aba nova — as duas ficam com o MESMO
 * fluxo_tab_id, e portanto a mesma chave no localStorage. Nesse caso não
 * são duas sessões independentes, é a mesma sessão vista de dois lugares:
 * logout numa afeta a outra na hora. resolveTabIdCollision() detecta isso
 * via BroadcastChannel (as abas se anunciam umas às outras) e troca de id
 * automaticamente quando percebe duplicata.
 */
function getTabId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem("fluxo_tab_id");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("fluxo_tab_id", id);
  }
  return id;
}

function resolveTabIdCollision() {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

  const channel = new BroadcastChannel("fluxo_tab_ids");
  channel.onmessage = (event) => {
    if (event.data?.type !== "hello") return;
    const myId = sessionStorage.getItem("fluxo_tab_id");
    if (event.data.id !== myId) return;

    // Outra aba anunciou o mesmo id que a minha — só acontece quando o
    // navegador duplica a aba (copia sessionStorage junto). Assumo uma
    // identidade nova; limpo o "seeded" pra essa aba poder herdar o token
    // de novo com a chave nova (senão ela ficaria deslogada do nada).
    const newId = crypto.randomUUID();
    sessionStorage.setItem("fluxo_tab_id", newId);
    sessionStorage.removeItem("fluxo_seeded");
    channel.postMessage({ type: "hello", id: newId });
  };
  channel.postMessage({ type: "hello", id: getTabId() });
}

resolveTabIdCollision();

function tokenKey(): string {
  return `fluxo_token_${getTabId()}`;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const key = tokenKey();
  const own = localStorage.getItem(key);
  if (own) return own;

  // Só herda de outra aba na primeira vez que essa aba pede um token.
  // Sem essa flag, um logout seria imediatamente desfeito: a página de
  // login checa hasToken() de novo, não acha a chave própria (que acabou
  // de ser removida) e herdaria outra sessão na hora.
  const seeded = sessionStorage.getItem("fluxo_seeded");
  sessionStorage.setItem("fluxo_seeded", "1");
  if (seeded) return null;

  for (let i = 0; i < localStorage.length; i++) {
    const otherKey = localStorage.key(i);
    if (otherKey && otherKey.startsWith("fluxo_token_") && otherKey !== key) {
      const inherited = localStorage.getItem(otherKey);
      if (inherited) {
        localStorage.setItem(key, inherited);
        return inherited;
      }
    }
  }
  return null;
}

export function hasToken(): boolean {
  return getToken() !== null;
}

export function saveToken(token: string) {
  sessionStorage.setItem("fluxo_seeded", "1");
  localStorage.setItem(tokenKey(), token);
}

export function clearToken() {
  localStorage.removeItem(tokenKey());
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }

  // DELETE devolve 204 sem corpo — res.json() quebraria tentando parsear "".
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Board {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  myRole: "OWNER" | "MEMBER";
}

export interface CardItem {
  id: string;
  title: string;
  description: string | null;
  position: number;
  listId: string;
}

export interface ListItem {
  id: string;
  title: string;
  position: number;
  cards: CardItem[];
}

export interface BoardDetail extends Board {
  lists: ListItem[];
}

export interface Member {
  id: string;
  role: "OWNER" | "MEMBER";
  user: User;
}

export const register = (name: string, email: string, password: string) =>
  apiFetch<{ user: User; token: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });

export const login = (email: string, password: string) =>
  apiFetch<{ user: User; token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const listBoards = () => apiFetch<{ boards: Board[] }>("/boards");

export const createBoard = (title: string) =>
  apiFetch<{ board: Board }>("/boards", {
    method: "POST",
    body: JSON.stringify({ title }),
  });

export const getBoard = (id: string) => apiFetch<{ board: BoardDetail }>(`/boards/${id}`);

export const deleteBoard = (id: string) => apiFetch<void>(`/boards/${id}`, { method: "DELETE" });

export const createList = (boardId: string, title: string) =>
  apiFetch<{ list: ListItem }>(`/boards/${boardId}/lists`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });

export const updateList = (listId: string, title: string) =>
  apiFetch<{ list: ListItem }>(`/lists/${listId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });

export const deleteList = (listId: string) =>
  apiFetch<void>(`/lists/${listId}`, { method: "DELETE" });

export const createCard = (listId: string, title: string) =>
  apiFetch<{ card: CardItem }>(`/lists/${listId}/cards`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });

export const moveCard = (cardId: string, listId: string, position: number) =>
  apiFetch<{ card: CardItem }>(`/cards/${cardId}`, {
    method: "PATCH",
    body: JSON.stringify({ listId, position }),
  });

export const updateCard = (cardId: string, data: { title?: string; description?: string | null }) =>
  apiFetch<{ card: CardItem }>(`/cards/${cardId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteCard = (cardId: string) =>
  apiFetch<void>(`/cards/${cardId}`, { method: "DELETE" });

export const inviteMember = (boardId: string, email: string) =>
  apiFetch<{ member: Member }>(`/boards/${boardId}/invite`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const listMembers = (boardId: string) =>
  apiFetch<{ members: Member[] }>(`/boards/${boardId}/members`);
