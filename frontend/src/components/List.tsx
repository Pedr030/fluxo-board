"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  createCard as apiCreateCard,
  deleteList as apiDeleteList,
  updateList as apiUpdateList,
} from "@/lib/api";
import { Card, CardData } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashIcon } from "./icons";

export interface ListData {
  id: string;
  title: string;
  cards: CardData[];
}

/**
 * Uma coluna do board (ex: "A fazer", "Em progresso", "Feito"). A própria
 * lista é uma área "droppable" (pra dar pra soltar um card numa lista vazia
 * ou depois do último card) e os cards ficam num SortableContext, que é
 * quem cuida da reordenação visual enquanto arrasta.
 * Igual ao Card: editar título ou excluir só chama a API — quem atualiza a
 * tela é o listener de socket no Board ("list:updated"/"list:deleted").
 */
export function List({ list }: { list: ListData }) {
  const { setNodeRef } = useDroppable({ id: list.id });
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
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
    <div className="group flex w-72 shrink-0 flex-col gap-2 rounded-list border border-surface-border bg-surface/70 p-3">
      <div className="flex items-center justify-between gap-2">
        {editingTitle ? (
          <input
            autoFocus
            className="w-full border-b border-brand-300 bg-transparent font-display text-sm font-semibold text-ink outline-none"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
          />
        ) : (
          <h3
            onClick={() => setEditingTitle(true)}
            className="font-display text-sm font-semibold text-ink"
          >
            {list.title}
          </h3>
        )}
        <button
          onClick={() => setConfirmOpen(true)}
          className="hidden shrink-0 rounded-card p-1 text-ink-soft transition-colors hover:text-red-600 group-hover:block"
          aria-label="Excluir lista"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
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
      <div ref={setNodeRef} className="flex min-h-[40px] flex-col gap-2">
        <SortableContext items={list.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {list.cards.map((card) => (
            <Card key={card.id} card={card} />
          ))}
        </SortableContext>
      </div>
      <form onSubmit={handleCreateCard} className="flex flex-col gap-1">
        <input
          className="rounded-card border border-surface-border bg-surface p-2 text-xs text-ink outline-none transition-colors focus:border-brand-500"
          placeholder="Novo card"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-card p-1 text-xs font-medium text-brand-500 transition-colors hover:bg-brand-50 disabled:opacity-60 dark:hover:bg-brand-500/10"
        >
          {creating ? "Criando..." : "+ Adicionar card"}
        </button>
        {createError && <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>}
      </form>
    </div>
  );
}
