import { randomUUID } from 'node:crypto';
import { buildContext } from './context/build.js';
import type { Memory, Message, Profile, Run, Session } from './domain.js';
import {
  assertFound,
  continuationSchema,
  GatewayError,
  memorySchema,
  profilePatchSchema,
  profileRecordSchema,
  profileSchema,
  sessionSchema,
  submitSchema,
} from './domain.js';
import type { Reader, Store, Transaction } from './storage.js';

const active = (run: Run) => run.status === 'running' || run.status === 'queued';

export class Gateway {
  constructor(
    public readonly store: Store,
    private readonly clock = Date.now,
  ) {}

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

  async profile(id: string, reader: Reader = this.store) {
    return profileRecordSchema.parse(assertFound(await reader.get('profile', id), 'Profile'));
  }

  async profiles() {
    return (await this.store.list('profile', { limit: 100 })).map((profile) =>
      profileRecordSchema.parse(profile),
    );
  }

  async createProfile(input: unknown) {
    const data = profileSchema.parse(input);

    const profile: Profile = {
      ...data,
      id: randomUUID(),
      version: 1,
      createdAt: this.now(),
      updatedAt: this.now(),
    };

    await this.store.transaction(profile.id, async (tx) => {
      await this.validateCredentials(profile, tx);
      await tx.put('profile', profile.id, profile.id, profile);

      await tx.put('revision', `${profile.id}:1`, profile.id, {
        id: `${profile.id}:1`,
        profileId: profile.id,
        profile,
        createdAt: this.now(),
      });

      await this.event(tx, profile.id, 'profile.created', { profileId: profile.id, version: 1 });
    });

    return profile;
  }

  private async validateCredentials(profile: Profile, reader: Reader) {
    for (const names of [
      profile.skills.map((skill) => skill.name),
      profile.mcpServers.map((server) => server.name),
    ]) {
      if (new Set(names).size !== names.length) {
        throw new GatewayError(400, 'Skill and MCP names must be unique within a profile');
      }
    }

    const references = [
      { id: profile.model.credentialId, kind: 'provider' },
      ...profile.mcpServers.map((server) => ({ id: server.credentialId, kind: 'mcp' })),
    ];

    for (const reference of references) {
      if (!reference.id) {
        continue;
      }

      const credential = await reader.get('credential', reference.id);

      if (
        !credential ||
        credential.profileId !== profile.id ||
        credential.kind !== reference.kind ||
        credential.revokedAt
      ) {
        throw new GatewayError(400, 'Credential reference is not available to this profile');
      }
    }
  }

  async updateProfile(id: string, input: unknown) {
    const { expectedVersion, ...patch } = profilePatchSchema.parse(input);

    return this.store.transaction(id, async (tx) => {
      const current = await this.profile(id, tx);

      if (current.version !== expectedVersion) {
        throw new GatewayError(409, 'Profile version changed; reload before editing');
      }

      const profile: Profile = {
        ...current,
        ...patch,
        version: current.version + 1,
        updatedAt: this.now(),
      };

      await this.validateCredentials(profile, tx);
      await tx.put('profile', id, id, profile);

      const revision = {
        id: `${id}:${profile.version}`,
        profileId: id,
        profile,
        createdAt: this.now(),
      };

      await tx.put('revision', revision.id, id, revision);
      await this.event(tx, id, 'profile.updated', { profileId: id, version: profile.version });

      return profile;
    });
  }

  async revisions(id: string) {
    await this.profile(id);

    return (await this.store.list('revision', { profileId: id, descending: true, limit: 50 })).map(
      (revision) => ({ ...revision, profile: profileRecordSchema.parse(revision.profile) }),
    );
  }

  async createSession(profileId: string, input: unknown) {
    const data = sessionSchema.parse(input);

    return this.store.transaction(profileId, async (tx) => {
      await this.profile(profileId, tx);

      const session: Session = { ...data, id: randomUUID(), profileId, createdAt: this.now() };

      await tx.put('session', session.id, profileId, session);
      await this.event(tx, profileId, 'session.created', session);

      return session;
    });
  }

  async session(profileId: string, sessionId: string, reader: Reader = this.store) {
    const session = await reader.get('session', sessionId);

    return assertFound(session?.profileId === profileId ? session : null, 'Session');
  }

  async sessions(profileId: string) {
    await this.profile(profileId);

    return this.store.list('session', { profileId, descending: true, limit: 100 });
  }

  async messages(profileId: string, sessionId: string, limit = 100) {
    await this.session(profileId, sessionId);

    return (
      await this.store.list('message', { profileId, where: { sessionId }, limit, descending: true })
    ).reverse();
  }

  async submit(profileId: string, sessionId: string, input: unknown, continuationOf?: string) {
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
        if (duplicate.input !== data.text) {
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

      if (!profile.model.apiKeyEnv && !profile.model.credentialId) {
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

  async memories(profileId: string) {
    await this.profile(profileId);

    return this.store.list('memory', { profileId, descending: true, limit: 100 });
  }

  async remember(profileId: string, input: unknown, sourceSessionId?: string) {
    const { expectedVersion, ...data } = memorySchema.parse(input);

    return this.store.transaction(profileId, async (tx) => {
      await this.profile(profileId, tx);

      if (sourceSessionId) {
        await this.session(profileId, sourceSessionId, tx);
      }

      const id = `${profileId}:${data.key}`;
      const old = await tx.get('memory', id);

      if ((old?.version ?? 0) !== expectedVersion) {
        throw new GatewayError(409, 'Memory version changed; reload before editing');
      }

      const memory: Memory = {
        ...data,
        id,
        profileId,
        version: expectedVersion + 1,
        sourceSessionId,
        updatedAt: this.now(),
      };

      await tx.put('memory', id, profileId, memory);

      await this.event(tx, profileId, 'memory.updated', {
        key: memory.key,
        version: memory.version,
        sourceSessionId,
      });

      return memory;
    });
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
