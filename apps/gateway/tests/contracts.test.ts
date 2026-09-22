import { randomBytes } from 'node:crypto';
import SwaggerParser from '@apidevtools/swagger-parser';
import { createOpenAPI, operations } from '@jian/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Channels } from '../src/channels/service.js';
import { Credentials } from '../src/security/credentials.js';
import { SecretBox } from '../src/security/crypto.js';
import { testServices } from './helpers/services.js';

const token = 'synthetic-admin-token-with-32-characters';
const admin = { authorization: `Bearer ${token}` };

async function setup() {
  const services = testServices();

  const credentials = new Credentials(
    services,
    new SecretBox({ activeKeyId: 'v1', keys: { v1: randomBytes(32) } }),
  );

  const channels = new Channels(services, credentials, async () => {
    throw new Error('Network forbidden in test');
  });

  const app = createApp({ ...services, credentials, channels, token, logger: false });

  await app.ready();

  const profile = await services.profiles.createProfile({
    name: 'P',
    instructions: 'Help',
    model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
  });

  return { app, services, credentials, profile };
}

describe('public API contracts', () => {
  it('exports valid OpenAPI and unique operation IDs', async () => {
    const schema = createOpenAPI();

    await SwaggerParser.validate(JSON.parse(JSON.stringify(schema)));

    expect(new Set(operations.map((operation) => operation.operationId)).size).toBe(
      operations.length,
    );
  });

  it('enforces scoped profile isolation, prevents capability escalation and immediately revokes keys', async () => {
    const { app, services, credentials, profile } = await setup();

    try {
      const key = await credentials.issueKey(profile.id, {
        label: 'Mac',
        scopes: ['read', 'profile:write'],
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });

      const headers = { authorization: `Bearer ${key.token}` };
      const path = `/v1/profiles/${profile.id}`;

      expect((await app.inject({ url: path, headers })).statusCode).toBe(200);
      expect((await app.inject({ url: `${path}/credentials`, headers })).statusCode).toBe(403);

      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: path,
            headers,
            payload: { expectedVersion: 1, allowSelfManagement: true },
          })
        ).statusCode,
      ).toBe(403);

      const other = await services.profiles.createProfile({
        name: 'Other',
        instructions: 'Help',
        model: profile.model,
      });

      expect((await app.inject({ url: `/v1/profiles/${other.id}`, headers })).statusCode).toBe(401);
      await credentials.revokeKey(profile.id, key.id);
      expect((await app.inject({ url: path, headers })).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('does not expose credential envelopes or worker snapshots in public responses', async () => {
    const { app, profile } = await setup();

    try {
      const prefix = `/v1/profiles/${profile.id}`;

      const credential = await app.inject({
        method: 'POST',
        url: `${prefix}/credentials`,
        headers: admin,
        payload: { kind: 'provider', label: 'Test', secret: 'synthetic-secret' },
      });

      expect(credential.statusCode).toBe(201);
      expect(credential.body).not.toContain('synthetic-secret');
      expect(credential.body).not.toContain('ciphertext');

      const session = await app.inject({
        method: 'POST',
        url: `${prefix}/sessions`,
        headers: admin,
        payload: { title: 'Test' },
      });

      const run = await app.inject({
        method: 'POST',
        url: `${prefix}/sessions/${session.json().id}/messages`,
        headers: admin,
        payload: { text: 'hi', requestKey: 'one' },
      });

      expect(run.statusCode).toBe(202);
      expect(run.json()).not.toHaveProperty('profile');
      expect(run.json()).not.toHaveProperty('leaseOwner');

      expect(
        (await app.inject({ url: `${prefix}/history?limit=5000`, headers: admin })).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('validates ingress using only its binding token and rejects unapproved actors', async () => {
    const { app, services, profile } = await setup();

    try {
      const session = await services.sessions.createSession(profile.id, { title: 'External' });

      const created = await app.inject({
        method: 'POST',
        url: `/v1/profiles/${profile.id}/channels`,
        headers: admin,
        payload: {
          name: 'API',
          type: 'generic',
          sessionId: session.id,
          actorIds: ['owner'],
          chatIds: ['chat'],
        },
      });

      expect(created.statusCode).toBe(201);

      const binding = created.json();
      const url = `/v1/ingress/${binding.id}`;
      const payload = { actorId: 'owner', chatId: 'chat', text: 'hi', requestKey: 'one' };

      expect((await app.inject({ method: 'POST', url, headers: admin, payload })).statusCode).toBe(
        401,
      );

      const headers = { 'x-jian-channel-token': binding.webhookToken };

      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers,
            payload: { ...payload, actorId: 'stranger' },
          })
        ).statusCode,
      ).toBe(403);

      const first = await app.inject({ method: 'POST', url, headers, payload });

      expect(first.statusCode).toBe(202);

      expect((await app.inject({ method: 'POST', url, headers, payload })).json()).toEqual(
        first.json(),
      );

      const deliveries = await app.inject({
        method: 'GET',
        url: `/v1/profiles/${profile.id}/deliveries`,
        headers: admin,
      });

      expect(deliveries.statusCode).toBe(200);
      expect(deliveries.json()).toEqual([]);

      const wrongProtocol = await app.inject({
        method: 'POST',
        url: `/v1/telegram/${binding.id}`,
        headers: { 'x-telegram-bot-api-secret-token': binding.webhookToken },
        payload: { update_id: 1 },
      });

      expect(wrongProtocol.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

it('rejects embedded URL credentials before they can be stored in profile configuration', async () => {
  const { app, profile } = await setup();

  try {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/profiles/${profile.id}`,
      headers: admin,
      payload: {
        expectedVersion: 1,
        model: { ...profile.model, baseURL: 'https://owner:synthetic-password@example.com/v1' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('synthetic-password');
  } finally {
    await app.close();
  }
});
