import { randomUUID } from 'node:crypto';
import { AGENT_SESSION_CHANNEL, type Profile, type Session, sessionSchema } from '@jian/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { assertFound } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Queryable, Store } from '../storage/database.js';
import {
  findPeerSession,
  findSession,
  insertSession,
  listSessionMessages,
  listSessions,
} from './repository.js';

/** The lookup a session needs from profiles, reading through whatever transaction it is given. */
type ProfileLookup = {
  profile(id: string, reader?: Queryable): Promise<Profile>;
};

export class Sessions {
  constructor(
    private readonly store: Store,
    private readonly profiles: ProfileLookup,
    private readonly clock: Clock = Date.now,
  ) {}

  /** A caller already inside a profile transaction passes it in: this store never nests locks. */
  async createSession(profileId: string, input: unknown, transaction?: Queryable) {
    const data = sessionSchema.parse(input);

    const write = async (tx: Queryable) => {
      await this.profiles.profile(profileId, tx);

      const session: Session = {
        ...data,
        id: randomUUID(),
        profileId,
        createdAt: nowIso(this.clock),
      };

      await insertSession(tx, session);
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
    transaction?: Queryable,
  ) {
    const open = async (tx: Queryable) => {
      const existing = await findPeerSession(tx, profileId, peerProfileId);

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

      await insertSession(tx, session);
      await recordEvent(tx, this.clock, profileId, 'session.created', session);

      return session;
    };

    return transaction ? open(transaction) : this.store.transaction(profileId, open);
  }

  /** Belonging to the profile is a condition of the read, so another profile's session is a 404. */
  async session(profileId: string, sessionId: string, reader: Queryable = this.store.db) {
    return assertFound(await findSession(reader, profileId, sessionId), 'Session');
  }

  async sessions(profileId: string) {
    await this.profiles.profile(profileId);

    return listSessions(this.store.db, profileId, 100);
  }

  async messages(profileId: string, sessionId: string, limit = 100) {
    await this.session(profileId, sessionId);

    return listSessionMessages(this.store.db, sessionId, limit);
  }
}
