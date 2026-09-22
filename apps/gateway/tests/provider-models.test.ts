import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ProviderModels } from '../src/providers/discovery.js';
import { testServices } from './helpers/services.js';

const token = 'test-token-that-is-at-least-32-characters';
const headers = { authorization: `Bearer ${token}` };
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const listing = (...ids: string[]) =>
  Response.json({ data: ids.map((id) => ({ id, display_name: id.toUpperCase() })) });

async function setup(respond: () => Promise<Response>) {
  let now = 1_700_000_000_000;
  const services = testServices(() => now);
  const profile = await services.profiles.createProfile({ name: 'Atlas', instructions: 'Help.' });
  const provider = await services.providers.createProvider(profile.id, {
    name: 'Anthropic',
    kind: 'anthropic',
    secret: 'synthetic-anthropic-key',
  });
  const models = new ProviderModels(services, respond, {
    ttlMs: 60_000,
    clock: () => now,
  });

  return {
    services,
    profile,
    provider,
    models,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it('keeps the saved default and the last list when the provider is unreachable', async () => {
  let reachable = true;
  const { services, profile, provider, models, advance } = await setup(async () => {
    if (!reachable) throw new Error('connect ECONNREFUSED');

    return listing('claude-sonnet-4-5', 'claude-opus-4-5');
  });

  await services.providers.setModelDefaults(profile.id, {
    conversation: { providerId: provider.id, modelId: 'claude-sonnet-4-5', reasoningEffort: 'low' },
  });

  const fresh = await models.list(profile.id, provider.id);

  expect(fresh.stale).toBe(false);
  expect(fresh.models.map((model) => model.id)).toEqual(['claude-opus-4-5', 'claude-sonnet-4-5']);

  reachable = false;
  advance(120_000);

  const offline = await models.list(profile.id, provider.id);

  expect(offline.stale).toBe(true);
  expect(offline.reason).toBeDefined();
  expect(offline.models.map((model) => model.id)).toEqual(fresh.models.map((model) => model.id));
  expect(offline.fetchedAt).toBe(fresh.fetchedAt);

  // The outage must not reach into stored configuration.
  expect((await services.providers.modelDefaults(profile.id)).conversation).toEqual({
    providerId: provider.id,
    modelId: 'claude-sonnet-4-5',
    reasoningEffort: 'low',
  });
  expect(
    (await services.providers.providers(profile.id)).find((item) => item.id === provider.id)
      ?.revokedAt,
  ).toBeUndefined();
});

it('reports an unreachable provider as empty instead of inventing a list', async () => {
  const { profile, provider, models } = await setup(async () => {
    throw new Error('connect ECONNREFUSED');
  });

  const list = await models.list(profile.id, provider.id);

  expect(list).toMatchObject({ providerId: provider.id, models: [], stale: true });
  expect(list.reason).toBeDefined();
});

it('answers inside the cache window without reaching the provider again', async () => {
  let reachable = true;
  const { profile, provider, models, advance } = await setup(async () => {
    if (!reachable) throw new Error('connect ECONNREFUSED');

    return listing('claude-sonnet-4-5');
  });

  await models.list(profile.id, provider.id);
  reachable = false;
  advance(30_000);

  expect(await models.list(profile.id, provider.id)).toMatchObject({ stale: false });
});

it('offers a model the capability table does not know, marked and held to the floor', async () => {
  const { services, profile, provider, models } = await setup(async () =>
    listing('claude-sonnet-4-5', 'claude-next-experimental'),
  );

  const list = await models.list(profile.id, provider.id);
  const known = list.models.find((model) => model.id === 'claude-sonnet-4-5');
  const unknown = list.models.find((model) => model.id === 'claude-next-experimental');

  expect(known).toMatchObject({ known: true, contextWindow: 200_000 });
  expect(known?.reasoningEfforts).toContain('high');
  expect(unknown).toMatchObject({
    known: false,
    contextWindow: 8192,
    reasoningEfforts: [],
    inputModalities: ['text'],
  });

  // Unknown capabilities never make a model unselectable.
  const saved = await services.providers.setModelDefaults(profile.id, {
    conversation: { providerId: provider.id, modelId: 'claude-next-experimental' },
  });

  expect(saved.conversation?.modelId).toBe('claude-next-experimental');

  // An effort we cannot vouch for is refused rather than guessed at the provider.
  await expect(
    services.providers.setModelDefaults(profile.id, {
      conversation: {
        providerId: provider.id,
        modelId: 'claude-next-experimental',
        reasoningEffort: 'high',
      },
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
});

it('keeps model discovery admin-only and inside the profile', async () => {
  const { services, profile, provider, models } = await setup(async () =>
    listing('claude-sonnet-4-5'),
  );
  const app = createApp({ ...services, providerModels: models, token, logger: false });
  apps.push(app);

  const path = `/v1/profiles/${profile.id}/providers/${provider.id}/models`;

  expect((await app.inject({ url: path })).statusCode).toBe(401);

  const allowed = await app.inject({ url: path, headers });

  expect(allowed.statusCode).toBe(200);
  expect(allowed.body).not.toContain('synthetic-anthropic-key');

  const stranger = await services.profiles.createProfile({ name: 'Other', instructions: 'Help.' });
  const crossed = await app.inject({
    url: `/v1/profiles/${stranger.id}/providers/${provider.id}/models`,
    headers,
  });

  expect(crossed.statusCode).toBe(404);
});
