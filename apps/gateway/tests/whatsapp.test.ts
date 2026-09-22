import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ChannelRegistry } from '../src/channels/registry.js';
import { Channels } from '../src/channels/service.js';
import { WhatsAppChannel } from '../src/channels/whatsapp/adapter.js';
import { WhatsAppConnections } from '../src/channels/whatsapp/connections.js';
import type {
  DeviceCallbacks,
  DeviceFactory,
  DeviceSessionStore,
} from '../src/channels/whatsapp/types.js';
import { Credentials } from '../src/security/credentials.js';
import { SecretBox } from '../src/security/crypto.js';
import { testServices } from './helpers/services.js';

const actorId = '5511999999999@c.us';
const token = 'synthetic-whatsapp-admin-token-32-characters';
const admin = { authorization: `Bearer ${token}` };
const message = { actorId, chatId: actorId, text: 'Hello', requestKey: 'wa-message-one' };

async function setup(send?: (chatId: string, text: string) => Promise<string>) {
  let now = Date.now();
  const services = testServices();
  const store = services.store;
  const box = new SecretBox({ activeKeyId: 'v1', keys: { v1: randomBytes(32) } });
  const credentials = new Credentials(services, box);
  const devices: Array<{ callbacks: DeviceCallbacks; store: DeviceSessionStore }> = [];
  const sent: Array<{ chatId: string; text: string }> = [];

  const factory: DeviceFactory = async (_id, sessionStore, callbacks) => {
    devices.push({ callbacks, store: sessionStore });

    return {
      start: async () => {},
      send: async (chatId, text) => {
        sent.push({ chatId, text });
        return send ? send(chatId, text) : `wa-sent-${sent.length}`;
      },
      stop: async () => {},
    };
  };

  const connection = () => new WhatsAppConnections(store, box, factory, () => now);
  const whatsapp = connection();
  const registry = new ChannelRegistry([new WhatsAppChannel(whatsapp)]);
  const channels = new Channels(services, credentials, fetch, registry);
  const receive = (id: string, input: typeof message, generation: number) =>
    channels.receiveLinked(id, input, generation);
  const profile = await services.profiles.createProfile({
    name: 'WhatsApp',
    instructions: 'Help.',
    model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
  });
  const session = await services.sessions.createSession(profile.id, {
    title: 'WhatsApp',
    channel: 'whatsapp',
  });
  const binding = await channels.create(profile.id, {
    name: 'Phone',
    type: 'whatsapp',
    sessionId: session.id,
    actorIds: [actorId],
    chatIds: [actorId],
  });
  const app = createApp({ ...services, credentials, channels, whatsapp, token, logger: false });
  const base = `/v1/profiles/${profile.id}/channels/${binding.id}`;

  return {
    services,
    store,
    devices,
    sent,
    credentials,
    whatsapp,
    channels,
    receive,
    profile,
    binding,
    app,
    base,
    connection,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('WhatsApp linked device', () => {
  it('restricts linking and short-lived QR codes to administrators without exposing secrets in status', async () => {
    const f = await setup();

    try {
      const key = await f.credentials.issueKey(f.profile.id, {
        label: 'Reader',
        scopes: ['read'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const restricted = { authorization: `Bearer ${key.token}` };
      expect(
        (await f.app.inject({ method: 'POST', url: `${f.base}/connect`, headers: restricted }))
          .statusCode,
      ).toBe(403);
      expect(
        (await f.app.inject({ method: 'POST', url: `${f.base}/connect`, headers: admin }))
          .statusCode,
      ).toBe(202);

      await f.whatsapp.tick(f.receive);
      await f.devices[0]?.callbacks.qr('synthetic-sensitive-qr');

      expect(JSON.stringify(await f.store.get('channelConnection', f.binding.id))).not.toContain(
        'synthetic-sensitive-qr',
      );
      const qr = await f.app.inject({ url: `${f.base}/qr`, headers: admin });
      expect(qr.statusCode).toBe(200);
      expect(qr.headers['cache-control']).toBe('no-store');
      expect(qr.json().qr).toBe('synthetic-sensitive-qr');
      expect((await f.app.inject({ url: `${f.base}/qr`, headers: restricted })).statusCode).toBe(
        403,
      );

      const status = await f.app.inject({ url: `${f.base}/connection`, headers: admin });
      expect(status.json().status).toBe('qr');
      expect(status.body).not.toContain('synthetic-sensitive-qr');
      expect(status.body).not.toContain('ciphertext');

      f.advance(46_000);
      expect((await f.app.inject({ url: `${f.base}/qr`, headers: admin })).statusCode).toBe(409);
      await expect(
        f.whatsapp.status(randomBytes(16).toString('hex'), f.binding.id),
      ).rejects.toThrow('Channel not found');
    } finally {
      await f.whatsapp.stop();
      await f.app.close();
    }
  });

  it('persists encrypted device sessions across workers and fences late saves after disconnect', async () => {
    const f = await setup();
    const replacement = f.connection();

    try {
      await f.whatsapp.connect(f.profile.id, f.binding.id);
      await f.whatsapp.tick(f.receive);
      const original = f.devices[0];
      if (!original) throw new Error('Device missing');
      const archive = Buffer.from('synthetic-device-secret:'.repeat(30_000));
      await original.store.save(archive);
      expect(JSON.stringify(await f.store.get('channelAuth', f.binding.id))).not.toContain(
        'synthetic-device-secret',
      );

      await f.whatsapp.stop();
      await replacement.tick(f.receive);
      const restored = f.devices[1];
      if (!restored) throw new Error('Restored device missing');
      expect(await restored.store.load()).toEqual(archive);
      await expect(original.store.save(Buffer.from('stale'))).rejects.toThrow(
        'Device ownership expired',
      );

      await replacement.disconnect(f.profile.id, f.binding.id);
      await expect(restored.store.save(archive)).rejects.toThrow('Device ownership expired');
      await expect(restored.callbacks.qr('late-qr')).rejects.toThrow('Device ownership expired');
      expect((await f.store.get('channelAuth', f.binding.id))?.chunks).toEqual([]);
      expect((await replacement.status(f.profile.id, f.binding.id)).status).toBe('disconnected');

      await replacement.connect(f.profile.id, f.binding.id);
      await replacement.tick(f.receive);
      const latest = f.devices.at(-1);
      if (!latest) throw new Error('Device missing');
      await latest.store.save(archive);
      await f.channels.revoke(f.profile.id, f.binding.id);
      await expect(latest.store.save(archive)).rejects.toThrow('Device ownership expired');
      expect((await f.store.get('channelAuth', f.binding.id))?.chunks).toEqual([]);
    } finally {
      await replacement.stop();
      await f.app.close();
    }
  });

  it('queues authorized messages during a busy run, deduplicates input and sends each result once', async () => {
    const f = await setup();

    try {
      await f.whatsapp.connect(f.profile.id, f.binding.id);
      await f.whatsapp.tick(f.receive);
      const callbacks = f.devices[0]?.callbacks;
      if (!callbacks) throw new Error('Device missing');
      await callbacks.ready('5511888888888@c.us');
      await callbacks.message({ ...message, actorId: 'stranger@c.us' });
      await callbacks.message(message);
      await callbacks.message(message);
      await callbacks.message({ ...message, text: 'Next', requestKey: 'wa-message-two' });
      await f.whatsapp.tick(f.receive);

      const [first] = await f.services.runs.activities(f.profile.id);
      if (!first) throw new Error('Run missing');
      expect(first.input).toBe('Hello');
      expect(await f.store.list('channelInbox', { where: { status: 'pending' } })).toHaveLength(1);
      await f.services.lifecycle.claim(first.id, f.profile.id, 'worker');
      await f.services.lifecycle.finish(
        f.profile.id,
        first.id,
        'worker',
        'completed',
        'First answer',
      );
      await Promise.all([f.channels.dispatch(), f.channels.dispatch()]);
      expect(f.sent).toEqual([{ chatId: actorId, text: 'First answer' }]);
      expect((await f.channels.deliveries(f.profile.id))[0]?.remoteMessageIds).toEqual([
        'wa-sent-1',
      ]);

      await f.whatsapp.tick(f.receive);
      expect((await f.services.runs.activities(f.profile.id))[0]?.input).toBe('Next');
      expect(await f.store.list('channelInbox', { where: { status: 'pending' } })).toHaveLength(0);
      const [second] = await f.services.runs.activities(f.profile.id);
      if (!second) throw new Error('Second run missing');
      await f.whatsapp.disconnect(f.profile.id, f.binding.id);
      await f.whatsapp.connect(f.profile.id, f.binding.id);
      await f.whatsapp.tick(f.receive);
      await f.devices.at(-1)?.callbacks.ready('different-account');
      await f.services.lifecycle.claim(second.id, f.profile.id, 'worker');
      await f.services.lifecycle.finish(
        f.profile.id,
        second.id,
        'worker',
        'completed',
        'Old account reply',
      );
      await f.channels.dispatch();
      expect(f.sent).toHaveLength(1);
      expect(
        (await f.channels.deliveries(f.profile.id)).find((item) => item.runId === second.id)
          ?.status,
      ).toBe('failed');

      await expect(
        f.channels.receive(f.binding.id, {
          type: 'whatsapp',
          headers: { 'x-jian-channel-token': f.binding.webhookToken },
          payload: message,
        }),
      ).rejects.toThrow('does not accept webhooks');
    } finally {
      await f.whatsapp.stop();
      await f.app.close();
    }
  });

  it('allows only the current worker to send after an expired connection lease is claimed', async () => {
    const f = await setup();
    const other = f.connection();

    try {
      await f.whatsapp.connect(f.profile.id, f.binding.id);
      await f.whatsapp.tick(f.receive);
      await f.devices[0]?.callbacks.ready('account');
      await other.tick(f.receive);
      expect(await other.canSend(f.binding.id)).toBe(false);
      expect(await f.whatsapp.canSend(f.binding.id)).toBe(true);

      f.advance(31_000);
      await other.tick(f.receive);
      expect(await f.whatsapp.canSend(f.binding.id)).toBe(false);
      expect(await other.canSend(f.binding.id)).toBe(false);
      await f.devices[1]?.callbacks.ready('account');
      expect(await other.canSend(f.binding.id)).toBe(true);
      await expect(f.devices[0]?.callbacks.message(message)).rejects.toThrow(
        'Device ownership expired',
      );
    } finally {
      await f.whatsapp.stop();
      await other.stop();
      await f.app.close();
    }
  });

  it('does not replay an uncertain outbound WhatsApp message', async () => {
    const f = await setup(async () => {
      throw new Error('Remote write succeeded but confirmation was lost');
    });

    try {
      await f.whatsapp.connect(f.profile.id, f.binding.id);
      await f.whatsapp.tick(f.receive);
      await f.devices[0]?.callbacks.ready('account');
      await f.devices[0]?.callbacks.message(message);
      await f.whatsapp.tick(f.receive);
      const [run] = await f.services.runs.activities(f.profile.id);
      if (!run) throw new Error('Run missing');
      await f.services.lifecycle.claim(run.id, f.profile.id, 'worker');
      await f.services.lifecycle.finish(f.profile.id, run.id, 'worker', 'completed', 'Answer');
      await f.channels.dispatch();
      await f.channels.dispatch();

      expect(f.sent).toHaveLength(1);
      expect((await f.channels.deliveries(f.profile.id))[0]?.status).toBe('unknown');
    } finally {
      await f.whatsapp.stop();
      await f.app.close();
    }
  });
});
