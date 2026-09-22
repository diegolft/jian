import { randomBytes } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Credentials } from '../src/security/credentials.js';
import { SecretBox } from '../src/security/crypto.js';
import { testServices } from './helpers/services.js';

const profileInput = {
  name: 'Atlas',
  instructions: 'Help with engineering.',
  model: { provider: 'openai' as const, modelId: 'test-model', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
};

afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const services = testServices();
  const profile = await services.profiles.createProfile(profileInput);
  const session = await services.sessions.createSession(profile.id, {
    title: 'Mac',
    channel: 'macos',
  });

  return { services, profile, session };
}

it('uses host provider credentials without manual registration or a model default', async () => {
  vi.stubEnv('ANTHROPIC_API_TOKEN', 'synthetic-anthropic-token');
  const services = testServices();
  const profile = await services.profiles.createProfile({ name: 'Host', instructions: 'Help.' });
  const providers = await services.providers.providers(profile.id);
  const anthropic = providers.find((provider) => provider.kind === 'anthropic');

  expect(anthropic?.apiKeyEnv).toBe('ANTHROPIC_API_TOKEN');
  expect(JSON.stringify(providers)).not.toContain('synthetic-anthropic-token');

  const session = await services.sessions.createSession(profile.id, { title: 'Test' });
  const run = await services.runs.submit(profile.id, session.id, {
    text: 'Hello',
    requestKey: 'host-provider',
  });

  expect(run.model).toMatchObject({
    provider: 'anthropic',
    apiKeyEnv: 'ANTHROPIC_API_TOKEN',
  });
});

it('replaces one provider credential and ignores an obsolete model default', async () => {
  const services = testServices();
  const profile = await services.profiles.createProfile({ name: 'Replace', instructions: 'Help.' });
  const credentials = new Credentials(
    services,
    new SecretBox({ activeKeyId: 'test', keys: { test: randomBytes(32) } }),
  );
  const add = async (name: string) => {
    const credential = await credentials.create(profile.id, {
      label: name,
      kind: 'provider',
      secret: `synthetic-${name}`,
    });
    return services.providers.createProvider(profile.id, {
      name,
      kind: 'openai',
      credentialId: credential.id,
      models: [{ id: name, contextWindow: 16_000, maxOutputTokens: 2048 }],
    });
  };
  const old = await add('old');
  await services.providers.setModelDefaults(profile.id, {
    conversation: { providerId: old.id, modelId: 'old' },
    channel: null,
  });
  const current = await add('current');
  const session = await services.sessions.createSession(profile.id, { title: 'Test' });
  const run = await services.runs.submit(profile.id, session.id, {
    text: 'Hello',
    requestKey: 'new',
  });

  expect(run.model?.modelId).toBe('current');
  expect(
    (await services.providers.providers(profile.id)).find((item) => item.id === old.id)?.revokedAt,
  ).toBeDefined();
  expect(
    (await services.providers.providers(profile.id)).find((item) => item.id === current.id)
      ?.revokedAt,
  ).toBeUndefined();
});

it('isolates providers and freezes the chosen model and its context budget per run', async () => {
  const { services, profile, session } = await setup();
  const vault = new Credentials(
    services,
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
  const provider = await services.providers.createProvider(profile.id, {
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

  await services.providers.setModelDefaults(profile.id, { conversation: small, channel: large });

  const chosen = await services.runs.submit(profile.id, session.id, {
    text: 'First',
    requestKey: 'one',
    model: large,
  });
  const otherSession = await services.sessions.createSession(profile.id, { title: 'Second' });
  const standard = await services.runs.submit(profile.id, otherSession.id, {
    text: 'Second',
    requestKey: 'two',
  });

  expect(chosen.model?.modelId).toBe('large');
  expect(chosen.contextPolicy?.inputTokens).toBe(28_800);
  expect(standard.model?.modelId).toBe('small');
  expect(standard.contextPolicy?.inputTokens).toBe(7200);
  expect(JSON.stringify(chosen)).not.toContain('synthetic-api-key');

  await expect(
    services.runs.submit(profile.id, session.id, {
      text: 'First',
      requestKey: 'one',
      model: small,
    }),
  ).rejects.toMatchObject({ statusCode: 409 });

  const stranger = await services.profiles.createProfile({ name: 'Other', instructions: 'Help.' });
  await expect(
    services.providers.setModelDefaults(stranger.id, {
      conversation: large,
      channel: null,
    }),
  ).rejects.toMatchObject({ statusCode: 409 });

  await services.providers.revokeProvider(profile.id, provider.id);
  await expect(
    services.runs.submit(profile.id, otherSession.id, {
      text: 'Third',
      requestKey: 'three',
      model: large,
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
});

it('commits one run and message for concurrent duplicate submissions', async () => {
  const { services, profile, session } = await setup();

  const [a, b] = await Promise.all([
    services.runs.submit(profile.id, session.id, { text: 'Deploy', requestKey: 'same' }),
    services.runs.submit(profile.id, session.id, { text: 'Deploy', requestKey: 'same' }),
  ]);

  expect(a.id).toBe(b.id);
  expect(await services.sessions.messages(profile.id, session.id)).toHaveLength(1);

  await expect(
    services.runs.submit(profile.id, session.id, { text: 'Different', requestKey: 'same' }),
  ).rejects.toMatchObject({ statusCode: 409 });

  await expect(
    services.runs.submit(profile.id, session.id, { text: 'Again', requestKey: 'new' }),
  ).rejects.toMatchObject({ statusCode: 409 });
});

it('pins model configuration for queued runs', async () => {
  const { services, profile, session } = await setup();
  const run = await services.runs.submit(profile.id, session.id, {
    text: 'Hello',
    requestKey: 'a',
  });

  await services.profiles.updateProfile(profile.id, {
    expectedVersion: 1,
    model: { ...profileInput.model, modelId: 'changed-model' },
  });

  expect((await services.runs.run(profile.id, run.id)).profile.model.modelId).toBe('test-model');
});

it('lets only one worker claim a run and rejects stale completion', async () => {
  const { services, profile, session } = await setup();
  const run = await services.runs.submit(profile.id, session.id, {
    text: 'Hello',
    requestKey: 'a',
  });

  const claims = await Promise.all([
    services.lifecycle.claim(run.id, profile.id, 'one'),
    services.lifecycle.claim(run.id, profile.id, 'two'),
  ]);

  expect(claims.filter(Boolean)).toHaveLength(1);

  await expect(
    services.lifecycle.finish(profile.id, run.id, 'wrong', 'completed', 'Hello'),
  ).rejects.toMatchObject({ statusCode: 409 });

  expect((await services.runs.run(profile.id, run.id)).status).toBe('running');
});

it('marks expired leases interrupted without replaying uncertain work', async () => {
  let now = Date.now();
  const services = testServices(() => now);
  const profile = await services.profiles.createProfile(profileInput);
  const session = await services.sessions.createSession(profile.id, {
    title: 'Test',
    channel: 'api',
  });
  const run = await services.runs.submit(profile.id, session.id, {
    text: 'Hello',
    requestKey: 'a',
  });

  await services.lifecycle.claim(run.id, profile.id, 'one');
  now += 120_000;
  await services.lifecycle.recover();
  expect((await services.runs.run(profile.id, run.id)).status).toBe('interrupted');
  expect(await services.lifecycle.claim(run.id, profile.id, 'two')).toBeNull();
  expect(await services.sessions.messages(profile.id, session.id)).toHaveLength(1);

  await expect(
    services.lifecycle.finish(profile.id, run.id, 'one', 'completed', 'Late'),
  ).rejects.toMatchObject({ statusCode: 409 });
});

it('continues only reconciled stopped runs and preserves checkpoints without replaying tools', async () => {
  const { services, profile, session } = await setup();

  const run = await services.runs.submit(profile.id, session.id, {
    text: 'Deploy',
    requestKey: 'initial',
  });

  await services.lifecycle.claim(run.id, profile.id, 'worker');

  await services.lifecycle.checkpoint(profile.id, run.id, 'worker', {
    phase: 'tool-started',
    toolCallId: 'one',
    toolName: 'deploy',
  });

  await expect(
    services.runs.continueRun(profile.id, run.id, {
      text: 'Continue',
      requestKey: 'next',
      reconciliation: 'Checked effects',
    }),
  ).rejects.toThrow();

  await services.lifecycle.finish(profile.id, run.id, 'worker', 'interrupted', 'Connection ended');

  await expect(
    services.runs.continueRun(profile.id, run.id, { text: 'Continue', requestKey: 'next' }),
  ).rejects.toThrow();

  const next = await services.runs.continueRun(profile.id, run.id, {
    text: 'Continue',
    requestKey: 'next',
    reconciliation: 'Deployment completed; only verify status.',
  });

  expect(next.continuationOf).toBe(run.id);
  expect(next.status).toBe('queued');
  expect(await services.lifecycle.checkpoints(profile.id, run.id)).toHaveLength(1);
  expect((await services.runs.run(profile.id, run.id)).status).toBe('interrupted');
});
