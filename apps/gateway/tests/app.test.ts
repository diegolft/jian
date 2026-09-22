import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { SecretBox } from '../src/security/crypto.js';
import { Credentials } from '../src/services/credentials.js';
import { testServices } from './helpers/services.js';

const token = 'test-token-that-is-at-least-32-characters';
const headers = { authorization: `Bearer ${token}` };

const input = {
  name: 'Atlas',
  instructions: 'Help.',
  model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_TEST' },
};

const apps: FastifyInstance[] = [];

function setup() {
  const services = testServices();
  const app = createApp({ ...services, token, logger: false });

  apps.push(app);

  return { app, services };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('HTTP services', () => {
  it('keeps provider setup admin-only while scoped chat can use a registered model', async () => {
    const services = testServices();
    const credentials = new Credentials(
      services,
      new SecretBox({
        activeKeyId: 'test',
        keys: { test: randomBytes(32) },
      }),
    );
    const app = createApp({ ...services, credentials, token, logger: false });
    apps.push(app);

    const profile = await services.profiles.createProfile({ name: 'New', instructions: 'Help.' });
    const secret = await credentials.create(profile.id, {
      label: 'Test',
      kind: 'provider',
      secret: 'synthetic-secret',
    });
    const base = `/v1/profiles/${profile.id}`;
    const payload = {
      name: 'OpenAI',
      kind: 'openai',
      credentialId: secret.id,
      models: [{ id: 'sample', contextWindow: 16_000, maxOutputTokens: 2048 }],
    };
    const created = await app.inject({
      method: 'POST',
      url: `${base}/providers`,
      headers,
      payload,
    });

    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain('synthetic-secret');

    const chosen = { providerId: created.json().id, modelId: 'sample' };
    const configured = await app.inject({
      method: 'PUT',
      url: `${base}/model-defaults`,
      headers,
      payload: { conversation: chosen, channel: null },
    });
    expect(configured.statusCode).toBe(200);

    const key = await credentials.issueKey(profile.id, {
      label: 'Chat',
      scopes: ['chat'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const scoped = { authorization: `Bearer ${key.token}` };

    expect((await app.inject({ url: `${base}/providers`, headers: scoped })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: `${base}/providers`, headers: scoped, payload }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: `${base}/providers/openai/oauth`, headers: scoped }))
        .statusCode,
    ).toBe(403);

    const session = await services.sessions.createSession(profile.id, { title: 'Chat' });
    const response = await app.inject({
      method: 'POST',
      url: `${base}/sessions/${session.id}/messages`,
      headers: scoped,
      payload: { text: 'Hello', requestKey: 'once' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().model.modelId).toBe('sample');
    expect(response.body).not.toContain('synthetic-secret');
  });
  it('protects profiles and events while exposing liveness', async () => {
    const { app } = setup();

    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/v1/profiles')).statusCode).toBe(401);
    expect((await app.inject('/v1/profiles/test/events/stream')).statusCode).toBe(401);
    expect((await app.inject({ url: '/v1/profiles', headers })).json()).toEqual([]);
  });

  it('creates profiles and sessions, then queues idempotent runs', async () => {
    const { app } = setup();

    const created = await app.inject({
      method: 'POST',
      url: '/v1/profiles',
      headers,
      payload: input,
    });

    expect(created.statusCode).toBe(201);

    const id = created.json().id;

    const session = await app.inject({
      method: 'POST',
      url: `/v1/profiles/${id}/sessions`,
      headers,
      payload: { title: 'Mac', channel: 'macos' },
    });

    const url = `/v1/profiles/${id}/sessions/${session.json().id}/messages`;

    const first = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { text: 'Hello', requestKey: 'same' },
    });

    const duplicate = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { text: 'Hello', requestKey: 'same' },
    });

    expect(first.statusCode).toBe(202);
    expect(duplicate.json().id).toBe(first.json().id);
    expect((await app.inject({ url, headers })).json()).toHaveLength(1);
  });

  it('rejects secret values and unknown settings without echoing payloads', async () => {
    const { app } = setup();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/profiles',
      headers,
      payload: { ...input, model: { ...input.model, apiKey: 'secret-123' } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('secret-123');
  });

  it('returns explicit conflicts and replayable event cursors', async () => {
    const { app, services } = setup();
    const profile = await services.profiles.createProfile(input);
    const url = `/v1/profiles/${profile.id}`;

    await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { expectedVersion: 1, name: 'Updated' },
    });

    const stale = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { expectedVersion: 1, name: 'Stale' },
    });

    expect(stale.statusCode).toBe(409);

    const events = (await app.inject({ url: `${url}/events`, headers })).json();

    expect(events).toHaveLength(2);

    const resumed = (
      await app.inject({ url: `${url}/events?after=${events[0].id}`, headers })
    ).json();

    expect(resumed).toHaveLength(1);
    expect(resumed[0].type).toBe('profile.updated');
    expect((await app.inject({ url: `${url}/events?after=-1`, headers })).statusCode).toBe(400);
  });
});

it('streams committed events over HTTP and resumes after a cursor', async () => {
  const { app, services } = setup();
  const profile = await services.profiles.createProfile(input);
  const initial = (await services.store.events(profile.id, 0))[0];

  assert.ok(initial, 'Profile creation must emit an event');
  await services.profiles.updateProfile(profile.id, { expectedVersion: 1, name: 'Updated' });

  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();

  try {
    const response = await fetch(`${url}/v1/profiles/${profile.id}/events/stream`, {
      headers: { ...headers, 'Last-Event-ID': String(initial.id) },
      signal: controller.signal,
    });

    expect(response.headers.get('content-type')).toBe('text/event-stream');
    assert.ok(response.body, 'SSE response must have a body');

    const reader = response.body.getReader();
    let data = '';

    while (!data.includes('profile.updated')) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      data += new TextDecoder().decode(chunk.value);
    }

    expect(data).toContain('event: profile.updated');
    expect(data).not.toContain('event: profile.created');
    await reader.cancel();
  } finally {
    controller.abort();
  }
});

describe('panel session', () => {
  const panel = { 'x-elos-panel': '1' };

  async function signIn(app: FastifyInstance) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/panel/session',
      payload: { token },
    });

    expect(response.statusCode).toBe(201);

    const cookie = response.cookies[0];

    assert(cookie && cookie.name === 'elos_panel');

    return { cookie: `elos_panel=${cookie.value}`, raw: cookie, response };
  }

  it('hands the browser an unreadable cookie that authorizes administration', async () => {
    const { app } = setup();
    const { cookie, raw, response } = await signIn(app);

    expect(raw.httpOnly).toBe(true);
    expect(raw.sameSite).toBe('Strict');
    expect(raw.path).toBe('/');
    // Plain HTTP is a supported self-hosted setup; a Secure cookie would never be sent back.
    expect(raw.secure).toBeFalsy();
    expect(Date.parse(response.json().expiresAt)).toBeGreaterThan(Date.now());
    expect(cookie).not.toContain(token);

    const listed = await app.inject({ url: '/v1/profiles', headers: { cookie, ...panel } });

    expect(listed.statusCode).toBe(200);
  });

  it('refuses the wrong host token without issuing a cookie', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/panel/session',
      payload: { token: `${token}-wrong` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.cookies).toHaveLength(0);
  });

  it('ignores a cookie sent without the panel header, tampered with, or expired', async () => {
    const { app } = setup();
    const { cookie, raw } = await signIn(app);

    // A third-party site can send the cookie, but not a header that needs a preflight.
    expect((await app.inject({ url: '/v1/profiles', headers: { cookie } })).statusCode).toBe(401);

    const [expiry, signature] = raw.value.split('.');

    for (const forged of [
      `${expiry}.${signature?.replace(/^./, (first) => (first === 'A' ? 'B' : 'A'))}`,
      `${Number(expiry) + 60_000}.${signature}`,
      `${Date.now() - 1000}.${signature}`,
    ]) {
      const response = await app.inject({
        url: '/v1/profiles',
        headers: { cookie: `elos_panel=${forged}`, ...panel },
      });

      expect(response.statusCode).toBe(401);
    }
  });

  it('clears the cookie on sign out', async () => {
    const { app } = setup();
    const { cookie } = await signIn(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/panel/session',
      headers: { cookie, ...panel },
    });

    expect(response.statusCode).toBe(200);
    expect(response.cookies[0]).toMatchObject({ name: 'elos_panel', value: '' });
    expect(response.cookies[0]?.maxAge).toBe(0);
  });
});
