import { describe, expect, it } from 'vitest';
import type { ChannelRequest } from '../src/channels/channel.js';
import { Channels } from '../src/channels/service.js';
import { Errands } from '../src/errands/service.js';
import { testServices } from './helpers/services.js';

const sent: Array<{ chatId: string; text: string }> = [];

/** A Telegram that accepts everything and records what it was asked to deliver. */
const telegram: typeof fetch = async (url, options) => {
  const path = String(url).split('/').pop() ?? '';
  const body = JSON.parse(String(options?.body ?? '{}')) as { chat_id?: string; text?: string };

  if (path === 'sendMessage') {
    sent.push({ chatId: String(body.chat_id), text: String(body.text) });
  }

  return Response.json({ ok: true, result: { message_id: sent.length, id: 700 } });
};

function update(from: number, chat: number, text: string, id: number): ChannelRequest['payload'] {
  return {
    update_id: id,
    message: { from: { id: from, first_name: 'Moabe' }, chat: { id: chat }, text },
  };
}

async function setup() {
  sent.length = 0;

  const services = await testServices();
  const channels = new Channels(services, telegram);

  const profile = await services.profiles.createProfile({
    name: 'Atlas',
    instructions: 'Help.',
    model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
  });

  const channel = await channels.connect(profile.id, {
    type: 'telegram',
    botToken: '123:synthetic-test-token',
  });

  const webhook = (payload: ChannelRequest['payload']): ChannelRequest => ({
    type: 'telegram',
    headers: { 'x-telegram-bot-api-secret-token': channel.webhookToken },
    payload,
  });

  // Moabe writes first and the owner approves him, which is the only way to become reachable.
  await channels.receive(channel.id, webhook(update(77, 77, 'Oi', 1)));

  const [pending] = await channels.contacts(profile.id);
  if (!pending) throw new Error('Contact request missing');

  const moabe = await channels.approveContact(profile.id, pending.id);

  // His first message started a run of its own; a session holds one at a time, so it is
  // closed before the test sends anything else.
  for (const run of await services.runs.activities(profile.id)) {
    await services.lifecycle.claim(run.id, profile.id, 'worker');
    await services.lifecycle.finish(profile.id, run.id, 'worker', 'completed', 'Oi, Moabe.');
  }

  // The owner's own conversation, which is what the question is asked on behalf of.
  const owner = await services.sessions.createSession(profile.id, { title: 'Dono' });

  return { services, channels, profile, moabe, owner, webhook, channel };
}

describe('asking a contact and bringing the answer back', () => {
  it('delivers the question, then turns the reply into a turn in the asking conversation', async () => {
    const { services, channels, profile, moabe, owner, webhook, channel } = await setup();
    const errands = new Errands(services.store);

    const asked = await errands.ask(
      profile.id,
      moabe.id,
      owner.id,
      'O deploy de sexta pode sair?',
      true,
    );

    expect(asked.errandId).toBeDefined();

    await channels.dispatch();
    expect(sent.at(-1)).toMatchObject({ chatId: '77', text: 'O deploy de sexta pode sair?' });

    const before = await services.sessions.messages(profile.id, owner.id, 10);

    await channels.receive(channel.id, webhook(update(77, 77, 'Pode sim, liberado.', 2)));

    // The reply starts a run where the question came from, not in Moabe's own conversation.
    const runs = await services.runs.activities(profile.id);
    const relayed = runs.find((run) => run.sessionId === owner.id);

    expect(relayed?.input).toContain('Pode sim, liberado.');
    expect(relayed?.input).toContain('O deploy de sexta pode sair?');
    // His reply is consumed as the answer, so it starts nothing in his own conversation.
    expect(runs.filter((run) => run.sessionId === moabe.sessionId)).toHaveLength(0);
    expect(before).toHaveLength(0);
  });

  it('refuses a second open question to the same contact', async () => {
    const { services, profile, moabe, owner } = await setup();
    const errands = new Errands(services.store);

    await errands.ask(profile.id, moabe.id, owner.id, 'Primeira?', true);

    await expect(errands.ask(profile.id, moabe.id, owner.id, 'Segunda?', true)).rejects.toThrow(
      'unanswered',
    );
  });

  it('sends without waiting when no reply is expected', async () => {
    const { services, channels, profile, moabe, owner, webhook, channel } = await setup();
    const errands = new Errands(services.store);

    const asked = await errands.ask(profile.id, moabe.id, owner.id, 'Só avisando.', false);

    expect(asked.errandId).toBeUndefined();
    await channels.dispatch();
    expect(sent.at(-1)?.text).toBe('Só avisando.');

    await channels.receive(channel.id, webhook(update(77, 77, 'Valeu', 3)));

    // Nobody was waiting, so his message is a turn in his own conversation as usual.
    const runs = await services.runs.activities(profile.id);

    expect(runs.some((run) => run.sessionId === moabe.sessionId)).toBe(true);
    expect(runs.some((run) => run.sessionId === owner.id)).toBe(false);
  });

  it('only lists approved contacts, and says who it is waiting on', async () => {
    const { services, profile, moabe, owner } = await setup();
    const errands = new Errands(services.store);

    expect(await errands.reachable(profile.id)).toEqual([
      { id: moabe.id, name: expect.any(String), channel: 'telegram', waitingOnThem: false },
    ]);

    await errands.ask(profile.id, moabe.id, owner.id, 'E aí?', true);

    expect((await errands.reachable(profile.id))[0]?.waitingOnThem).toBe(true);
  });
});
