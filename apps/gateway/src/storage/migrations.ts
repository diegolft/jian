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
  {
    // Channels stopped carrying a name, a session and sender lists: there is one channel of each
    // type per profile, and every sender is now a contact the owner approves. Senders an older
    // binding already allowed keep talking to the agent, on the session that binding used.
    version: 7,
    sql: `
        ALTER TABLE jian_records DROP CONSTRAINT IF EXISTS jian_records_kind_check;
        ALTER TABLE jian_records ADD CONSTRAINT jian_records_kind_check
          CHECK (kind IN ('profile','revision','session','message','memory','run','secret','artifact','lease','mail','channel','delivery','checkpoint','channelConnection','channelAuth','channelInbox','provider','modelDefault','contact'));

        WITH allowed AS (
          SELECT DISTINCT
            record.profile_id,
            record.data->>'id' AS channel_id,
            CASE WHEN record.data->>'type' = 'generic' THEN 'api' ELSE record.data->>'type' END AS type,
            record.data->>'sessionId' AS session_id,
            actor AS actor_id
          FROM jian_records AS record
          CROSS JOIN LATERAL jsonb_array_elements_text(record.data->'actorIds') AS actor
          WHERE record.kind = 'channel'
            AND jsonb_typeof(record.data->'actorIds') = 'array'
            AND record.data ? 'sessionId'
            AND NOT record.data ? 'revokedAt'
        ), identified AS (
          SELECT gen_random_uuid()::text AS contact_id, allowed.* FROM allowed
        )
        INSERT INTO jian_records (kind, id, profile_id, data)
        SELECT 'contact', contact_id, profile_id, jsonb_build_object(
          'id', contact_id,
          'profileId', profile_id::text,
          'channelId', channel_id,
          'type', type,
          'actorId', actor_id,
          -- These channels only ever served direct chats, where the sender is the conversation.
          'chatId', actor_id,
          'status', 'approved',
          'sessionId', session_id,
          'createdAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'updatedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        FROM identified
        ON CONFLICT (kind, id) DO NOTHING;

        -- Version 6 deleted every credential record, so the identifier a channel kept points at
        -- nothing; a Telegram token now lives in the vault under 'channel:<id>'.
        UPDATE jian_records SET data = jsonb_strip_nulls(jsonb_build_object(
          'id', data->>'id',
          'profileId', data->>'profileId',
          'type', CASE WHEN data->>'type' = 'generic' THEN 'api' ELSE data->>'type' END,
          'tokenHash', data->>'tokenHash',
          'createdAt', data->>'createdAt',
          'revokedAt', data->>'revokedAt'))
        WHERE kind = 'channel';

        UPDATE jian_records SET data = data || jsonb_build_object(
          'revokedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        WHERE kind = 'channel' AND NOT data ? 'revokedAt' AND id IN (
          SELECT id FROM (
            SELECT id, row_number() OVER (PARTITION BY profile_id, data->>'type' ORDER BY seq) AS position
            FROM jian_records WHERE kind = 'channel' AND NOT data ? 'revokedAt'
          ) ranked WHERE position > 1);
`,
  },
  {
    // Conversations gained a scope: a contact is one person writing privately, or a room the
    // owner approves once for everyone in it. Every contact written before this is a private
    // conversation, and the code reads the field rather than guessing at its absence.
    version: 8,
    sql: `
        UPDATE jian_records SET data = data || jsonb_build_object('scope', 'direct')
        WHERE kind = 'contact' AND NOT data ? 'scope';
`,
  },
];
