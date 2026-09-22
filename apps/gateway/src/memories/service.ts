import { type Memory, memoryKeySchema, memorySchema } from '@jian/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { assertFound, GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Store } from '../core/store.js';
import type { ProfileReader } from '../profiles/port.js';
import type { SessionReader } from '../sessions/port.js';

export class Memories {
  constructor(
    private readonly store: Store,
    private readonly profiles: ProfileReader,
    private readonly sessions: SessionReader,
    private readonly clock: Clock = Date.now,
  ) {}

  async memories(profileId: string) {
    await this.profiles.profile(profileId);

    return this.store.list('memory', { profileId, descending: true, limit: 100 });
  }

  async remember(profileId: string, input: unknown, sourceSessionId?: string) {
    const { expectedVersion, ...data } = memorySchema.parse(input);

    return this.store.transaction(profileId, async (tx) => {
      await this.profiles.profile(profileId, tx);

      if (sourceSessionId) {
        await this.sessions.session(profileId, sourceSessionId, tx);
      }

      const id = `${profileId}:${data.key}`;
      const old = await tx.get('memory', id);

      if ((old?.version ?? 0) !== expectedVersion) {
        throw new GatewayError(409, 'Memory version changed; reload before editing');
      }

      const memory: Memory = {
        ...data,
        id,
        profileId,
        version: expectedVersion + 1,
        sourceSessionId,
        updatedAt: nowIso(this.clock),
      };

      await tx.put('memory', id, profileId, memory);

      await recordEvent(tx, this.clock, profileId, 'memory.updated', {
        key: memory.key,
        version: memory.version,
        sourceSessionId,
      });

      return memory;
    });
  }

  /**
   * The owner cannot write a memory, but must be able to take a wrong one off the shelf: an
   * agent that keeps reading it repeats the same mistake in every new session.
   */
  async forget(profileId: string, key: unknown) {
    const memoryKey = memoryKeySchema.parse(key);

    return this.store.transaction(profileId, async (tx) => {
      await this.profiles.profile(profileId, tx);

      const id = `${profileId}:${memoryKey}`;
      const stored = await tx.get('memory', id);
      const memory = assertFound(stored?.profileId === profileId ? stored : null, 'Memory');

      await tx.remove('memory', id, profileId);

      await recordEvent(tx, this.clock, profileId, 'memory.forgotten', {
        key: memory.key,
        version: memory.version,
      });

      return memory;
    });
  }
}
