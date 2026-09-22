import type { Message, Session } from '@elos/contracts';
import type { Reader } from '../core/store.js';

export interface SessionReader {
  session(profileId: string, sessionId: string, reader?: Reader): Promise<Session>;
  sessions(profileId: string): Promise<Session[]>;
  messages(profileId: string, sessionId: string, limit?: number): Promise<Message[]>;
}

export interface SessionWriter extends SessionReader {
  createSession(profileId: string, input: unknown): Promise<Session>;
}
