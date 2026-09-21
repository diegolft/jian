import { Pool, type PoolClient } from 'pg';
import type { GatewayEvent, Kind, Records } from './domain.js';
import type { Reader, Selection, Store, Transaction } from './storage.js';

class PostgresReader implements Reader {
  constructor(protected readonly connection: Pick<Pool, 'query'> | PoolClient) {}
  async get<K extends Kind>(kind: K, id: string): Promise<Records[K] | null> {
    const result = await this.connection.query<{ data: Records[K] }>(
      'SELECT data FROM elos_records WHERE kind = $1 AND id = $2',
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
    values.push(Math.max(1, Math.min(options.limit ?? 100, 1000)));
    const result = await this.connection.query<{ data: Records[K] }>(
      `SELECT data FROM elos_records WHERE ${conditions.join(' AND ')} ORDER BY seq ${options.descending ? 'DESC' : 'ASC'} LIMIT $${values.length}`,
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
    }>('SELECT * FROM elos_events WHERE profile_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3', [
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
      console.error('elos: idle database connection failed');
    });
  }
  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('elos:migrations', 0))");
      await client.query(`
        CREATE TABLE IF NOT EXISTS elos_records (
          seq bigserial UNIQUE NOT NULL,
          kind text NOT NULL CHECK (kind IN ('profile','revision','session','message','memory','run')),
          id text NOT NULL,
          profile_id uuid NOT NULL,
          data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data->>'id' = id),
          PRIMARY KEY (kind, id)
        );
        CREATE INDEX IF NOT EXISTS elos_records_profile_kind ON elos_records (profile_id, kind, seq);
        CREATE INDEX IF NOT EXISTS elos_records_data ON elos_records USING gin (data jsonb_path_ops);
        CREATE TABLE IF NOT EXISTS elos_events (
          id bigserial PRIMARY KEY,
          profile_id uuid NOT NULL,
          run_id uuid,
          type text NOT NULL,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS elos_events_profile_cursor ON elos_events (profile_id, id);
      `);
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
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [profileId]);
      const reader = new PostgresReader(client);
      const result = await body({
        get: reader.get.bind(reader),
        list: reader.list.bind(reader),
        events: reader.events.bind(reader),
        put: async (kind, id, ownerId, value) => {
          if (ownerId !== profileId) throw new Error('Transaction profile mismatch');
          await client.query(
            `INSERT INTO elos_records (kind, id, profile_id, data) VALUES ($1, $2, $3, $4)
            ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data WHERE elos_records.profile_id = EXCLUDED.profile_id`,
            [kind, id, ownerId, JSON.stringify(value)],
          );
        },
        event: async (event) => {
          if (event.profileId !== profileId) throw new Error('Event profile mismatch');
          await client.query(
            'INSERT INTO elos_events (profile_id, run_id, type, data, created_at) VALUES ($1, $2, $3, $4, $5)',
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
