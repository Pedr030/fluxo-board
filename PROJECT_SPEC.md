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
│  (Vercel)    │                                   │  (Northflank)│
│              │        WebSocket (Socket.io)       │              │
│              │ ◀────────────────────────────────▶│              │
└─────────────┘                                    └──────┬───────┘
                                                            │ Prisma
                                                     ┌──────▼───────┐
                                                     │  PostgreSQL   │
                                                     │  + Storage    │
                                                     │  (Supabase)   │
                                                     └───────────────┘
```

Por que backend e banco separados do frontend: WebSocket precisa de uma
conexão persistente, que funções serverless (como as do Vercel) não
sustentam bem. Por isso o backend roda como processo Node "de verdade" no
Northflank (container a partir de `backend/Dockerfile`), enquanto o
Next.js fica no Vercel só cuidando de UI e rotas. Essa separação é,
inclusive, um bom ponto pra explicar em entrevista. Detalhes de por que
essas escolhas específicas de provedor (todas em free tier): seção 8.

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
| `BoardMember` | boardId, userId, role (OWNER/ADMIN/MEMBER), restricted | liga User↔Board (N:N com atributo). `restricted` é uma dimensão separada do cargo: um MEMBER restrito só edita/move/exclui cards atribuídos a ele mesmo (ou sem responsável) — promover a ADMIN sempre limpa a flag |
| `List` | title, position, boardId, isTemplatesList | tem vários `Card`. `isTemplatesList` marca a lista oculta de modelos (no máximo uma por board, criada sob demanda no primeiro `POST /boards/:id/templates`) — excluída de todo cálculo de posição das listas normais e nunca aparece no Quadro/Por etiqueta |
| `Card` | title, description, position, listId, creatorId, dueDate, completed | pertence a uma `List`, tem vários responsáveis via `CardAssignee` |
| `Comment` | text, cardId, authorId, createdAt | pertence a um `Card` |
| `Attachment` | cardId, uploaderId, filename, mimeType, size, url, createdAt | pertence a um `Card` |
| `Label` | boardId, name, color | pertence a um `Board`, paleta compartilhada |
| `CardLabel` | cardId, labelId | tabela de junção N:N Card↔Label |
| `CardAssignee` | cardId, userId | tabela de junção N:N Card↔User (responsáveis) — um card pode ter mais de uma pessoa (ex: tarefa feita em dupla) |
| `ChecklistItem` | cardId, text, done, position | pertence a um `Card` (um card, uma checklist só) |
| `Activity` | boardId, userId, summary, createdAt | pertence a um `Board` — não referencia Card/List (é um retrato congelado, não uma junção viva) |

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
| GET | `/me` | dados do usuário logado |
| PATCH | `/me` | edita nome/e-mail |
| PATCH | `/me/password` | troca de senha (exige a senha atual) |
| PATCH | `/me/avatar` | envia avatar (multipart, campo `file`; imagem, máx. 2MB) |
| DELETE | `/me/avatar` | remove avatar |
| DELETE | `/me` | exclui a conta — boards que a pessoa é dona precisam ser transferidos ou excluídos antes (nunca fica board órfão) |
| GET | `/boards` | lista boards do usuário logado |
| POST | `/boards` | cria board `{ title }` (já nasce com 3 etiquetas: Alta/Média/Baixa) |
| GET | `/boards/:id` | detalhe do board com lists+cards; inclui `myRole` e `myRestricted` |
| DELETE | `/boards/:id` | remove board (só o dono) |
| GET | `/boards/:id/members` | lista membros do board (dono e admins primeiro) |
| POST | `/boards/:id/invite` | adiciona membro `{ email }` (dono ou admin) |
| PATCH | `/boards/:id/members/:memberId` | promove/rebaixa ADMIN↔MEMBER e/ou ajusta `restricted` `{ role?, restricted? }` — só o dono, nunca no próprio dono; promover a ADMIN força `restricted: false` |
| POST | `/boards/:id/lists` | cria lista `{ title }` |
| PATCH | `/lists/:id` | renomeia (`{ title }`) ou reordena (`{ position }`) lista |
| DELETE | `/lists/:id` | remove lista (e os cards dela, em cascata) |
| POST | `/lists/:id/cards` | cria card `{ title }` **ou** `{ fromTemplateId }` (exatamente um dos dois) — o segundo copia título/descrição/etiquetas/checklist de um modelo (ver `/boards/:id/templates`) pro fim da lista; aberto a qualquer membro, mesmo restrito |
| PATCH | `/cards/:id` | edita/move card `{ title?, description?, listId?, position?, dueDate?, completed? }` — 403 se quem chama é um membro restrito mexendo num card atribuído a outra pessoa (responsáveis não entram aqui, ver `/cards/:id/assignees` abaixo) |
| POST | `/cards/:id/assignees` | atribui um membro do board ao card `{ userId }` — idempotente, mesmo padrão de `/cards/:id/labels`; um card aceita mais de um responsável; `userId` precisa ser membro do board (400 senão); mesma regra de 403 pra membro restrito |
| DELETE | `/cards/:id/assignees/:userId` | remove um responsável do card |
| DELETE | `/cards/:id` | remove card — mesma regra de 403 acima pra membro restrito |
| POST | `/cards/:id/duplicate` | duplica o card (título+"(cópia)", descrição, etiquetas, checklist desmarcada) logo depois do original, na mesma lista — aberto a qualquer membro, mesmo restrito (emite `card:created`, não um evento próprio) |
| POST | `/boards/:id/templates` | cria um modelo `{ title }` — é um `Card` numa lista especial oculta (`List.isTemplatesList`, título "Modelos", criada sob demanda na primeira chamada); não aparece no Quadro/Por etiqueta, não gera `Activity`; aberto a qualquer membro (emite `card:created`, e `list:created` só na primeira vez que a lista é criada) |
| GET | `/cards/:id/comments` | lista comentários do card, em ordem cronológica |
| POST | `/cards/:id/comments` | cria comentário `{ text }` |
| DELETE | `/comments/:id` | remove comentário (só quem escreveu) |
| GET | `/cards/:id/attachments` | lista anexos do card, em ordem cronológica |
| POST | `/cards/:id/attachments` | envia anexo (multipart, campo `file`; imagem, máx. 5MB) |
| DELETE | `/attachments/:id` | remove anexo (só quem enviou) |
| POST | `/boards/:id/labels` | cria etiqueta na paleta do board `{ name?, color }` |
| PATCH | `/labels/:id` | edita nome/cor da etiqueta (afeta todo card que a usa) |
| DELETE | `/labels/:id` | remove a etiqueta (e a associação em todo card) |
| POST | `/cards/:id/labels` | aplica etiqueta no card `{ labelId }` (idempotente) |
| DELETE | `/cards/:id/labels/:labelId` | remove etiqueta do card |
| POST | `/cards/:id/checklist-items` | cria item da checklist `{ text }` |
| PATCH | `/checklist-items/:id` | edita texto e/ou marca/desmarca `{ text?, done? }` |
| DELETE | `/checklist-items/:id` | remove item (reindexa os restantes) |
| GET | `/boards/:id/activity?page=<n>` | histórico de atividade do board, paginado (50 por página, mais recente primeiro); resposta traz `totalPages`/`totalCount` |

`GET /boards/:id` já devolve `labels` (paleta do board inteiro) e cada
card vem com `labelIds` e `checklistItems` — pequeno o bastante pra não
precisar de rota separada, ao contrário de comentários/anexos/atividade.

## 5. Eventos de socket

Room = `boardId`. Cliente entra com `board:join` (payload: `boardId`) e sai
com `board:leave` ao desmontar a página.

| Evento (servidor → clientes na room) | Payload | Disparado por |
|---|---|---|
| `list:created` | `{ list }` | `POST /boards/:id/lists` |
| `list:updated` | `{ list }` | `PATCH /lists/:id` (título) |
| `list:moved` | `{ orderedListIds }` | `PATCH /lists/:id` (position) |
| `list:deleted` | `{ listId }` | `DELETE /lists/:id` |
| `card:created` | `{ card }` | `POST /lists/:id/cards` |
| `card:moved` | `{ card, fromListId, toListId }` | `PATCH /cards/:id` (quando `listId`/`position` muda) |
| `card:updated` | `{ card }` | `PATCH /cards/:id` (título/descrição/prazo/conclusão/responsável) |
| `card:deleted` | `{ cardId, listId }` | `DELETE /cards/:id` |
| `board:deleted` | `{ boardId }` | `DELETE /boards/:id` |
| `comment:created` | `{ comment, cardId }` | `POST /cards/:id/comments` |
| `comment:deleted` | `{ commentId, cardId }` | `DELETE /comments/:id` |
| `attachment:created` | `{ attachment, cardId }` | `POST /cards/:id/attachments` |
| `attachment:deleted` | `{ attachmentId, cardId }` | `DELETE /attachments/:id` |
| `label:created` | `{ label }` | `POST /boards/:id/labels` |
| `label:updated` | `{ label }` | `PATCH /labels/:id` |
| `label:deleted` | `{ labelId, boardId }` | `DELETE /labels/:id` |
| `card:label-added` | `{ cardId, labelId }` | `POST /cards/:id/labels` |
| `card:label-removed` | `{ cardId, labelId }` | `DELETE /cards/:id/labels/:labelId` |
| `checklist-item:created` | `{ item, cardId }` | `POST /cards/:id/checklist-items` |
| `checklist-item:updated` | `{ item, cardId }` | `PATCH /checklist-items/:id` |
| `checklist-item:deleted` | `{ itemId, cardId }` | `DELETE /checklist-items/:id` |
| `activity:created` | `{ activity }` | qualquer ação de alto sinal (ver seção 3, model `Activity`) |
| `member:updated` | `{ member }` | `PATCH /boards/:id/members/:memberId` (mudança de cargo e/ou `restricted`) |
| `presence:update` | `{ users }` | alguém entra/sai da room (`board:join`/`board:leave`/desconexão), ou o cliente reemite `profile:updated` abaixo |

Além dos eventos servidor→clientes acima, existe um evento **cliente→
servidor**: `profile:updated` (sem payload), disparado pelo frontend depois
de `PATCH /me`, `/me/password` ou `/me/avatar` ter sucesso — sem isso, a
presença ao vivo mostraria o nome/avatar antigo em qualquer board já aberto
até reconectar. O servidor busca os dados atuais do usuário e reemite
`presence:update` em toda room em que aquele socket estiver.

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

- ~~Labels/etiquetas coloridas nos cards~~ — feito
- ~~Comentários em card~~ — feito
- ~~Anexos (upload de arquivo)~~ — feito
- ~~Modo escuro~~ — feito
- ~~Testes automatizados~~ — feito (Jest no backend, incluindo testes de
  socket com dois clientes provando a sincronização em tempo real)
- ~~CI (GitHub Actions rodando lint + testes a cada push)~~ — feito
- ~~Histórico de atividade do board (quem fez o quê e quando)~~ — feito
- ~~Checklist dentro do card~~ — feito
- ~~Data de vencimento (due date) no card~~ — feito
- ~~Atribuição de responsável (assignee) por card~~ — feito
- ~~Hierarquia de permissões: papel `ADMIN` (convida membros, sem
  privilégio extra sobre cards) e flag `restricted` por membro (só edita/
  move/exclui os próprios cards atribuídos)~~ — feito
- ~~Deploy em produção~~ — feito (Vercel + Northflank + Supabase, seção 8)
- ~~Branch protection na `main`~~ — feito (PR + CI obrigatórios antes de
  mergear, nem o dono do repo pode dar push direto)
- ~~Paginação do histórico de atividade~~ — feito (antes cortava
  silenciosamente nas últimas 100 entradas; agora pagina de verdade,
  com página numerada no frontend)
- ~~CI rodando também em push na `development`~~ — feito (antes só
  disparava em push/PR pra `main`, então commits acumulados na
  `development` ficavam sem checagem nenhuma até a hora do PR)
- ~~Testes automatizados no frontend~~ — feito (Jest via `next/jest`,
  cobertura de lógica pura: regra de `restricted`, reindexação do
  drag-and-drop, formatação de data — sem renderizar componente nem
  precisar de jsdom)

## 7. Autenticação — detalhes

JWT assinado com `JWT_SECRET`, payload mínimo `{ userId }`, validade
sugerida 7 dias. Frontend guarda o token em `localStorage` (aceitável pro
escopo deste projeto; cookie httpOnly é mais seguro contra XSS mas exige
mais infraestrutura — ver isso como possível "próximo passo" a mencionar em
entrevista, não como bloqueio pro MVP).

## 8. Deploy

Tudo em produção, custo zero:

- **Frontend**: Vercel, deploy automático a cada push em `main`, variável
  `NEXT_PUBLIC_API_URL` apontando pro backend.
- **Backend**: Northflank (plano "Developer Sandbox" — free, não hiberna,
  container de verdade, necessário pro WebSocket sobreviver; Railway free
  tier virou só crédito de trial e Render free hiberna após 15min de
  inatividade, o que mataria a proposta de colaboração ao vivo), a partir
  de `backend/Dockerfile`, deploy automático a cada push em `main`,
  variáveis `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`,
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.
- **Banco + Storage**: Supabase (Postgres via *session pooler* — não
  *direct*, que é IPv6-only por padrão; não *transaction pooler*, que não
  suporta prepared statements que o Prisma precisa) + Storage (avatares e
  anexos). Free tier pausa o projeto depois de 1 semana sem uso — reativa
  pelo dashboard, sem perder dado.

**Fluxo de trabalho**: commits acumulam na branch `development` (testados
localmente a cada passo); chegar à produção exige abrir uma PR
`development` → `main` (`gh pr create`) e mergear (`gh pr merge`) só depois
dos dois checks de CI passarem — branch protection na `main` bloqueia
push direto, inclusive do dono do repo (`enforce_admins: true`).

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

## 11. Roadmap futuro — features/UI (pós-reavaliação de set/2026)

Levantado depois de uma rodada de reavaliação de segurança/dependências
(seção 8 já cobre o que foi corrigido ali). Esse aqui é sobre produto —
o que falta pro app em si, priorizado por esforço, não por importância.

### Ganhos rápidos (baixo esforço, alto impacto de UX)

- [x] **Duplicar card** — `POST /cards/:id/duplicate` copia título
      (sufixo "(cópia)")/descrição/etiquetas/checklist (itens
      desmarcados, mesmo se o original já tivesse algum feito) pra um
      card novo, logo depois do original na mesma lista. Não copia
      comentários/anexos/responsável/prazo/conclusão (específicos do
      card original, não fazem sentido "herdados"). Aberto a qualquer
      membro, mesmo restrito — é uma variação de criar card, não uma
      edição do original.
- [x] **Modelos de card (aba própria)** — cogitamos inicialmente não
      criar um sistema separado (duplicar card já cobria o caso de
      uso na prática), mas voltamos atrás: usar "duplicar" como
      template manual dependia de já ter um card publicado, ficando
      confuso quando ele já foi editado/movido. Implementado como uma
      lista oculta (`List.isTemplatesList`, ver seção 3) — cada modelo
      é só um `Card` normal nessa lista, reaproveitando toda a
      infra existente de checklist/etiquetas em vez de um model novo.
      Nova aba "Modelos" no board (`TemplateDetailModal`/`TemplateTile`
      — versão enxuta do painel de card, só com título/descrição/
      etiquetas/checklist, sem responsável/prazo/concluído/anexos/
      comentários, que não fazem sentido pra algo que nunca é
      "trabalhado"). Criar um modelo já abre esse painel na hora
      (título provisório "Novo modelo", renomeia clicando nele — sem
      pedir o nome numa janelinha à parte). Criar um card oferece a
      mesma lógica: um botão único "+ Adicionar card" abre uma
      janelinha com os modelos disponíveis (cria direto) ou "criar em
      branco" (pede só o título, cria, e já abre o `CardDetailModal`
      completo — em vez de só digitar um nome e pronto).
- [x] **Múltiplos responsáveis por card** — `assigneeId` (único) virou
      `CardAssignee` (N:N, ver seção 3): tarefa feita em dupla precisa
      de mais de uma pessoa atribuída. Endpoints dedicados
      `POST`/`DELETE /cards/:id/assignees` (mesmo padrão de etiqueta —
      idempotente, um por vez), em vez de continuar no `PATCH /cards/:id`
      genérico. `canEditCard` (regra do membro restrito) passa a checar
      "está entre os responsáveis", não mais "é o responsável único".
      Migração preserva os dados existentes (cada `assigneeId` antigo
      virou uma linha em `CardAssignee` antes da coluna ser removida).
      UI: seletor de Responsável na CardDetailModal virou multi-toggle
      (mesmo padrão do seletor de Etiquetas), e o card fechado mostra um
      "avatar stack" (avatares sobrepostos) em vez de um avatar só.
- [ ] Busca de texto (título/descrição) nos cards do board inteiro —
      hoje só existe filtro por etiqueta/status na aba "Por etiqueta".
- [ ] Cor ou capa no card, além da etiqueta (que hoje é só uma barra
      fininha) — mais escaneabilidade visual no quadro.
- [ ] Atalhos de teclado básicos (novo card, foco na busca, etc.).
- [ ] Soltar arquivo direto na área de anexos do card (hoje precisa
      clicar no ícone primeiro).

### Médio porte (feature de verdade, algumas sessões)

- [ ] Notificações in-app (sino no header): atribuíram um card a você,
      comentaram num card seu, ou te mencionaram (`@nome`) — reaproveita
      a infra de socket que já existe.
- [ ] "Meus cards": visão que junta os cards atribuídos a você em
      **todos** os boards, não só dentro de um board.
- [ ] Menções (`@nome`) em comentários.
- [ ] Ações em lote: selecionar múltiplos cards e mover/etiquetar/
      excluir em conjunto.
- [ ] Markdown básico (negrito/lista/link) em descrição e comentários —
      hoje é texto puro.
- [ ] Lembrete de prazo (e-mail ou notificação in-app perto do
      `dueDate`).

### Maior porte (arquitetura nova, projeto próprio)

- [ ] Views alternativas do board: calendário (por `dueDate`) ou
      tabela/planilha, além do Kanban.
- [ ] Templates de **board** (não de card): escolher um ponto de
      partida ao criar ("Sprint", "Pessoal", "Bugs") já vindo com
      listas/etiquetas padrão.
- [ ] Responsividade mobile de verdade — o drag-and-drop atual não foi
      pensado pra touch; dnd-kit suporta, mas o layout inteiro precisa
      de revisão.
- [ ] Campos customizados por board (prioridade, estimativa, etc.).
