import SwaggerParser from '@apidevtools/swagger-parser';
import { createOpenAPI, operations } from '@jian/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Channels } from '../src/channels/service.js';
import { testServices } from './helpers/services.js';

const token = 'synthetic-admin-token-with-32-characters';
const admin = { authorization: `Bearer ${token}` };

async function setup() {
  const services = testServices();

  const channels = new Channels(services, async () => {
    throw new Error('Network forbidden in test');
  });

  const app = createApp({ ...services, channels, token, logger: false });

  await app.ready();

  const profile = await services.profiles.createProfile({
    name: 'P',
    instructions: 'Help',
    model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
  });

  return { app, services, profile };
}

/** A path every parameter of which is filled in, so only authentication decides the answer. */
function address(path: string, profileId: string) {
  return path
    .replace(':profileId', profileId)
    .replace(':memoryKey', 'sample')
    .replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000002');
}

describe('public API contracts', () => {
  it('exports valid OpenAPI and unique operation IDs', async () => {
    const schema = createOpenAPI();

    await SwaggerParser.validate(JSON.parse(JSON.stringify(schema)));

    expect(new Set(operations.map((operation) => operation.operationId)).size).toBe(
      operations.length,
    );
  });

  it('answers every administrative route only to the host token', async () => {
    const { app, profile } = await setup();
    const administrative = operations.filter((operation) => operation.access === 'admin');

    try {
      expect(administrative.length).toBeGreaterThan(20);

      for (const operation of administrative) {
        const request = {
          method: operation.method,
          url: address(operation.path, profile.id),
          ...(operation.body ? { payload: {} } : {}),
        };

        const anonymous = await app.inject(request);
        const wrong = await app.inject({
          ...request,
          headers: { authorization: `Bearer ${token}-wrong` },
        });
        expect([operation.operationId, anonymous.statusCode]).toEqual([operation.operationId, 401]);
        expect([operation.operationId, wrong.statusCode]).toEqual([operation.operationId, 401]);

        // An event stream answers by staying open, so only its refusals are injectable.
        if (operation.stream) {
          continue;
        }

        const authorized = await app.inject({ ...request, headers: admin });

        expect([operation.operationId, authorized.statusCode]).not.toEqual([
          operation.operationId,
          401,
        ]);
      }

      // Only liveness and the sign-in that verifies the token itself answer without one.
      expect(
        operations
          .filter((operation) => operation.access === 'public')
          .map((operation) => operation.operationId),
      ).toEqual(['health', 'startPanelSession']);
    } finally {
      await app.close();
    }
  });

  it('does not expose provider secrets or worker snapshots in public responses', async () => {
    const { app, profile } = await setup();

    try {
      const prefix = `/v1/profiles/${profile.id}`;

      const provider = await app.inject({
        method: 'POST',
        url: `${prefix}/providers`,
        headers: admin,
        payload: {
          name: 'OpenAI',
          kind: 'openai',
          secret: 'synthetic-secret',
          models: [{ id: 'sample', contextWindow: 16_000, maxOutputTokens: 2048 }],
        },
      });

      expect(provider.statusCode).toBe(201);
      expect(provider.body).not.toContain('synthetic-secret');
      expect(provider.body).not.toContain('ciphertext');

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
