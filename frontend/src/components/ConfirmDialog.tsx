"use client";

import { useEffect, useRef } from "react";

/**
 * Modal de confirmação genérico pra ações destrutivas (excluir board/lista/
 * card). Fecha com Escape ou clicando no fundo. `pending`/`error` deixam o
 * botão de confirmar num estado de "Excluindo..." e mostram o erro dentro
 * do próprio modal, sem fechar sozinho — assim dá pra tentar de novo sem
 * reabrir a confirmação.
 *
 * z-[60], não z-50: precisa ficar por cima do CardDetailModal (z-50) quando
 * a exclusão é disparada de dentro dele.
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Foca o botão de cancelar ao abrir — é o destino mais seguro (evita
    // que um Enter acidental logo após abrir dispare a ação destrutiva).
    cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      // Prende o foco dentro do modal: só tem dois botões focáveis, então
      // Tab/Shift+Tab só precisa alternar entre eles.
      if (e.key === "Tab") {
        e.preventDefault();
        const focusingCancel = document.activeElement === cancelRef.current;
        (focusingCancel ? confirmRef.current : cancelRef.current)?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm rounded-card border border-surface-border bg-surface p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="font-display text-base font-semibold text-ink">
          {title}
        </h2>
        {description && <p className="mt-1.5 text-sm text-ink-soft">{description}</p>}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-card border border-surface-border px-3 py-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
          >
            Cancelar
          </button>
          <button
            ref={confirmRef}
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
