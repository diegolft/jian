import type { Run } from '@elos/contracts';
import type { Store } from '../core/store.js';
import type { Runs } from '../runs/service.js';
import type { Sessions } from '../sessions/service.js';
import { buildContext } from './build.js';

export class Contexts {
  constructor(
    private readonly store: Store,
    private readonly runs: Runs,
    private readonly sessions: Sessions,
  ) {}

  async context(run: Run) {
    const words = [...new Set(run.input.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(
      0,
      12,
    );

    const [memories, activities, history] = await Promise.all([
      words.length
        ? this.store.list('memory', {
            profileId: run.profileId,
            anyWords: words,
            limit: 100,
            descending: true,
          })
        : Promise.resolve([]),
      this.runs.activities(run.profileId),
      this.sessions.messages(run.profileId, run.sessionId, 40),
    ]);

    return buildContext(run, { memories, activities, history });
  }
}
