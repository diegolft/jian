import { randomUUID } from 'node:crypto';
import type { Message, Run } from '@elos/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Store } from '../core/store.js';
import type { Runs } from './service.js';

/** The lease is the right to apply external effects, so a stale owner must never write. */
function assertOwned(run: Run, owner: string, clock: Clock): void {
  if (run.status !== 'running' || run.leaseOwner !== owner || (run.leaseUntil ?? 0) <= clock()) {
    throw new GatewayError(409, 'Run lease is no longer valid');
  }
}

export class RunLifecycle {
  constructor(
    private readonly store: Store,
    private readonly runs: Runs,
    private readonly clock: Clock = Date.now,
  ) {}

  async claim(runId: string, profileId: string, owner: string) {
    return this.store.transaction(profileId, async (tx) => {
      const run = await this.runs.run(profileId, runId, tx);

      if (run.status !== 'queued') {
        return null;
      }

      const claimed: Run = {
        ...run,
        status: 'running',
        leaseOwner: owner,
        leaseUntil: this.clock() + 60_000,
        updatedAt: nowIso(this.clock),
      };

      await tx.put('run', run.id, profileId, claimed);

      await recordEvent(
        tx,
        this.clock,
        profileId,
        'run.started',
        { sessionId: run.sessionId },
        run.id,
      );

      return claimed;
    });
  }

  async heartbeat(profileId: string, runId: string, owner: string) {
    await this.store.transaction(profileId, async (tx) => {
      const run = await this.runs.run(profileId, runId, tx);

      assertOwned(run, owner, this.clock);

      await tx.put('run', run.id, profileId, {
        ...run,
        leaseUntil: this.clock() + 60_000,
        updatedAt: nowIso(this.clock),
      });
    });
  }

  async checkpoint(profileId: string, runId: string, owner: string, data: unknown) {
    await this.store.transaction(profileId, async (tx) => {
      const run = await this.runs.run(profileId, runId, tx);

      assertOwned(run, owner, this.clock);

      const id = randomUUID();

      await tx.put('checkpoint', id, profileId, {
        id,
        profileId,
        runId,
        data,
        createdAt: nowIso(this.clock),
      });

      await recordEvent(tx, this.clock, profileId, 'run.step', data, runId);
    });
  }

  async checkpoints(profileId: string, runId: string) {
    await this.runs.run(profileId, runId);

    return this.store.list('checkpoint', {
      profileId,
      where: { runId },
      descending: true,
      limit: 100,
    });
  }

  async recordUsage(
    profileId: string,
    runId: string,
    owner: string,
    usage: { inputTokens: number; outputTokens: number; steps: number },
  ) {
    await this.store.transaction(profileId, async (tx) => {
      const run = await this.runs.run(profileId, runId, tx);

      assertOwned(run, owner, this.clock);

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
      const run = await this.runs.run(profileId, runId, tx);

      assertOwned(run, owner, this.clock);

      const final: Run = {
        ...run,
        status,
        updatedAt: nowIso(this.clock),
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
          createdAt: nowIso(this.clock),
        };

        await tx.put('message', message.id, profileId, message);
      }

      await tx.put('run', runId, profileId, final);

      await recordEvent(
        tx,
        this.clock,
        profileId,
        `run.${status}`,
        status === 'completed' ? { text: content } : { error: content },
        runId,
      );

      return final;
    });
  }

  // Expired ownership interrupts a run: replaying it could repeat completed external effects.
  async recover() {
    const runs = await this.store.list('run', { where: { status: 'running' }, limit: 1000 });

    for (const run of runs) {
      await this.store.transaction(run.profileId, async (tx) => {
        const current = await this.runs.run(run.profileId, run.id, tx);

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
          updatedAt: nowIso(this.clock),
        });

        await recordEvent(tx, this.clock, run.profileId, 'run.interrupted', { error }, run.id);
      });
    }
  }
}
