import { getActivityPageNumbers, moveCardInLists } from "@/components/Board";
import type { CardData } from "@/components/Card";
import type { ListData } from "@/components/List";

function card(id: string): CardData {
  return {
    id,
    title: id,
    dueDate: null,
    completed: false,
    labelIds: [],
    checklistItems: [],
    assignee: null,
  };
}

function list(id: string, cardIds: string[]): ListData {
  return { id, title: id, cards: cardIds.map(card), isTemplatesList: false };
}

describe("moveCardInLists", () => {
  it("move um card pra outra lista, no índice certo", () => {
    const lists = [list("A", ["1", "2"]), list("B", ["3"])];
    const result = moveCardInLists(lists, "1", "B", 0);
    expect(result.find((l) => l.id === "A")!.cards.map((c) => c.id)).toEqual(["2"]);
    expect(result.find((l) => l.id === "B")!.cards.map((c) => c.id)).toEqual(["1", "3"]);
  });

  it("reordena dentro da mesma lista", () => {
    const lists = [list("A", ["1", "2", "3"])];
    const result = moveCardInLists(lists, "1", "A", 2);
    expect(result[0].cards.map((c) => c.id)).toEqual(["2", "3", "1"]);
  });

  it("índice além do fim da lista de destino cai no final (clamp)", () => {
    const lists = [list("A", ["1"]), list("B", ["2"])];
    const result = moveCardInLists(lists, "1", "B", 99);
    expect(result.find((l) => l.id === "B")!.cards.map((c) => c.id)).toEqual(["2", "1"]);
  });

  it("card inexistente: devolve as listas sem mudança nenhuma", () => {
    const lists = [list("A", ["1"]), list("B", ["2"])];
    const result = moveCardInLists(lists, "fantasma", "B", 0);
    expect(result).toEqual(lists);
  });

  it("é idempotente: aplicar o mesmo evento de novo não duplica nem desalinha", () => {
    const lists = [list("A", ["1", "2"]), list("B", ["3"])];
    const once = moveCardInLists(lists, "1", "B", 0);
    const twice = moveCardInLists(once, "1", "B", 0);
    expect(twice).toEqual(once);
  });
});

describe("getActivityPageNumbers", () => {
  it("com poucas páginas (<=7), mostra todas sem reticências", () => {
    expect(getActivityPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("com muitas páginas, mantém reticências entre os grupos", () => {
    expect(getActivityPageNumbers(1, 20)).toEqual([1, 2, "…", 19, 20]);
  });

  it("no meio de muitas páginas, mostra uma janela em volta da atual", () => {
    expect(getActivityPageNumbers(10, 20)).toEqual([1, 2, "…", 9, 10, 11, "…", 19, 20]);
  });

  it("perto do fim, não duplica nem deixa reticência de um item só", () => {
    expect(getActivityPageNumbers(19, 20)).toEqual([1, 2, "…", 18, 19, 20]);
  });
});
