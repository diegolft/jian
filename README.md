# Elos

Gateway de agentes com uma identidade persistente por perfil e contexto compartilhado entre sessões.

**Primeira versão do backend.** TypeScript, Node.js 24+, Fastify, AI SDK, PostgreSQL e pg-boss. O app nativo macOS e os conectores de mensageria são próximas etapas.

## O que já existe

- Perfis com provider, modelo, instruções, skills e MCPs independentes.
- Sessões simultâneas por perfil, com uma execução ativa por sessão.
- Memórias explícitas compartilhadas, com origem e controle de versão.
- Contexto atualizado entre chamadas ao modelo, incluindo tarefas de outras sessões.
- Ferramentas para consultar outras sessões, carregar skills e salvar memórias.
- Alteração da própria identidade e criação de perfis derivados, quando habilitadas pelo dono.
- API autenticada, eventos persistentes e acompanhamento via Server-Sent Events.
- Fila persistente, pedidos idempotentes, cancelamento e registro de etapas concluídas.
- OpenAI, Anthropic, Google e endpoints compatíveis com OpenAI, usando credenciais próprias.

## Executar

Instale Node.js 24 ou superior. Para hospedar com Compose, tenha Docker disponível.

```bash
npm ci
```

```bash
npm run setup
```

O setup cria `.env` com credenciais aleatórias e permissão `0600`. Não sobrescreve um arquivo existente. Preencha ao menos uma chave `ELOS_PROVIDER_*` nesse arquivo. Uma assinatura de aplicativo não equivale automaticamente a uma chave de API.

```bash
docker compose up --build -d
```

A API fica em `http://127.0.0.1:4310`. O PostgreSQL mantém os dados em um volume e não publica uma porta. Para acesso remoto, coloque o gateway atrás de um proxy HTTPS autenticado pelo token da API.

Para desenvolvimento com um PostgreSQL **já disponível**, ajuste `DATABASE_URL` em `.env`:

```bash
npm run dev
```

`ELOS_ROLE=all` executa API e worker juntos. Para separar processos, use `ELOS_ROLE=api` e `ELOS_ROLE=worker`, com o mesmo banco e as mesmas credenciais dos providers no worker. Quatro execuções podem rodar simultaneamente por processo worker.

## Primeiro perfil

Carregue as variáveis do `.env` no shell:

```bash
. ./.env
```

Crie um perfil, substituindo `MODEL_ID` pelo identificador de um modelo disponível na sua conta. O valor de `apiKeyEnv` é o **nome da variável**, nunca a chave em si.

```bash
curl -sS http://127.0.0.1:4310/v1/profiles \
  -H "Authorization: Bearer $ELOS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Atlas","instructions":"Responda em português. Consulte as outras sessões quando forem relevantes.","model":{"provider":"openai","modelId":"MODEL_ID","apiKeyEnv":"ELOS_PROVIDER_OPENAI"}}'
```

Copie o `id` retornado para `PROFILE_ID`:

```bash
PROFILE_ID='id-do-perfil'
curl -sS "http://127.0.0.1:4310/v1/profiles/$PROFILE_ID/sessions" \
  -H "Authorization: Bearer $ELOS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Primeira conversa","channel":"api"}'
```

Copie o `id` da sessão para `SESSION_ID`:

```bash
SESSION_ID='id-da-sessao'
curl -sS "http://127.0.0.1:4310/v1/profiles/$PROFILE_ID/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $ELOS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Salve na memória que meu projeto se chama Elos.","requestKey":"primeira-mensagem"}'
```

A resposta `202` contém o run. Repetir a mesma `requestKey` na mesma sessão recupera o run existente. Cada mensagem nova precisa de uma chave nova; reutilizar uma chave com conteúdo diferente retorna `409`.

Acompanhe o perfil em outro terminal:

```bash
curl -N "http://127.0.0.1:4310/v1/profiles/$PROFILE_ID/events/stream" \
  -H "Authorization: Bearer $ELOS_API_TOKEN"
```

Os eventos mostram início, ferramentas iniciadas, etapas concluídas e resposta final. Esta versão não transmite tokens individuais. Reconecte com `Last-Event-ID` para continuar após o último evento recebido. O stream exige header de autenticação; tokens em query string não são aceitos.

## API

Todas as rotas `/v1` exigem `Authorization: Bearer <ELOS_API_TOKEN>`.

| Método e rota | Resultado |
|---|---|
| `GET /health` | Liveness do processo; não testa banco ou provider |
| `GET /v1/profiles` | Perfis |
| `POST /v1/profiles` | Criar perfil |
| `GET /v1/profiles/:profileId` | Configuração atual |
| `PATCH /v1/profiles/:profileId` | Editar com `expectedVersion` |
| `GET /v1/profiles/:profileId/revisions` | Últimas 50 versões |
| `GET /v1/profiles/:profileId/sessions` | Últimas 100 sessões |
| `POST /v1/profiles/:profileId/sessions` | Criar sessão |
| `GET /v1/profiles/:profileId/sessions/:sessionId/messages` | Últimas 100 mensagens, em ordem cronológica |
| `POST /v1/profiles/:profileId/sessions/:sessionId/messages` | Enfileirar execução |
| `GET /v1/profiles/:profileId/memories` | Até 100 memórias |
| `PUT /v1/profiles/:profileId/memories` | Criar/editar memória com `key`, `content`, `expectedVersion` |
| `GET /v1/profiles/:profileId/activities` | Execuções ativas |
| `GET /v1/profiles/:profileId/runs/:runId` | Estado e resultado |
| `POST /v1/profiles/:profileId/runs/:runId/cancel` | Cancelar execução |
| `GET /v1/profiles/:profileId/events?after=0` | Próximos 100 eventos após o cursor |
| `GET /v1/profiles/:profileId/events/stream` | Stream autenticado com reconexão |

Crie memórias com `expectedVersion: 0`. Edições exigem a versão atual. Um `409` pede recarregar o estado antes de tentar novamente.

Para testar o contexto compartilhado: crie duas sessões no mesmo perfil; peça à primeira para salvar uma memória; confirme `run.completed` e a presença da memória; pergunte sobre ela na segunda. Perfis diferentes não compartilham memórias automaticamente.

## Skills, MCP e identidade

Edite o perfil com `PATCH` e `expectedVersion`. Cada skill tem `name`, `description` e `instructions`. As descrições entram no contexto; as instruções completas são carregadas pela ferramenta `load_skill`.

Cada entrada de `mcpServers` tem `name`, `url`, `allowedTools` e opcionalmente `bearerTokenEnv`, como `ELOS_MCP_DOCS`. Apenas ferramentas explicitamente permitidas ficam disponíveis. O transporte desta versão é HTTP; stdio, OAuth interativo e instalação de servidores ainda não estão implementados.

`allowSelfManagement: true` permite ao agente versionar seu nome/instruções ou criar outro perfil com o mesmo provider. Perfis derivados começam sem skills, sem MCPs e sem autogerenciamento. O agente não pode conceder a si mesmo novas credenciais ou permissões. A configuração do perfil é fixada no início de cada run; mudanças valem para novos runs.

## Persistência e limites atuais

O banco guarda registros JSONB indexados e eventos. O dispatcher recupera pedidos que foram gravados antes de uma queda, mesmo que ainda não tenham entrado na fila. Alterações curtas são serializadas por perfil; chamadas ao modelo acontecem fora das transações.

Uma execução em andamento renova sua lease a cada 10 segundos. Se o worker desaparecer, a lease expira após 60 segundos e o run é marcado `interrupted`. Etapas concluídas ficam nos eventos. **Não há retomada automática dentro do ciclo do modelo**: uma ferramenta pode ter realizado um efeito externo antes da queda. Inspecione as etapas antes de enviar uma nova mensagem. Cancelamento interrompe novas etapas, mas não desfaz efeitos externos já iniciados.

O contexto usa até 40 mensagens recentes e seleção lexical de memórias com orçamento por caracteres. Ainda não há embeddings, pgvector, sumarização automática ou busca paginada de todo o histórico. Ferramentas podem consultar mensagens recentes de outras sessões. A execução tem limite de 12 etapas e 10 minutos.

Esta versão é para **um único dono confiável por instalação**. Todas as sessões de um perfil compartilham a mesma fronteira de acesso. O campo `channel` é metadado: Telegram, Slack e outros conectores ainda não existem. Grupos, equipes e múltiplos usuários exigem ACLs próprias antes de serem conectados. As chaves dos providers só são acessadas no worker.

## Verificação

Sem Docker e sem provider externo:

```bash
npm run check
```

Os testes locais usam armazenamento em memória, modelos de teste do AI SDK e um servidor MCP HTTP local. Cobrem contexto entre sessões, isolamento de perfis, idempotência, versões, leases, cancelamento, autenticação, eventos e ferramentas permitidas.

Com um PostgreSQL descartável:

```bash
TEST_DATABASE_URL='postgres://elos:password@localhost:5432/elos_test' npm run test:integration
```

O workflow de CI roda esses testes com PostgreSQL 17 e valida o build da imagem. Configurar o workflow não significa que ele já foi executado: o repositório ainda precisa ser publicado.

## Próximas etapas

1. Validar com um provider real e publicar a primeira implantação do gateway.
2. Criar o cliente macOS em SwiftUI usando a API e o stream de eventos.
3. Implementar busca semântica e recuperação paginada de histórico.
4. Adicionar conectores de canais com regras explícitas de compartilhamento.
5. Evoluir a retomada de execuções com garantias por ferramenta.
