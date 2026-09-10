"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AccountDeletionResolution,
  Member,
  clearToken,
  deleteAccount,
  listBoards,
  listMembers,
} from "@/lib/api";
import { disconnectSocket } from "@/lib/socket";
import { ConfirmDialog } from "./ConfirmDialog";

interface BoardNeedingResolution {
  id: string;
  title: string;
  otherMembers: Member[];
}

/**
 * "Zona de perigo" da tela de Perfil. Excluir a conta não pode ser um
 * clique só: boards que a pessoa é dona precisam de uma decisão antes
 * (transferir posse ou excluir o board), exceto quando ela é a única
 * pessoa no board — aí não tem pra quem transferir, exclui direto.
 *
 * Busca os boards e os membros de cada um só quando o usuário de fato
 * inicia o fluxo (não no carregamento da página) — é N+1 requisições,
 * mas o volume aqui é sempre pequeno (quantos boards uma pessoa é dona).
 */
export function AccountDeletionSection({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [boardsNeeding, setBoardsNeeding] = useState<BoardNeedingResolution[] | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const { boards } = await listBoards();
      const owned = boards.filter((b) => b.myRole === "OWNER");
      const needing: BoardNeedingResolution[] = [];
      for (const board of owned) {
        const { members } = await listMembers(board.id);
        if (members.length > 1) {
          needing.push({
            id: board.id,
            title: board.title,
            otherMembers: members.filter((m) => m.user.id !== userId),
          });
        }
      }
      setBoardsNeeding(needing);
    } catch {
      setError("Não foi possível carregar seus boards. Tente de novo.");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setBoardsNeeding(null);
    setChoices({});
    setError(null);
  }

  const allResolved = boardsNeeding !== null && boardsNeeding.every((b) => choices[b.id]);

  async function handleConfirmDelete() {
    setDeleting(true);
    setError(null);
    try {
      const resolutions: AccountDeletionResolution[] = (boardsNeeding ?? []).map((b) => {
        const choice = choices[b.id];
        return choice === "delete"
          ? { boardId: b.id, action: "delete" as const }
          : { boardId: b.id, action: "transfer" as const, newOwnerId: choice };
      });
      await deleteAccount(resolutions);
      disconnectSocket();
      clearToken();
      router.push("/");
    } catch {
      setError("Não foi possível excluir a conta. Tente de novo.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-card border border-red-200 bg-red-50/50 p-6 dark:border-red-900 dark:bg-red-950/20">
      <h2 className="mb-2 font-display text-base font-semibold text-red-700 dark:text-red-400">
        Zona de perigo
      </h2>
      <p className="mb-4 text-sm text-ink-soft">Excluir sua conta é uma ação permanente.</p>

      {!open && (
        <button
          onClick={handleOpen}
          className="rounded-card border border-red-300 px-5 py-2 text-base font-medium text-red-600 transition-colors hover:bg-red-600 hover:text-white dark:border-red-800"
        >
          Excluir minha conta
        </button>
      )}

      {open && loading && <p className="text-sm text-ink-soft">Carregando seus boards...</p>}

      {open && !loading && boardsNeeding !== null && boardsNeeding.length === 0 && (
        <ConfirmDialog
          open
          title="Excluir sua conta?"
          description="Essa ação não pode ser desfeita. Boards em que você é a única participante serão excluídos junto."
          pending={deleting}
          error={error}
          onConfirm={handleConfirmDelete}
          onCancel={handleClose}
        />
      )}

      {open && !loading && boardsNeeding !== null && boardsNeeding.length > 0 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium text-ink">Resolva os boards abaixo antes de continuar:</p>
          {boardsNeeding.map((board) => (
            <div key={board.id} className="rounded-card border border-surface-border bg-surface p-3">
              <p className="mb-2 text-sm font-medium text-ink">{board.title}</p>
              <select
                aria-label={`O que fazer com o board ${board.title}`}
                className="w-full rounded-card border border-surface-border bg-surface p-2 text-sm text-ink outline-none focus:border-brand-500"
                value={choices[board.id] ?? ""}
                onChange={(e) => setChoices((prev) => ({ ...prev, [board.id]: e.target.value }))}
              >
                <option value="" disabled>
                  Escolha o que fazer...
                </option>
                <option value="delete">Excluir este board</option>
                {board.otherMembers.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    Transferir posse para {m.user.name}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="rounded-card border border-surface-border px-4 py-2 text-sm text-ink-soft transition-colors hover:text-ink"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirmDelete}
              disabled={!allResolved || deleting}
              className="rounded-card bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              {deleting ? "Excluindo..." : "Confirmar exclusão da conta"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
