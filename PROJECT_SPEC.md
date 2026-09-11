# Fluxo — Especificação do Projeto

Kanban board colaborativo em tempo real. Documento de referência para guiar
o desenvolvimento — use-o como contexto nas sessões de pair-programming com
o Claude Code (cole trechos relevantes, ou aponte o arquivo inteiro, quando
pedir pra ele implementar algo).

Identidade visual completa (paleta, tipografia, componentes): ver
`docs/identidade-visual.html` ou a versão publicada.

---

## 1. Objetivo

Provar, num projeto de portfólio, que você entende o ciclo completo de uma
aplicação full-stack: modelagem de dados, API, autenticação, tempo real via
WebSocket, frontend reativo e deploy. O diferencial em relação a um "Trello
clone" genérico é a colaboração ao vivo (múltiplos usuários editando o mesmo
board e vendo a mudança do outro instantaneamente) — é isso que deve estar
bem feito e bem explicado no README/demo, mesmo que o resto do produto seja
simples.

Uso real: você mesmo vai usar pra organizar suas próprias tarefas — isso é
uma vantagem, porque significa que bugs e falta de features vão aparecer
naturalmente no seu dia a dia, em vez de só em teoria.

## 2. Arquitetura

```
┌─────────────┐        HTTP (REST, JSON)        ┌──────────────┐
│   Frontend   │ ───────────────────────────────▶ │   Backend    │
│  Next.js     │ ◀─────────────────────────────── │  Express     │
│  (Vercel)    │                                   │  (Railway)   │
│              │        WebSocket (Socket.io)       │              │
│              │ ◀────────────────────────────────▶│              │
└─────────────┘                                    └──────┬───────┘
                                                            │ Prisma
                                                     ┌──────▼───────┐
                                                     │  PostgreSQL   │
                                                     │ (Supabase/    │
                                                     │  Neon/Railway)│
                                                     └───────────────┘
```

Por que backend e banco separados do frontend: WebSocket precisa de uma
conexão persistente, que funções serverless (como as do Vercel) não
sustentam bem. Por isso o backend roda como processo Node "de verdade" no
Railway/Render, enquanto o Next.js fica no Vercel só cuidando de UI e
rotas. Essa separação é, inclusive, um bom ponto pra explicar em entrevista.

**Regra de ouro do tempo real:** toda mutação (criar card, mover card, etc.)
segue sempre o mesmo caminho: (1) o cliente chama uma rota REST, (2) a rota
persiste a mudança no banco via Prisma, (3) só depois de persistir com
sucesso, a rota emite o evento de socket pra todo mundo na room do board
(incluindo quem fez a ação — simplifica o estado no frontend, todo mundo
reage do mesmo jeito ao evento). Nunca faça a mutação só via socket sem
passar pelo banco — senão um refresh de página perde o estado.

## 3. Modelo de dados

Já implementado em `backend/prisma/schema.prisma`. Resumo:

| Model | Campos principais | Relação |
|---|---|---|
| `User` | name, email, password (hash) | dono/membro de boards |
| `Board` | title, ownerId | tem várias `List` |
| `BoardMember` | boardId, userId, role (OWNER/MEMBER) | liga User↔Board (N:N com atributo) |
| `List` | title, position, boardId | tem vários `Card` |
| `Card` | title, description, position, listId, creatorId | pertence a uma `List` |
| `Comment` | text, cardId, authorId, createdAt | pertence a um `Card` |
| `Attachment` | cardId, uploaderId, filename, mimeType, size, url, createdAt | pertence a um `Card` |

**Sobre `position` (ordenação de listas e cards):** a forma mais simples é
usar inteiros e reindexar (0, 1, 2, ...) sempre que a ordem mudar dentro de
uma lista. Funciona bem pro tamanho de board que este projeto vai ter — não
complique com posições fracionárias/float a não ser que sinta necessidade
real depois.

## 4. API REST (backend)

Todas as rotas abaixo (exceto `/auth/*`) exigem header
`Authorization: Bearer <token>`.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/register` | cria usuário, devolve `{ user, token }` |
| POST | `/auth/login` | autentica, devolve `{ user, token }` |
| GET | `/boards` | lista boards do usuário logado |
| POST | `/boards` | cria board `{ title }` |
| GET | `/boards/:id` | detalhe do board com lists+cards |
| POST | `/boards/:id/invite` | adiciona membro `{ email }` |
| POST | `/boards/:id/lists` | cria lista `{ title }` |
| PATCH | `/lists/:id` | renomeia (`{ title }`) ou reordena (`{ position }`) lista |
| POST | `/lists/:id/cards` | cria card `{ title }` |
| PATCH | `/cards/:id` | edita/move card `{ title?, description?, listId?, position? }` |
| DELETE | `/cards/:id` | remove card |
| DELETE | `/boards/:id` | remove board (só o dono) |
| GET | `/cards/:id/comments` | lista comentários do card, em ordem cronológica |
| POST | `/cards/:id/comments` | cria comentário `{ text }` |
| DELETE | `/comments/:id` | remove comentário (só quem escreveu) |
| GET | `/cards/:id/attachments` | lista anexos do card, em ordem cronológica |
| POST | `/cards/:id/attachments` | envia anexo (multipart, campo `file`; imagem, máx. 5MB) |
| DELETE | `/attachments/:id` | remove anexo (só quem enviou) |

## 5. Eventos de socket

Room = `boardId`. Cliente entra com `board:join` (payload: `boardId`) e sai
com `board:leave` ao desmontar a página.

| Evento (servidor → clientes na room) | Payload | Disparado por |
|---|---|---|
| `list:created` | `{ list }` | `POST /boards/:id/lists` |
| `list:updated` | `{ list }` | `PATCH /lists/:id` (título) |
| `list:moved` | `{ orderedListIds }` | `PATCH /lists/:id` (position) |
| `card:created` | `{ card }` | `POST /lists/:id/cards` |
| `card:moved` | `{ card, fromListId, toListId }` | `PATCH /cards/:id` (quando `listId`/`position` muda) |
| `card:updated` | `{ card }` | `PATCH /cards/:id` (título/descrição) |
| `card:deleted` | `{ cardId, listId }` | `DELETE /cards/:id` |
| `board:deleted` | `{ boardId }` | `DELETE /boards/:id` |
| `comment:created` | `{ comment, cardId }` | `POST /cards/:id/comments` |
| `comment:deleted` | `{ commentId, cardId }` | `DELETE /comments/:id` |
| `attachment:created` | `{ attachment, cardId }` | `POST /cards/:id/attachments` |
| `attachment:deleted` | `{ attachmentId, cardId }` | `DELETE /attachments/:id` |

Stub em `backend/src/sockets/boardSocket.ts` — os handlers de `join`/`leave`
já existem, os eventos de mutação você adiciona junto com cada rota REST
correspondente (emitir `io.to(boardId).emit(...)` no fim do controller,
depois do `prisma.*.update`/`create` ter sucesso).

## 6. Roadmap — MVP primeiro, ordem sugerida

Siga nessa ordem — cada etapa é "fechável" e testável sozinha antes de ir
pra próxima, o que ajuda demais quando você tá pareando com o Claude Code
(sessões menores e focadas > pedir tudo de uma vez):

1. **Auth**: implementar `register`/`login` (bcrypt + JWT) e o middleware
   `requireAuth`. Testar com curl/Postman antes de mexer no frontend.
2. **CRUD de board sem tempo real ainda**: criar board, listar boards,
   ver detalhe de um board (ainda sem lists/cards, só o registro). Ligar a
   página de login e a lista de boards no frontend.
3. **Lists e Cards (CRUD simples, sem drag-and-drop ainda)**: criar
   lista, criar card, exibir na tela. Sem mover nada ainda — só criar e
   listar. Aqui já dá pra usar o board de verdade pra tarefas simples.
4. **Socket.io básico**: conectar, entrar na room, e emitir/receber
   `card:created` como prova de conceito de tempo real (abra o mesmo board
   em duas abas e veja o card aparecer nas duas).
5. **Drag-and-drop com `@dnd-kit`**: mover card dentro da lista e entre
   listas, persistindo a nova `position`/`listId` e emitindo `card:moved`.
   Essa é a etapa mais trabalhosa — não tenha pressa.
6. **Convite/compartilhamento de board**: adicionar membro por email (ou,
   mais simples de implementar primeiro, um link de convite com token).
7. **Polish**: editar/excluir card e lista, avatares de presença (quem
   está no board agora — dá pra fazer com o próprio `io.on("connection")`
   contando sockets na room), estados de loading/erro.

### Stretch goals (só depois do MVP rodando e no ar)

- Labels/etiquetas coloridas nos cards
- Comentários em card
- Anexos (upload de arquivo)
- Histórico de atividade do board
- Modo escuro (o guia de identidade visual já tem os tokens prontos)
- Testes automatizados (Jest no backend; um teste e2e simples com dois
  clientes de socket provando a sincronização é ótimo argumento de
  entrevista)
- CI (GitHub Actions rodando lint + testes a cada push)

## 7. Autenticação — detalhes

JWT assinado com `JWT_SECRET`, payload mínimo `{ userId }`, validade
sugerida 7 dias. Frontend guarda o token em `localStorage` (aceitável pro
escopo deste projeto; cookie httpOnly é mais seguro contra XSS mas exige
mais infraestrutura — ver isso como possível "próximo passo" a mencionar em
entrevista, não como bloqueio pro MVP).

## 8. Deploy

- **Frontend**: Vercel, conectado ao repo, variável `NEXT_PUBLIC_API_URL`
  apontando pro backend em produção.
- **Backend**: Railway ou Render (free tier), variáveis `DATABASE_URL`,
  `JWT_SECRET`, `FRONTEND_URL`.
- **Banco**: Supabase ou Neon (Postgres free tier) — pegue a
  `DATABASE_URL` de lá e rode `npx prisma migrate deploy` no backend em
  produção.

## 9. Identidade visual — resumo rápido

Paleta: `Canvas #F5F7FB` (fundo) · `Ink #131B2E` (texto) ·
`Brand #3B6FED` (ações primárias) · `Flow #14B8A6` (presença/tempo real) ·
`Signal #F97316` (colaborador ativo agora, usar com moderação).
Tipografia: `Unbounded` (wordmark/títulos), `Inter` (interface),
`JetBrains Mono` (técnico). Já configurado em
`frontend/tailwind.config.ts`. Guia completo com todos os componentes:
`docs/identidade-visual.html`.

## 10. Dicas pra pair-programming com o Claude Code

- Peça uma etapa do roadmap (seção 6) por vez, não o projeto inteiro de
  uma vez — ele vai implementar melhor com escopo pequeno e você entende
  cada pedaço antes de emendar o próximo.
- Cole o trecho relevante deste documento (ex: a tabela de eventos de
  socket, seção 5) na conversa quando pedir pra implementar algo que
  depende disso.
- Peça pra ele explicar o que fez, não só gerar o código — é isso que vai
  te preparar pra falar sobre o projeto numa entrevista técnica.
- Rode e teste cada etapa antes de pedir a próxima — isso evita acumular
  bugs de uma etapa que quebram a próxima.
