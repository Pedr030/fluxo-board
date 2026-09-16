# Fluxo

![CI](https://github.com/Pedr030/fluxo-board/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

**Kanban board colaborativo em tempo real.** Múltiplas pessoas editando o
mesmo board e vendo a mudança da outra instantaneamente, sem recarregar a
página — esse é o diferencial em relação a um "Trello clone" genérico, e o
que este projeto foi feito para provar bem feito.

**[Demo ao vivo →](https://fluxo-board.vercel.app)**

Projeto de portfólio full-stack: modelagem de dados relacional,
autenticação, API REST, sincronização em tempo real via WebSocket,
frontend reativo, upload de arquivos e deploy em produção.

---

## Por que "colaborativo em tempo real" e não só CRUD

Toda mutação do sistema — criar card, mover entre listas, comentar, marcar
como concluído, o que for — segue sempre a mesma regra:

1. O cliente chama uma rota REST.
2. A rota persiste a mudança no Postgres via Prisma.
3. **Só depois de persistir com sucesso**, a rota emite um evento via
   Socket.io para todo mundo conectado na "room" daquele board —
   **incluindo quem fez a ação**.
4. O frontend nunca atualiza a tela a partir da resposta do REST; ele só
   reage ao evento de socket. Isso significa que o autor da ação e quem
   está só olhando reagem exatamente da mesma forma, sem duplicar lógica de
   estado entre os dois casos.

A única exceção deliberada é o drag-and-drop de cards, que atualiza o
estado local otimisticamente no momento do drop (esperar o round-trip do
socket faria o card "voltar" e "pular" visualmente) — mas a persistência via
REST e a reconciliação via socket continuam acontecendo por trás, de forma
idempotente.

## Funcionalidades

**Boards, listas e cards**
- Boards com dono (`OWNER`), admin (`ADMIN`, convida membros — sem
  privilégio extra sobre cards) e membro (`MEMBER`) convidados por e-mail
- Atribuição de responsável (assignee) por card, e um flag `restricted`
  por membro (independente do cargo): quem está restrito só edita, move ou
  exclui os cards atribuídos a si mesmo (ou sem responsável ainda) — o
  dono ativa por pessoa na aba Membros
- Listas e cards com CRUD completo, reordenáveis por drag-and-drop
  (`@dnd-kit`, com suporte a teclado) dentro da lista, entre listas, e entre
  listas do próprio board
- Colunas colapsáveis (preferência por viewer, persistida em
  `localStorage`, sobrevive a reload)

**No card**
- Painel de detalhes em estilo modal (glassmorphism), com título e
  descrição editáveis inline
- Etiquetas coloridas (paleta compartilhada do board, 3 etiquetas padrão
  criadas automaticamente) — aplicar/remover por card, e uma aba "Por
  etiqueta" que agrupa o board inteiro por etiqueta em vez de por lista,
  com filtro de pendente/concluído e sidebar colapsável
- Checklist com progresso, no mesmo padrão de UX do Trello (campo de novo
  item revelado no hover, permanece aberto após cada adição)
- Data de vencimento + status "concluído" **independente** um do outro —
  toggle direto no card fechado (sem abrir o modal), card perde destaque
  visual quando concluído
- Comentários (só o autor exclui) e anexos de imagem (Supabase Storage, com
  visualização em lightbox; só quem enviou exclui)

**Board**
- **Histórico de atividade** em tempo real, paginado: quem fez o quê e
  quando (criar/mover/excluir card e lista, concluir/reabrir, comentar,
  convidar membro, mudar cargo/restrição) — guardado como um retrato
  congelado no momento da ação, não uma junção viva, então continua fazendo
  sentido mesmo depois do card ou lista em questão ser excluído
- Presença ao vivo: avatares de quem está com o board aberto agora
- Modo claro/escuro persistido

**Conta**
- Autenticação por JWT (registro/login com bcrypt)
- Perfil com upload de avatar (Supabase Storage), troca de nome/senha
- Exclusão de conta com fluxo de transferência de posse dos boards que a
  pessoa é dona (nunca existe board órfão)

## Stack técnica

| | |
|---|---|
| **Frontend** | Next.js 15 (App Router) · React 18 · TypeScript · Tailwind CSS · `@dnd-kit` · `socket.io-client` |
| **Backend** | Node.js · Express 4 · TypeScript · Socket.io 4 · Prisma 5 · Zod (validação) · JWT + bcrypt · Multer (upload) · Helmet + rate limiting |
| **Banco** | PostgreSQL |
| **Storage** | Supabase Storage (avatares e anexos de card) |
| **Testes** | Jest + Supertest (API) · `socket.io-client` real, dois clientes conectados, provando sincronização em tempo real ponta a ponta |
| **CI** | GitHub Actions — typecheck + testes (backend) e lint + typecheck + build (frontend) a cada push/PR |

```
┌──────────────┐        HTTP (REST, JSON)        ┌──────────────┐
│   Frontend    │ ────────────────────────────────▶│   Backend    │
│   Next.js     │ ◀────────────────────────────────│   Express    │
│   (Vercel)    │                                    │  (Northflank) │
│               │        WebSocket (Socket.io)        │              │
│               │ ◀─────────────────────────────────▶│              │
└──────────────┘                                    └──────┬───────┘
                                                             │ Prisma
                                                      ┌──────▼───────┐
                                                      │  PostgreSQL   │
                                                      │  + Storage    │
                                                      │  (Supabase)   │
                                                      └───────────────┘
```

Frontend e backend são deploys **separados** de propósito: WebSocket
precisa de uma conexão persistente, que uma função serverless (como as do
Vercel) não sustenta — por isso o backend roda como um processo Node "de
verdade" (container Docker no Northflank), enquanto o Next.js cuida só de
UI e fica no Vercel.

## Estrutura do projeto

```
fluxo-board/
├── frontend/            Next.js app (UI)
│   └── src/
│       ├── app/         rotas (login, lista de boards, board, perfil)
│       ├── components/  Board, List, Card, CardDetailModal, etc.
│       └── lib/         cliente de API, socket, tema
├── backend/             API REST + servidor de WebSocket
│   ├── prisma/          schema + migrations
│   └── src/
│       ├── controllers/ lógica de negócio por recurso
│       ├── routes/      mapeamento REST → controller
│       ├── sockets/     autenticação e presença do Socket.io
│       ├── lib/         helpers compartilhados (autorização, activity log, Supabase Storage)
│       └── __tests__/   Jest + Supertest + testes e2e de socket
├── docs/                identidade visual e materiais de referência
└── PROJECT_SPEC.md      especificação completa: modelo de dados, todas as
                         rotas REST, todos os eventos de socket, roadmap
```

## Rodando localmente

Pré-requisitos: Node 20+, Docker (para o Postgres local).

### 1. Banco de dados

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env    # ajuste DATABASE_URL e gere um JWT_SECRET aleatório
npm install
npx prisma migrate dev
npm run dev              # http://localhost:4000
```

Upload de avatar/anexo exige um projeto Supabase (`SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` no `.env`) — sem isso, o resto da aplicação
funciona normalmente, só essas duas features ficam indisponíveis.

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev               # http://localhost:3000
```

## Testes automatizados

```bash
# uma vez, criar o banco de teste (mesmo Postgres do docker compose)
docker compose exec db psql -U fluxo -d fluxo -c "CREATE DATABASE fluxo_test OWNER fluxo"

cd backend
npm test
```

`pretest` já aplica as migrations no banco de teste automaticamente. A
suíte cobre autenticação, autorização (isolamento entre boards de usuários
diferentes), a lógica de reindexação de `position` em listas/cards, e um
teste e2e com dois clientes `socket.io-client` reais provando que uma
mutação feita por um chega em tempo real no outro.

## Deploy

| Camada | Onde | Observação |
|---|---|---|
| Frontend | [Vercel](https://vercel.com) | build a partir de `frontend/`, deploy automático a cada push em `main` |
| Backend | [Northflank](https://northflank.com) | container a partir de `backend/Dockerfile`, deploy automático a cada push em `main` |
| Banco + Storage | [Supabase](https://supabase.com) | Postgres (conexão via *session pooler*) + Storage para avatares e anexos |

Fluxo de trabalho: commits acumulam na branch `development` (testados
localmente a cada passo); o merge para `main` é o gatilho deliberado de
deploy em produção — e só acontece via PR com os dois checks de CI
verdes (branch protection bloqueia push direto na `main`, inclusive do
dono do repositório).

## Documentação completa

`PROJECT_SPEC.md` na raiz do repositório tem a especificação inteira:
diagrama de arquitetura, todos os campos de cada model do Prisma, a tabela
completa de rotas REST, a tabela completa de eventos de socket (com
payload e o que dispara cada um), e o histórico do roadmap.

## Licença

[MIT](LICENSE.md) — Pedro Henrique Fernandes
