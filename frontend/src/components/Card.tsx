"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { deleteCard as apiDeleteCard, updateCard as apiUpdateCard } from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashIcon } from "./icons";

export interface CardData {
  id: string;
  title: string;
  description?: string | null;
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
 * Card arrastável dentro de uma lista, com edição de título inline e
 * exclusão. Não atualiza o próprio estado ao editar/excluir — só chama a
 * API; quem reflete a mudança na tela é o listener de socket no Board
 * ("card:updated"/"card:deleted"), igual pro dono da ação e pra quem
 * estiver assistindo.
 *
 * `onPointerDown={stopPropagation}` no input de edição e nos botões de
 * excluir evita que interagir com eles vire um "início de arrasto" (ex:
 * selecionar texto no input arrastando o mouse não deve mover o card).
 * O título em modo leitura (`<p>`) NÃO precisa disso: o PointerSensor já
 * distingue clique de arrasto pela distância percorrida
 * (`activationConstraint: { distance: 4 }` no Board), então um clique
 * parado continua abrindo a edição normalmente sem bloquear o drag.
 */
export function Card({ card }: { card: CardData }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  async function handleSaveTitle() {
    setEditing(false);
    const trimmed = title.trim();
    if (!trimmed || trimmed === card.title) {
      setTitle(card.title);
      return;
    }
    try {
      await apiUpdateCard(card.id, { title: trimmed });
    } catch {
      setTitle(card.title);
      setTitleError("Não foi possível salvar o título.");
    }
  }

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
      <div {...attributes} {...listeners} className="cursor-grab touch-none active:cursor-grabbing">
        <div className="rounded-card border border-surface-border bg-surface p-4 pr-8 text-base font-medium text-ink shadow-card transition-shadow hover:shadow-none">
          {editing ? (
            <input
              autoFocus
              className="w-full border-b border-brand-300 bg-transparent text-base font-medium text-ink outline-none"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <p onClick={() => setEditing(true)}>{card.title}</p>
          )}
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
      {titleError && <p className="text-xs text-red-600 dark:text-red-400">{titleError}</p>}
      <ConfirmDialog
        open={confirmOpen}
        title="Excluir este card?"
        description="Essa ação não pode ser desfeita."
        pending={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
