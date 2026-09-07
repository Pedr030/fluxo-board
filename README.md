# Fluxo

Kanban board colaborativo em tempo real — projeto de portfólio full-stack.

Frontend em Next.js (React + TypeScript + Tailwind), backend em Node.js
(Express + Socket.io + Prisma), banco Postgres. Ver `PROJECT_SPEC.md` na raiz
para a especificação completa (arquitetura, modelo de dados, eventos de
socket, roadmap de features e ordem sugerida de implementação).

## Estrutura

```
fluxo/
├── frontend/   # Next.js app (UI)
├── backend/    # API REST + servidor de WebSocket
├── docs/       # identidade visual e outros materiais de referência
└── PROJECT_SPEC.md
```

## Rodando localmente

### 1. Banco de dados

Suba um Postgres local (ou use o free tier do Supabase/Neon e pule esta etapa):

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env    # ajuste DATABASE_URL e JWT_SECRET
npm install
npx prisma migrate dev --name init
npm run dev              # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev               # http://localhost:3000
```

## Testes automatizados

O backend tem uma suíte com Jest + Supertest (rotas REST, autenticação,
autorização, e a lógica de reindexação de `position` de listas/cards) e um
teste e2e com dois clientes de `socket.io-client` reais provando a
sincronização em tempo real entre duas conexões.

Os testes rodam contra um banco Postgres separado (`fluxo_test`), não o de
desenvolvimento — crie-o uma vez (usando o mesmo Postgres do
`docker compose up -d`):

```bash
docker compose exec db psql -U fluxo -d fluxo -c "CREATE DATABASE fluxo_test OWNER fluxo"
```

Depois, na pasta `backend`:

```bash
npm test
```

(`pretest` já aplica as migrations no banco de teste automaticamente.)

## Status

MVP completo: autenticação (JWT), boards/lists/cards com CRUD completo,
drag-and-drop persistido (`@dnd-kit`), sincronização em tempo real via
Socket.io (criar/mover/editar/excluir lista e card, presença de quem está no
board agora), convite de membros por email, estados de loading/erro em toda
mutação, identidade visual aplicada (paleta, tipografia, `docs/identidade-visual.html`)
com dark mode, e suíte de testes automatizados (Jest + e2e de socket).

Sessão em andamento como pair-programming com o Claude Code — o
`PROJECT_SPEC.md` serve de contexto/roteiro pra essas sessões, com o roadmap
(seção 6) marcando o que falta dos stretch goals (CI, labels, comentários,
anexos, histórico de atividade).
