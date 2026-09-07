import { Board } from "@/components/Board";

/**
 * Página de um board específico (`/board/:id`).
 * TODO:
 *  - Buscar os dados do board via src/lib/api.ts (GET /boards/:id)
 *  - Conectar ao socket e entrar na room do board (ver src/lib/socket.ts)
 *  - Passar os dados + handlers de mutação pro componente <Board />
 */
export default function BoardPage({ params }: { params: { id: string } }) {
  return <Board boardId={params.id} />;
}
