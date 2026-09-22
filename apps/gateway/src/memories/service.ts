import { type Memory, memoryKeySchema, memorySchema } from '@jian/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { assertFound, GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { ProfileReader } from '../profiles/port.js';
import type { SessionReader } from '../sessions/port.js';
import type { Store } from '../storage/database.js';
import { deleteMemory, findMemory, listMemories, memoryId, writeMemory } from './repository.js';

export class Memories {
  constructor(
    private readonly store: Store,
    private readonly profiles: ProfileReader,
    private readonly sessions: SessionReader,
    private readonly clock: Clock = Date.now,
  ) {}

  async memories(profileId: string) {
    await this.profiles.profile(profileId);

    return listMemories(this.store.db, profileId);
  }

  async remember(profileId: string, input: unknown, sourceSessionId?: string) {
    const { expectedVersion, ...data } = memorySchema.parse(input);

    return this.store.transaction(profileId, async (tx) => {
      await this.profiles.profile(profileId, tx);

      if (sourceSessionId) {
        await this.sessions.session(profileId, sourceSessionId, tx);
      }

      const old = await findMemory(tx, profileId, data.key);

      if ((old?.version ?? 0) !== expectedVersion) {
        throw new GatewayError(409, 'Memory version changed; reload before editing');
      }

      const memory: Memory = {
        ...data,
        id: memoryId(profileId, data.key),
        profileId,
        version: expectedVersion + 1,
        sourceSessionId,
        updatedAt: nowIso(this.clock),
      };

      // The row can only have moved on under a writer outside this profile's lock; the guard
      // is the table's, so the answer is the conflict either way.
      if (!(await writeMemory(tx, memory, expectedVersion))) {
        throw new GatewayError(409, 'Memory version changed; reload before editing');
      }

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

      const memory = assertFound(await findMemory(tx, profileId, memoryKey), 'Memory');

      await deleteMemory(tx, profileId, memoryKey);

      await recordEvent(tx, this.clock, profileId, 'memory.forgotten', {
        key: memory.key,
        version: memory.version,
      });

      return memory;
    });
  }
}
