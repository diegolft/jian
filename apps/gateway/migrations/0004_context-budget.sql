-- The tool definitions alone cost about 9000 tokens, so a 16000 token input budget left no
-- room for the system prompt and refused the run outright. Widen the profiles that still hold
-- the old default; a budget the owner chose is left alone.
UPDATE "profiles"
SET "context_policy" = jsonb_set("context_policy", '{inputTokens}', '32000')
WHERE "context_policy" ->> 'inputTokens' = '16000';
