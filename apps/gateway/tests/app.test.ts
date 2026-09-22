import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Gateway } from '../src/gateway.js';
import { MemoryStore } from './helpers/memory-store.js';

const token = 'test-token-that-is-at-least-32-characters';
const headers = { authorization: `Bearer ${token}` };

const input = {
  name: 'Atlas',
  instructions: 'Help.',
  model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_TEST' },
};

const apps: FastifyInstance[] = [];

function setup() {
  const gateway = new Gateway(new MemoryStore());
  const app = createApp({ gateway, token, logger: false });

  apps.push(app);

  return { app, gateway };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('HTTP gateway', () => {
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
    const { app, gateway } = setup();
    const profile = await gateway.createProfile(input);
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
  const { app, gateway } = setup();
  const profile = await gateway.createProfile(input);
  const initial = (await gateway.store.events(profile.id, 0))[0];

  assert.ok(initial, 'Profile creation must emit an event');
  await gateway.updateProfile(profile.id, { expectedVersion: 1, name: 'Updated' });

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
