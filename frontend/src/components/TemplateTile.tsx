"use client";

import { useState } from "react";
import { Label, deleteCard as apiDeleteCard } from "@/lib/api";
import { CardBody, CardData } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { TemplateDetailModal } from "./TemplateDetailModal";
import { TrashIcon } from "./icons";

/**
 * Card-modelo na aba "Modelos" — mesma aparência de tile que um CardTile,
 * mas abre o TemplateDetailModal (só título/descrição/etiquetas/checklist)
 * em vez do CardDetailModal completo, e sem o toggle de "concluído" (não
 * se aplica a um modelo, que nunca é "trabalhado"). Sem checagem de membro
 * restrito: modelo nunca tem responsável, e canEditCard no backend já
 * libera qualquer membro pra mexer num card sem assignee.
 */
export function TemplateTile({
  template,
  labels,
  boardId,
}: {
  template: CardData;
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
      await apiDeleteCard(template.id);
      setConfirmOpen(false);
    } catch {
      setDeleteError("Não foi possível excluir o modelo.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="group/card relative">
      <div
        onClick={() => setDetailOpen(true)}
        className="cursor-pointer rounded-card border border-surface-border bg-surface p-4 pr-8 text-base font-medium text-ink shadow-card transition-all hover:shadow-none"
      >
        <CardBody card={template} labels={labels} />
      </div>
      <button
        onClick={() => setConfirmOpen(true)}
        className="absolute right-1 top-1 hidden rounded-full p-1.5 text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-600 group-hover/card:block"
        aria-label="Excluir modelo"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Excluir este modelo?"
        description="Essa ação não pode ser desfeita."
        pending={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
      <TemplateDetailModal
        template={template}
        labels={labels}
        boardId={boardId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onDelete={() => setConfirmOpen(true)}
      />
    </div>
  );
}
