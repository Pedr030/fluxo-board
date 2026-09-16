"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChecklistItem,
  Label,
  Member,
  deleteCard as apiDeleteCard,
  updateCard as apiUpdateCard,
} from "@/lib/api";
import { Avatar } from "./Avatar";
import { CardDetailModal } from "./CardDetailModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { CalendarIcon, CheckIcon, TrashIcon } from "./icons";

export interface CardData {
  id: string;
  title: string;
  description?: string | null;
  createdAt?: string;
  dueDate: string | null;
  completed: boolean;
  labelIds: string[];
  checklistItems: ChecklistItem[];
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
}

/**
 * "Vencido" = prazo já passou e o card não foi marcado como concluído.
 * Compara strings "YYYY-MM-DD" em vez de instantes (Date): o prazo é
 * salvo como meia-noite UTC do dia escolhido, e comparar Date objects
 * diretamente reinterpreta esse instante no fuso local — em fusos atrás
 * de UTC (ex: Brasil, UTC-3) isso faria um card vencendo "hoje" já
 * aparecer vencido horas antes da meia-noite local. Comparando só a
 * data (string) o resultado não depende do fuso de quem está vendo.
 */
export function isCardOverdue(card: Pick<CardData, "dueDate" | "completed">): boolean {
  if (!card.dueDate || card.completed) return false;
  return card.dueDate.slice(0, 10) < todayDateString();
}

/**
 * Espelha a checagem do backend (`canEditCard` em authorization.ts): um
 * membro "restricted" só edita/move/exclui cards atribuídos a ele mesmo
 * (ou sem responsável nenhum — livres pra pegar). Usado só pra já
 * esconder/desabilitar os controles certos na tela — o backend reforça
 * de qualquer forma, isso aqui é só pra não deixar a pessoa tentar algo
 * que vai voltar 403.
 */
export function canEditCard(
  card: Pick<CardData, "assignee">,
  currentUserId: string | null,
  restricted: boolean
): boolean {
  if (!restricted) return true;
  return card.assignee === null || card.assignee.id === currentUserId;
}

function todayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// timeZone: "UTC" pelo mesmo motivo do comentário acima — sem isso,
// toLocaleDateString reinterpreta a meia-noite UTC salva no fuso local
// e pode exibir o dia anterior.
export function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
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
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1">{card.title}</p>
        {card.assignee && (
          <span title={`Responsável: ${card.assignee.name}`} className="shrink-0">
            <Avatar name={card.assignee.name} avatarUrl={card.assignee.avatarUrl} className="h-6 w-6 text-xs" />
          </span>
        )}
      </div>
      {card.description && (
        <p className="mt-2 line-clamp-2 break-words text-sm font-normal text-ink-soft">
          {card.description}
        </p>
      )}
      {(card.checklistItems.length > 0 || card.dueDate || card.completed) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {card.checklistItems.length > 0 && (
            <div
              className={`flex w-fit items-center gap-1 rounded-card px-1.5 py-0.5 text-xs font-medium ${
                card.checklistItems.every((i) => i.done)
                  ? "bg-flow-100 text-flow-700 dark:bg-flow-500/20 dark:text-flow-400"
                  : "bg-surface-border/50 text-ink-soft"
              }`}
            >
              <CheckIcon className="h-3 w-3" />
              {card.checklistItems.filter((i) => i.done).length}/{card.checklistItems.length}
            </div>
          )}
          {card.completed && !card.dueDate && (
            <div className="flex w-fit items-center gap-1 rounded-card bg-flow-100 px-1.5 py-0.5 text-xs font-medium text-flow-700 dark:bg-flow-500/20 dark:text-flow-400">
              <CheckIcon className="h-3 w-3" />
              Concluído
            </div>
          )}
          {card.dueDate && (
            <div
              className={`flex w-fit items-center gap-1 rounded-card px-1.5 py-0.5 text-xs font-medium ${
                card.completed
                  ? "bg-flow-100 text-flow-700 dark:bg-flow-500/20 dark:text-flow-400"
                  : isCardOverdue(card)
                  ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
                  : "bg-surface-border/50 text-ink-soft"
              }`}
            >
              <CalendarIcon className="h-3 w-3" />
              {formatDueDate(card.dueDate)}
            </div>
          )}
        </div>
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
  members,
  currentUserId,
  restricted,
  boardId,
}: {
  card: CardData;
  labels: Label[];
  members: Member[];
  currentUserId: string | null;
  restricted: boolean;
  boardId: string;
}) {
  const editable = canEditCard(card, currentUserId, restricted);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !editable,
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

  // Sem tratamento de erro visível de propósito: é um toggle rápido
  // direto no quadro, sem lugar pra mostrar mensagem de erro por perto.
  // Se a chamada falhar, nenhum evento de socket chega e o card
  // simplesmente não muda — dá pra tentar de novo.
  async function handleToggleComplete() {
    try {
      await apiUpdateCard(card.id, { completed: !card.completed });
    } catch {
      // silencioso, ver comentário acima
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="group/card relative">
      <div
        {...attributes}
        {...listeners}
        aria-label={`Card "${card.title}" — arraste ou use as setas do teclado para mover`}
        className={editable ? "cursor-grab touch-none active:cursor-grabbing" : "touch-none"}
      >
        <div
          onClick={() => setDetailOpen(true)}
          className={`cursor-pointer rounded-card border border-surface-border bg-surface p-4 pr-8 text-base font-medium text-ink shadow-card transition-all hover:shadow-none ${
            card.completed ? "opacity-50" : ""
          }`}
        >
          <CardBody card={card} labels={labels} />
        </div>
      </div>
      {editable && (
        <>
          <button
            onClick={() => setConfirmOpen(true)}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute right-1 top-1 hidden rounded-full p-1.5 text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-600 group-hover/card:block"
            aria-label="Excluir card"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleComplete();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={card.completed ? "Desmarcar como concluído" : "Marcar como concluído"}
            className={`absolute right-1.5 top-9 hidden h-5 w-5 items-center justify-center rounded-full border transition-colors group-hover/card:flex ${
              card.completed
                ? "border-flow-500 bg-flow-500 text-white"
                : "border-surface-border bg-surface text-transparent hover:border-flow-400"
            }`}
          >
            <CheckIcon className="h-3 w-3" />
          </button>
        </>
      )}
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
        members={members}
        canEdit={editable}
        boardId={boardId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onDelete={() => setConfirmOpen(true)}
      />
    </div>
  );
}
