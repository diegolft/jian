import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Gateway } from '../src/gateway.js';
import { SecretBox } from '../src/security/crypto.js';
import { Credentials } from '../src/services/credentials.js';
import { MemoryStore } from './helpers/memory-store.js';

async function setup() {
  const gateway = new Gateway(new MemoryStore());

  const profile = await gateway.createProfile({
    name: 'Test',
    instructions: 'Help.',
    model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_TEST' },
  });

  const vault = new Credentials(
    gateway,
    new SecretBox({ activeKeyId: 'v1', keys: { v1: randomBytes(32) } }),
  );

  return { gateway, profile, vault };
}

describe('profile credentials', () => {
  it('stores ciphertext, hides secrets in metadata and rejects cross-profile or wrong-purpose reads', async () => {
    const { gateway, profile, vault } = await setup();

    const value = await vault.create(profile.id, {
      label: 'Provider',
      kind: 'provider',
      secret: 'synthetic-secret',
    });

    expect(JSON.stringify(value)).not.toContain('synthetic-secret');

    expect(JSON.stringify(await gateway.store.get('credential', value.id))).not.toContain(
      'synthetic-secret',
    );

    expect(await vault.resolve(profile.id, value.id, 'provider')).toBe('synthetic-secret');
    await expect(vault.resolve(profile.id, value.id, 'mcp')).rejects.toThrow();

    await expect(
      vault.resolve('00000000-0000-4000-8000-000000000001', value.id, 'provider'),
    ).rejects.toThrow();

    await vault.revoke(profile.id, value.id);
    await expect(vault.resolve(profile.id, value.id, 'provider')).rejects.toThrow();
  });

  it('issues hashed expiring keys, enforces scope and revokes immediately', async () => {
    const { gateway, profile, vault } = await setup();

    const key = await vault.issueKey(profile.id, {
      label: 'Mac',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });

    expect(JSON.stringify(await gateway.store.get('accessKey', key.id))).not.toContain(key.token);
    await expect(vault.authorize(key.token, profile.id, 'read')).resolves.toBeUndefined();
    await expect(vault.authorize(key.token, profile.id, 'chat')).rejects.toThrow();

    await expect(
      vault.authorize(key.token, '00000000-0000-4000-8000-000000000001', 'read'),
    ).rejects.toThrow();

    await vault.revokeKey(profile.id, key.id);
    await expect(vault.authorize(key.token, profile.id, 'read')).rejects.toThrow();
  });
});
