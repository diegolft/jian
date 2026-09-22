import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Gateway } from '../src/gateway.js';
import { SecretBox } from '../src/security/crypto.js';
import { Credentials } from '../src/services/credentials.js';
import { MemoryStore } from './helpers/memory-store.js';

const profileInput = {
  name: 'Atlas',
  instructions: 'Help with engineering.',
  model: { provider: 'openai' as const, modelId: 'test-model', apiKeyEnv: 'ELOS_PROVIDER_TEST' },
};

afterEach(() => vi.unstubAllEnvs());

it.each([
  ['ANTHROPIC_API_KEY', 'anthropic'],
  ['ANTHROPIC_API_TOKEN', 'anthropic'],
  ['GEMINI_API_TOKEN', 'google'],
  ['OPENAI_API_KEY', 'openai'],
] as const)('detects %s as %s without storing the secret', async (name, kind) => {
  if (name === 'ANTHROPIC_API_TOKEN') vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv(name, `synthetic-${name}`);
  const gateway = new Gateway(new MemoryStore());
  const profile = await gateway.createProfile({ name: 'Env', instructions: 'Help.' });
  const providers = await gateway.providers(profile.id);
  expect(providers.find((provider) => provider.kind === kind)?.apiKeyEnv).toBe(name);
  expect(JSON.stringify(providers)).not.toContain(`synthetic-${name}`);
});

it('uses host provider credentials without manual registration or a model default', async () => {
  vi.stubEnv('ANTHROPIC_API_TOKEN', 'synthetic-anthropic-token');
  const gateway = new Gateway(new MemoryStore());
  const profile = await gateway.createProfile({ name: 'Host', instructions: 'Help.' });
  const providers = await gateway.providers(profile.id);
  const anthropic = providers.find((provider) => provider.kind === 'anthropic');

  expect(anthropic?.apiKeyEnv).toBe('ANTHROPIC_API_TOKEN');
  expect(JSON.stringify(providers)).not.toContain('synthetic-anthropic-token');

  const session = await gateway.createSession(profile.id, { title: 'Test' });
  const run = await gateway.submit(profile.id, session.id, {
    text: 'Hello',
    requestKey: 'host-provider',
  });

  expect(run.model).toMatchObject({
    provider: 'anthropic',
    apiKeyEnv: 'ANTHROPIC_API_TOKEN',
  });
});

it('replaces one provider credential and ignores an obsolete model default', async () => {
  const gateway = new Gateway(new MemoryStore());
  const profile = await gateway.createProfile({ name: 'Replace', instructions: 'Help.' });
  const credentials = new Credentials(
    gateway,
    new SecretBox({ activeKeyId: 'test', keys: { test: randomBytes(32) } }),
  );
  const add = async (name: string) => {
    const credential = await credentials.create(profile.id, {
      label: name,
      kind: 'provider',
      secret: `synthetic-${name}`,
    });
    return gateway.createProvider(profile.id, {
      name,
      kind: 'openai',
      credentialId: credential.id,
      models: [{ id: name, contextWindow: 16_000, maxOutputTokens: 2048 }],
    });
  };
  const old = await add('old');
  await gateway.setModelDefaults(profile.id, {
    conversation: { providerId: old.id, modelId: 'old' },
    channel: null,
  });
  const current = await add('current');
  const session = await gateway.createSession(profile.id, { title: 'Test' });
  const run = await gateway.submit(profile.id, session.id, { text: 'Hello', requestKey: 'new' });

  expect(run.model?.modelId).toBe('current');
  expect(
    (await gateway.providers(profile.id)).find((item) => item.id === old.id)?.revokedAt,
  ).toBeDefined();
  expect(
    (await gateway.providers(profile.id)).find((item) => item.id === current.id)?.revokedAt,
  ).toBeUndefined();
});

async function setup() {
  const gateway = new Gateway(new MemoryStore());
  const profile = await gateway.createProfile(profileInput);
  const session = await gateway.createSession(profile.id, { title: 'Mac', channel: 'macos' });

  return { gateway, profile, session };
}

describe('shared profile brain', () => {
  it('isolates providers and freezes the chosen model and its context budget per run', async () => {
    const { gateway, profile, session } = await setup();
    const vault = new Credentials(
      gateway,
      new SecretBox({
        activeKeyId: 'test',
        keys: { test: randomBytes(32) },
      }),
    );
    const credential = await vault.create(profile.id, {
      label: 'OpenAI',
      kind: 'provider',
      secret: 'synthetic-api-key',
    });
    const provider = await gateway.createProvider(profile.id, {
      name: 'Personal',
      kind: 'openai',
      credentialId: credential.id,
      models: [
        { id: 'small', contextWindow: 16_000, maxOutputTokens: 2048 },
        { id: 'large', contextWindow: 64_000, maxOutputTokens: 8192 },
      ],
    });
    const large = { providerId: provider.id, modelId: 'large' };
    const small = { providerId: provider.id, modelId: 'small' };

    await gateway.setModelDefaults(profile.id, { conversation: small, channel: large });

    const chosen = await gateway.submit(profile.id, session.id, {
      text: 'First',
      requestKey: 'one',
      model: large,
    });
    const otherSession = await gateway.createSession(profile.id, { title: 'Second' });
    const standard = await gateway.submit(profile.id, otherSession.id, {
      text: 'Second',
      requestKey: 'two',
    });

    expect(chosen.model?.modelId).toBe('large');
    expect(chosen.contextPolicy?.inputTokens).toBe(28_800);
    expect(standard.model?.modelId).toBe('small');
    expect(standard.contextPolicy?.inputTokens).toBe(7200);
    expect(JSON.stringify(chosen)).not.toContain('synthetic-api-key');

    await expect(
      gateway.submit(profile.id, session.id, {
        text: 'First',
        requestKey: 'one',
        model: small,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const stranger = await gateway.createProfile({ name: 'Other', instructions: 'Help.' });
    await expect(
      gateway.setModelDefaults(stranger.id, {
        conversation: large,
        channel: null,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    await gateway.revokeProvider(profile.id, provider.id);
    await expect(
      gateway.submit(profile.id, otherSession.id, {
        text: 'Third',
        requestKey: 'three',
        model: large,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('makes one session’s memory visible to another while isolating other profiles', async () => {
    const { gateway, profile, session } = await setup();

    const otherSession = await gateway.createSession(profile.id, {
      title: 'Telegram',
      channel: 'telegram',
    });

    const otherProfile = await gateway.createProfile({ ...profileInput, name: 'Private' });

    await gateway.remember(
      profile.id,
      { key: 'deployment', content: 'Deploy release at 21:00.', expectedVersion: 0 },
      session.id,
    );

    const run = await gateway.submit(profile.id, otherSession.id, {
      text: 'What time is deployment?',
      requestKey: 'req-1',
    });

    const context = await gateway.context(run);

    expect(context.system).toContain('Deploy release at 21:00.');
    expect(await gateway.memories(otherProfile.id)).toEqual([]);

    await expect(gateway.messages(otherProfile.id, session.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('commits one run and message for concurrent duplicate submissions', async () => {
    const { gateway, profile, session } = await setup();

    const [a, b] = await Promise.all([
      gateway.submit(profile.id, session.id, { text: 'Deploy', requestKey: 'same' }),
      gateway.submit(profile.id, session.id, { text: 'Deploy', requestKey: 'same' }),
    ]);

    expect(a.id).toBe(b.id);
    expect(await gateway.messages(profile.id, session.id)).toHaveLength(1);

    await expect(
      gateway.submit(profile.id, session.id, { text: 'Different', requestKey: 'same' }),
    ).rejects.toMatchObject({ statusCode: 409 });

    await expect(
      gateway.submit(profile.id, session.id, { text: 'Again', requestKey: 'new' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows parallel sessions and exposes their actual activity', async () => {
    const { gateway, profile, session } = await setup();
    const other = await gateway.createSession(profile.id, { title: 'Other', channel: 'api' });

    const run = await gateway.submit(profile.id, session.id, {
      text: 'Deploy version 2',
      requestKey: 'a',
    });

    await gateway.claim(run.id, profile.id, 'worker-a');

    const otherRun = await gateway.submit(profile.id, other.id, {
      text: 'What is happening?',
      requestKey: 'b',
    });

    expect((await gateway.context(otherRun)).system).toContain('Deploy version 2');

    expect((await gateway.activities(profile.id)).map((r) => r.status)).toEqual(
      expect.arrayContaining(['running', 'queued']),
    );
  });

  it('uses optimistic versions for profile and memory edits', async () => {
    const { gateway, profile } = await setup();

    const updated = await gateway.updateProfile(profile.id, {
      expectedVersion: 1,
      name: 'New name',
    });

    expect(updated.version).toBe(2);

    await expect(
      gateway.updateProfile(profile.id, { expectedVersion: 1, name: 'Stale' }),
    ).rejects.toMatchObject({ statusCode: 409 });

    await gateway.remember(profile.id, { key: 'project', content: 'Alpha', expectedVersion: 0 });

    await expect(
      gateway.remember(profile.id, { key: 'project', content: 'Beta', expectedVersion: 0 }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect((await gateway.memories(profile.id))[0]?.content).toBe('Alpha');
  });

  it('pins model configuration for queued runs', async () => {
    const { gateway, profile, session } = await setup();
    const run = await gateway.submit(profile.id, session.id, { text: 'Hello', requestKey: 'a' });

    await gateway.updateProfile(profile.id, {
      expectedVersion: 1,
      model: { ...profileInput.model, modelId: 'changed-model' },
    });

    expect((await gateway.run(profile.id, run.id)).profile.model.modelId).toBe('test-model');
  });

  it('lets only one worker claim a run and rejects stale completion', async () => {
    const { gateway, profile, session } = await setup();
    const run = await gateway.submit(profile.id, session.id, { text: 'Hello', requestKey: 'a' });

    const claims = await Promise.all([
      gateway.claim(run.id, profile.id, 'one'),
      gateway.claim(run.id, profile.id, 'two'),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);

    await expect(
      gateway.finish(profile.id, run.id, 'wrong', 'completed', 'Hello'),
    ).rejects.toMatchObject({ statusCode: 409 });

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

    await expect(
      gateway.finish(profile.id, run.id, 'one', 'completed', 'Late'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

const avatar = `data:image/jpeg;base64,${Buffer.from('synthetic-image-bytes').toString('base64')}`;

describe('profile configuration changes', () => {
  it('preserves skills, MCP configuration and permissions on a name-only edit', async () => {
    const gateway = new Gateway(new MemoryStore());

    const profile = await gateway.createProfile({
      ...profileInput,
      allowSelfManagement: true,
      skills: [
        { name: 'deploy', description: 'Deployment guide', instructions: 'Check the release.' },
      ],
      mcpServers: [{ name: 'docs', url: 'https://example.com/mcp', allowedTools: ['search'] }],
    });

    const updated = await gateway.updateProfile(profile.id, {
      expectedVersion: 1,
      name: 'New name',
    });

    expect(updated.allowSelfManagement).toBe(true);
    expect(updated.skills).toHaveLength(1);
    expect(updated.mcpServers).toHaveLength(1);
  });

  it('keeps, replaces and clears the picture, and keeps its bytes out of the model context', async () => {
    const gateway = new Gateway(new MemoryStore());
    const profile = await gateway.createProfile({ ...profileInput, avatar });

    expect(profile.avatar).toBe(avatar);

    const renamed = await gateway.updateProfile(profile.id, {
      expectedVersion: 1,
      name: 'Atlas II',
    });

    expect(renamed.avatar).toBe(avatar);

    const session = await gateway.createSession(profile.id, { title: 'Mac', channel: 'macos' });
    const run = await gateway.submit(profile.id, session.id, { text: 'Hi', requestKey: 'one' });

    expect((await gateway.context(run)).system).not.toContain(avatar.slice(-24));

    const cleared = await gateway.updateProfile(profile.id, { expectedVersion: 2, avatar: null });

    expect(cleared.avatar).toBeNull();
  });

  it('rejects a picture that is not an inline image within the size limit', async () => {
    const gateway = new Gateway(new MemoryStore());
    const profile = await gateway.createProfile(profileInput);

    for (const rejected of [
      'https://example.com/avatar.png',
      'data:text/html;base64,PHNjcmlwdD4=',
      `data:image/jpeg;base64,${'A'.repeat(100_001)}`,
    ]) {
      await expect(
        gateway.updateProfile(profile.id, { expectedVersion: 1, avatar: rejected }),
      ).rejects.toThrow();
    }

    expect((await gateway.profile(profile.id)).avatar).toBeNull();
  });
});

it('normalizes legacy profiles and queued snapshots without rewriting their historical version', async () => {
  const { gateway, profile, session } = await setup();
  const run = await gateway.submit(profile.id, session.id, { text: 'Hi', requestKey: 'legacy' });
  const { identity: _identity, contextPolicy: _policy, ...legacy } = profile;

  await gateway.store.transaction(profile.id, async (tx) => {
    await tx.put('profile', profile.id, profile.id, legacy as typeof profile);
    await tx.put('run', run.id, profile.id, { ...run, profile: legacy as typeof profile });
  });

  expect((await gateway.profile(profile.id)).contextPolicy.inputTokens).toBe(16000);

  const claimed = await gateway.claim(run.id, profile.id, 'worker');

  expect(claimed?.profile.identity.goals).toEqual([]);
  expect(claimed?.profile.version).toBe(1);
});

it('continues only reconciled stopped runs and preserves checkpoints without replaying tools', async () => {
  const { gateway, profile, session } = await setup();

  const run = await gateway.submit(profile.id, session.id, {
    text: 'Deploy',
    requestKey: 'initial',
  });

  await gateway.claim(run.id, profile.id, 'worker');

  await gateway.checkpoint(profile.id, run.id, 'worker', {
    phase: 'tool-started',
    toolCallId: 'one',
    toolName: 'deploy',
  });

  await expect(
    gateway.continueRun(profile.id, run.id, {
      text: 'Continue',
      requestKey: 'next',
      reconciliation: 'Checked effects',
    }),
  ).rejects.toThrow();

  await gateway.finish(profile.id, run.id, 'worker', 'interrupted', 'Connection ended');

  await expect(
    gateway.continueRun(profile.id, run.id, { text: 'Continue', requestKey: 'next' }),
  ).rejects.toThrow();

  const next = await gateway.continueRun(profile.id, run.id, {
    text: 'Continue',
    requestKey: 'next',
    reconciliation: 'Deployment completed; only verify status.',
  });

  expect(next.continuationOf).toBe(run.id);
  expect(next.status).toBe('queued');
  expect(await gateway.checkpoints(profile.id, run.id)).toHaveLength(1);
  expect((await gateway.run(profile.id, run.id)).status).toBe('interrupted');
});
