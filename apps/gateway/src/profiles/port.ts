import type { Profile } from '@elos/contracts';
import type { Reader } from '../core/store.js';

/** Passing a reader keeps the lookup inside the caller's open transaction. */
export interface ProfileReader {
  profile(id: string, reader?: Reader): Promise<Profile>;
}

export interface ProfileAdmin extends ProfileReader {
  profiles(): Promise<Profile[]>;
  createProfile(input: unknown): Promise<Profile>;
  updateProfile(id: string, input: unknown): Promise<Profile>;
}
