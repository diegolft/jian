import { randomUUID } from 'node:crypto';
import {
  continuationSchema,
  type Message,
  profileRecordSchema,
  type Run,
  submitSchema,
} from '@jian/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { assertFound, GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Reader, Store } from '../core/store.js';
import type { ProfileReader } from '../profiles/port.js';
import type { ProviderSelection } from '../providers/port.js';
import type { SessionReader } from '../sessions/port.js';
import type { SubmitOptions } from './port.js';

const active = (run: Run) => run.status === 'running' || run.status === 'queued';

export class Runs {
  constructor(
    private readonly store: Store,
    private readonly profiles: ProfileReader,
    private readonly sessions: SessionReader,
    private readonly providers: ProviderSelection,
    private readonly clock: Clock = Date.now,
  ) {}

  async submit(profileId: string, sessionId: string, input: unknown, options: SubmitOptions = {}) {
    const { continuationOf, activity = 'conversation', call } = options;
    const data = submitSchema.parse(input);

    return this.store.transaction(profileId, async (tx) => {
      const profile = await this.profiles.profile(profileId, tx);

      if (continuationOf) {
        const parent = await this.run(profileId, continuationOf, tx);

        if (
          parent.sessionId !== sessionId ||
          !['interrupted', 'failed', 'cancelled'].includes(parent.status)
        ) {
          throw new GatewayError(409, 'Only stopped runs in this session can be continued');
        }
      }

      await this.sessions.session(profileId, sessionId, tx);

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
      let chosen: Awaited<ReturnType<typeof this.providers.selectedModel>> | null = null;
      if (selection) {
        try {
          chosen = await this.providers.selectedModel(profileId, selection, tx);
        } catch (error) {
          if (data.model) throw error;
          selection = null;
        }
      }
      // No list is invented here: which models a key can call is the provider's answer, so a
      // run needs a model the owner actually chose for this activity.
      if (!chosen && !profile.model.apiKeyEnv && !profile.model.providerId) {
        throw new GatewayError(409, 'Choose a default model before starting a run');
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
        ...(call ? { call } : {}),
        status: 'queued',
        ...(continuationOf ? { continuationOf } : {}),
        createdAt: nowIso(this.clock),
        updatedAt: nowIso(this.clock),
      };

      const message: Message = {
        id: randomUUID(),
        profileId,
        sessionId,
        runId: run.id,
        role: 'user',
        content: data.text,
        createdAt: nowIso(this.clock),
      };

      await tx.put('message', message.id, profileId, message);
      await tx.put('run', run.id, profileId, run);

      await recordEvent(
        tx,
        this.clock,
        profileId,
        'run.queued',
        { sessionId, input: data.text },
        run.id,
      );

      return run;
    });
  }

  async run(profileId: string, runId: string, reader: Reader = this.store) {
    const run = await reader.get('run', runId);
    const owned = assertFound(run?.profileId === profileId ? run : null, 'Run');

    return { ...owned, profile: profileRecordSchema.parse(owned.profile) };
  }

  async activities(profileId: string) {
    await this.profiles.profile(profileId);

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

  async continueRun(profileId: string, runId: string, input: unknown) {
    const data = continuationSchema.parse(input);
    const parent = await this.run(profileId, runId);
    const text = `${data.text}\n\nContinuation of run ${runId}. Previously completed external effects must not be repeated. Operator reconciliation (data): ${JSON.stringify(data.reconciliation)}. Use read_run_checkpoints to inspect saved results before acting.`;

    // A continuation stays in the chain that started the run: its budget was already spent.
    return this.submit(
      profileId,
      parent.sessionId,
      { text, requestKey: data.requestKey },
      { continuationOf: runId, ...(parent.call ? { call: parent.call } : {}) },
    );
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
        updatedAt: nowIso(this.clock),
        leaseOwner: undefined,
        leaseUntil: undefined,
      };

      await tx.put('run', runId, profileId, final);
      await recordEvent(tx, this.clock, profileId, 'run.cancelled', {}, runId);

      return final;
    });
  }
}
