import type { Message, Session } from '@jian/contracts';
import type { Queryable } from '../storage/database.js';

export interface SessionReader {
  session(profileId: string, sessionId: string, reader?: Queryable): Promise<Session>;
  sessions(profileId: string): Promise<Session[]>;
  messages(profileId: string, sessionId: string, limit?: number): Promise<Message[]>;
}

export interface SessionWriter extends SessionReader {
  createSession(profileId: string, input: unknown, transaction?: Queryable): Promise<Session>;
}

/** The session two agents share. Held apart from `SessionWriter`: only peer calls open one. */
export interface PeerSessions {
  peerSession(
    profileId: string,
    peerProfileId: string,
    title: string,
    transaction?: Queryable,
  ): Promise<Session>;
}
