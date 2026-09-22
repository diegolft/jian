# Estrutura do Gateway

Reorganização interna de `apps/gateway`. Sem mudança de contrato, de comportamento ou de
banco: a suíte atual é a rede de segurança, e cada passo termina com `pnpm check` verde.

## Por que

Quatro problemas medidos no código de hoje:

1. `src/gateway.ts` tem 833 linhas e 36 métodos cobrindo perfis, providers, sessões,
   mensagens, runs, memórias e contexto. Sete responsabilidades em uma classe.
2. `src/domain.ts` importa tipos de registro de `services/channels.ts`,
   `services/coordination.ts`, `services/credentials.ts` e `channels/whatsapp/types.ts`, e
   todos eles importam `domain.js` de volta. O módulo de tipos centrais depende das áreas
   que dependem dele. O ciclo é só de tipos, então compila — mas a camada está invertida.
3. Nove módulos recebem a classe `Gateway` concreta quando usam de dois a seis métodos
   dela. Ninguém pode ser lido, testado ou trocado sem o objeto inteiro.
4. Provider está espalhado por `providers.ts`, `codex-model.ts`, `provider-catalog.ts` e
   `services/codex-login.ts`, em três lugares diferentes. Órfãos na raiz convivem com
   pastas por assunto, sem regra que diga onde um arquivo novo deve nascer.

## Estrutura alvo

Uma área por pasta, cada uma com seu serviço, suas rotas e seus tipos de registro. Área
nova passa a ser pasta nova.

```text
src/
  main.ts            composição: monta tudo e sobe
  app.ts             só o Fastify: plugins, segurança, tratamento de erro, registradores
  records.ts         o mapa de registros, montado a partir das áreas
  services.ts        buildServices: monta os serviços sobre uma loja
  startup.ts         mensagens de falha de inicialização (fica na composição)
  core/              errors, store, clock, events — não importa nenhuma área
  profiles/          service, routes, port, record
  runs/              service, lifecycle, queue, routes, port, record
  sessions/          service, routes, port, records
  memories/          service, routes, record
  providers/         catalog, service, models, routes, port + codex/{model,login}
  coordination/      service, routes, records
  channels/          service, routes, registry, channel + telegram, generic, whatsapp/
  agent/             runtime, tools, mcp, results, types
  context/           service, build, budget
  security/          crypto, tokens, outbound, credentials, panel-session, routes
  storage/           postgres, migrations
  http/              events, ui, params, security (gancho de autenticação e erros)
```

### Regra de camada

`core/` ← áreas ← `app.ts` ← `main.ts`.

- `core/` não importa nenhuma área.
- Nenhuma área importa o serviço de outra por atalho: recebe no construtor o que precisa.
- Uma área pode importar o **tipo** de porta de outra, porque tipo não cria aresta em
  tempo de execução.
- `src/records.ts` fica na camada de composição e monta o mapa a partir das áreas. É o que
  conserta a inversão: a seta passa a ser composição → áreas → core.

`domain.ts` deixa de existir. Quem hoje o usa para reexportar `@elos/contracts` passa a
importar do contrato direto, e `GatewayError`/`assertFound` vêm de `core/errors.ts`.

Foi considerado deixar cada área se registrar no mapa por aumento de interface
(`declare module`). Recusado: nada na leitura mostra quem contribuiu o quê.

## Divisão da classe

A classe `Gateway` é removida. Não fica fachada delegando, porque isso recria o
acoplamento por outro caminho.

| Serviço | Métodos | Linhas hoje |
| --- | --- | --- |
| `profiles/service.ts` | profile, profiles, createProfile, updateProfile, revisions, validateCredentials | ~112 |
| `providers/service.ts` | providers, createProvider, configureCodexProvider, revokeProvider, modelDefaults, setModelDefaults, selectedModel | ~203 |
| `runs/service.ts` | submit, run, activities, continueRun, cancel | ~200 |
| `runs/lifecycle.ts` | claim, heartbeat, checkpoint, checkpoints, recordUsage, finish, recover, owned | ~190 |
| `sessions/service.ts` | createSession, session, sessions, messages | ~35 |
| `memories/service.ts` | memories, remember | ~44 |
| `context/service.ts` | context | ~21 |

`runs` parte em dois porque são dois públicos: o que a API chama e o que o worker dirige.
`context` fica junto de quem constrói contexto, que é quem ele já chamava.

`now()` e `event()`, hoje privados da classe, viram funções em `core/clock.ts` e
`core/events.ts` que recebem o relógio. As assinaturas que aceitam `Reader` continuam
aceitando, para que uma chamada entre serviços dentro de uma transação siga passando o
`tx` — é assim que `submit` já lê o perfil hoje.

`buildServices({ store, clock })`, em `src/services.ts`, monta o conjunto. `main.ts` e os
testes usam o mesmo montador.

## Portas

Cada porta é publicada pela área que a cumpre, em `<área>/port.ts`, e importada como tipo
pelos consumidores. Cinco cópias de "ler perfil" divergem em um mês.

São interfaces estruturais: nenhum serviço escreve `implements`.

| Consumidor | Portas que recebe |
| --- | --- |
| `agent/runtime.ts` | ciclo de vida do run (claim, heartbeat, checkpoint, recordUsage, finish, run) e fonte de contexto |
| `agent/tools.ts` | leitura de perfil, administração de perfil, escrita de memória, leitura de sessão e de run |
| `channels/service.ts` | leitura de perfil, escrita de sessão, envio e leitura de run, armazenamento |
| `coordination/service.ts` | leitura de perfil, de sessão e de run, armazenamento |
| `security/credentials.ts` | leitura de perfil, armazenamento |
| `http/events.ts` | leitura de perfil, armazenamento |
| `providers/codex/login.ts` | leitura de perfil, administração de provider |
| `runs/queue.ts` | recuperação de runs, armazenamento |
| `channels/whatsapp/connections.ts` | armazenamento |

A lista veio do uso real: cada módulo chama hoje entre dois e seis métodos da classe.

## Rotas

`app.ts` cai de 389 linhas para criar o Fastify, registrar plugins, segurança e tratamento
de erro, e chamar um registrador por área. As cerca de 50 rotas viram nove módulos:

`profiles`, `providers`, `sessions`, `runs`, `memories`, `coordination`, `channels`,
`security` (credenciais, chaves de acesso e sessão do painel) e um `http/meta.ts` para
`/health` e `/openapi.json`.

Cada registrador é uma função que recebe a instância e os serviços de que precisa. Os
tipos de parâmetro de rota, hoje declarados dentro de `createApp`, vão para
`http/params.ts`.

## Testes

- `tests/gateway.test.ts` (441 linhas) quebra por área, com as asserções idênticas.
  Reescrever teste não faz parte desta mudança.
- Os outros 17 arquivos mudam só caminho de import.
- `tests/helpers/services.ts` monta os serviços sobre a loja em memória e substitui os
  `new Gateway(store)` espalhados.
- Teste de persistência continua exigindo `TEST_DATABASE_URL` e não roda por padrão.

## Ordem

Cada passo termina com `pnpm check` verde.

1. `core/` (errors, store, clock, events) e `records.ts` de composição; remover `domain.ts`.
2. Juntar os quatro arquivos de provider em `providers/`.
3. Quebrar a classe nos sete serviços e criar `buildServices`.
4. Trocar a classe concreta pelas portas nos nove consumidores.
5. Dividir `app.ts` nos registradores por área.
6. Mover o resto: `runtime` para `agent/`, `services/*` para suas áreas, `queue.ts` para
   `runs/` e banco para `storage/`.
7. Atualizar `docs/architecture.md`, que descreve a estrutura antiga por nome.

## Fora de escopo

Contrato HTTP, comportamento observável, migrações de banco, painel, SDK e cliente Apple.
Nenhuma rota, código de status ou corpo de resposta muda.

## Riscos

- **Volume de imports.** Quase todo import interno muda de caminho. O compilador cobre
  isso: `pnpm typecheck` falha em qualquer caminho errado.
- **Sessões concorrentes.** Outro agente editou este diretório durante o trabalho
  anterior. Antes de começar, confirmar que a árvore está limpa do trabalho alheio.
- **Passo 3 é o maior.** Quebrar a classe e atualizar os testes na mesma leva é o único
  ponto onde a suíte fica vermelha por mais de alguns minutos.
