import { describe, expect, it } from 'vitest';
import { Gateway } from '../src/gateway.js';
import { MemoryStore } from './helpers/memory-store.js';

export const profileInput = {
  name: 'Atlas', instructions: 'Help with engineering.',
  model: { provider: 'openai' as const, modelId: 'test-model', apiKeyEnv: 'ELOS_PROVIDER_TEST' },
};

async function setup() {
  const gateway = new Gateway(new MemoryStore());
  const profile = await gateway.createProfile(profileInput);
  const session = await gateway.createSession(profile.id, { title: 'Mac', channel: 'macos' });
  return { gateway, profile, session };
}

describe('shared profile brain', () => {
  it('makes one session’s memory visible to another while isolating other profiles', async () => {
    const { gateway, profile, session } = await setup();
    const otherSession = await gateway.createSession(profile.id, { title: 'Telegram', channel: 'telegram' });
    const otherProfile = await gateway.createProfile({ ...profileInput, name: 'Private' });
    await gateway.remember(profile.id, { key: 'deployment', content: 'Deploy release at 21:00.', expectedVersion: 0 }, session.id);
    const run = await gateway.submit(profile.id, otherSession.id, { text: 'What time is deployment?', requestKey: 'req-1' });
    const context = await gateway.context(run);
    expect(context.system).toContain('Deploy release at 21:00.');
    expect(await gateway.memories(otherProfile.id)).toEqual([]);
    await expect(gateway.messages(otherProfile.id, session.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('commits one run and message for concurrent duplicate submissions', async () => {
    const { gateway, profile, session } = await setup();
    const [a, b] = await Promise.all([
      gateway.submit(profile.id, session.id, { text: 'Deploy', requestKey: 'same' }),
      gateway.submit(profile.id, session.id, { text: 'Deploy', requestKey: 'same' }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await gateway.messages(profile.id, session.id)).toHaveLength(1);
    await expect(gateway.submit(profile.id, session.id, { text: 'Different', requestKey: 'same' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(gateway.submit(profile.id, session.id, { text: 'Again', requestKey: 'new' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows parallel sessions and exposes their actual activity', async () => {
    const { gateway, profile, session } = await setup();
    const other = await gateway.createSession(profile.id, { title: 'Other', channel: 'api' });
    const run = await gateway.submit(profile.id, session.id, { text: 'Deploy version 2', requestKey: 'a' });
    await gateway.claim(run.id, profile.id, 'worker-a');
    const otherRun = await gateway.submit(profile.id, other.id, { text: 'What is happening?', requestKey: 'b' });
    expect((await gateway.context(otherRun)).system).toContain('Deploy version 2');
    expect((await gateway.activities(profile.id)).map(r => r.status)).toEqual(expect.arrayContaining(['running', 'queued']));
  });

  it('uses optimistic versions for profile and memory edits', async () => {
    const { gateway, profile } = await setup();
    const updated = await gateway.updateProfile(profile.id, { expectedVersion: 1, name: 'New name' });
    expect(updated.version).toBe(2);
    await expect(gateway.updateProfile(profile.id, { expectedVersion: 1, name: 'Stale' })).rejects.toMatchObject({ statusCode: 409 });
    await gateway.remember(profile.id, { key: 'project', content: 'Alpha', expectedVersion: 0 });
    await expect(gateway.remember(profile.id, { key: 'project', content: 'Beta', expectedVersion: 0 })).rejects.toMatchObject({ statusCode: 409 });
    expect((await gateway.memories(profile.id))[0]?.content).toBe('Alpha');
  });

  it('pins model configuration for queued runs', async () => {
    const { gateway, profile, session } = await setup();
    const run = await gateway.submit(profile.id, session.id, { text: 'Hello', requestKey: 'a' });
    await gateway.updateProfile(profile.id, { expectedVersion: 1, model: { ...profileInput.model, modelId: 'changed-model' } });
    expect((await gateway.run(profile.id, run.id)).profile.model.modelId).toBe('test-model');
  });

  it('lets only one worker claim a run and rejects stale completion', async () => {
    const { gateway, profile, session } = await setup();
    const run = await gateway.submit(profile.id, session.id, { text: 'Hello', requestKey: 'a' });
    const claims = await Promise.all([gateway.claim(run.id, profile.id, 'one'), gateway.claim(run.id, profile.id, 'two')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(gateway.finish(profile.id, run.id, 'wrong', 'completed', 'Hello')).rejects.toMatchObject({ statusCode: 409 });
    expect((await gateway.run(profile.id, run.id)).status).toBe('running');
  });

  it('marks expired leases interrupted without replaying uncertain work', async () => {
    let now = Date.now();
    const gateway = new Gateway(new MemoryStore(), () => now);
    const profile = await gateway.createProfile(profileInput);
    const session = await gateway.createSession(profile.id, { title: 'Test', channel: 'api' });
    const run = await gateway.submit(profile.id, session.id, { text: 'Hello', requestKey: 'a' });
    await gateway.claim(run.id, profile.id, 'one');
    now += 120_000;
    await gateway.recover();
    expect((await gateway.run(profile.id, run.id)).status).toBe('interrupted');
    expect(await gateway.claim(run.id, profile.id, 'two')).toBeNull();
    expect(await gateway.messages(profile.id, session.id)).toHaveLength(1);
    await expect(gateway.finish(profile.id, run.id, 'one', 'completed', 'Late')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('profile configuration changes', () => {
  it('preserves skills, MCP configuration and permissions on a name-only edit', async () => {
    const gateway = new Gateway(new MemoryStore());
    const profile = await gateway.createProfile({ ...profileInput, allowSelfManagement: true,
      skills: [{ name: 'deploy', description: 'Deployment guide', instructions: 'Check the release.' }],
      mcpServers: [{ name: 'docs', url: 'https://example.com/mcp', allowedTools: ['search'] }],
    });
    const updated = await gateway.updateProfile(profile.id, { expectedVersion: 1, name: 'New name' });
    expect(updated.allowSelfManagement).toBe(true);
    expect(updated.skills).toHaveLength(1);
    expect(updated.mcpServers).toHaveLength(1);
  });
  it('rolls back failed transactions', async () => {
    const { gateway, profile } = await setup();
    await expect(gateway.store.transaction(profile.id, async tx => {
      await tx.put('profile', profile.id, profile.id, { ...profile, name: 'Not committed' });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect((await gateway.profile(profile.id)).name).toBe('Atlas');
  });
});
