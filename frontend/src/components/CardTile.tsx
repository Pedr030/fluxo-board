"use client";

import { useState } from "react";
import { Label, deleteCard as apiDeleteCard } from "@/lib/api";
import { CardBody, CardData } from "./Card";
import { CardDetailModal } from "./CardDetailModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashIcon } from "./icons";

/**
 * Card não-arrastável — usado na aba "Por etiqueta" do board, que agrupa
 * os cards por etiqueta em vez de por lista. Ali não existe uma "lista de
 * destino" pra soltar, então dnd-kit não faz sentido (por isso não usa
 * `useSortable`, diferente do `Card` normal). Reusa o mesmo `CardBody` e
 * `CardDetailModal` — clicar continua abrindo os mesmos detalhes/edição
 * de sempre, incluindo trocar as etiquetas do card ali dentro.
 */
export function CardTile({
  card,
  labels,
  boardId,
}: {
  card: CardData;
  labels: Label[];
  boardId: string;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    try {
      await apiDeleteCard(card.id);
      setConfirmOpen(false);
    } catch {
      setDeleteError("Não foi possível excluir o card.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="group/card relative">
      <div
        onClick={() => setDetailOpen(true)}
        className="cursor-pointer rounded-card border border-surface-border bg-surface p-4 pr-8 text-base font-medium text-ink shadow-card transition-shadow hover:shadow-none"
      >
        <CardBody card={card} labels={labels} />
      </div>
      <button
        onClick={() => setConfirmOpen(true)}
        className="absolute right-1 top-1 hidden rounded-full p-1.5 text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-600 group-hover/card:block"
        aria-label="Excluir card"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Excluir este card?"
        description="Essa ação não pode ser desfeita."
        pending={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
      <CardDetailModal
        card={card}
        labels={labels}
        boardId={boardId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onDelete={() => setConfirmOpen(true)}
      />
    </div>
  );
}
