import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { ChannelRequest } from '../src/channels/channel.js';
import { Channels } from '../src/channels/service.js';
import { testServices } from './helpers/services.js';

const token = 'synthetic-telegram-admin-token-32-chars';
const admin = { authorization: `Bearer ${token}` };

async function setup(fetcher: typeof fetch) {
  const services = await testServices();

  const profile = await services.profiles.createProfile({
    name: 'P',
    instructions: 'Help',
    model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
  });

  // Connecting asks Telegram which account the bot is; only the deliveries reach the fetcher
  // each test inspects.
  const telegram: typeof fetch = async (url, options) =>
    String(url).endsWith('/getMe')
      ? Response.json({ ok: true, result: { id: 700 } })
      : fetcher(url, options);

  const channels = new Channels(services, telegram);

  const channel = await channels.connect(profile.id, {
    type: 'telegram',
    botToken: '123:synthetic-test-token',
  });

  const app = createApp({ ...services, channels, token, logger: false });

  return {
    services,
    channels,
    channel,
    profile,
    app,
    url: `/v1/telegram/${channel.id}`,
    headers: { 'x-telegram-bot-api-secret-token': channel.webhookToken },
  };
}

const update = {
  update_id: 123,
  message: { from: { id: 42, first_name: 'Ada' }, chat: { id: 99 }, text: 'Hello' },
};

const later = {
  update_id: 124,
  message: { from: { id: 42, first_name: 'Ada' }, chat: { id: 99 }, text: 'Still there?' },
};

function webhook(secret: string): ChannelRequest {
  return {
    type: 'telegram',
    headers: { 'x-telegram-bot-api-secret-token': secret },
    payload: update,
  };
}

describe('Telegram transport', () => {
  it('connects one channel per type and frees the type again after disconnecting', async () => {
    const f = await setup(async () => Response.json({ ok: true }));

    try {
      await expect(
        f.channels.connect(f.profile.id, { type: 'telegram', botToken: '123:other' }),
      ).rejects.toThrow('already connected');

      await expect(f.channels.connect(f.profile.id, { type: 'telegram' })).rejects.toThrow();

      await f.channels.revoke(f.profile.id, f.channel.id);

      const replacement = await f.channels.connect(f.profile.id, {
        type: 'telegram',
        botToken: '123:synthetic-replacement',
      });

      expect(replacement.id).not.toBe(f.channel.id);
      expect(replacement.webhookToken).not.toBe(f.channel.webhookToken);
      expect((await f.channels.list(f.profile.id)).filter((item) => !item.revokedAt)).toHaveLength(
        1,
      );
    } finally {
      await f.app.close();
    }
  });

  it('holds an unknown sender out of the profile and warns them only once', async () => {
    const sent: string[] = [];

    const f = await setup(async (_url, options) => {
      sent.push(String(options?.body));

      return Response.json({ ok: true, result: { message_id: 5 } });
    });

    try {
      const denied = await f.app.inject({ method: 'POST', url: f.url, payload: update });
      expect(denied.statusCode).toBe(401);

      const first = await f.app.inject({
        method: 'POST',
        url: f.url,
        headers: f.headers,
        payload: update,
      });

      expect(first.json()).toEqual({ accepted: false, contact: 'pending' });

      await f.app.inject({ method: 'POST', url: f.url, headers: f.headers, payload: later });

      const contacts = await f.channels.contacts(f.profile.id);

      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({
        status: 'pending',
        actorId: '42',
        displayName: 'Ada',
        message: 'Hello\n\nStill there?',
      });

      expect(await f.services.sessions.sessions(f.profile.id)).toEqual([]);
      expect(await f.services.runs.activities(f.profile.id)).toEqual([]);

      await f.channels.dispatch();
      await f.channels.dispatch();

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0] as string).chat_id).toBe('99');
      expect(JSON.parse(sent[0] as string).text).toContain('approve');
    } finally {
      await f.app.close();
    }
  });

  it('releases the waiting message once when the owner approves, and blocks silently', async () => {
    const sent: string[] = [];

    const f = await setup(async (_url, options) => {
      sent.push(String(options?.body));

      return Response.json({ ok: true, result: { message_id: 5 } });
    });

    try {
      await f.channels.receive(f.channel.id, webhook(f.channel.webhookToken));

      const [pending] = await f.channels.contacts(f.profile.id);
      if (!pending) throw new Error('Contact request missing');

      const approved = await f.channels.approveContact(f.profile.id, pending.id);

      expect(approved.status).toBe('approved');
      expect(approved.message).toBeUndefined();
      expect(approved.sessionId).toBeDefined();

      const runs = await f.services.runs.activities(f.profile.id);

      expect(runs).toHaveLength(1);
      expect(runs[0]?.input).toBe('Hello');
      expect(runs[0]?.sessionId).toBe(approved.sessionId);

      await f.channels.approveContact(f.profile.id, pending.id);
      expect(await f.services.runs.activities(f.profile.id)).toHaveLength(1);

      const replay = await f.app.inject({
        method: 'POST',
        url: f.url,
        headers: f.headers,
        payload: update,
      });

      expect(replay.json()).toEqual({ accepted: true, runId: runs[0]?.id, contact: 'approved' });

      const runId = runs[0]?.id as string;
      await f.services.lifecycle.claim(runId, f.profile.id, 'worker');
      await f.services.lifecycle.finish(f.profile.id, runId, 'worker', 'completed', 'Hi');
      await Promise.all([f.channels.dispatch(), f.channels.dispatch()]);

      expect(sent.map((body) => JSON.parse(body).text)).toEqual([
        expect.stringContaining('approve'),
        'Hi',
      ]);

      await f.channels.blockContact(f.profile.id, pending.id);

      const afterBlock = await f.app.inject({
        method: 'POST',
        url: f.url,
        headers: f.headers,
        payload: { ...later, update_id: 200 },
      });

      expect(afterBlock.json()).toEqual({ accepted: false, contact: 'blocked' });
      await f.channels.dispatch();
      expect(sent).toHaveLength(2);
    } finally {
      await f.app.close();
    }
  });

  it('keeps contact decisions administrative and inside their own profile', async () => {
    const f = await setup(async () => Response.json({ ok: true }));

    try {
      await f.channels.receive(f.channel.id, webhook(f.channel.webhookToken));
      const [pending] = await f.channels.contacts(f.profile.id);
      if (!pending) throw new Error('Contact request missing');

      // Approving is granting access to the agent, so only the host token may do it.
      const stranger = { authorization: `Bearer ${token}-wrong` };
      const base = `/v1/profiles/${f.profile.id}/contacts`;

      expect((await f.app.inject({ url: base, headers: stranger })).statusCode).toBe(401);

      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: `${base}/${pending.id}/approve`,
            headers: stranger,
          })
        ).statusCode,
      ).toBe(401);

      const other = await f.services.profiles.createProfile({
        name: 'Other',
        instructions: 'Help',
        model: f.profile.model,
      });

      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: `/v1/profiles/${other.id}/contacts/${pending.id}/approve`,
            headers: admin,
          })
        ).statusCode,
      ).toBe(404);

      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: `${base}/${randomUUID()}/block`,
            headers: admin,
          })
        ).statusCode,
      ).toBe(404);

      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: `${base}/${pending.id}/approve`,
            headers: admin,
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await f.app.close();
    }
  });

  it.each([0, 1])(
    'does not resend after an uncertain delivery with %i confirmed chunks',
    async (confirmedChunks) => {
      let attempts = 0;

      const f = await setup(async () => {
        attempts += 1;

        if (attempts <= confirmedChunks + 1) {
          return Response.json({ ok: true, result: { message_id: 5 } });
        }

        throw new Error('Connection closed after remote write');
      });

      try {
        await f.channels.receive(f.channel.id, webhook(f.channel.webhookToken));
        const [pending] = await f.channels.contacts(f.profile.id);
        if (!pending) throw new Error('Contact request missing');

        await f.channels.approveContact(f.profile.id, pending.id);
        // The approval notice is the first confirmed send; the reply follows it.
        await f.channels.dispatch();

        const [run] = await f.services.runs.activities(f.profile.id);
        if (!run) throw new Error('Run missing');

        await f.services.lifecycle.claim(run.id, f.profile.id, 'worker');
        await f.services.lifecycle.finish(
          f.profile.id,
          run.id,
          'worker',
          'completed',
          'x'.repeat(4001),
        );
        await f.channels.dispatch();
        await f.channels.dispatch();

        expect(attempts).toBe(confirmedChunks + 2);
        expect(
          (await f.channels.deliveries(f.profile.id)).find((item) => item.runId === run.id),
        ).toMatchObject({
          status: 'unknown',
          remoteMessageIds: confirmedChunks ? [5] : [],
        });
      } finally {
        await f.app.close();
      }
    },
  );
});
