import { describe, expect, it } from 'vitest';
import { modelSchema } from '../src/domain.js';
import { resolveModel } from '../src/providers.js';

describe('providers', () => {
  it.each(['openai', 'anthropic', 'google', 'openai-compatible'] as const)(
    'resolves %s without using another profile’s default',
    (provider) => {
      const config = modelSchema.parse({
        provider,
        modelId: 'chosen-model',
        apiKeyEnv: 'ELOS_PROVIDER_A',
        ...(provider === 'openai-compatible' ? { baseURL: 'http://localhost:11434/v1' } : {}),
      });

      const model = resolveModel(config, { ELOS_PROVIDER_A: 'test-only' });

      expect(typeof model).toBe('object');

      if (typeof model !== 'string') {
        expect(model.modelId).toBe('chosen-model');
      }
    },
  );

  it('does not fall back to a global key if the selected credential is absent', () => {
    expect(() =>
      resolveModel(
        { provider: 'openai', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_MISSING' },
        { OPENAI_API_KEY: 'other-profile-secret' },
      ),
    ).toThrow('Provider credential is not configured');
  });
});

it('rejects a compatible provider without an endpoint before making a request', () => {
  expect(() =>
    resolveModel(
      { provider: 'openai-compatible', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_LOCAL' },
      { ELOS_PROVIDER_LOCAL: 'local' },
    ),
  ).toThrow('baseURL is required for compatible providers');
});

it('accepts an explicitly resolved vault key without consulting host environment', () => {
  const model = resolveModel(
    {
      provider: 'openai',
      modelId: 'chosen-model',
      credentialId: '00000000-0000-4000-8000-000000000001',
    },
    {},
    undefined,
    'dummy-vault-key',
  );

  if (typeof model !== 'string') {
    expect(model.modelId).toBe('chosen-model');
  }
});
