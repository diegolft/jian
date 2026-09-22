import { describe, expect, it } from 'vitest';
import { mcpSecret } from '../src/profiles/service.js';
import { providerSecret } from '../src/providers/service.js';
import { testServices } from './helpers/services.js';

const otherProfile = '00000000-0000-4000-8000-000000000001';

async function setup() {
  const services = testServices();

  const profile = await services.profiles.createProfile({
    name: 'Test',
    instructions: 'Help.',
    model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
  });

  return { services, profile };
}

describe('profile vault', () => {
  it('keeps the secret out of the record and refuses an envelope moved to another profile', async () => {
    const { services, profile } = await setup();
    const owner = providerSecret('11111111-1111-4111-8111-111111111111');

    await services.vault.put(profile.id, owner, 'synthetic-secret');

    const stored = await services.store.get('secret', `${profile.id}:${owner}`);

    if (!stored) {
      throw new Error('The vault must persist the secret it accepted');
    }

    expect(JSON.stringify(stored)).not.toContain('synthetic-secret');
    expect(await services.vault.read(profile.id, owner)).toBe('synthetic-secret');
    expect(await services.vault.read(otherProfile, owner)).toBeUndefined();

    // A stolen envelope replanted under another profile must not decrypt.
    await services.store.transaction(otherProfile, async (tx) => {
      const id = `${otherProfile}:${owner}`;

      await tx.put('secret', id, otherProfile, { ...stored, id, profileId: otherProfile });
    });

    await expect(services.vault.read(otherProfile, owner)).rejects.toThrow();
  });

  it('discards a provider key when the provider is revoked or replaced', async () => {
    const { services, profile } = await setup();

    const first = await services.providers.createProvider(profile.id, {
      name: 'OpenAI',
      kind: 'openai',
      secret: 'synthetic-first-key',
      models: [{ id: 'sample', contextWindow: 16_000, maxOutputTokens: 2048 }],
    });

    expect(await services.vault.read(profile.id, providerSecret(first.id))).toBe(
      'synthetic-first-key',
    );

    const second = await services.providers.createProvider(profile.id, {
      name: 'OpenAI',
      kind: 'openai',
      secret: 'synthetic-second-key',
      models: [{ id: 'sample', contextWindow: 16_000, maxOutputTokens: 2048 }],
    });

    expect(await services.vault.read(profile.id, providerSecret(first.id))).toBeUndefined();

    await services.providers.revokeProvider(profile.id, second.id);

    expect(await services.vault.read(profile.id, providerSecret(second.id))).toBeUndefined();
  });

  it('stores an MCP token with its server and forgets it when the server goes', async () => {
    const { services, profile } = await setup();

    const server = {
      name: 'tracker',
      url: 'https://mcp.example.com/mcp',
      allowedTools: ['search'],
    };

    const updated = await services.profiles.updateProfile(profile.id, {
      expectedVersion: profile.version,
      mcpServers: [{ ...server, bearerToken: 'synthetic-mcp-token' }],
    });

    expect(JSON.stringify(updated)).not.toContain('synthetic-mcp-token');
    expect(await services.vault.read(profile.id, mcpSecret('tracker'))).toBe('synthetic-mcp-token');

    // A patch that omits the token keeps the stored one.
    const kept = await services.profiles.updateProfile(profile.id, {
      expectedVersion: updated.version,
      mcpServers: [{ ...server, allowedTools: ['search', 'create'] }],
    });

    expect(await services.vault.read(profile.id, mcpSecret('tracker'))).toBe('synthetic-mcp-token');

    await services.profiles.updateProfile(profile.id, {
      expectedVersion: kept.version,
      mcpServers: [],
    });

    expect(await services.vault.read(profile.id, mcpSecret('tracker'))).toBeUndefined();
  });
});
