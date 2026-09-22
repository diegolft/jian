# Gateway Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar `apps/gateway` em uma pasta por área, com a classe `Gateway` de 833 linhas quebrada em serviços focados que recebem portas estreitas em vez do objeto inteiro.

**Architecture:** Camadas `core/` ← áreas ← `app.ts` ← `main.ts`. Cada área é uma pasta com serviço, rotas, porta e tipos de registro. O mapa de registros sai de `domain.ts` para `src/records.ts`, na camada de composição, o que inverte a dependência hoje circular entre tipos centrais e serviços. Nenhum comportamento observável muda.

**Tech Stack:** TypeScript em Node 24, Fastify 5, Zod 4, pg-boss, Vitest, Biome. Zod fica em `packages/contracts`; o gateway consome `@elos/contracts`.

**Spec:** `docs/specs/2026-09-22-gateway-structure-design.md`

## Global Constraints

- Contrato HTTP congelado: nenhuma rota, código de status, corpo de resposta ou nome de operação muda. `pnpm contracts:check` precisa passar sem regenerar nada.
- Comportamento observável congelado: as asserções dos testes existentes não mudam de valor. Mover um teste de arquivo é permitido; reescrever a asserção não.
- Banco congelado: nenhuma migração nova. Migração publicada é imutável.
- Biome formata: dois espaços, aspas simples, ponto e vírgula, 100 colunas.
- Comentário explica só o que o código não diz: por quê, garantia, unidade, armadilha. Não narrar o óbvio.
- Nenhum teste novo nesta mudança. Um teste que afirme onde um módulo mora, ou que um serviço delega para outro, espelha a implementação — o `CLAUDE.md` do projeto proíbe.
- Toda tarefa termina com `pnpm check` verde, rodado da raiz do repositório.
- Mensagem de commit sem atribuição de IA: um gancho do repositório rejeita `Co-Authored-By` e qualquer crédito a assistente. O autor é o dono do repositório.
- `tests/postgres.test.ts` exige `TEST_DATABASE_URL` e continua fora da suíte padrão.

## Antes de começar

- [ ] **Confirmar que a árvore está limpa de trabalho alheio**

Outra sessão editou este diretório durante o trabalho anterior. Rode:

```bash
cd /Volumes/Data/Developer/elos && git status --porcelain
```

Se houver arquivo modificado que não seja seu, pare e confirme com o dono do repositório antes de mover qualquer coisa. Um `git mv` sobre trabalho em andamento de outro agente é perda difícil de reconstruir.

---

### Task 1: Camada `core/` e o mapa de registros

Tira os tipos centrais de `domain.ts` e inverte a dependência: hoje `domain.ts` importa tipos de registro dos serviços que importam `domain.js` de volta.

**Files:**
- Create: `apps/gateway/src/core/errors.ts`
- Create: `apps/gateway/src/core/store.ts`
- Create: `apps/gateway/src/core/clock.ts`
- Create: `apps/gateway/src/core/events.ts`
- Create: `apps/gateway/src/records.ts`
- Delete: `apps/gateway/src/domain.ts`, `apps/gateway/src/storage.ts`
- Modify: todo módulo que importa `./domain.js` ou `./storage.js` (26 arquivos em `src`, 8 em `tests`)

**Interfaces:**
- Consumes: `@elos/contracts` (`Profile`, `Run`, `Session`, `Message`, `Memory`, `Checkpoint`, `GatewayEvent`, `ProfileRevision`, `ProviderRecord`, `ModelDefaultsRecord`).
- Produces: `GatewayError`, `assertFound` de `core/errors.js`; `Selection`, `Reader`, `Transaction`, `Store` de `core/store.js`; `Clock`, `nowIso` de `core/clock.js`; `recordEvent` de `core/events.js`; `Records`, `Kind` de `records.js`.

- [ ] **Step 1: Rodar a suíte para ter o ponto de partida**

```bash
cd /Volumes/Data/Developer/elos && pnpm check
```

Esperado: verde de ponta a ponta — 107 testes em 16 arquivos. Anote a contagem; ela não deve cair em nenhuma tarefa.

- [ ] **Step 2: Criar `core/errors.ts`**

Conteúdo, movido de `domain.ts` sem alteração:

```ts
export class GatewayError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function assertFound<T>(value: T | null | undefined, label: string): T {
  if (value == null) {
    throw new GatewayError(404, `${label} not found`);
  }

  return value;
}
```

- [ ] **Step 3: Criar `core/store.ts`**

Conteúdo de `src/storage.ts`, com o import do mapa apontando para a nova casa:

```ts
import type { GatewayEvent, Kind, Records } from '../records.js';

export type Selection = {
  profileId?: string;
  where?: Record<string, unknown>;
  limit?: number;
  descending?: boolean;
  before?: string;
  search?: string;
  anyWords?: string[];
};

export interface Reader {
  get<K extends Kind>(kind: K, id: string): Promise<Records[K] | null>;
  list<K extends Kind>(kind: K, options?: Selection): Promise<Records[K][]>;
  events(profileId: string, after: number, limit?: number): Promise<GatewayEvent[]>;
}

export interface Transaction extends Reader {
  put<K extends Kind>(kind: K, id: string, profileId: string, value: Records[K]): Promise<void>;
  event(event: Omit<GatewayEvent, 'id'>): Promise<void>;
}

export interface Store extends Reader {
  transaction<T>(profileId: string, body: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

Nota de camada: `core/store.ts` importa `records.js`, que é composição. É a única seta de `core/` para fora, e ela existe porque o mapa de registros é, por definição, a lista das áreas. Mantenha-a só de tipo (`import type`), para não criar aresta em tempo de execução.

- [ ] **Step 4: Criar `core/clock.ts`**

```ts
/** Milissegundos desde a epoch. Injetável para que teste controle o tempo. */
export type Clock = () => number;

export function nowIso(clock: Clock): string {
  return new Date(clock()).toISOString();
}
```

- [ ] **Step 5: Criar `core/events.ts`**

```ts
import type { Clock } from './clock.js';
import { nowIso } from './clock.js';
import type { Transaction } from './store.js';

export async function recordEvent(
  tx: Transaction,
  clock: Clock,
  profileId: string,
  type: string,
  data: unknown,
  runId?: string,
): Promise<void> {
  await tx.event({ profileId, type, data, runId, createdAt: nowIso(clock) });
}
```

- [ ] **Step 6: Criar `src/records.ts`**

O mapa que hoje vive em `domain.ts`, sem o `export * from '@elos/contracts'`. Os caminhos de `services/*` e `channels/*` são os de hoje; as Tasks 2, 3, 4, 5 e 8 atualizam cada um quando o arquivo se mudar.

```ts
import type {
  Checkpoint,
  GatewayEvent,
  Memory,
  Message,
  ModelDefaultsRecord,
  Profile,
  ProfileRevision,
  ProviderRecord,
  Run,
  Session,
} from '@elos/contracts';
import type { ConnectionRecord, DeviceAuthRecord, InboxRecord } from './channels/whatsapp/types.js';
import type { ChannelRecord, DeliveryRecord } from './services/channels.js';
import type { ArtifactRecord, LeaseRecord, MailRecord } from './services/coordination.js';
import type { AccessKeyRecord, CredentialRecord } from './services/credentials.js';

export type { GatewayEvent };

/** Um registro por tipo persistido. Área nova entra aqui, e só aqui. */
export type Records = {
  profile: Profile;
  provider: ProviderRecord;
  modelDefault: ModelDefaultsRecord;
  revision: ProfileRevision;
  session: Session;
  message: Message;
  memory: Memory;
  run: Run;
  credential: CredentialRecord;
  accessKey: AccessKeyRecord;
  artifact: ArtifactRecord;
  lease: LeaseRecord;
  mail: MailRecord;
  channel: ChannelRecord;
  delivery: DeliveryRecord;
  checkpoint: Checkpoint;
  channelConnection: ConnectionRecord;
  channelAuth: DeviceAuthRecord;
  channelInbox: InboxRecord;
};

export type Kind = keyof Records;
```

- [ ] **Step 7: Apagar `domain.ts` e `storage.ts` e deixar o compilador listar o serviço**

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && git rm src/domain.ts src/storage.ts && pnpm exec tsc --noEmit 2>&1 | head -60
```

- [ ] **Step 8: Reescrever os imports, arquivo por arquivo, guiado pelo compilador**

Regra de tradução, sem exceção:

| Vinha de `domain.js` | Passa a vir de |
| --- | --- |
| `GatewayError`, `assertFound` | `core/errors.js` |
| `Records`, `Kind` | `records.js` |
| `Reader`, `Transaction`, `Store`, `Selection` (de `storage.js`) | `core/store.js` |
| qualquer schema ou tipo de contrato (`profileSchema`, `Profile`, `Run`, …) | `@elos/contracts` |

O ponto de atenção: `domain.ts` fazia `export * from '@elos/contracts'`, então muitos módulos importavam schema de contrato achando que era coisa local. Todos passam a importar de `@elos/contracts` direto. Use `import type` onde só o tipo é usado, como o repositório já faz.

Repita `pnpm exec tsc --noEmit` até zerar. Não crie um `core/index.ts` que reexporte tudo: o barril traz de volta o despejo comum que esta tarefa está desmontando.

- [ ] **Step 9: Formatar e verificar**

```bash
cd /Volumes/Data/Developer/elos && pnpm exec biome check --write apps/gateway/src apps/gateway/tests && pnpm check
```

Esperado: verde, com a mesma contagem de testes do Step 1.

- [ ] **Step 10: Commit**

```bash
cd /Volumes/Data/Developer/elos && git add apps/gateway/src apps/gateway/tests && git commit -m "refactor(gateway): extract core types and compose the record map"
```

---

### Task 2: Consolidar provider em uma pasta

Provider está em três lugares: `providers.ts` e `codex-model.ts` e `provider-catalog.ts` na raiz, `services/codex-login.ts` em serviços.

**Files:**
- Move: `src/provider-catalog.ts` → `src/providers/catalog.ts`
- Move: `src/providers.ts` → `src/providers/models.ts`
- Move: `src/codex-model.ts` → `src/providers/codex/model.ts`
- Move: `src/services/codex-login.ts` → `src/providers/codex/login.ts`
- Modify: `src/records.ts`, `src/gateway.ts`, `src/runtime.ts`, `src/runtime/types.ts`, `src/app.ts`, `src/main.ts`
- Modify: `tests/codex-model.test.ts`, `tests/codex-login.test.ts`, `tests/providers.test.ts`

**Interfaces:**
- Consumes: `core/errors.js`, `records.js` da Task 1.
- Produces: `providerCatalog`, `environmentProvider`, `providerEnvironment`, `ProviderKind` de `providers/catalog.js`; `resolveModel` de `providers/models.js`; `createCodexModel` de `providers/codex/model.js`; `CodexLogin` de `providers/codex/login.js`. Nenhum nome de export muda.

- [ ] **Step 1: Mover os quatro arquivos**

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && mkdir -p src/providers/codex && git mv src/provider-catalog.ts src/providers/catalog.ts && git mv src/providers.ts src/providers/models.ts && git mv src/codex-model.ts src/providers/codex/model.ts && git mv src/services/codex-login.ts src/providers/codex/login.ts
```

- [ ] **Step 2: Corrigir os imports guiado pelo compilador**

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && pnpm exec tsc --noEmit 2>&1 | head -40
```

Dentro de `src/providers/`, o caminho para a raiz de `src` passa a ser `../` (ou `../../` sob `codex/`). Os arquivos de teste importam pelo caminho novo.

- [ ] **Step 3: Verificar**

```bash
cd /Volumes/Data/Developer/elos && pnpm check
```

- [ ] **Step 4: Commit**

```bash
cd /Volumes/Data/Developer/elos && git add -A apps/gateway && git commit -m "refactor(gateway): gather provider code under one folder"
```

---

### Task 3: Serviços de perfil, sessão e memória

Primeira fatia da classe. Durante as Tasks 3, 4 e 5 a classe `Gateway` guarda instâncias dos serviços novos e delega — andaime temporário, removido no fim da Task 5. Sem isso a suíte ficaria vermelha por três tarefas seguidas.

**Files:**
- Create: `src/profiles/service.ts`, `src/sessions/service.ts`, `src/memories/service.ts`
- Modify: `src/gateway.ts` (remover os métodos movidos, delegar)
- Modify: `src/records.ts` (nada nesta tarefa; os tipos de perfil, sessão, mensagem e memória já vêm do contrato)

**Interfaces:**
- Consumes: `Store`, `Reader`, `Transaction` de `core/store.js`; `Clock`, `nowIso` de `core/clock.js`; `recordEvent` de `core/events.js`; `GatewayError`, `assertFound` de `core/errors.js`.
- Produces:

```ts
export class Profiles {
  constructor(store: Store, clock?: Clock);
  profile(id: string, reader?: Reader): Promise<Profile>;
  profiles(): Promise<Profile[]>;
  createProfile(input: unknown): Promise<Profile>;
  updateProfile(id: string, input: unknown): Promise<Profile>;
  revisions(id: string): Promise<ProfileRevision[]>;
  validateCredentials(profile: Profile, reader: Reader): Promise<void>;
}

export class Sessions {
  constructor(store: Store, profiles: Profiles, clock?: Clock);
  createSession(profileId: string, input: unknown): Promise<Session>;
  session(profileId: string, sessionId: string, reader?: Reader): Promise<Session>;
  sessions(profileId: string): Promise<Session[]>;
  messages(profileId: string, sessionId: string, limit?: number): Promise<Message[]>;
}

export class Memories {
  constructor(store: Store, profiles: Profiles, sessions: Sessions, clock?: Clock);
  memories(profileId: string): Promise<Memory[]>;
  remember(profileId: string, input: unknown, sourceSessionId?: string): Promise<Memory>;
}
```

`validateCredentials` é público nesta tarefa por precaução, mas a Task 4 mostrou que ninguém fora de `Profiles` o chama: `createProvider` e `configureCodexProvider` validam a credencial com mensagem própria. A Task 6 devolve o método a privado.

Nas Tasks 3, 4 e 5 um serviço injetado é tipado pela classe concreta. A Task 6 estreita cada um desses parâmetros para a porta correspondente; fazer as duas coisas de uma vez deixaria a suíte vermelha por mais tempo sem ganho.

- [ ] **Step 1: Criar `profiles/service.ts` com os seis métodos**

Mova o corpo de `profile`, `profiles`, `createProfile`, `validateCredentials`, `updateProfile` e `revisions` de `src/gateway.ts` (linhas 48–118 e 322–363) sem alterar uma linha de lógica. Troque `this.now()` por `nowIso(this.clock)` e `this.event(tx, …)` por `recordEvent(tx, this.clock, …)`.

- [ ] **Step 2: Criar `sessions/service.ts` e `memories/service.ts`**

Mesma regra, de `src/gateway.ts` linhas 364–398 (sessões e mensagens) e 558–601 (memórias). Onde o corpo chamava `this.profile(profileId, tx)`, passa a chamar `this.profiles.profile(profileId, tx)` — é o mesmo `tx`, então a transação continua uma só.

- [ ] **Step 3: Fazer a classe delegar**

Em `src/gateway.ts`, instancie os três no construtor e substitua cada método movido por uma linha que delega. O andaime é temporário: deixe um comentário único no topo da classe dizendo que ela é um ponto de passagem em migração e que a Task 5 a apaga.

- [ ] **Step 4: Verificar**

```bash
cd /Volumes/Data/Developer/elos && pnpm check
```

Esperado: verde, mesma contagem de testes. Nenhum teste muda nesta tarefa, porque a superfície pública da classe continua idêntica.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Data/Developer/elos && git add -A apps/gateway && git commit -m "refactor(gateway): split profile, session and memory services out of the class"
```

---

### Task 4: Serviço de provider

**Files:**
- Create: `src/providers/service.ts`
- Modify: `src/gateway.ts`

**Interfaces:**
- Consumes: `Profiles` da Task 3 (só `profile`), `providerCatalog`, `environmentProvider`, `ProviderKind` de `providers/catalog.js`.
- Produces:

```ts
export class Providers {
  constructor(store: Store, profiles: Profiles, clock?: Clock);
  providers(profileId: string): Promise<ProviderRecord[]>;
  createProvider(profileId: string, input: unknown): Promise<ProviderRecord>;
  configureCodexProvider(profileId: string, credentialId: string): Promise<ProviderRecord>;
  revokeProvider(profileId: string, providerId: string): Promise<ProviderRecord>;
  modelDefaults(profileId: string): Promise<ModelDefaultsRecord>;
  setModelDefaults(profileId: string, input: unknown): Promise<ModelDefaultsRecord>;
  selectedModel(
    profileId: string,
    selection: ModelSelection,
    reader: Reader,
  ): Promise<{ config: ModelConfig; policy: ContextPolicy }>;
}
```

`selectedModel` era privado e passa a público, porque `Runs`, na Task 5, o chama ao congelar a configuração de um run.

`ContextPolicy` não é exportado por `@elos/contracts`; `providers/service.ts` o declara como `NonNullable<Run['contextPolicy']>`, derivado do contrato para não divergir. A porta da Task 6 importa esse tipo de lá.

- [ ] **Step 1: Mover os sete métodos**

De `src/gateway.ts` linhas 119–321, sem mudar lógica. O tipo de retorno de `selectedModel` é o objeto `{ config, policy }` que o corpo já monta; declare-o explicitamente para que a porta da Task 6 tenha o que citar.

- [ ] **Step 2: Delegar a partir da classe e verificar**

```bash
cd /Volumes/Data/Developer/elos && pnpm check
```

Esperado: verde, mesma contagem.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Data/Developer/elos && git add -A apps/gateway && git commit -m "refactor(gateway): split the provider service out of the class"
```

---

### Task 5: Runs, ciclo de vida, contexto — e o fim da classe

A fatia maior. Ao final, `src/gateway.ts` não existe mais.

**Files:**
- Create: `src/runs/service.ts`, `src/runs/lifecycle.ts`, `src/context/service.ts`, `src/services.ts`
- Create: `tests/helpers/services.ts`
- Create: `tests/profiles.test.ts`, `tests/runs.test.ts`, `tests/sessions.test.ts`
- Delete: `src/gateway.ts`, `tests/gateway.test.ts`
- Modify: `src/main.ts`, `src/app.ts`, `src/queue.ts`, `src/runtime.ts`, `src/tools.ts`, `src/http/events.ts`, `src/services/*.ts`, `src/channels/whatsapp/connections.ts`, `src/providers/codex/login.ts`
- Modify: os 17 arquivos de teste restantes (só a construção do sujeito)

**Interfaces:**
- Consumes: `Profiles`, `Sessions`, `Memories` (Task 3), `Providers` (Task 4), `buildContext` de `context/build.js`.
- Produces:

```ts
export class Runs {
  constructor(store: Store, profiles: Profiles, sessions: Sessions, providers: Providers, clock?: Clock);
  submit(
    profileId: string,
    sessionId: string,
    input: unknown,
    continuationOf?: string,
    activity?: 'conversation' | 'channel',
  ): Promise<Run>;
  run(profileId: string, runId: string, reader?: Reader): Promise<Run>;
  activities(profileId: string): Promise<Run[]>;
  continueRun(profileId: string, runId: string, input: unknown): Promise<Run>;
  cancel(profileId: string, runId: string): Promise<Run>;
}

export class RunLifecycle {
  constructor(store: Store, runs: Runs, clock?: Clock);
  claim(runId: string, profileId: string, owner: string): Promise<Run | null>;
  heartbeat(profileId: string, runId: string, owner: string): Promise<void>;
  checkpoint(profileId: string, runId: string, owner: string, data: unknown): Promise<void>;
  checkpoints(profileId: string, runId: string): Promise<Checkpoint[]>;
  recordUsage(
    profileId: string,
    runId: string,
    owner: string,
    usage: { inputTokens: number; outputTokens: number; steps: number },
  ): Promise<void>;
  finish(
    profileId: string,
    runId: string,
    owner: string,
    status: 'completed' | 'failed' | 'interrupted',
    content: string,
  ): Promise<Run>;
  recover(): Promise<void>;
}

export class Contexts {
  constructor(store: Store, runs: Runs, sessions: Sessions);
  context(run: Run): Promise<{
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>;
}

export type Services = {
  profiles: Profiles;
  providers: Providers;
  sessions: Sessions;
  memories: Memories;
  runs: Runs;
  lifecycle: RunLifecycle;
  contexts: Contexts;
};

export function buildServices(options: { store: Store; clock?: Clock }): Services;
```

- [ ] **Step 1: Criar `runs/service.ts`**

De `src/gateway.ts` linhas 399–557 (`submit`, `run`, `activities`) mais 680–687 (`continueRun`) e 761–784 (`cancel`). O helper `active(run)` do topo do arquivo vem junto, como função de módulo. `continueRun` chama `this.submit` do próprio serviço — a cadeia continua interna.

- [ ] **Step 2: Criar `runs/lifecycle.ts`**

De `src/gateway.ts` linhas 602–679, 688–760 e 785–811. O `owned(run, owner)` privado vira função de módulo no mesmo arquivo; ela precisa do relógio, então receba-o como parâmetro:

```ts
function assertOwned(run: Run, owner: string, clock: Clock): void {
  if (run.status !== 'running' || run.leaseOwner !== owner || (run.leaseUntil ?? 0) <= clock()) {
    throw new GatewayError(409, 'Run lease is no longer valid');
  }
}
```

- [ ] **Step 3: Criar `context/service.ts`**

De `src/gateway.ts` linhas 812–833. O corpo usa três fontes: memórias por palavra (`store.list('memory', …)`), `activities` do serviço de runs e `messages` do de sessões. Injete os dois serviços; não chame o store para o que já tem dono.

- [ ] **Step 4: Criar `src/services.ts` com o montador**

```ts
export function buildServices({ store, clock = Date.now }: { store: Store; clock?: Clock }): Services {
  const profiles = new Profiles(store, clock);
  const providers = new Providers(store, profiles, clock);
  const sessions = new Sessions(store, profiles, clock);
  const memories = new Memories(store, profiles, sessions, clock);
  const runs = new Runs(store, profiles, sessions, providers, clock);

  return {
    profiles,
    providers,
    sessions,
    memories,
    runs,
    lifecycle: new RunLifecycle(store, runs, clock),
    contexts: new Contexts(store, runs, sessions),
  };
}
```

- [ ] **Step 5: Apagar a classe e deixar o compilador apontar cada chamador**

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && git rm src/gateway.ts && pnpm exec tsc --noEmit 2>&1 | head -60
```

Cada módulo que recebia `Gateway` passa a receber, no construtor, só os serviços que usa. A Task 6 estreita isso para interfaces; aqui ainda podem ser as classes concretas.

- [ ] **Step 6: Criar o montador dos testes**

```ts
// tests/helpers/services.ts
import { buildServices, type Services } from '../../src/services.js';
import { MemoryStore } from './memory-store.js';

export function testServices(clock?: () => number): Services & { store: MemoryStore } {
  const store = new MemoryStore();

  return { ...buildServices({ store, clock }), store };
}
```

- [ ] **Step 7: Repartir `tests/gateway.test.ts` por área**

As 441 linhas viram `tests/profiles.test.ts`, `tests/runs.test.ts` e `tests/sessions.test.ts`, conforme o assunto de cada `it`. Copie as asserções sem tocar em nenhum valor esperado. O `setup()` local de cada arquivo usa `testServices()`. Se um `it` cobre duas áreas — por exemplo, versão otimista de perfil e de memória no mesmo caso —, deixe-o inteiro no arquivo da área que ele testa primeiro; dividir um caso é reescrever teste.

- [ ] **Step 8: Verificar que a contagem não caiu**

```bash
cd /Volumes/Data/Developer/elos && pnpm check
```

Esperado: verde, e o total de testes igual ao do Step 1 da Task 1. Se caiu, um `it` se perdeu na repartição.

- [ ] **Step 9: Commit**

```bash
cd /Volumes/Data/Developer/elos && git add -A apps/gateway && git commit -m "refactor(gateway): replace the Gateway class with focused services"
```

---

### Task 6: Portas no lugar das classes concretas

Nove módulos recebem classe concreta quando usam de dois a seis métodos. Cada área publica a interface que cumpre, e o consumidor importa só o tipo.

**Files:**
- Create: `src/profiles/port.ts`, `src/sessions/port.ts`, `src/runs/port.ts`, `src/providers/port.ts`, `src/memories/port.ts`, `src/context/port.ts`
- Modify: `src/runtime.ts`, `src/tools.ts`, `src/queue.ts`, `src/http/events.ts`, `src/services/channels.ts`, `src/services/coordination.ts`, `src/services/credentials.ts`, `src/channels/whatsapp/connections.ts`, `src/providers/codex/login.ts`

**Interfaces:**
- Consumes: os serviços da Task 5, que satisfazem cada porta estruturalmente, e `ContextPolicy` de `providers/service.js`.
- Produces:

```ts
// profiles/port.ts
export interface ProfileReader {
  profile(id: string, reader?: Reader): Promise<Profile>;
}

export interface ProfileAdmin extends ProfileReader {
  profiles(): Promise<Profile[]>;
  createProfile(input: unknown): Promise<Profile>;
  updateProfile(id: string, input: unknown): Promise<Profile>;
}

// sessions/port.ts
export interface SessionReader {
  session(profileId: string, sessionId: string, reader?: Reader): Promise<Session>;
  sessions(profileId: string): Promise<Session[]>;
  messages(profileId: string, sessionId: string, limit?: number): Promise<Message[]>;
}

export interface SessionWriter extends SessionReader {
  createSession(profileId: string, input: unknown): Promise<Session>;
}

// runs/port.ts
export interface RunReader {
  run(profileId: string, runId: string, reader?: Reader): Promise<Run>;
  activities(profileId: string): Promise<Run[]>;
}

export interface RunWriter extends RunReader {
  submit(
    profileId: string,
    sessionId: string,
    input: unknown,
    continuationOf?: string,
    activity?: 'conversation' | 'channel',
  ): Promise<Run>;
}

export interface RunExecution {
  claim(runId: string, profileId: string, owner: string): Promise<Run | null>;
  heartbeat(profileId: string, runId: string, owner: string): Promise<void>;
  checkpoint(profileId: string, runId: string, owner: string, data: unknown): Promise<void>;
  checkpoints(profileId: string, runId: string): Promise<Checkpoint[]>;
  recordUsage(
    profileId: string,
    runId: string,
    owner: string,
    usage: { inputTokens: number; outputTokens: number; steps: number },
  ): Promise<void>;
  finish(
    profileId: string,
    runId: string,
    owner: string,
    status: 'completed' | 'failed' | 'interrupted',
    content: string,
  ): Promise<Run>;
}

export interface RunRecovery {
  recover(): Promise<void>;
}

// providers/port.ts
export interface ProviderAdmin {
  providers(profileId: string): Promise<ProviderRecord[]>;
  configureCodexProvider(profileId: string, credentialId: string): Promise<ProviderRecord>;
}

export interface ProviderSelection {
  selectedModel(
    profileId: string,
    selection: ModelSelection,
    reader: Reader,
  ): Promise<{ config: ModelConfig; policy: ContextPolicy }>;
}

// memories/port.ts
export interface MemoryWriter {
  memories(profileId: string): Promise<Memory[]>;
  remember(profileId: string, input: unknown, sourceSessionId?: string): Promise<Memory>;
}

// context/port.ts
export interface ContextSource {
  context(run: Run): Promise<{
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>;
}
```

- [ ] **Step 1: Escrever as seis portas exatamente como acima**

Nada de `implements` nos serviços: a checagem estrutural do TypeScript já falha se um serviço deixar de cumprir a porta que alguém pede.

- [ ] **Step 2: Trocar o tipo dentro do objeto de dependências de cada consumidor**

A Task 5 deu a cada consumidor um único objeto de dependências, com só as chaves que ele usa, em vez de parâmetros posicionais. Portar, aqui, é trocar a classe concreta pela porta dentro desses tipos: `ToolServices` em `tools.ts`, `RuntimeServices` em `runtime.ts` (que é `ToolServices & { contexts }`, porque o runtime monta o conjunto de ferramentas), `CoordinationServices`, `ChannelServices`, e os objetos declarados em `codex-login.ts`, `queue.ts`, `credentials.ts` e `registerEventRoutes`. `WhatsAppConnections` recebe o `Store` cru e não muda.

O que cada chave passa a ter como tipo, medido pelo uso de hoje:

| Módulo | Recebe |
| --- | --- |
| `tools.ts` (`ToolServices`) | `ProfileAdmin`, `MemoryWriter`, `SessionReader`, `RunReader`, `RunExecution` (só `checkpoints`), `Store` |
| `runtime.ts` (`RuntimeServices`) | `ToolServices` mais `ContextSource` |
| `queue.ts` | `RunRecovery`, `Store` |
| `http/events.ts` | `ProfileReader`, `Store` |
| `services/channels.ts` | `ProfileReader`, `SessionWriter`, `RunWriter`, `Store` |
| `services/coordination.ts` | `ProfileReader`, `SessionReader`, `RunReader`, `Store` |
| `services/credentials.ts` | `ProfileReader`, `Store` |
| `channels/whatsapp/connections.ts` | `Store` |
| `providers/codex/login.ts` | `ProfileReader`, `ProviderAdmin` |

- [ ] **Step 3: Devolver `Profiles.validateCredentials` a privado**

Nada fora de `Profiles` o chama — `createProfile` e `updateProfile` são os dois usos. Corrija também o comentário que a Task 3 deixou dizendo que `Providers` depende dele.

- [ ] **Step 4: Estreitar também os parâmetros entre serviços**

Os serviços que recebem outro serviço pela classe concreta, vindos das Tasks 3 a 5, passam a receber a porta: `Sessions`, `Memories`, `Providers` e `Runs` recebem `ProfileReader`; `Memories`, `Runs` e `Contexts` recebem `SessionReader`; `Runs` recebe `ProviderSelection`; `RunLifecycle` e `Contexts` recebem `RunReader`.

- [ ] **Step 5: Atualizar a montagem**

`main.ts` e `app.ts` passam os serviços do `buildServices`; como as portas são estruturais, não há adaptador para escrever.

- [ ] **Step 6: Verificar**

```bash
cd /Volumes/Data/Developer/elos && pnpm check
```

- [ ] **Step 7: Commit**

```bash
cd /Volumes/Data/Developer/elos && git add -A apps/gateway && git commit -m "refactor(gateway): depend on narrow ports instead of concrete services"
```

---

### Task 7: Repartir o registro de rotas

`app.ts` tem 389 linhas e cerca de 50 rotas de oito assuntos.

**Files:**
- Create: `src/http/params.ts`, `src/http/meta.ts`
- Create: `src/profiles/routes.ts`, `src/providers/routes.ts`, `src/sessions/routes.ts`, `src/runs/routes.ts`, `src/memories/routes.ts`, `src/coordination/routes.ts`, `src/channels/routes.ts`, `src/security/routes.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `createApp` recebe o pacote achatado `Services & { store: Store; token: string; … }`, como a Task 5 deixou. Cada registrador recebe esse mesmo objeto e declara no seu tipo só as chaves que usa.
- Produces: uma função por arquivo, com a forma

```ts
export function registerProfileRoutes(app: FastifyInstance, deps: { profiles: ProfileAdmin }): void;
```

e, em `http/params.ts`, os tipos de parâmetro hoje declarados dentro de `createApp`:

```ts
export type ProfileParams = { profileId: string };
export type SessionParams = ProfileParams & { sessionId: string };
export type RunParams = ProfileParams & { runId: string };
export type ChannelParams = ProfileParams & { channelId: string };
export type CredentialParams = ProfileParams & { credentialId: string };
export type KeyParams = ProfileParams & { keyId: string };
```

- [ ] **Step 1: Extrair `http/params.ts` e apontar `app.ts` para ele**

- [ ] **Step 2: Mover as rotas, um assunto por vez, verificando entre cada um**

A divisão, por caminho:

| Módulo | Rotas |
| --- | --- |
| `profiles/routes.ts` | `/v1/profiles` (listar, criar), `/v1/profiles/:profileId` (ler, alterar), `…/revisions` |
| `providers/routes.ts` | `…/providers` (listar, criar, revogar), `…/model-defaults` (ler, gravar) e as duas rotas de login Codex |
| `sessions/routes.ts` | `…/sessions` (listar, criar), `…/sessions/:sessionId/submit`, `…/history` e `…/sessions/:sessionId/history` |
| `runs/routes.ts` | `…/activities`, `…/runs/:runId`, `…/cancel`, `…/checkpoints`, `…/continue` |
| `memories/routes.ts` | `…/memories` (ler, gravar) |
| `coordination/routes.ts` | `…/artifacts/:artifactId`, `…/leases`, `…/leases/release`, `…/mail`, `…/sessions/:sessionId/mail` |
| `channels/routes.ts` | `…/channels` (criar, listar, revogar), `…/deliveries`, conectar, conexão, QR, desconectar, `/v1/ingress/:channelId`, `/v1/telegram/:channelId` |
| `security/routes.ts` | credenciais, chaves de acesso e as duas rotas de sessão do painel |
| `http/meta.ts` | `/health`, `/openapi.json` |

A guarda de `updateProfile` que barra requisição com escopo de mudar concessão de capacidade vai junto para `profiles/routes.ts`, com `isScopedRequest` recebido como dependência. Ela é a razão de a rota existir desse jeito; não a deixe atrás em `app.ts`.

Depois de cada assunto:

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && pnpm vitest run tests/app.test.ts
```

- [ ] **Step 3: Deixar em `app.ts` só a montagem**

Ficam: criação do Fastify com os limites de hoje, `helmet`, `rate-limit`, o gancho `onRoute` que aplica o schema da operação, `configureSecurity`, o tratador de erro, `registerGatewayUi`, `registerEventRoutes` e as chamadas aos nove registradores. Nada de regra de negócio.

- [ ] **Step 4: Verificar**

```bash
cd /Volumes/Data/Developer/elos && pnpm check && pnpm contracts:check
```

Esperado: verde, e nenhuma diferença em `packages/contracts/openapi.json`. Se o arquivo mudou, uma rota saiu do lugar com caminho ou método diferente.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Data/Developer/elos && git add -A apps/gateway && git commit -m "refactor(gateway): register routes per area"
```

---

### Task 8: Mover o que resta para a estrutura final

**Files:**
- Move: `src/runtime.ts` → `src/agent/runtime.ts`; `src/runtime/mcp.ts` → `src/agent/mcp.ts`; `src/runtime/results.ts` → `src/agent/results.ts`; `src/runtime/types.ts` → `src/agent/types.ts`; `src/tools.ts` → `src/agent/tools.ts`
- Move: `src/services/channels.ts` → `src/channels/service.ts`; `src/services/coordination.ts` → `src/coordination/service.ts`; `src/services/credentials.ts` → `src/security/credentials.ts`
- Move: `src/http/panel-session.ts` → `src/security/panel-session.ts`
- Move: `src/queue.ts` → `src/runs/queue.ts`
- Move: `src/postgres.ts` → `src/storage/postgres.ts`; `src/migrations.ts` → `src/storage/migrations.ts`
- Modify: `src/records.ts` (caminhos dos tipos de registro), `src/main.ts`, `src/app.ts` e os testes correspondentes

- [ ] **Step 1: Mover em quatro lotes, verificando o compilador entre eles**

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && mkdir -p src/agent src/coordination src/storage && git mv src/runtime.ts src/agent/runtime.ts && git mv src/runtime/mcp.ts src/agent/mcp.ts && git mv src/runtime/results.ts src/agent/results.ts && git mv src/runtime/types.ts src/agent/types.ts && git mv src/tools.ts src/agent/tools.ts && rmdir src/runtime && pnpm exec tsc --noEmit 2>&1 | head -30
```

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && git mv src/services/channels.ts src/channels/service.ts && git mv src/services/coordination.ts src/coordination/service.ts && git mv src/services/credentials.ts src/security/credentials.ts && rmdir src/services && pnpm exec tsc --noEmit 2>&1 | head -30
```

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && git mv src/http/panel-session.ts src/security/panel-session.ts && git mv src/queue.ts src/runs/queue.ts && git mv src/postgres.ts src/storage/postgres.ts && git mv src/migrations.ts src/storage/migrations.ts && pnpm exec tsc --noEmit 2>&1 | head -30
```

`src/http/security.ts` fica onde está: o que ele faz é encanamento do Fastify — um gancho de requisição e o tratador de erro público. O cookie assinado, que é regra de segurança, é que muda de casa.

- [ ] **Step 2: Atualizar `src/records.ts` para os caminhos finais**

Os quatro imports de tipo de registro passam a apontar para `./channels/service.js`, `./coordination/service.js`, `./security/credentials.js` e `./channels/whatsapp/types.js`.

- [ ] **Step 3: Conferir que a regra de camada vale de fato**

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && grep -rn "from '\.\./" src/core/ | grep -v "records.js"
```

Esperado: nenhuma linha. `core/` só pode alcançar `records.js`, e só como tipo.

- [ ] **Step 4: Verificar**

```bash
cd /Volumes/Data/Developer/elos && pnpm check
```

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Data/Developer/elos && git add -A apps/gateway && git commit -m "refactor(gateway): move runtime, channels, coordination and storage into their areas"
```

---

### Task 9: Documentar a estrutura

`docs/architecture.md` descreve a estrutura antiga por nome: cita a classe que guarda perfil, revisões, sessões, mensagens, memórias e execuções, e os serviços `Credentials`, `Coordination` e `Channels` como se fossem a divisão principal.

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Reescrever os dois parágrafos que descrevem a divisão interna**

O que precisa constar, em uma frase cada: a regra de camada (`core/` ← áreas ← `app.ts` ← `main.ts`); que área nova é pasta nova, com serviço, rotas, porta e registro; que o mapa de registros vive em `src/records.ts`, na composição; que consumidor recebe porta, não serviço inteiro. Mantenha o resto do arquivo, que descreve comportamento e continua correto.

- [ ] **Step 2: Conferir que nenhum caminho citado na documentação sumiu**

```bash
cd /Volumes/Data/Developer/elos && grep -ohrE "(apps/gateway/)?src/[a-z/.-]+\.ts" docs/*.md | sort -u | while read -r path; do candidate="${path#apps/gateway/}"; [ -f "apps/gateway/$candidate" ] || echo "referência quebrada: $path"; done
```

Esperado: nenhuma saída.

- [ ] **Step 3: Verificar e commitar**

```bash
cd /Volumes/Data/Developer/elos && pnpm check && git add docs/architecture.md && git commit -m "docs: describe the gateway layering rule"
```

---

## Fechamento

- [ ] **Confirmar as invariantes da mudança inteira**

```bash
cd /Volumes/Data/Developer/elos && pnpm check && pnpm contracts:check && git diff --stat ef28fb5 -- packages/contracts/openapi.json
```

Esperado: `pnpm check` verde; a contagem de testes igual à do começo; e `openapi.json` sem diferença nesta mudança — o contrato estava congelado.

- [ ] **Conferir que nenhum arquivo de `src` passou de 250 linhas sem motivo declarado**

```bash
cd /Volumes/Data/Developer/elos/apps/gateway && find src -name "*.ts" | xargs wc -l | sort -rn | head -12
```

`channels/whatsapp/connections.ts` (540 linhas) e `channels/service.ts` (399) seguem grandes: são território do protocolo e das entregas duráveis, fora do escopo desta mudança. Se um arquivo novo aparecer no topo, ele foi dividido errado.
