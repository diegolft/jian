import { describe, expect, it } from 'vitest';
import { Coordination } from '../src/coordination/service.js';
import { testServices } from './helpers/services.js';

async function setup() {
  const services = testServices();

  const profile = await services.profiles.createProfile({
    name: 'Test',
    instructions: 'Help.',
    model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
  });

  const a = await services.sessions.createSession(profile.id, { title: 'A' });
  const b = await services.sessions.createSession(profile.id, { title: 'B' });
  let now = 1000;
  const coordination = new Coordination(services, () => now);

  return {
    services,
    profile,
    a,
    b,
    coordination,
    advance: () => {
      now += 6000;
    },
  };
}

describe('shared coordination', () => {
  it('fences expired resource holders and prevents competing sessions from acquiring a lease', async () => {
    const { profile, a, b, coordination, advance } = await setup();

    const first = await coordination.acquire(profile.id, {
      sessionId: a.id,
      resource: 'deploy/prod',
      ttlSeconds: 5,
    });

    await expect(
      coordination.acquire(profile.id, { sessionId: b.id, resource: 'deploy/prod', ttlSeconds: 5 }),
    ).rejects.toThrow();

    advance();

    const next = await coordination.acquire(profile.id, {
      sessionId: b.id,
      resource: 'deploy/prod',
      ttlSeconds: 5,
    });

    expect(next.fence).toBeGreaterThan(first.fence);

    await expect(
      coordination.release(profile.id, {
        sessionId: a.id,
        resource: 'deploy/prod',
        fence: first.fence,
      }),
    ).rejects.toThrow();
  });

  it('deduplicates cross-session mail and exposes it only to the target profile', async () => {
    const { services, profile, a, b, coordination } = await setup();

    const payload = {
      fromSessionId: a.id,
      toSessionId: b.id,
      text: 'Deployment finished',
      requestKey: 'one',
    };

    const first = await coordination.send(profile.id, payload);

    expect((await coordination.send(profile.id, payload)).id).toBe(first.id);
    expect(await coordination.inbox(profile.id, b.id)).toHaveLength(1);

    const other = await services.profiles.createProfile({
      name: 'Other',
      instructions: 'Help',
      model: profile.model,
    });

    await expect(coordination.inbox(other.id, b.id)).rejects.toThrow();
  });

  it('returns bounded artifact pages and preserves the complete tool output', async () => {
    const { services, profile, a, coordination } = await setup();
    const run = await services.runs.submit(profile.id, a.id, { text: 'run', requestKey: 'run' });

    const saved = await coordination.storeArtifact(run, 'remote_search', {
      value: 'a'.repeat(20000),
    });

    const page = await coordination.artifact(profile.id, saved.artifactId, {
      offset: 0,
      limit: 100,
    });

    expect(page.content.length).toBe(100);
    expect(page.nextOffset).toBe(100);
    expect(saved.bytes).toBeGreaterThan(20000);
  });
});
