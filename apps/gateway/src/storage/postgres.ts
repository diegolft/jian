import { Pool, type PoolClient } from 'pg';
import type { Reader, Selection, Store, Transaction } from '../core/store.js';
import type { GatewayEvent, Kind, Records } from '../records.js';
import { migrations } from './migrations.js';

class PostgresReader implements Reader {
  constructor(protected readonly connection: Pick<Pool, 'query'> | PoolClient) {}

  async get<K extends Kind>(kind: K, id: string): Promise<Records[K] | null> {
    const result = await this.connection.query<{ data: Records[K] }>(
      'SELECT data FROM jian_records WHERE kind = $1 AND id = $2',
      [kind, id],
    );

    return result.rows[0]?.data ?? null;
  }

  async list<K extends Kind>(kind: K, options: Selection = {}): Promise<Records[K][]> {
    const values: unknown[] = [kind];
    const conditions = ['kind = $1'];

    if (options.profileId) {
      values.push(options.profileId);
      conditions.push(`profile_id = $${values.length}`);
    }

    if (options.where) {
      values.push(JSON.stringify(options.where));
      conditions.push(`data @> $${values.length}::jsonb`);
    }

    if (options.before) {
      values.push(options.before);

      conditions.push(
        `seq < (SELECT seq FROM jian_records WHERE kind = $1 AND id = $${values.length})`,
      );
    }

    if (options.anyWords?.length) {
      const words = options.anyWords
        .flatMap((word) => word.match(/[\p{L}\p{N}]+/gu) ?? [])
        .slice(0, 12);

      if (words.length) {
        values.push(words.join(' | '));

        conditions.push(
          `to_tsvector('simple', COALESCE(data->>'key', '') || ' ' || COALESCE(data->>'content', '')) @@ to_tsquery('simple', $${values.length})`,
        );
      }
    }

    if (options.search) {
      values.push(options.search);

      conditions.push(
        `to_tsvector('simple', COALESCE(data->>'key', '') || ' ' || COALESCE(data->>'content', '')) @@ plainto_tsquery('simple', $${values.length})`,
      );
    }

    values.push(Math.max(1, Math.min(options.limit ?? 100, 1000)));

    const result = await this.connection.query<{ data: Records[K] }>(
      `SELECT data FROM jian_records WHERE ${conditions.join(' AND ')} ORDER BY seq ${options.descending ? 'DESC' : 'ASC'} LIMIT $${values.length}`,
      values,
    );

    return result.rows.map((row) => row.data);
  }

  async events(profileId: string, after: number, limit = 100): Promise<GatewayEvent[]> {
    const result = await this.connection.query<{
      id: string;
      profile_id: string;
      run_id: string | null;
      type: string;
      data: unknown;
      created_at: Date;
    }>('SELECT * FROM jian_events WHERE profile_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3', [
      profileId,
      after,
      Math.min(limit, 1000),
    ]);

    return result.rows.map((r) => ({
      id: Number(r.id),
      profileId: r.profile_id,
      runId: r.run_id ?? undefined,
      type: r.type,
      data: r.data,
      createdAt: r.created_at.toISOString(),
    }));
  }
}

export class PostgresStore extends PostgresReader implements Store {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    const pool = new Pool({
      connectionString,
      max: 12,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 30_000,
    });

    super(pool);
    this.pool = pool;

    pool.on('error', () => {
      console.error('jian: idle database connection failed');
    });
  }

  async migrate() {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('jian:migrations', 0))");

      await client.query(
        'CREATE TABLE IF NOT EXISTS jian_schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );

      const applied = await client.query<{ version: number }>(
        'SELECT version FROM jian_schema_migrations ORDER BY version',
      );

      const versions = new Set(applied.rows.map((row) => row.version));

      if (
        applied.rows.some(
          (row) => !migrations.some((migration) => migration.version === row.version),
        )
      ) {
        throw new Error('Database schema is newer than this gateway');
      }

      for (const migration of migrations) {
        if (versions.has(migration.version)) {
          continue;
        }

        await client.query(migration.sql);

        await client.query('INSERT INTO jian_schema_migrations (version) VALUES ($1)', [
          migration.version,
        ]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');

      throw error;
    } finally {
      client.release();
    }
  }

  async transaction<T>(profileId: string, body: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      // A profile lock makes version checks, state changes and events atomic across workers.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [profileId]);

      const reader = new PostgresReader(client);

      const result = await body({
        get: reader.get.bind(reader),
        list: reader.list.bind(reader),
        events: reader.events.bind(reader),
        put: async (kind, id, ownerId, value) => {
          if (ownerId !== profileId) {
            throw new Error('Transaction profile mismatch');
          }

          const result = await client.query(
            `INSERT INTO jian_records (kind, id, profile_id, data) VALUES ($1, $2, $3, $4)
            ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data WHERE jian_records.profile_id = EXCLUDED.profile_id`,
            [kind, id, ownerId, JSON.stringify(value)],
          );

          if (result.rowCount !== 1) {
            throw new Error('Record profile mismatch');
          }
        },
        remove: async (kind, id, ownerId) => {
          if (ownerId !== profileId) {
            throw new Error('Transaction profile mismatch');
          }

          await client.query(
            'DELETE FROM jian_records WHERE kind = $1 AND id = $2 AND profile_id = $3',
            [kind, id, ownerId],
          );
        },
        event: async (event) => {
          if (event.profileId !== profileId) {
            throw new Error('Event profile mismatch');
          }

          await client.query(
            'INSERT INTO jian_events (profile_id, run_id, type, data, created_at) VALUES ($1, $2, $3, $4, $5)',
            [
              event.profileId,
              event.runId ?? null,
              event.type,
              JSON.stringify(event.data),
              event.createdAt,
            ],
          );
        },
      });

      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK');

      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
