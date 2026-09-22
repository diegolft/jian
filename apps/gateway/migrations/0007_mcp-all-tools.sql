-- An MCP server now offers whatever it offers: the owner no longer lists the tools, and the
-- agent loads one before it can call it. The stored lists are dropped so a strict read of a
-- profile, and of every revision a past run froze, still parses.
UPDATE "profiles" p
SET "mcp_servers" = (
  SELECT coalesce(jsonb_agg(server - 'allowedTools'), '[]'::jsonb)
  FROM jsonb_array_elements(p."mcp_servers") AS server
)
WHERE jsonb_typeof(p."mcp_servers") = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p."mcp_servers") AS s WHERE s ? 'allowedTools'
  );
--> statement-breakpoint
UPDATE "profile_revisions" r
SET "document" = jsonb_set(
  r."document",
  '{mcpServers}',
  (
    SELECT coalesce(jsonb_agg(server - 'allowedTools'), '[]'::jsonb)
    FROM jsonb_array_elements(r."document" -> 'mcpServers') AS server
  )
)
WHERE jsonb_typeof(r."document" -> 'mcpServers') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(r."document" -> 'mcpServers') AS s
    WHERE s ? 'allowedTools'
  );
