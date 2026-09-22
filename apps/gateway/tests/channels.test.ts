import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { ChannelRequest } from '../src/channels/channel.js';
import { Gateway } from '../src/gateway.js';
import { SecretBox } from '../src/security/crypto.js';
import { Channels } from '../src/services/channels.js';
import { Credentials } from '../src/services/credentials.js';
import { MemoryStore } from './helpers/memory-store.js';

async function setup(fetcher: typeof fetch) {
  const gateway = new Gateway(new MemoryStore());

  const credentials = new Credentials(
    gateway,
    new SecretBox({ activeKeyId: 'v1', keys: { v1: randomBytes(32) } }),
  );

  const profile = await gateway.createProfile({
    name: 'P',
    instructions: 'Help',
    model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_TEST' },
  });

  const session = await gateway.createSession(profile.id, { title: 'Telegram' });

  const credential = await credentials.create(profile.id, {
    kind: 'channel',
    label: 'Bot',
    secret: '123:synthetic-test-token',
  });

  const channels = new Channels(gateway, credentials, fetcher);

  const binding = await channels.create(profile.id, {
    name: 'Telegram',
    type: 'telegram',
    sessionId: session.id,
    credentialId: credential.id,
    actorIds: ['42'],
    chatIds: ['99'],
  });

  return { gateway, channels, binding, profile };
}

const update = { update_id: 123, message: { from: { id: 42 }, chat: { id: 99 }, text: 'Hello' } };

function webhook(token: string): ChannelRequest {
  return {
    type: 'telegram',
    headers: { 'x-telegram-bot-api-secret-token': token },
    payload: update,
  };
}

describe('Telegram transport', () => {
  it('validates the webhook and deduplicates both ingestion and delivery', async () => {
    const sent: string[] = [];

    const { gateway, channels, binding, profile } = await setup(async (_url, options) => {
      sent.push(String(options?.body));

      return Response.json({ ok: true, result: { message_id: 5 } });
    });

    const app = createApp({
      gateway,
      channels,
      token: 'test-admin-token'.repeat(3),
      logger: false,
    });
    const url = `/v1/telegram/${binding.id}`;
    const headers = { 'x-telegram-bot-api-secret-token': binding.webhookToken };

    try {
      const denied = await app.inject({ method: 'POST', url, payload: update });
      expect(denied.statusCode).toBe(401);

      const accepted = await app.inject({ method: 'POST', url, headers, payload: update });
      expect(accepted.statusCode).toBe(200);
      const first = accepted.json<{ accepted: boolean; runId: string }>();
      expect(first.accepted).toBe(true);

      const duplicate = await app.inject({ method: 'POST', url, headers, payload: update });
      expect(duplicate.json()).toEqual(first);

      await gateway.claim(first.runId, profile.id, 'worker');
      await gateway.finish(profile.id, first.runId, 'worker', 'completed', 'Hi');
      await Promise.all([channels.dispatch(), channels.dispatch()]);

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0] as string)).toEqual({ chat_id: '99', text: 'Hi' });
      expect((await channels.deliveries(profile.id))[0]?.status).toBe('sent');
    } finally {
      await app.close();
    }
  });

  it.each([0, 1])(
    'does not resend after an uncertain delivery with %i confirmed chunks',
    async (confirmedChunks) => {
      let attempts = 0;

      const { gateway, channels, binding, profile } = await setup(async () => {
        attempts += 1;

        if (attempts <= confirmedChunks) {
          return Response.json({ ok: true, result: { message_id: 5 } });
        }

        throw new Error('Connection closed after remote write');
      });

      const { runId } = await channels.receive(binding.id, webhook(binding.webhookToken));

      await gateway.claim(runId as string, profile.id, 'worker');
      await gateway.finish(profile.id, runId as string, 'worker', 'completed', 'x'.repeat(4001));
      await channels.dispatch();
      await channels.dispatch();
      expect(attempts).toBe(confirmedChunks + 1);
      expect((await channels.deliveries(profile.id))[0]).toMatchObject({
        status: 'unknown',
        remoteMessageIds: confirmedChunks ? [5] : [],
      });
    },
  );
});
