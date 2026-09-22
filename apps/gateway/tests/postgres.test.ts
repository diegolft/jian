import { MockLanguageModelV4 } from 'ai/test';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentRuntime } from '../src/agent/runtime.js';
import { RunQueue } from '../src/runs/queue.js';
import { buildServices } from '../src/services.js';
import { PostgresStore } from '../src/storage/postgres.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required; use a disposable database');
}

const connectionString = databaseUrl;
const store = new PostgresStore(connectionString);
const services = { ...buildServices({ store }), store };

const input = {
  name: 'CI',
  instructions: 'Help.',
  model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
};

beforeAll(async () => {
  await store.migrate();
}, 30_000);

afterAll(async () => {
  await store.close();
});

describe('PostgreSQL durability', () => {
  it('serializes concurrent submissions and persists state across connections', async () => {
    const profile = await services.profiles.createProfile(input);
    const session = await services.sessions.createSession(profile.id, { title: 'One' });

    const submits = await Promise.all(
      Array.from({ length: 8 }, () =>
        services.runs.submit(profile.id, session.id, { text: 'Hello', requestKey: 'same' }),
      ),
    );

    expect(new Set(submits.map((r) => r.id)).size).toBe(1);
    expect(await services.sessions.messages(profile.id, session.id)).toHaveLength(1);

    const second = new PostgresStore(connectionString);

    try {
      expect((await buildServices({ store: second }).profiles.profile(profile.id)).name).toBe('CI');
    } finally {
      await second.close();
    }

    const claims = await Promise.all(
      submits.map((r, i) => services.lifecycle.claim(r.id, profile.id, `worker-${i}`)),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('rolls back record writes and events together', async () => {
    const profile = await services.profiles.createProfile(input);

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

    expect((await services.profiles.profile(profile.id)).name).toBe('CI');
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

    const runtime = new AgentRuntime(services, () => model);
    const queue = new RunQueue(new PgBoss(connectionString), services, runtime, () => {});
    const profile = await services.profiles.createProfile(input);
    const session = await services.sessions.createSession(profile.id, { title: 'Queue' });

    const run = await services.runs.submit(profile.id, session.id, {
      text: 'Hello',
      requestKey: 'queue',
    });

    try {
      await queue.start();

      await expect
        .poll(async () => (await services.runs.run(profile.id, run.id)).status, {
          timeout: 20_000,
          interval: 200,
        })
        .toBe('completed');

      expect((await services.sessions.messages(profile.id, session.id)).at(-1)?.content).toBe(
        'Hello from the worker',
      );
    } finally {
      await queue.stop();
    }
  }, 30_000);
});

it('applies migrations repeatedly and searches old records through stable cursors', async () => {
  await store.migrate();

  const profile = await services.profiles.createProfile(input);
  const session = await services.sessions.createSession(profile.id, { title: 'Search' });

  for (let index = 0; index < 4; index += 1) {
    const run = await services.runs.submit(profile.id, session.id, {
      text: `deployment ${index}`,
      requestKey: `search-${index}`,
    });

    await services.runs.cancel(profile.id, run.id);
  }

  const first = await store.list('message', {
    profileId: profile.id,
    search: 'deployment',
    limit: 2,
    descending: true,
  });

  const next = await store.list('message', {
    profileId: profile.id,
    search: 'deployment',
    before: first.at(-1)?.id,
    limit: 2,
    descending: true,
  });

  expect(first.map((message) => message.content)).toEqual(['deployment 3', 'deployment 2']);
  expect(next.map((message) => message.content)).toEqual(['deployment 1', 'deployment 0']);

  await services.memories.remember(profile.id, {
    key: 'deployment',
    content: 'At 21:00',
    expectedVersion: 0,
  });

  expect(
    await store.list('memory', { profileId: profile.id, anyWords: ['deployment'] }),
  ).toHaveLength(1);
});
