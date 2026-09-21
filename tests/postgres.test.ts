import { MockLanguageModelV4 } from 'ai/test';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Gateway } from '../src/gateway.js';
import { PostgresStore } from '../src/postgres.js';
import { RunQueue } from '../src/queue.js';
import { AgentRuntime } from '../src/runtime.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; use a disposable database');
const connectionString = databaseUrl;
const store = new PostgresStore(connectionString);
const gateway = new Gateway(store);
const input = {
  name: 'CI',
  instructions: 'Help.',
  model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_TEST' },
};

beforeAll(async () => {
  await store.migrate();
}, 30_000);
afterAll(async () => {
  await store.close();
});

describe('PostgreSQL durability', () => {
  it('serializes concurrent submissions and persists state across connections', async () => {
    const profile = await gateway.createProfile(input);
    const session = await gateway.createSession(profile.id, { title: 'One' });
    const submits = await Promise.all(
      Array.from({ length: 8 }, () =>
        gateway.submit(profile.id, session.id, { text: 'Hello', requestKey: 'same' }),
      ),
    );
    expect(new Set(submits.map((r) => r.id)).size).toBe(1);
    expect(await gateway.messages(profile.id, session.id)).toHaveLength(1);
    const second = new PostgresStore(connectionString);
    try {
      expect((await new Gateway(second).profile(profile.id)).name).toBe('CI');
    } finally {
      await second.close();
    }
    const claims = await Promise.all(
      submits.map((r, i) => gateway.claim(r.id, profile.id, `worker-${i}`)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
  it('rolls back record writes and events together', async () => {
    const profile = await gateway.createProfile(input);
    await expect(
      store.transaction(profile.id, async (tx) => {
        await tx.put('profile', profile.id, profile.id, { ...profile, name: 'Uncommitted' });
        await tx.event({
          profileId: profile.id,
          type: 'uncommitted',
          data: {},
          createdAt: new Date().toISOString(),
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await gateway.profile(profile.id)).name).toBe('CI');
    expect((await store.events(profile.id, 0)).map((e) => e.type)).toEqual(['profile.created']);
  });
  it('dispatches persisted queued work through pg-boss', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'Hello from the worker' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        warnings: [],
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      }),
    });
    const runtime = new AgentRuntime(gateway, () => model);
    const queue = new RunQueue(new PgBoss(connectionString), gateway, runtime, () => {});
    const profile = await gateway.createProfile(input);
    const session = await gateway.createSession(profile.id, { title: 'Queue' });
    const run = await gateway.submit(profile.id, session.id, {
      text: 'Hello',
      requestKey: 'queue',
    });
    try {
      await queue.start();
      await expect
        .poll(async () => (await gateway.run(profile.id, run.id)).status, {
          timeout: 20_000,
          interval: 200,
        })
        .toBe('completed');
      expect((await gateway.messages(profile.id, session.id)).at(-1)?.content).toBe(
        'Hello from the worker',
      );
    } finally {
      await queue.stop();
    }
  }, 30_000);
});
