"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError,
  Board,
  clearToken,
  createBoard,
  deleteBoard,
  hasToken,
  listBoards,
} from "@/lib/api";
import { disconnectSocket } from "@/lib/socket";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Lista os boards do usuário logado e permite criar um novo.
 * Sem token salvo, redireciona pro login.
 */
export default function BoardsPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setLoadError(null);
    listBoards()
      .then(({ boards }) => setBoards(boards))
      .catch((err) => {
        // Token inválido/expirado: sem sessão pra recuperar, volta pro login.
        // Qualquer outra coisa (rede caiu, servidor fora do ar) é passageiro
        // — deixa a pessoa tentar de novo sem perder a sessão.
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/");
          return;
        }
        setLoadError("Não foi possível carregar seus boards. Verifique sua conexão.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!hasToken()) {
      router.replace("/");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { board } = await createBoard(title.trim());
      setBoards((prev) => [board, ...prev]);
      setTitle("");
    } catch {
      setCreateError("Não foi possível criar o board. Tente de novo.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(boardId: string) {
    setDeleteError(null);
    try {
      await deleteBoard(boardId);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    } catch {
      setConfirmingDeleteId(null);
      setDeleteError("Não foi possível excluir o board.");
    }
  }

  function handleLogout() {
    disconnectSocket();
    clearToken();
    router.push("/");
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo size={28} />
          <h1 className="font-display text-xl font-bold text-ink">Seus boards</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="rounded-card border border-surface-border px-3 py-1.5 text-sm text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-500"
          >
            Sair
          </button>
        </div>
      </div>

      <form onSubmit={handleCreate} className="mb-2 flex gap-2">
        <input
          className="flex-1 rounded-card border border-surface-border bg-surface p-2 text-sm text-ink outline-none transition-colors focus:border-brand-500"
          placeholder="Título do novo board"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-card bg-brand-500 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {creating ? "Criando..." : "Criar"}
        </button>
      </form>
      {createError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{createError}</p>}
      {deleteError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{deleteError}</p>}

      {loading ? (
        <p className="text-sm text-ink-soft">Carregando...</p>
      ) : loadError ? (
        <div className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          <p className="mb-2">{loadError}</p>
          <button onClick={load} className="font-medium underline hover:no-underline">
            Tentar de novo
          </button>
        </div>
      ) : boards.length === 0 ? (
        <p className="text-sm text-ink-soft">Nenhum board ainda — crie o primeiro acima.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {boards.map((board) => (
            <li
              key={board.id}
              className="flex items-center gap-2 rounded-card border border-surface-border bg-surface p-3 shadow-card transition-colors hover:border-brand-300"
            >
              <Link href={`/board/${board.id}`} className="flex-1 text-sm text-ink">
                {board.title}
              </Link>
              {board.myRole === "OWNER" &&
                (confirmingDeleteId === board.id ? (
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <button
                      onClick={() => handleDelete(board.id)}
                      className="font-medium text-red-600 hover:underline"
                    >
                      Excluir
                    </button>
                    <button
                      onClick={() => setConfirmingDeleteId(null)}
                      className="text-ink-soft hover:text-ink"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingDeleteId(board.id)}
                    className="shrink-0 text-xs text-ink-soft hover:text-red-600"
                    aria-label="Excluir board"
                  >
                    ✕
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
