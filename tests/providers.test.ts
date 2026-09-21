import { describe, expect, it } from 'vitest';
import { resolveModel } from '../src/providers.js';
import { modelSchema } from '../src/domain.js';

describe('providers', () => {
  it.each(['openai', 'anthropic', 'google', 'openai-compatible'] as const)('resolves %s without using another profile’s default', provider => {
    const config = modelSchema.parse({ provider, modelId: 'chosen-model', apiKeyEnv: 'ELOS_PROVIDER_A', ...(provider === 'openai-compatible' ? { baseURL: 'http://localhost:11434/v1' } : {}) });
    const model = resolveModel(config, { ELOS_PROVIDER_A: 'test-only' });
    expect(typeof model).toBe('object');
    if (typeof model !== 'string') expect(model.modelId).toBe('chosen-model');
  });
  it('does not fall back to a global key if the selected credential is absent', () => {
    expect(() => resolveModel({ provider: 'openai', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_MISSING' }, { OPENAI_API_KEY: 'other-profile-secret' })).toThrow('Provider credential is not configured');
  });
});
