import { Board } from "@/components/Board";

/**
 * Página de um board específico (`/board/:id`) — só repassa o id pro
 * componente cliente, que cuida de buscar os dados e conectar o socket.
 */
export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Board boardId={id} />;
}
