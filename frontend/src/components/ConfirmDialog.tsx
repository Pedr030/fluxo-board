"use client";

import { useEffect } from "react";

/**
 * Modal de confirmação genérico pra ações destrutivas (excluir board/lista/
 * card). Fecha com Escape ou clicando no fundo. `pending`/`error` deixam o
 * botão de confirmar num estado de "Excluindo..." e mostram o erro dentro
 * do próprio modal, sem fechar sozinho — assim dá pra tentar de novo sem
 * reabrir a confirmação.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Excluir",
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-card border border-surface-border bg-surface p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1.5 text-sm text-ink-soft">{description}</p>}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-card border border-surface-border px-3 py-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-card bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {pending ? "Excluindo..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
