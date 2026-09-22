import { modelSchema } from '@elos/contracts';
import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { resolveModel } from '../src/providers/models.js';

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
