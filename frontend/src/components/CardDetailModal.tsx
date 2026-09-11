"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import {
  Attachment,
  ChecklistItem,
  Comment,
  Label,
  attachLabel as apiAttachLabel,
  createAttachment as apiCreateAttachment,
  createChecklistItem as apiCreateChecklistItem,
  createComment as apiCreateComment,
  deleteAttachment as apiDeleteAttachment,
  deleteChecklistItem as apiDeleteChecklistItem,
  deleteComment as apiDeleteComment,
  deleteLabel as apiDeleteLabel,
  detachLabel as apiDetachLabel,
  getMe,
  listAttachments,
  listComments,
  updateCard as apiUpdateCard,
  updateChecklistItem as apiUpdateChecklistItem,
} from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { Avatar } from "./Avatar";
import { CardData, isCardOverdue } from "./Card";
import { CreateLabelForm } from "./CreateLabelForm";
import { CalendarIcon, CameraIcon, CheckIcon, PlusIcon, TrashIcon, XIcon } from "./icons";

/**
 * Painel de detalhes do card (estilo Trello: clicar no card abre isso em
 * vez de editar o título direto no quadro, e ocupa boa parte da tela em
 * vez de um dialog pequeno centralizado). `card` vem como prop reativa —
 * o mesmo objeto que o Board mantém atualizado via socket ("card:updated"
 * etc) — então edições de outra pessoa aparecem aqui sozinhas, sem esse
 * componente precisar buscar nada por conta própria.
 *
 * Comentários são a exceção: não vêm com o board (ver PROJECT_SPEC.md —
 * GET /boards/:id não inclui comentário nenhum, pra não inflar o payload
 * de todo card com threads que a maioria nem tem), então esse componente
 * busca a própria lista quando abre e escuta "comment:created"/
 * "comment:deleted" no socket enquanto estiver aberto — mesma regra de
 * ouro do resto do app: o POST/DELETE só persiste, quem atualiza a tela
 * é o evento (chega pra todo mundo na room, inclusive quem editou).
 *
 * Layout em duas colunas: conteúdo principal à esquerda (título,
 * descrição, anexos), coluna de comentários à direita.
 */
export function CardDetailModal({
  card,
  labels,
  boardId,
  open,
  onClose,
  onDelete,
}: {
  card: CardData;
  labels: Label[];
  boardId: string;
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(card.title);
  const [editingDescription, setEditingDescription] = useState(false);
  const [description, setDescription] = useState(card.description ?? "");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [newCommentText, setNewCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [labelActionError, setLabelActionError] = useState<string | null>(null);
  const [addItemFormOpen, setAddItemFormOpen] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState("");
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [dueDateError, setDueDateError] = useState<string | null>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(card.title);
  }, [card.title, editingTitle]);

  useEffect(() => {
    if (!editingDescription) setDescription(card.description ?? "");
  }, [card.description, editingDescription]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Escape fecha primeiro o lightbox (se tiver uma imagem expandida
      // aberta), só fecha o modal inteiro quando não tem nenhum lightbox.
      if (lightboxUrl) {
        setLightboxUrl(null);
      } else if (labelPickerOpen) {
        setLabelPickerOpen(false);
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, lightboxUrl, labelPickerOpen]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCommentsLoading(true);
    setAttachmentsLoading(true);
    Promise.all([listComments(card.id), listAttachments(card.id), getMe()])
      .then(([commentsRes, attachmentsRes, meRes]) => {
        if (cancelled) return;
        setComments(commentsRes.comments);
        setAttachments(attachmentsRes.attachments);
        setCurrentUserId(meRes.user.id);
      })
      .catch(() => {
        if (cancelled) return;
        setCommentError("Não foi possível carregar os comentários.");
        setAttachmentError("Não foi possível carregar os anexos.");
      })
      .finally(() => {
        if (cancelled) return;
        setCommentsLoading(false);
        setAttachmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, card.id]);

  useEffect(() => {
    if (!open) return;
    const socket = getSocket();
    function handleCommentCreated({ comment, cardId }: { comment: Comment; cardId: string }) {
      if (cardId !== card.id) return;
      setComments((prev) => [...prev, comment]);
    }
    function handleCommentDeleted({ commentId, cardId }: { commentId: string; cardId: string }) {
      if (cardId !== card.id) return;
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    }
    function handleAttachmentCreated({ attachment, cardId }: { attachment: Attachment; cardId: string }) {
      if (cardId !== card.id) return;
      setAttachments((prev) => [...prev, attachment]);
    }
    function handleAttachmentDeleted({ attachmentId, cardId }: { attachmentId: string; cardId: string }) {
      if (cardId !== card.id) return;
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    }
    socket.on("comment:created", handleCommentCreated);
    socket.on("comment:deleted", handleCommentDeleted);
    socket.on("attachment:created", handleAttachmentCreated);
    socket.on("attachment:deleted", handleAttachmentDeleted);
    return () => {
      socket.off("comment:created", handleCommentCreated);
      socket.off("comment:deleted", handleCommentDeleted);
      socket.off("attachment:created", handleAttachmentCreated);
      socket.off("attachment:deleted", handleAttachmentDeleted);
    };
  }, [open, card.id]);

  if (!open) return null;

  async function handleSaveTitle() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === card.title) {
      setTitleDraft(card.title);
      return;
    }
    setTitleError(null);
    try {
      await apiUpdateCard(card.id, { title: trimmed });
    } catch {
      setTitleDraft(card.title);
      setTitleError("Não foi possível salvar o título.");
    }
  }

  async function handleSaveDescription() {
    setEditingDescription(false);
    const trimmed = description.trim();
    if (trimmed === (card.description ?? "")) return;
    setDescriptionError(null);
    try {
      await apiUpdateCard(card.id, { description: trimmed || null });
    } catch {
      setDescription(card.description ?? "");
      setDescriptionError("Não foi possível salvar a descrição.");
    }
  }

  async function handleSubmitComment(e: FormEvent) {
    e.preventDefault();
    const trimmed = newCommentText.trim();
    if (!trimmed) return;
    setPostingComment(true);
    setCommentError(null);
    try {
      await apiCreateComment(card.id, trimmed);
      setNewCommentText("");
    } catch {
      setCommentError("Não foi possível enviar o comentário.");
    } finally {
      setPostingComment(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    setCommentError(null);
    try {
      await apiDeleteComment(commentId);
    } catch {
      setCommentError("Não foi possível excluir o comentário.");
    }
  }

  async function handleUploadAttachment(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;
    setUploadingAttachment(true);
    setAttachmentError(null);
    try {
      await apiCreateAttachment(card.id, file);
    } catch {
      setAttachmentError("Não foi possível enviar o anexo.");
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    setAttachmentError(null);
    try {
      await apiDeleteAttachment(attachmentId);
    } catch {
      setAttachmentError("Não foi possível excluir o anexo.");
    }
  }

  async function handleToggleLabel(labelId: string) {
    setLabelActionError(null);
    try {
      if (card.labelIds.includes(labelId)) {
        await apiDetachLabel(card.id, labelId);
      } else {
        await apiAttachLabel(card.id, labelId);
      }
    } catch {
      setLabelActionError("Não foi possível atualizar a etiqueta.");
    }
  }

  async function handleChangeDueDate(value: string) {
    setDueDateError(null);
    try {
      await apiUpdateCard(card.id, { dueDate: value || null });
    } catch {
      setDueDateError("Não foi possível salvar o prazo.");
    }
  }

  async function handleToggleCompleted() {
    setDueDateError(null);
    try {
      await apiUpdateCard(card.id, { completed: !card.completed });
    } catch {
      setDueDateError("Não foi possível atualizar o status.");
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
      await apiCreateChecklistItem(card.id, trimmed);
      setNewItemText("");
      // Igual Trello: depois de adicionar, o campo continua aberto e em
      // foco, pronto pro próximo item — só fecha quando a pessoa clica
      // fora ou aperta Escape. Sem isso, adicionar vários itens seguidos
      // exigiria reabrir o formulário a cada um.
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
      className="fixed inset-0 z-50 flex items-stretch justify-start bg-black/30 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-detail-title"
        className="flex h-full w-[min(92vw,1600px)] overflow-hidden rounded-card border border-surface-border bg-surface/70 shadow-card backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-8">
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
                  id="card-detail-title"
                  onClick={() => setEditingTitle(true)}
                  className="cursor-text font-display text-xl font-semibold text-ink"
                >
                  {card.title}
                </h2>
              )}
              {card.createdAt && (
                <p className="text-xs text-ink-soft">Criado em {formatDate(card.createdAt)}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={onDelete}
                aria-label="Excluir card"
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
              {card.labelIds.length === 0 && (
                <p className="text-sm text-ink-soft">Nenhuma etiqueta.</p>
              )}
              {card.labelIds.map((labelId) => {
                const label = labels.find((l) => l.id === labelId);
                if (!label) return null;
                return (
                  <span
                    key={label.id}
                    style={{ backgroundColor: label.color }}
                    className="rounded-full px-3 py-1 text-xs font-medium text-white"
                  >
                    {label.name || "    "}
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
                      const applied = card.labelIds.includes(label.id);
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
            <h3 className="text-sm font-medium text-ink-soft">Prazo</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleToggleCompleted}
                aria-label={card.completed ? "Desmarcar como concluído" : "Marcar como concluído"}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-card border transition-colors ${
                  card.completed
                    ? "border-flow-500 bg-flow-500 text-white"
                    : "border-surface-border text-transparent hover:border-brand-400"
                }`}
              >
                <CheckIcon className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1 rounded-card border border-surface-border bg-surface px-2 py-1 text-sm text-ink transition-colors focus-within:border-brand-500">
                <CalendarIcon className="h-4 w-4 shrink-0 text-ink-soft" />
                <input
                  type="date"
                  aria-label="Data de vencimento"
                  value={card.dueDate ? card.dueDate.slice(0, 10) : ""}
                  onChange={(e) => handleChangeDueDate(e.target.value)}
                  className="bg-transparent outline-none [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
              {card.dueDate && (
                <button
                  type="button"
                  onClick={() => handleChangeDueDate("")}
                  aria-label="Remover prazo"
                  className="rounded-full p-1 text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-600"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
              {card.completed ? (
                <span className="text-xs font-medium text-flow-600 dark:text-flow-400">Concluído</span>
              ) : (
                isCardOverdue(card) && (
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">Vencido</span>
                )
              )}
            </div>
            {dueDateError && <p className="text-sm text-red-600 dark:text-red-400">{dueDateError}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="card-detail-description" className="text-sm font-medium text-ink-soft">
              Descrição
            </label>
            {editingDescription ? (
              <textarea
                id="card-detail-description"
                autoFocus
                rows={6}
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
                  card.description ? "text-ink" : "text-ink-soft"
                }`}
              >
                {card.description || "Adicionar uma descrição mais detalhada..."}
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
            {card.checklistItems.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-border/50">
                  <div
                    className="h-full rounded-full bg-flow-500 transition-all"
                    style={{
                      width: `${
                        (card.checklistItems.filter((i) => i.done).length /
                          card.checklistItems.length) *
                        100
                      }%`,
                    }}
                  />
                </div>
                <span className="shrink-0 text-xs text-ink-soft">
                  {card.checklistItems.filter((i) => i.done).length}/{card.checklistItems.length}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              {card.checklistItems.map((item) => (
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
                    // Igual Trello: clicar fora fecha o campo (sem
                    // confirmar nada digitado e não enviado) — só não
                    // fecha logo depois de mandar um item (o próprio
                    // handleAddChecklistItem já devolve o foco pro campo,
                    // o que dispararia esse blur/focus em sequência).
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

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink-soft">Anexos</h3>
              <label
                aria-label="Adicionar anexo"
                className="cursor-pointer rounded-full p-1.5 text-ink-soft transition-colors hover:bg-surface-border/50 hover:text-ink"
              >
                <CameraIcon className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleUploadAttachment}
                />
              </label>
            </div>
            {attachmentError && <p className="text-sm text-red-600 dark:text-red-400">{attachmentError}</p>}
            {!attachmentsLoading && attachments.length === 0 && !uploadingAttachment && (
              <p className="text-sm text-ink-soft">Nenhum anexo ainda.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="group/attachment relative inline-block overflow-hidden rounded-card border border-surface-border bg-surface-border/10"
                >
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(attachment.url)}
                    aria-label={`Expandir anexo ${attachment.filename}`}
                    className="block"
                  >
                    <img
                      src={attachment.url}
                      alt={attachment.filename}
                      className="h-36 w-auto max-w-56 object-contain"
                    />
                  </button>
                  {attachment.uploader?.id === currentUserId && (
                    <button
                      onClick={() => handleDeleteAttachment(attachment.id)}
                      aria-label="Excluir anexo"
                      className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-red-600 group-hover/attachment:block"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {uploadingAttachment && (
                <div className="flex h-36 w-36 items-center justify-center rounded-card border border-dashed border-surface-border text-xs text-ink-soft">
                  Enviando...
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="hidden w-80 shrink-0 flex-col gap-3 border-l border-surface-border p-6 sm:flex">
          <h3 className="font-display text-sm font-semibold text-ink">Comentários</h3>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
            {commentsLoading && comments.length === 0 && (
              <p className="text-sm text-ink-soft">Carregando...</p>
            )}
            {!commentsLoading && comments.length === 0 && (
              <p className="text-sm text-ink-soft">Nenhum comentário ainda.</p>
            )}
            {comments.map((comment) => (
              <div key={comment.id} className="group/comment flex items-start gap-2">
                <Avatar
                  name={comment.author?.name ?? "?"}
                  avatarUrl={comment.author?.avatarUrl}
                  className="h-7 w-7 shrink-0"
                />
                <div className="min-w-0 flex-1 rounded-card bg-surface-border/20 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-ink">
                      {comment.author?.name ?? "Usuário removido"}
                    </span>
                    <span className="shrink-0 text-xs text-ink-soft">
                      {formatTime(comment.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">
                    {comment.text}
                  </p>
                </div>
                {comment.author?.id === currentUserId && (
                  <button
                    onClick={() => handleDeleteComment(comment.id)}
                    aria-label="Excluir comentário"
                    className="hidden shrink-0 rounded-full p-1 text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-600 group-hover/comment:block"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmitComment} className="flex flex-col gap-2">
            <textarea
              rows={2}
              className="w-full resize-none rounded-card border border-surface-border bg-surface p-2.5 text-sm text-ink outline-none transition-colors focus:border-brand-500"
              placeholder="Escrever um comentário..."
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
            />
            <button
              type="submit"
              disabled={!newCommentText.trim() || postingComment}
              className="self-end rounded-card bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              {postingComment ? "Enviando..." : "Comentar"}
            </button>
          </form>
          {commentError && <p className="text-sm text-red-600 dark:text-red-400">{commentError}</p>}
        </div>
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6"
          onClick={(e) => {
            e.stopPropagation();
            setLightboxUrl(null);
          }}
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-h-full max-w-full rounded-card object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            aria-label="Fechar imagem"
            className="absolute right-6 top-6 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
          >
            <XIcon className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
