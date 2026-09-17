"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ChecklistItem,
  Label,
  attachLabel as apiAttachLabel,
  createChecklistItem as apiCreateChecklistItem,
  deleteChecklistItem as apiDeleteChecklistItem,
  deleteLabel as apiDeleteLabel,
  detachLabel as apiDetachLabel,
  updateCard as apiUpdateCard,
  updateChecklistItem as apiUpdateChecklistItem,
} from "@/lib/api";
import { CardData } from "./Card";
import { CreateLabelForm } from "./CreateLabelForm";
import { CheckIcon, PlusIcon, TrashIcon, XIcon } from "./icons";

/**
 * Painel de detalhes de um modelo — versão enxuta do CardDetailModal, só
 * com os campos que um modelo de verdade carrega (ver copyCardContent no
 * backend): título, descrição, etiquetas e checklist. Sem responsável,
 * prazo, "concluído", anexos ou comentários — nenhum desses se aplica a
 * algo que nunca é "trabalhado", só copiado pra virar um card de verdade.
 */
export function TemplateDetailModal({
  template,
  labels,
  boardId,
  open,
  onClose,
  onDelete,
}: {
  template: CardData;
  labels: Label[];
  boardId: string;
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(template.title);
  const [editingDescription, setEditingDescription] = useState(false);
  const [description, setDescription] = useState(template.description ?? "");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [labelActionError, setLabelActionError] = useState<string | null>(null);
  const [addItemFormOpen, setAddItemFormOpen] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState("");
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(template.title);
  }, [template.title, editingTitle]);

  useEffect(() => {
    if (!editingDescription) setDescription(template.description ?? "");
  }, [template.description, editingDescription]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (labelPickerOpen) {
        setLabelPickerOpen(false);
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, labelPickerOpen]);

  if (!open) return null;

  async function handleSaveTitle() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === template.title) {
      setTitleDraft(template.title);
      return;
    }
    setTitleError(null);
    try {
      await apiUpdateCard(template.id, { title: trimmed });
    } catch {
      setTitleDraft(template.title);
      setTitleError("Não foi possível salvar o título.");
    }
  }

  async function handleSaveDescription() {
    setEditingDescription(false);
    const trimmed = description.trim();
    if (trimmed === (template.description ?? "")) return;
    setDescriptionError(null);
    try {
      await apiUpdateCard(template.id, { description: trimmed || null });
    } catch {
      setDescription(template.description ?? "");
      setDescriptionError("Não foi possível salvar a descrição.");
    }
  }

  async function handleToggleLabel(labelId: string) {
    setLabelActionError(null);
    try {
      if (template.labelIds.includes(labelId)) {
        await apiDetachLabel(template.id, labelId);
      } else {
        await apiAttachLabel(template.id, labelId);
      }
    } catch {
      setLabelActionError("Não foi possível atualizar a etiqueta.");
    }
  }

  async function handleDeleteLabel(labelId: string) {
    setLabelActionError(null);
    try {
      await apiDeleteLabel(labelId);
    } catch {
      setLabelActionError("Não foi possível excluir a etiqueta.");
    }
  }

  async function handleAddChecklistItem(e: FormEvent) {
    e.preventDefault();
    const trimmed = newItemText.trim();
    if (!trimmed) return;
    setAddingItem(true);
    setChecklistError(null);
    try {
      await apiCreateChecklistItem(template.id, trimmed);
      setNewItemText("");
      newItemInputRef.current?.focus();
    } catch {
      setChecklistError("Não foi possível adicionar o item.");
    } finally {
      setAddingItem(false);
    }
  }

  async function handleToggleChecklistItem(item: ChecklistItem) {
    setChecklistError(null);
    try {
      await apiUpdateChecklistItem(item.id, { done: !item.done });
    } catch {
      setChecklistError("Não foi possível atualizar o item.");
    }
  }

  async function handleSaveChecklistItemText(item: ChecklistItem) {
    setEditingItemId(null);
    const trimmed = editingItemText.trim();
    if (!trimmed || trimmed === item.text) return;
    try {
      await apiUpdateChecklistItem(item.id, { text: trimmed });
    } catch {
      setChecklistError("Não foi possível salvar o item.");
    }
  }

  async function handleDeleteChecklistItem(itemId: string) {
    setChecklistError(null);
    try {
      await apiDeleteChecklistItem(itemId);
    } catch {
      setChecklistError("Não foi possível excluir o item.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-detail-title"
        className="flex max-h-[85vh] w-[min(92vw,640px)] flex-col gap-5 overflow-y-auto rounded-card border border-surface-border bg-surface/70 p-8 shadow-card backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            {editingTitle ? (
              <input
                autoFocus
                className="w-full border-b border-brand-300 bg-transparent font-display text-xl font-semibold text-ink outline-none"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
              />
            ) : (
              <h2
                id="template-detail-title"
                onClick={() => setEditingTitle(true)}
                className="cursor-text font-display text-xl font-semibold text-ink"
              >
                {template.title}
              </h2>
            )}
            <p className="text-xs text-ink-soft">Modelo — não aparece no quadro nem tem responsável/prazo.</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onDelete}
              aria-label="Excluir modelo"
              className="rounded-full p-1.5 text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-600"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-full p-1.5 text-ink-soft transition-colors hover:bg-surface-border/50 hover:text-ink"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
        {titleError && <p className="text-sm text-red-600 dark:text-red-400">{titleError}</p>}

        <div className="relative flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink-soft">Etiquetas</h3>
            <button
              onClick={() => setLabelPickerOpen((v) => !v)}
              aria-label="Gerenciar etiquetas"
              className="rounded-full p-1.5 text-ink-soft transition-colors hover:bg-surface-border/50 hover:text-ink"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {template.labelIds.length === 0 && (
              <p className="text-sm text-ink-soft">Nenhuma etiqueta.</p>
            )}
            {template.labelIds.map((labelId) => {
              const label = labels.find((l) => l.id === labelId);
              if (!label) return null;
              return (
                <span
                  key={label.id}
                  style={{ backgroundColor: label.color }}
                  className="rounded-full px-3 py-1 text-xs font-medium text-white"
                >
                  {label.name || "    "}
                </span>
              );
            })}
          </div>
          {labelActionError && (
            <p className="text-sm text-red-600 dark:text-red-400">{labelActionError}</p>
          )}

          {labelPickerOpen && (
            <>
              <div className="fixed inset-0 z-[65]" onClick={() => setLabelPickerOpen(false)} />
              <div
                className="absolute right-0 top-8 z-[66] w-64 rounded-card border border-surface-border bg-surface p-3 shadow-card"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="mb-2 text-xs font-medium text-ink-soft">Etiquetas do board</p>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {labels.length === 0 && (
                    <p className="text-sm text-ink-soft">Nenhuma etiqueta criada ainda.</p>
                  )}
                  {labels.map((label) => {
                    const applied = template.labelIds.includes(label.id);
                    return (
                      <div key={label.id} className="group/label flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleToggleLabel(label.id)}
                          className="flex flex-1 items-center gap-2 rounded-card px-1 py-1 text-left hover:bg-surface-border/30"
                        >
                          <span
                            style={{ backgroundColor: label.color }}
                            className="flex h-7 flex-1 items-center rounded-card px-2 text-xs font-medium text-white"
                          >
                            {label.name}
                          </span>
                          {applied && <CheckIcon className="h-4 w-4 shrink-0 text-ink" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLabel(label.id)}
                          aria-label={`Excluir etiqueta${label.name ? ` ${label.name}` : ""}`}
                          className="shrink-0 rounded-full p-1 text-ink-soft opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-600 group-hover/label:opacity-100"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 border-t border-surface-border pt-3">
                  <p className="mb-2 text-xs font-medium text-ink-soft">Criar etiqueta</p>
                  <CreateLabelForm boardId={boardId} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="template-detail-description" className="text-sm font-medium text-ink-soft">
            Descrição
          </label>
          {editingDescription ? (
            <textarea
              id="template-detail-description"
              autoFocus
              rows={5}
              className="w-full resize-y rounded-card border border-brand-300 bg-surface p-3 text-sm text-ink outline-none"
              placeholder="Adicionar uma descrição mais detalhada..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleSaveDescription}
            />
          ) : (
            <p
              onClick={() => setEditingDescription(true)}
              className={`cursor-text whitespace-pre-wrap rounded-card border border-transparent p-3 text-sm transition-colors hover:border-surface-border hover:bg-surface-border/20 ${
                template.description ? "text-ink" : "text-ink-soft"
              }`}
            >
              {template.description || "Adicionar uma descrição mais detalhada..."}
            </p>
          )}
          {descriptionError && (
            <p className="text-sm text-red-600 dark:text-red-400">{descriptionError}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink-soft">Checklist</h3>
            <button
              onClick={() => setAddItemFormOpen(true)}
              aria-label="Adicionar item"
              className="rounded-full p-1.5 text-ink-soft transition-colors hover:bg-surface-border/50 hover:text-ink"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
          {template.checklistItems.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-border/50">
                <div
                  className="h-full rounded-full bg-flow-500 transition-all"
                  style={{
                    width: `${
                      (template.checklistItems.filter((i) => i.done).length /
                        template.checklistItems.length) *
                      100
                    }%`,
                  }}
                />
              </div>
              <span className="shrink-0 text-xs text-ink-soft">
                {template.checklistItems.filter((i) => i.done).length}/{template.checklistItems.length}
              </span>
            </div>
          )}
          <div className="flex flex-col gap-1">
            {template.checklistItems.map((item) => (
              <div key={item.id} className="group/checklist-item flex items-center gap-2">
                <button
                  onClick={() => handleToggleChecklistItem(item)}
                  aria-label={item.done ? "Desmarcar item" : "Marcar item como feito"}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-card border transition-colors ${
                    item.done
                      ? "border-flow-500 bg-flow-500 text-white"
                      : "border-surface-border text-transparent hover:border-brand-400"
                  }`}
                >
                  <CheckIcon className="h-3.5 w-3.5" />
                </button>
                {editingItemId === item.id ? (
                  <input
                    autoFocus
                    value={editingItemText}
                    onChange={(e) => setEditingItemText(e.target.value)}
                    onBlur={() => handleSaveChecklistItemText(item)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveChecklistItemText(item)}
                    className="flex-1 border-b border-brand-300 bg-transparent text-sm text-ink outline-none"
                  />
                ) : (
                  <p
                    onClick={() => {
                      setEditingItemId(item.id);
                      setEditingItemText(item.text);
                    }}
                    className={`flex-1 cursor-text text-sm ${
                      item.done ? "text-ink-soft line-through" : "text-ink"
                    }`}
                  >
                    {item.text}
                  </p>
                )}
                <button
                  onClick={() => handleDeleteChecklistItem(item.id)}
                  aria-label="Excluir item"
                  className="hidden shrink-0 rounded-full p-1 text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-600 group-hover/checklist-item:block"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {checklistError && (
            <p className="text-sm text-red-600 dark:text-red-400">{checklistError}</p>
          )}
          {addItemFormOpen && (
            <form onSubmit={handleAddChecklistItem} className="flex gap-2">
              <input
                ref={newItemInputRef}
                autoFocus
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onBlur={() => {
                  if (!newItemText.trim()) setAddItemFormOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setNewItemText("");
                    setAddItemFormOpen(false);
                  }
                }}
                placeholder="Adicionar item..."
                className="flex-1 rounded-card border border-surface-border bg-surface p-2 text-sm text-ink outline-none transition-colors focus:border-brand-500"
              />
              <button
                type="submit"
                disabled={!newItemText.trim() || addingItem}
                className="rounded-card bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
              >
                {addingItem ? "..." : "Adicionar"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
