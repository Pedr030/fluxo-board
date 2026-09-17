import { canEditCard, formatDueDate, isCardOverdue } from "@/components/Card";

describe("canEditCard", () => {
  const base = { assigneeIds: [] as string[] };

  it("membro não restrito sempre pode editar, mesmo card de outra pessoa", () => {
    expect(canEditCard({ assigneeIds: ["outro"] }, "eu", false)).toBe(true);
  });

  it("membro restrito pode editar card sem responsável (livre pra pegar)", () => {
    expect(canEditCard(base, "eu", true)).toBe(true);
  });

  it("membro restrito pode editar card atribuído a si mesmo", () => {
    expect(canEditCard({ assigneeIds: ["eu"] }, "eu", true)).toBe(true);
  });

  it("membro restrito pode editar card com vários responsáveis, se estiver entre eles", () => {
    expect(canEditCard({ assigneeIds: ["outro", "eu"] }, "eu", true)).toBe(true);
  });

  it("membro restrito NÃO pode editar card atribuído a outra pessoa", () => {
    expect(canEditCard({ assigneeIds: ["outro"] }, "eu", true)).toBe(false);
  });

  it("membro restrito sem currentUserId (edge case) não pode editar card atribuído", () => {
    expect(canEditCard({ assigneeIds: ["outro"] }, null, true)).toBe(false);
  });
});

describe("isCardOverdue", () => {
  it("sem prazo, nunca está vencido", () => {
    expect(isCardOverdue({ dueDate: null, completed: false })).toBe(false);
  });

  it("prazo no passado e não concluído: vencido", () => {
    expect(isCardOverdue({ dueDate: "2020-01-01T00:00:00.000Z", completed: false })).toBe(true);
  });

  it("prazo no passado mas concluído: não conta como vencido", () => {
    expect(isCardOverdue({ dueDate: "2020-01-01T00:00:00.000Z", completed: true })).toBe(false);
  });

  it("prazo no futuro: não vencido", () => {
    expect(isCardOverdue({ dueDate: "2999-01-01T00:00:00.000Z", completed: false })).toBe(false);
  });
});

describe("formatDueDate", () => {
  // Regressão: o prazo é salvo como meia-noite UTC do dia escolhido. Usar o
  // fuso local pra formatar (em vez de UTC) reinterpretaria essa meia-noite
  // e, em fusos atrás de UTC, mostraria o dia ANTERIOR ao escolhido — bug
  // real já corrigido nesse projeto (ver PROJECT_SPEC.md/histórico).
  it("formata a data escolhida, sem deslocar um dia por causa do fuso local", () => {
    expect(formatDueDate("2026-03-15T00:00:00.000Z")).toBe("15 de mar.");
  });
});
