"use client";

import { useState } from "react";
import { createLabel as apiCreateLabel } from "@/lib/api";

export const LABEL_COLORS = [
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#3b82f6",
  "#06b6d4",
  "#64748b",
];

/**
 * Formulário de criar etiqueta (nome opcional + paleta de cores fixa) —
 * usado tanto no seletor de etiquetas dentro do card (CardDetailModal)
 * quanto direto na aba "Por etiqueta" do board, pra criar sem precisar
 * abrir nenhum card. Só cria — quem atualiza a paleta em todo lugar é o
 * evento "label:created" no socket (ver Board.tsx), então esse
 * componente nem guarda a etiqueta criada em lugar nenhum.
 */
export function CreateLabelForm({ boardId }: { boardId: string }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await apiCreateLabel(boardId, name.trim() || undefined, color);
      setName("");
    } catch {
      setError("Não foi possível criar a etiqueta.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome (opcional)"
        className="mb-2 w-full rounded-card border border-surface-border bg-surface p-2 text-sm text-ink outline-none transition-colors focus:border-brand-500"
      />
      <div className="mb-2 flex flex-wrap gap-1.5">
        {LABEL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            style={{ backgroundColor: c }}
            aria-label={`Cor ${c}`}
            className={`h-6 w-6 rounded-full ${
              color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""
            }`}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        className="w-full rounded-card bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
      >
        {creating ? "Criando..." : "Criar etiqueta"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
