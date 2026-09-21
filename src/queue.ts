import type { PgBoss } from 'pg-boss';
import type { Gateway } from './gateway.js';
import type { AgentRuntime } from './runtime.js';

const queueName = 'elos-agent-runs';
export class RunQueue {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private pending: Promise<void> = Promise.resolve();
  constructor(
    private boss: PgBoss,
    private gateway: Gateway,
    private runtime: AgentRuntime,
    private report: (message: string) => void = console.error,
  ) {}
  async start() {
    this.boss.on('error', () => this.report('elos: queue connection failed'));
    await this.boss.start();
    await this.boss.createQueue(queueName, {
      policy: 'exclusive',
      retryLimit: 0,
      expireInSeconds: 660,
    });
    await this.boss.work<{ profileId: string; runId: string }>(
      queueName,
      { localConcurrency: 4, batchSize: 1, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs) await this.runtime.execute(job.data.profileId, job.data.runId);
      },
    );
    await this.tick();
  }
  private async dispatch() {
    await this.gateway.recover();
    const queued = await this.gateway.store.list('run', {
      where: { status: 'queued' },
      limit: 1000,
    });
    for (const run of queued) {
      if (this.stopped) return;
      await this.boss.send(
        queueName,
        { profileId: run.profileId, runId: run.id },
        { singletonKey: run.id },
      );
    }
  }
  private async tick() {
    if (this.stopped) return;
    this.pending = this.dispatch().catch(() =>
      this.report('elos: run dispatch failed; will retry'),
    );
    await this.pending;
    if (!this.stopped) {
      this.timer = setTimeout(() => {
        void this.tick();
      }, 2000);
      this.timer.unref();
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.runtime.stop();
    await this.pending;
    await this.boss.stop({ graceful: true, timeout: 15_000 });
  }
}
