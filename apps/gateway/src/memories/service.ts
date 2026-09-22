import { type Memory, memorySchema } from '@elos/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Store } from '../core/store.js';
import type { Profiles } from '../profiles/service.js';
import type { Sessions } from '../sessions/service.js';

export class Memories {
  constructor(
    private readonly store: Store,
    private readonly profiles: Profiles,
    private readonly sessions: Sessions,
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
}
