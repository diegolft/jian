/** Ordered, transactional migrations; released versions are append-only. */
export const migrations = [
  {
    version: 1,
    sql: `
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
`,
  },
  {
    version: 2,
    sql: `
        ALTER TABLE elos_records DROP CONSTRAINT IF EXISTS elos_records_kind_check;
        ALTER TABLE elos_records ADD CONSTRAINT elos_records_kind_check
          CHECK (kind IN ('profile','revision','session','message','memory','run','credential','accessKey','artifact','lease','mail','channel','delivery','checkpoint'));
        CREATE INDEX IF NOT EXISTS elos_records_content_search ON elos_records USING gin (to_tsvector('simple', COALESCE(data->>'key', '') || ' ' || COALESCE(data->>'content', '')));
        CREATE INDEX IF NOT EXISTS elos_records_access_key_hash ON elos_records ((data->>'hash')) WHERE kind = 'accessKey';
`,
  },
  {
    version: 3,
    sql: `
        ALTER TABLE elos_records DROP CONSTRAINT IF EXISTS elos_records_kind_check;
        ALTER TABLE elos_records ADD CONSTRAINT elos_records_kind_check
          CHECK (kind IN ('profile','revision','session','message','memory','run','credential','accessKey','artifact','lease','mail','channel','delivery','checkpoint','channelConnection','channelAuth','channelInbox'));
`,
  },
  {
    version: 4,
    sql: `
        ALTER TABLE elos_records DROP CONSTRAINT IF EXISTS elos_records_kind_check;
        ALTER TABLE elos_records ADD CONSTRAINT elos_records_kind_check
          CHECK (kind IN ('profile','revision','session','message','memory','run','credential','accessKey','artifact','lease','mail','channel','delivery','checkpoint','channelConnection','channelAuth','channelInbox','provider','modelDefault'));
`,
  },
  {
    // The product was renamed from Elos to Jian. Versions 1-4 are published and stay as
    // written, so the objects they created still carry the old prefix until this runs;
    // IF EXISTS keeps the rename safe on a database that never had them.
    version: 5,
    sql: `
        ALTER TABLE IF EXISTS elos_records RENAME TO jian_records;
        ALTER TABLE IF EXISTS elos_events RENAME TO jian_events;
        ALTER INDEX IF EXISTS elos_records_profile_kind RENAME TO jian_records_profile_kind;
        ALTER INDEX IF EXISTS elos_records_data RENAME TO jian_records_data;
        ALTER INDEX IF EXISTS elos_records_content_search RENAME TO jian_records_content_search;
        ALTER INDEX IF EXISTS elos_records_access_key_hash RENAME TO jian_records_access_key_hash;
        ALTER INDEX IF EXISTS elos_events_profile_cursor RENAME TO jian_events_profile_cursor;
        ALTER TABLE IF EXISTS jian_records RENAME CONSTRAINT elos_records_kind_check TO jian_records_kind_check;
`,
  },
  {
    // Access keys were removed and the credential vault became internal storage addressed by
    // its owner, so both record shapes are unreadable by this gateway. They are deleted here
    // rather than left behind: a dead ciphertext still holds a live secret from a provider.
    version: 6,
    sql: `
        DELETE FROM jian_records WHERE kind IN ('accessKey','credential');
        DROP INDEX IF EXISTS jian_records_access_key_hash;
        ALTER TABLE jian_records DROP CONSTRAINT IF EXISTS jian_records_kind_check;
        ALTER TABLE jian_records ADD CONSTRAINT jian_records_kind_check
          CHECK (kind IN ('profile','revision','session','message','memory','run','secret','artifact','lease','mail','channel','delivery','checkpoint','channelConnection','channelAuth','channelInbox','provider','modelDefault'));
`,
  },
];
