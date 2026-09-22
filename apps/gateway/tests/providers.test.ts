import { modelSchema } from '@jian/contracts';
import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { resolveModel } from '../src/providers/models.js';
import { testServices } from './helpers/services.js';

describe('providers', () => {
  it.each(['openai', 'anthropic', 'google', 'openai-compatible'] as const)(
    'resolves %s without using another profile’s default',
    (provider) => {
      const config = modelSchema.parse({
        provider,
        modelId: 'chosen-model',
        apiKeyEnv: 'JIAN_PROVIDER_A',
        ...(provider === 'openai-compatible' ? { baseURL: 'http://localhost:11434/v1' } : {}),
      });

      const model = resolveModel(config, { JIAN_PROVIDER_A: 'test-only' });

      expect(typeof model).toBe('object');

      if (typeof model !== 'string') {
        expect(model.modelId).toBe('chosen-model');
      }
    },
  );

  it('does not fall back to a global key if the selected credential is absent', () => {
    expect(() =>
      resolveModel(
        { provider: 'openai', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_MISSING' },
        { OPENAI_API_KEY: 'other-profile-secret' },
      ),
    ).toThrow('Provider key is not configured');
  });
});

it('rejects a compatible provider without an endpoint before making a request', () => {
  expect(() =>
    resolveModel(
      { provider: 'openai-compatible', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_LOCAL' },
      { JIAN_PROVIDER_LOCAL: 'local' },
    ),
  ).toThrow('baseURL is required for compatible providers');
});

it('accepts an explicitly resolved vault key without consulting host environment', () => {
  const model = resolveModel(
    {
      provider: 'openai',
      modelId: 'chosen-model',
      providerId: '00000000-0000-4000-8000-000000000001',
    },
    {},
    undefined,
    'dummy-vault-key',
  );

  if (typeof model !== 'string') {
    expect(model.modelId).toBe('chosen-model');
  }
});

it('sends ANTHROPIC_API_TOKEN as a bearer token', async () => {
  let headers = new Headers();
  const fetcher: typeof fetch = async (_input, init) => {
    headers = new Headers(init?.headers);
    return Response.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'synthetic' } },
      { status: 400 },
    );
  };
  const model = resolveModel(
    { provider: 'anthropic', modelId: 'test', apiKeyEnv: 'ANTHROPIC_API_TOKEN' },
    { ANTHROPIC_API_TOKEN: 'synthetic-token' },
    fetcher,
  );

  await expect(generateText({ model, prompt: 'Hi', maxRetries: 0 })).rejects.toThrow();
  expect(headers.get('authorization')).toBe('Bearer synthetic-token');
  expect(headers.has('x-api-key')).toBe(false);
});

it('reads a provider stored before the vault moved indoors', async () => {
  const services = testServices();
  const profile = await services.profiles.createProfile({
    name: 'Atlas',
    instructions: 'Help.',
  });

  // Written by an older version: a hand-written model list and a credential by id, both of
  // which the record no longer declares. Listing must not answer 400 to the whole panel.
  await services.store.transaction(profile.id, async (tx) => {
    await tx.put('provider', 'e1957360-9a95-4651-a63c-5f313ebafaba', profile.id, {
      id: 'e1957360-9a95-4651-a63c-5f313ebafaba',
      profileId: profile.id,
      name: 'OpenAI',
      kind: 'openai',
      authMode: 'codex',
      createdAt: new Date().toISOString(),
      models: [{ id: 'gpt-5.6-terra', contextWindow: 1_000_000, maxOutputTokens: 128_000 }],
      credentialId: '3dc472c6-9111-41c8-873f-c7fe82265daa',
    } as never);
  });

  const [stored] = await services.providers.providers(profile.id);

  expect(stored).toMatchObject({ name: 'OpenAI', kind: 'openai', authMode: 'codex' });
  expect(stored).not.toHaveProperty('credentialId');
  expect(stored).not.toHaveProperty('models');
});
