import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { Database, Queryable, Store } from './database.js';
import { MIGRATION_LOCK, migrationsFolder } from './database.js';
import * as schema from './schema.js';

export class PostgresStore implements Store {
  private readonly pool: Pool;
  private readonly client: ReturnType<typeof drizzle<typeof schema>>;
  readonly db: Database;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
    this.client = drizzle(this.pool, { schema, casing: 'snake_case' });
    this.db = this.client as unknown as Database;
  }

  async migrate(): Promise<void> {
    const connection = await this.pool.connect();

    try {
      // Held for the whole run and released with the session, so a worker that dies mid
      // migration does not leave the next one waiting forever.
      await connection.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
      await migrate(this.client, { migrationsFolder });
    } finally {
      await connection.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
      connection.release();
    }
  }

  async transaction<T>(profileId: string, body: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.client.transaction(async (tx) => {
      // Hashed to a bigint because an advisory lock takes numbers, not a uuid.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${profileId}, 0))`);

      return body(tx as unknown as Queryable);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
