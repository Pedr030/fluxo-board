"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Label, deleteCard as apiDeleteCard } from "@/lib/api";
import { CardDetailModal } from "./CardDetailModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashIcon } from "./icons";

export interface CardData {
  id: string;
  title: string;
  description?: string | null;
  createdAt?: string;
  labelIds: string[];
}

/**
 * Visual "puro" do card, sem nada de drag-and-drop — usado tanto pelo
 * card normal (`Card`, abaixo) quanto pelo "fantasma" que segue o cursor
 * durante o arrasto (`DragOverlay` no Board). Não dá pra reusar o `Card`
 * direto ali porque ele chama useSortable(id: card.id) — dois elementos
 * montados ao mesmo tempo com o mesmo id de sortable confundiria o dnd-kit.
 */
export function CardView({ card }: { card: CardData }) {
  return (
    <div className="rounded-card border border-surface-border bg-surface p-4 text-base font-medium text-ink shadow-card">
      {card.title}
    </div>
  );
}

/**
 * Corpo visual do card (pills de etiqueta + título + prévia da descrição)
 * — usado tanto pelo `Card` arrastável (dentro de uma lista) quanto pelo
 * `CardTile` estático (aba "Por etiqueta", que agrupa por etiqueta em vez
 * de por lista e por isso não usa dnd-kit).
 */
export function CardBody({ card, labels }: { card: CardData; labels: Label[] }) {
  return (
    <>
      {card.labelIds.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {card.labelIds.map((labelId) => {
            const label = labels.find((l) => l.id === labelId);
            if (!label) return null;
            return (
              <span
                key={labelId}
                style={{ backgroundColor: label.color }}
                className="h-2 w-8 rounded-full"
                title={label.name ?? undefined}
              />
            );
          })}
        </div>
      )}
      <p>{card.title}</p>
      {card.description && (
        <p className="mt-2 line-clamp-2 break-words text-sm font-normal text-ink-soft">
          {card.description}
        </p>
      )}
    </>
  );
}

/**
 * Card arrastável dentro de uma lista. Clicar nele abre o painel de
 * detalhes (`CardDetailModal` — título e descrição vivem lá, estilo
 * Trello) em vez de editar o título direto no quadro. Excluir não
 * atualiza o próprio estado — só chama a API; quem reflete a mudança na
 * tela é o listener de socket no Board ("card:deleted"), igual pro dono
 * da ação e pra quem estiver assistindo.
 *
 * `onPointerDown={stopPropagation}` no botão de excluir evita que clicar
 * nele vire um "início de arrasto". O corpo do card (que abre o modal)
 * NÃO precisa disso: o PointerSensor já distingue clique de arrasto pela
 * distância percorrida (`activationConstraint: { distance: 4 }` no
 * Board), então um clique parado continua abrindo o modal normalmente
 * sem bloquear o drag.
 */
export function Card({
  card,
  labels,
  boardId,
}: {
  card: CardData;
  labels: Label[];
  boardId: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card" },
  });
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

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
    <div ref={setNodeRef} style={style} className="group relative">
      <div
        {...attributes}
        {...listeners}
        aria-label={`Card "${card.title}" — arraste ou use as setas do teclado para mover`}
        className="cursor-grab touch-none active:cursor-grabbing"
      >
        <div
          onClick={() => setDetailOpen(true)}
          className="cursor-pointer rounded-card border border-surface-border bg-surface p-4 pr-8 text-base font-medium text-ink shadow-card transition-shadow hover:shadow-none"
        >
          <CardBody card={card} labels={labels} />
        </div>
      </div>
      <button
        onClick={() => setConfirmOpen(true)}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-1 top-1 hidden rounded-full p-1.5 text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-600 group-hover:block"
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
