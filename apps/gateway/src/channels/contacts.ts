import { randomUUID } from 'node:crypto';
import type { contactSchema } from '@jian/contracts';
import type { z } from 'zod';
import { type Clock, nowIso } from '../core/clock.js';
import { assertFound } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Reader, Store, Transaction } from '../core/store.js';
import type { ProfileReader } from '../profiles/port.js';
import type { SessionWriter } from '../sessions/port.js';
import type { ChannelType, IncomingMessage } from './channel.js';

/**
 * `requestKey` stays out of the contract: it is the protocol's message ID, not owner-facing.
 * So do the two counters a room keeps — the agent turns spent since a person wrote, and the
 * message ids already observed, which is what stops a redelivery from spending another turn.
 */
export type ContactRecord = z.infer<typeof contactSchema> & {
  requestKey?: string;
  agentTurns?: number;
  seen?: string[];
};

export type Contact = z.infer<typeof contactSchema>;

export type Intake =
  | { status: 'approved'; contact: ContactRecord }
  | { status: 'pending'; announce: boolean }
  | { status: 'blocked' };

/** The held text is released as one message, so it stays inside the run input limit. */
const MAX_HELD_CHARACTERS = 8000;

const names: Record<ChannelType, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  api: 'API',
};

type ContactServices = {
  profiles: ProfileReader;
  sessions: SessionWriter;
  store: Store;
};

/** Who may talk to the agent, decided by the owner and never by the sender. */
export class Contacts {
  constructor(
    private readonly services: ContactServices,
    private readonly clock: Clock = Date.now,
  ) {}

  private title(contact: Pick<ContactRecord, 'type' | 'scope' | 'actorId' | 'displayName'>) {
    const who = `${contact.scope === 'group' ? 'Grupo ' : ''}${contact.displayName ?? contact.actorId}`;

    return `${names[contact.type]} · ${who}`.slice(0, 160);
  }

  /** The owner-facing shape of a contact. */
  view({ requestKey: _key, agentTurns: _turns, seen: _seen, ...contact }: ContactRecord): Contact {
    return contact;
  }

  async read(profileId: string, id: string, reader: Reader = this.services.store) {
    const contact = await reader.get('contact', id);

    return assertFound(contact?.profileId === profileId ? contact : null, 'Contact');
  }

  private async openSession(tx: Transaction, contact: ContactRecord) {
    const session = await this.services.sessions.createSession(
      contact.profileId,
      { title: this.title(contact), channel: contact.type },
      tx,
    );

    return session.id;
  }

  /**
   * Runs inside the channel transaction so that a burst from one stranger produces exactly one
   * request: the second message finds the record the first one wrote. A group is one request
   * for the whole room — the owner decides about the conversation, not about each participant.
   */
  async intake(
    tx: Transaction,
    channel: { id: string; profileId: string; type: ChannelType },
    message: IncomingMessage,
  ): Promise<Intake> {
    const profileId = channel.profileId;
    const now = nowIso(this.clock);
    const group = message.scope === 'group';

    const existing = (
      await tx.list('contact', {
        profileId,
        where: group
          ? { channelId: channel.id, scope: 'group', chatId: message.chatId }
          : { channelId: channel.id, scope: 'direct', actorId: message.actorId },
        limit: 1,
      })
    )[0];

    if (!existing) {
      const name = group ? message.groupName : message.displayName;

      const contact: ContactRecord = {
        id: randomUUID(),
        profileId,
        channelId: channel.id,
        type: channel.type,
        scope: message.scope,
        // The room is the identity of a group contact: whoever writes there is the same request.
        actorId: group ? message.chatId : message.actorId,
        chatId: message.chatId,
        ...(name ? { displayName: name } : {}),
        status: 'pending',
        // Nothing is held for a room. Releasing it on approval would answer a message that
        // named nobody, which is exactly what a group with several agents must not do.
        ...(group ? {} : { message: message.text, requestKey: message.requestKey }),
        createdAt: now,
        updatedAt: now,
      };

      await tx.put('contact', contact.id, profileId, contact);
      await recordEvent(tx, this.clock, profileId, 'contact.requested', this.view(contact));

      return { status: 'pending', announce: !group };
    }

    if (existing.status === 'blocked') {
      return { status: 'blocked' };
    }

    // A waiting stranger is told once, and what they keep writing is appended to the same
    // request instead of producing another one. No event is recorded for those later messages:
    // nothing a stranger sends may drive an automatic reply or a panel update in a loop.
    if (existing.status === 'pending') {
      const held = existing.message ? `${existing.message}\n\n${message.text}` : message.text;

      if (!group && held !== existing.message && held.length <= MAX_HELD_CHARACTERS) {
        await tx.put('contact', existing.id, profileId, {
          ...existing,
          message: held,
          updatedAt: now,
        });
      }

      return { status: 'pending', announce: false };
    }

    // A renamed room keeps its request: the owner approved the conversation, not its subject.
    const renamed =
      group && message.groupName && message.groupName !== existing.displayName
        ? { displayName: message.groupName }
        : {};

    const current = { ...existing, ...renamed };

    if (current.sessionId && (await tx.get('session', current.sessionId))) {
      if (Object.keys(renamed).length) {
        await tx.put('contact', current.id, profileId, { ...current, updatedAt: now });
      }

      return { status: 'approved', contact: current };
    }

    const contact: ContactRecord = {
      ...current,
      sessionId: await this.openSession(tx, current),
      updatedAt: now,
    };

    await tx.put('contact', contact.id, profileId, contact);

    return { status: 'approved', contact };
  }

  async list(profileId: string) {
    await this.services.profiles.profile(profileId);

    // Newest first, so a fresh request is never the one a full page leaves out.
    const contacts = await this.services.store.list('contact', {
      profileId,
      limit: 200,
      descending: true,
    });

    return contacts
      .map((contact) => this.view(contact))
      .sort(
        (a, b) =>
          Number(b.status === 'pending') - Number(a.status === 'pending') ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
  }

  async approve(profileId: string, id: string): Promise<ContactRecord> {
    return this.services.store.transaction(profileId, async (tx) => {
      const current = await this.read(profileId, id, tx);

      if (current.status === 'approved') {
        return current;
      }

      const contact: ContactRecord = {
        ...current,
        status: 'approved',
        sessionId: current.sessionId ?? (await this.openSession(tx, current)),
        updatedAt: nowIso(this.clock),
      };

      await tx.put('contact', id, profileId, contact);
      await recordEvent(tx, this.clock, profileId, 'contact.approved', this.view(contact));

      return contact;
    });
  }

  async block(profileId: string, id: string): Promise<Contact> {
    return this.services.store.transaction(profileId, async (tx) => {
      const current = await this.read(profileId, id, tx);

      const contact: ContactRecord = {
        ...current,
        status: 'blocked',
        message: undefined,
        requestKey: undefined,
        updatedAt: nowIso(this.clock),
      };

      await tx.put('contact', id, profileId, contact);
      await recordEvent(tx, this.clock, profileId, 'contact.blocked', this.view(contact));

      return this.view(contact);
    });
  }

  /** Releasing the held message is not repeatable: the text is dropped once it reached a run. */
  async release(profileId: string, id: string): Promise<Contact> {
    return this.services.store.transaction(profileId, async (tx) => {
      const current = await this.read(profileId, id, tx);
      const contact: ContactRecord = {
        ...current,
        message: undefined,
        requestKey: undefined,
        updatedAt: nowIso(this.clock),
      };

      await tx.put('contact', id, profileId, contact);

      return this.view(contact);
    });
  }
}
