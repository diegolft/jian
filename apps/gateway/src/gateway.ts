import { randomUUID } from 'node:crypto';
import {
  continuationSchema,
  type Message,
  profileRecordSchema,
  type Run,
  submitSchema,
} from '@elos/contracts';
import { buildContext } from './context/build.js';
import { assertFound, GatewayError } from './core/errors.js';
import type { Reader, Store, Transaction } from './core/store.js';
import { Memories } from './memories/service.js';
import { Profiles } from './profiles/service.js';
import { environmentProvider, type ProviderKind, providerCatalog } from './providers/catalog.js';
import { Providers } from './providers/service.js';
import { Sessions } from './sessions/service.js';

const active = (run: Run) => run.status === 'running' || run.status === 'queued';

// Migration scaffold: this class is a pass-through to the area services while the split
// proceeds, and it is deleted once the run, lifecycle and context services land.
export class Gateway {
  private readonly profileService: Profiles;
  private readonly providerService: Providers;
  private readonly sessionService: Sessions;
  private readonly memoryService: Memories;

  constructor(
    public readonly store: Store,
    private readonly clock = Date.now,
  ) {
    this.profileService = new Profiles(store, clock);
    this.providerService = new Providers(store, this.profileService, clock);
    this.sessionService = new Sessions(store, this.profileService, clock);
    this.memoryService = new Memories(store, this.profileService, this.sessionService, clock);
  }

  private now() {
    return new Date(this.clock()).toISOString();
  }

  private async event(
    tx: Transaction,
    profileId: string,
    type: string,
    data: unknown,
    runId?: string,
  ) {
    await tx.event({ profileId, type, data, runId, createdAt: this.now() });
  }

  profile(id: string, reader?: Reader) {
    return this.profileService.profile(id, reader);
  }

  profiles() {
    return this.profileService.profiles();
  }

  createProfile(input: unknown) {
    return this.profileService.createProfile(input);
  }

  updateProfile(id: string, input: unknown) {
    return this.profileService.updateProfile(id, input);
  }

  revisions(id: string) {
    return this.profileService.revisions(id);
  }

  createSession(profileId: string, input: unknown) {
    return this.sessionService.createSession(profileId, input);
  }

  session(profileId: string, sessionId: string, reader?: Reader) {
    return this.sessionService.session(profileId, sessionId, reader);
  }

  sessions(profileId: string) {
    return this.sessionService.sessions(profileId);
  }

  messages(profileId: string, sessionId: string, limit?: number) {
    return this.sessionService.messages(profileId, sessionId, limit);
  }

  memories(profileId: string) {
    return this.memoryService.memories(profileId);
  }

  remember(profileId: string, input: unknown, sourceSessionId?: string) {
    return this.memoryService.remember(profileId, input, sourceSessionId);
  }

  providers(profileId: string) {
    return this.providerService.providers(profileId);
  }

  createProvider(profileId: string, input: unknown) {
    return this.providerService.createProvider(profileId, input);
  }

  configureCodexProvider(profileId: string, credentialId: string) {
    return this.providerService.configureCodexProvider(profileId, credentialId);
  }

  revokeProvider(profileId: string, providerId: string) {
    return this.providerService.revokeProvider(profileId, providerId);
  }

  modelDefaults(profileId: string) {
    return this.providerService.modelDefaults(profileId);
  }

  setModelDefaults(profileId: string, input: unknown) {
    return this.providerService.setModelDefaults(profileId, input);
  }

  async submit(
    profileId: string,
    sessionId: string,
    input: unknown,
    continuationOf?: string,
    activity: 'conversation' | 'channel' = 'conversation',
  ) {
    const data = submitSchema.parse(input);

    return this.store.transaction(profileId, async (tx) => {
      const profile = await this.profile(profileId, tx);

      if (continuationOf) {
        const parent = await this.run(profileId, continuationOf, tx);

        if (
          parent.sessionId !== sessionId ||
          !['interrupted', 'failed', 'cancelled'].includes(parent.status)
        ) {
          throw new GatewayError(409, 'Only stopped runs in this session can be continued');
        }
      }

      await this.session(profileId, sessionId, tx);

      const duplicate = (
        await tx.list('run', {
          profileId,
          where: { sessionId, requestKey: data.requestKey },
          limit: 1,
        })
      )[0];

      if (duplicate) {
        if (
          duplicate.input !== data.text ||
          (data.model && JSON.stringify(duplicate.modelSelection) !== JSON.stringify(data.model))
        ) {
          throw new GatewayError(409, 'Request key was already used for different content');
        }

        return duplicate;
      }

      const runs = await tx.list('run', {
        profileId,
        where: { sessionId },
        descending: true,
        limit: 1,
      });

      if (runs.some(active)) {
        throw new GatewayError(409, 'Session already has an active run');
      }

      const defaults = await tx.get('modelDefault', profileId);
      let selection = data.model ?? defaults?.[activity] ?? defaults?.conversation;
      let chosen: Awaited<ReturnType<typeof this.providerService.selectedModel>> | null = null;
      if (selection) {
        try {
          chosen = await this.providerService.selectedModel(profileId, selection, tx);
        } catch (error) {
          if (data.model) throw error;
          selection = null;
        }
      }
      if (!chosen && !profile.model.apiKeyEnv && !profile.model.credentialId) {
        const stored = await tx.list('provider', { profileId, limit: 100 });
        const credentials = await tx.list('credential', { profileId, limit: 100 });
        const configured = [
          ...stored.filter(
            (item) =>
              !item.revokedAt &&
              credentials.some(
                (credential) => credential.id === item.credentialId && !credential.revokedAt,
              ),
          ),
          ...(Object.keys(providerCatalog) as ProviderKind[])
            .map((kind) => environmentProvider(profileId, kind))
            .filter((item) => item !== null),
        ];
        const first =
          configured.find((item) => item.kind === profile.model.provider) ?? configured[0];
        if (first?.models[0]) {
          selection = { providerId: first.id, modelId: first.models[0].id };
          chosen = await this.providerService.selectedModel(profileId, selection, tx);
        }
      }

      if (!chosen && !profile.model.apiKeyEnv && !profile.model.credentialId) {
        throw new GatewayError(409, 'Configure a provider credential before starting a run');
      }

      const queued = await tx.list('run', { profileId, where: { status: 'queued' }, limit: 33 });
      const running = await tx.list('run', { profileId, where: { status: 'running' }, limit: 5 });

      if (queued.length + running.length >= 32) {
        throw new GatewayError(429, 'Profile run limit reached');
      }

      // Freeze configuration for this run; later identity edits apply only to new runs.
      const run: Run = {
        id: randomUUID(),
        profileId,
        sessionId,
        requestKey: data.requestKey,
        input: data.text,
        profile,
        ...(chosen ? { model: chosen.config, contextPolicy: chosen.policy } : {}),
        ...(selection ? { modelSelection: selection } : {}),
        status: 'queued',
        ...(continuationOf ? { continuationOf } : {}),
        createdAt: this.now(),
        updatedAt: this.now(),
      };

      const message: Message = {
        id: randomUUID(),
        profileId,
        sessionId,
        runId: run.id,
        role: 'user',
        content: data.text,
        createdAt: this.now(),
      };

      await tx.put('message', message.id, profileId, message);
      await tx.put('run', run.id, profileId, run);
      await this.event(tx, profileId, 'run.queued', { sessionId, input: data.text }, run.id);

      return run;
    });
  }

  async run(profileId: string, runId: string, reader: Reader = this.store) {
    const run = await reader.get('run', runId);
    const owned = assertFound(run?.profileId === profileId ? run : null, 'Run');

    return { ...owned, profile: profileRecordSchema.parse(owned.profile) };
  }

  async activities(profileId: string) {
    await this.profile(profileId);

    const queued = await this.store.list('run', {
      profileId,
      where: { status: 'queued' },
      limit: 100,
    });

    const running = await this.store.list('run', {
      profileId,
      where: { status: 'running' },
      limit: 100,
    });

    return [...queued, ...running].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async claim(runId: string, profileId: string, owner: string) {
    return this.store.transaction(profileId, async (tx) => {
      const run = await this.run(profileId, runId, tx);

      if (run.status !== 'queued') {
        return null;
      }

      const claimed: Run = {
        ...run,
        status: 'running',
        leaseOwner: owner,
        leaseUntil: this.clock() + 60_000,
        updatedAt: this.now(),
      };

      await tx.put('run', run.id, profileId, claimed);
      await this.event(tx, profileId, 'run.started', { sessionId: run.sessionId }, run.id);

      return claimed;
    });
  }

  private owned(run: Run, owner: string) {
    if (
      run.status !== 'running' ||
      run.leaseOwner !== owner ||
      (run.leaseUntil ?? 0) <= this.clock()
    ) {
      throw new GatewayError(409, 'Run lease is no longer valid');
    }
  }

  async heartbeat(profileId: string, runId: string, owner: string) {
    await this.store.transaction(profileId, async (tx) => {
      const run = await this.run(profileId, runId, tx);

      this.owned(run, owner);

      await tx.put('run', run.id, profileId, {
        ...run,
        leaseUntil: this.clock() + 60_000,
        updatedAt: this.now(),
      });
    });
  }

  async checkpoint(profileId: string, runId: string, owner: string, data: unknown) {
    await this.store.transaction(profileId, async (tx) => {
      const run = await this.run(profileId, runId, tx);

      this.owned(run, owner);

      const id = randomUUID();

      await tx.put('checkpoint', id, profileId, {
        id,
        profileId,
        runId,
        data,
        createdAt: this.now(),
      });

      await this.event(tx, profileId, 'run.step', data, runId);
    });
  }

  async checkpoints(profileId: string, runId: string) {
    await this.run(profileId, runId);

    return this.store.list('checkpoint', {
      profileId,
      where: { runId },
      descending: true,
      limit: 100,
    });
  }

  async continueRun(profileId: string, runId: string, input: unknown) {
    const data = continuationSchema.parse(input);
    const parent = await this.run(profileId, runId);
    const text = `${data.text}\n\nContinuation of run ${runId}. Previously completed external effects must not be repeated. Operator reconciliation (data): ${JSON.stringify(data.reconciliation)}. Use read_run_checkpoints to inspect saved results before acting.`;

    return this.submit(profileId, parent.sessionId, { text, requestKey: data.requestKey }, runId);
  }

  async recordUsage(
    profileId: string,
    runId: string,
    owner: string,
    usage: { inputTokens: number; outputTokens: number; steps: number },
  ) {
    await this.store.transaction(profileId, async (tx) => {
      const run = await this.run(profileId, runId, tx);

      this.owned(run, owner);

      const previous = run.usage ?? { inputTokens: 0, outputTokens: 0, steps: 0 };

      await tx.put('run', runId, profileId, {
        ...run,
        usage: {
          inputTokens: previous.inputTokens + usage.inputTokens,
          outputTokens: previous.outputTokens + usage.outputTokens,
          steps: previous.steps + usage.steps,
        },
      });
    });
  }

  async finish(
    profileId: string,
    runId: string,
    owner: string,
    status: 'completed' | 'failed' | 'interrupted',
    content: string,
  ) {
    return this.store.transaction(profileId, async (tx) => {
      const run = await this.run(profileId, runId, tx);

      this.owned(run, owner);

      const final: Run = {
        ...run,
        status,
        updatedAt: this.now(),
        leaseOwner: undefined,
        leaseUntil: undefined,
        ...(status === 'completed' ? { output: content } : { error: content }),
      };

      if (status === 'completed') {
        const message: Message = {
          id: randomUUID(),
          profileId,
          sessionId: run.sessionId,
          runId,
          role: 'assistant',
          content,
          createdAt: this.now(),
        };

        await tx.put('message', message.id, profileId, message);
      }

      await tx.put('run', runId, profileId, final);

      await this.event(
        tx,
        profileId,
        `run.${status}`,
        status === 'completed' ? { text: content } : { error: content },
        runId,
      );

      return final;
    });
  }

  async cancel(profileId: string, runId: string) {
    return this.store.transaction(profileId, async (tx) => {
      const run = await this.run(profileId, runId, tx);

      if (!active(run)) {
        return run;
      }

      const final: Run = {
        ...run,
        status: 'cancelled',
        updatedAt: this.now(),
        leaseOwner: undefined,
        leaseUntil: undefined,
      };

      await tx.put('run', runId, profileId, final);
      await this.event(tx, profileId, 'run.cancelled', {}, runId);

      return final;
    });
  }

  // Expired ownership interrupts a run: replaying it could repeat completed external effects.
  async recover() {
    const runs = await this.store.list('run', { where: { status: 'running' }, limit: 1000 });

    for (const run of runs) {
      await this.store.transaction(run.profileId, async (tx) => {
        const current = await this.run(run.profileId, run.id, tx);

        if (current.status !== 'running' || (current.leaseUntil ?? 0) > this.clock()) {
          return;
        }

        const error = 'Worker lease expired. Inspect completed steps before starting another run.';

        await tx.put('run', run.id, run.profileId, {
          ...current,
          status: 'interrupted',
          error,
          leaseOwner: undefined,
          leaseUntil: undefined,
          updatedAt: this.now(),
        });

        await this.event(tx, run.profileId, 'run.interrupted', { error }, run.id);
      });
    }
  }

  async context(run: Run) {
    const words = [...new Set(run.input.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(
      0,
      12,
    );

    const [memories, activities, history] = await Promise.all([
      words.length
        ? this.store.list('memory', {
            profileId: run.profileId,
            anyWords: words,
            limit: 100,
            descending: true,
          })
        : Promise.resolve([]),
      this.activities(run.profileId),
      this.messages(run.profileId, run.sessionId, 40),
    ]);

    return buildContext(run, { memories, activities, history });
  }
}
