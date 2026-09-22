import type { Clock } from './clock.js';
import { nowIso } from './clock.js';
import type { Transaction } from './store.js';

export async function recordEvent(
  tx: Transaction,
  clock: Clock,
  profileId: string,
  type: string,
  data: unknown,
  runId?: string,
): Promise<void> {
  await tx.event({ profileId, type, data, runId, createdAt: nowIso(clock) });
}
