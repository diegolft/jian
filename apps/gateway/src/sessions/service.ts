import { randomUUID } from 'node:crypto';
import { AGENT_SESSION_CHANNEL, type Session, sessionSchema } from '@jian/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { assertFound } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Reader, Store, Transaction } from '../core/store.js';
import type { ProfileReader } from '../profiles/port.js';

export class Sessions {
  constructor(
    private readonly store: Store,
    private readonly profiles: ProfileReader,
    private readonly clock: Clock = Date.now,
  ) {}

  /** A caller already inside a profile transaction passes it in: this store never nests locks. */
  async createSession(profileId: string, input: unknown, transaction?: Transaction) {
    const data = sessionSchema.parse(input);

    const write = async (tx: Transaction) => {
      await this.profiles.profile(profileId, tx);

      const session: Session = {
        ...data,
        id: randomUUID(),
        profileId,
        createdAt: nowIso(this.clock),
      };

      await tx.put('session', session.id, profileId, session);
      await recordEvent(tx, this.clock, profileId, 'session.created', session);

      return session;
    };

    return transaction ? write(transaction) : this.store.transaction(profileId, write);
  }

  /**
   * The one session a pair of agents shares, found or opened on the called profile's side, so
   * colleagues keep continuity instead of restarting at every request. It is a session of this
   * profile like any other: the peer cannot read it, and `peerProfileId` is not writable
   * through the public session input, so only a peer call can open one.
   */
  async peerSession(
    profileId: string,
    peerProfileId: string,
    title: string,
    transaction?: Transaction,
  ) {
    const open = async (tx: Transaction) => {
      const existing = (
        await tx.list('session', {
          profileId,
          where: { channel: AGENT_SESSION_CHANNEL, peerProfileId },
          limit: 1,
        })
      )[0];

      if (existing) {
        return existing;
      }

      await this.profiles.profile(profileId, tx);

      const session: Session = {
        ...sessionSchema.parse({ title, channel: AGENT_SESSION_CHANNEL }),
        id: randomUUID(),
        profileId,
        peerProfileId,
        createdAt: nowIso(this.clock),
      };

      await tx.put('session', session.id, profileId, session);
      await recordEvent(tx, this.clock, profileId, 'session.created', session);

      return session;
    };

    return transaction ? open(transaction) : this.store.transaction(profileId, open);
  }

  async session(profileId: string, sessionId: string, reader: Reader = this.store) {
    const session = await reader.get('session', sessionId);

    return assertFound(session?.profileId === profileId ? session : null, 'Session');
  }

  async sessions(profileId: string) {
    await this.profiles.profile(profileId);

    return this.store.list('session', { profileId, descending: true, limit: 100 });
  }

  async messages(profileId: string, sessionId: string, limit = 100) {
    await this.session(profileId, sessionId);

    return (
      await this.store.list('message', { profileId, where: { sessionId }, limit, descending: true })
    ).reverse();
  }
}
