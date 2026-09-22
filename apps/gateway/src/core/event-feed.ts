import type { GatewayEvent } from '@jian/contracts';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Queryable } from '../storage/database.js';
import { events } from '../storage/schema.js';

/** Everything a profile recorded after a cursor, oldest first, so a client can resume. */
export async function readEvents(
  db: Queryable,
  profileId: string,
  after: number,
  limit = 100,
): Promise<GatewayEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.profileId, profileId), gt(events.id, after)))
    .orderBy(asc(events.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    profileId: row.profileId,
    ...(row.runId ? { runId: row.runId } : {}),
    type: row.type,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
  }));
}
