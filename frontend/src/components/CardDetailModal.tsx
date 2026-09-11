"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Comment,
  createComment as apiCreateComment,
  deleteComment as apiDeleteComment,
  getMe,
  listComments,
  updateCard as apiUpdateCard,
} from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { Avatar } from "./Avatar";
import { CardData } from "./Card";
import { TrashIcon, XIcon } from "./icons";

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
 * descrição, anexos — placeholder ainda), coluna de comentários à
 * direita.
 */
export function CardDetailModal({
  card,
  open,
  onClose,
  onDelete,
}: {
  card: CardData;
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
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCommentsLoading(true);
    Promise.all([listComments(card.id), getMe()])
      .then(([commentsRes, meRes]) => {
        if (cancelled) return;
        setComments(commentsRes.comments);
        setCurrentUserId(meRes.user.id);
      })
      .catch(() => {
        if (!cancelled) setCommentError("Não foi possível carregar os comentários.");
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
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
    socket.on("comment:created", handleCommentCreated);
    socket.on("comment:deleted", handleCommentDeleted);
    return () => {
      socket.off("comment:created", handleCommentCreated);
      socket.off("comment:deleted", handleCommentDeleted);
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
            <h3 className="text-sm font-medium text-ink-soft">Anexos</h3>
            <p className="text-sm text-ink-soft">Em breve.</p>
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
              <div key={comment.id} className="group flex items-start gap-2">
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
                    className="hidden shrink-0 rounded-full p-1 text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-600 group-hover:block"
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
