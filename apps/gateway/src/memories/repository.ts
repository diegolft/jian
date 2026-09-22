import type { Memory } from '@jian/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Queryable } from '../storage/database.js';
import { memories } from '../storage/schema.js';

type Row = typeof memories.$inferSelect;

/** The contract addresses a memory by one string; the table keys it by profile and key. */
export const memoryId = (profileId: string, key: string) => `${profileId}:${key}`;

export function toMemory(row: Row): Memory {
  return {
    id: memoryId(row.profileId, row.key),
    profileId: row.profileId,
    key: row.key,
    content: row.content,
    version: row.version,
    ...(row.sourceSessionId ? { sourceSessionId: row.sourceSessionId } : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMemories(
  db: Queryable,
  profileId: string,
  limit = 100,
): Promise<Memory[]> {
  const rows = await db
    .select()
    .from(memories)
    .where(eq(memories.profileId, profileId))
    .orderBy(desc(memories.updatedAt))
    .limit(limit);

  return rows.map(toMemory);
}

export async function findMemory(
  db: Queryable,
  profileId: string,
  key: string,
): Promise<Memory | null> {
  const [row] = await db
    .select()
    .from(memories)
    .where(and(eq(memories.profileId, profileId), eq(memories.key, key)))
    .limit(1);

  return row ? toMemory(row) : null;
}

/**
 * Whatever mentions any of the words. The vector repeats the `memories_search` expression
 * verbatim — a different one is a different expression, and Postgres then scans the table.
 * Each word becomes its own `plainto_tsquery`, OR-ed into one query, so a word carrying
 * tsquery punctuation is text to match rather than syntax to parse.
 */
export async function searchMemories(
  db: Queryable,
  profileId: string,
  words: string[],
  limit = 100,
): Promise<Memory[]> {
  if (words.length === 0) {
    return [];
  }

  const query = sql.join(
    words.map((word) => sql`plainto_tsquery('simple', ${word})`),
    sql` || `,
  );

  const rows = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.profileId, profileId),
        sql`to_tsvector('simple', ${memories.key} || ' ' || ${memories.content}) @@ (${query})`,
      ),
    )
    .orderBy(desc(memories.updatedAt))
    .limit(limit);

  return rows.map(toMemory);
}

/**
 * The write behind the version check. An absent key is an insert, which the primary key lets
 * happen once; a present one is updated only while it still carries the version that was read.
 * A race lost between the read and the write touches nothing and returns false, so the caller
 * reports the same conflict it would have reported from the read.
 */
export async function writeMemory(
  db: Queryable,
  memory: Memory,
  expectedVersion: number,
): Promise<boolean> {
  const values = {
    profileId: memory.profileId,
    key: memory.key,
    content: memory.content,
    version: memory.version,
    sourceSessionId: memory.sourceSessionId ?? null,
    updatedAt: new Date(memory.updatedAt),
  };

  const written = await db
    .insert(memories)
    .values(values)
    .onConflictDoUpdate({
      target: [memories.profileId, memories.key],
      set: {
        content: values.content,
        version: values.version,
        sourceSessionId: values.sourceSessionId,
        updatedAt: values.updatedAt,
      },
      setWhere: eq(memories.version, expectedVersion),
    })
    .returning({ key: memories.key });

  return written.length > 0;
}

export async function deleteMemory(db: Queryable, profileId: string, key: string): Promise<void> {
  await db.delete(memories).where(and(eq(memories.profileId, profileId), eq(memories.key, key)));
}
