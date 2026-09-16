"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Label,
  Member,
  createCard as apiCreateCard,
  deleteList as apiDeleteList,
  updateList as apiUpdateList,
} from "@/lib/api";
import { Card, CardData } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { ArrowLeftIcon, TrashIcon } from "./icons";

export interface ListData {
  id: string;
  title: string;
  cards: CardData[];
}

/**
 * Uma coluna do board (ex: "A fazer", "Em progresso", "Feito"). Dois
 * mecanismos de drag-and-drop diferentes no mesmo componente, com ids
 * separados de propósito (`list-${list.id}` vs `list.id` puro) — senão o
 * dnd-kit registraria dois nós pro mesmo id e um atrapalharia o outro:
 *  - a lista inteira é arrastável (useSortable, id `list-${list.id}`,
 *    handle = cabeçalho) pra reordenar as colunas do board.
 *  - dentro dela, a área dos cards é "droppable" (useDroppable, id
 *    `list.id` puro — sem o prefixo) pra dar pra soltar um card numa lista
 *    vazia ou depois do último, e os cards ficam num SortableContext.
 * Igual ao Card: editar título/excluir/mover só chama a API — quem atualiza
 * a tela é o listener de socket no Board ("list:updated"/"list:deleted"/
 * "list:moved").
 */
export function List({
  list,
  labels,
  members,
  currentUserId,
  restricted,
  boardId,
}: {
  list: ListData;
  labels: Label[];
  members: Member[];
  currentUserId: string | null;
  restricted: boolean;
  boardId: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `list-${list.id}`, data: { type: "list", listId: list.id } });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: list.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  // Preferência de exibição de quem está vendo — não é estado do board
  // (não vai pro backend nem pro socket, cada pessoa colapsa do seu
  // jeito sem afetar quem mais está olhando o mesmo board). Guardada no
  // localStorage (não em estado só de memória) pra sobreviver a reload
  // e troca de aba Quadro/Por etiqueta, que desmontam o componente.
  const collapsedStorageKey = `fluxo_list_collapsed_${list.id}`;
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(collapsedStorageKey) === "1";
    } catch {
      return false;
    }
  });

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(collapsedStorageKey, next ? "1" : "0");
      } catch {
        // localStorage indisponível (modo privado, por exemplo) — só
        // não persiste entre sessões, o toggle em si continua funcionando.
      }
      return next;
    });
  }
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(list.title);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleCreateCard(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await apiCreateCard(list.id, title.trim());
      setTitle("");
    } catch {
      setCreateError("Não foi possível criar o card.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveTitle() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === list.title) {
      setTitleDraft(list.title);
      return;
    }
    try {
      await apiUpdateList(list.id, trimmed);
    } catch {
      setTitleDraft(list.title);
      setTitleError("Não foi possível renomear a lista.");
    }
  }

  async function handleDeleteList() {
    setDeleteError(null);
    setDeleting(true);
    try {
      await apiDeleteList(list.id);
      setConfirmOpen(false);
    } catch {
      setDeleteError("Não foi possível excluir a lista.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      ref={setSortableRef}
      style={style}
      className={`flex w-80 shrink-0 flex-col gap-3 rounded-list border border-surface-border bg-surface/70 p-4 ${
        collapsed ? "self-start" : ""
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        aria-label={`Lista "${list.title}" — arraste ou use as setas do teclado para reordenar`}
        className="group flex cursor-grab items-center justify-between gap-2 touch-none active:cursor-grabbing"
      >
        {editingTitle ? (
          <input
            autoFocus
            className="w-full border-b border-brand-300 bg-transparent font-display text-base font-semibold text-ink outline-none"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <h3
            onClick={() => setEditingTitle(true)}
            className="flex min-w-0 items-center gap-1.5 font-display text-base font-semibold text-ink"
          >
            <span className="truncate">{list.title}</span>
            {collapsed && (
              <span className="shrink-0 text-xs font-normal text-ink-soft">({list.cards.length})</span>
            )}
          </h3>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={toggleCollapsed}
            onPointerDown={(e) => e.stopPropagation()}
            className="rounded-full p-1.5 text-ink-soft transition-colors hover:bg-surface-border/50 hover:text-ink"
            aria-label={collapsed ? "Expandir lista" : "Colapsar lista"}
          >
            <ArrowLeftIcon
              className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : "-rotate-90"}`}
            />
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            onPointerDown={(e) => e.stopPropagation()}
            className="rounded-full p-1.5 text-ink-soft opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100"
            aria-label="Excluir lista"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {titleError && <p className="text-xs text-red-600 dark:text-red-400">{titleError}</p>}
      <ConfirmDialog
        open={confirmOpen}
        title={`Excluir a lista "${list.title}"?`}
        description="Os cards dela também serão excluídos. Essa ação não pode ser desfeita."
        pending={deleting}
        error={deleteError}
        onConfirm={handleDeleteList}
        onCancel={() => setConfirmOpen(false)}
      />
      {!collapsed && (
        <>
          <div ref={setDroppableRef} className="flex min-h-[40px] flex-col gap-3">
            <SortableContext items={list.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {list.cards.map((card) => (
                <Card
                  key={card.id}
                  card={card}
                  labels={labels}
                  members={members}
                  currentUserId={currentUserId}
                  restricted={restricted}
                  boardId={boardId}
                />
              ))}
            </SortableContext>
          </div>
          <form onSubmit={handleCreateCard} className="flex flex-col gap-1.5">
            <input
              className="rounded-card border border-surface-border bg-surface p-2.5 text-sm text-ink outline-none transition-colors focus:border-brand-500"
              placeholder="Novo card"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded-card p-1.5 text-sm font-medium text-brand-500 transition-colors hover:bg-brand-50 disabled:opacity-60 dark:hover:bg-brand-500/10"
            >
              {creating ? "Criando..." : "+ Adicionar card"}
            </button>
            {createError && <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>}
          </form>
        </>
      )}
    </div>
  );
}
