import { createMCPClient } from '@ai-sdk/mcp';
import type { McpStatus, Profile } from '@jian/contracts';
import { GatewayError } from '../core/errors.js';
import { mcpSecret } from '../profiles/service.js';
import { createSafeFetch } from '../security/outbound.js';
import type { Vault } from '../security/vault.js';

/**
 * Connects to one configured server and reports what it answered. This is the owner asking
 * "does this work", so a refusal is a result to show, not an error to raise — the only failure
 * is a server that is not configured at all.
 */
export async function probeMcpServer(
  profile: Profile,
  name: string,
  vault: Vault,
  fetcher?: typeof globalThis.fetch,
): Promise<McpStatus> {
  const config = profile.mcpServers.find((server) => server.name === name);

  if (!config) {
    throw new GatewayError(404, 'MCP server not found');
  }

  const checkedAt = new Date().toISOString();
  const outbound = fetcher ? undefined : createSafeFetch();

  try {
    const token = config.bearerTokenEnv
      ? process.env[config.bearerTokenEnv]
      : await vault.read(profile.id, mcpSecret(config.name));

    if (config.bearerTokenEnv && !token) {
      return {
        name,
        reachable: false,
        tools: [],
        error: `${config.bearerTokenEnv} is not set on this gateway`,
        checkedAt,
      };
    }

    const client = await createMCPClient({
      transport: {
        type: 'http',
        url: config.url,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        fetch: fetcher ?? outbound?.fetch,
        redirect: 'error',
      },
      initializationOptions: { signal: AbortSignal.timeout(15_000), timeout: 15_000 },
      maxRetries: 0,
    });

    try {
      const tools = Object.entries(await client.tools()).map(([toolName, definition]) => ({
        name: toolName,
        ...(typeof definition.description === 'string'
          ? { description: definition.description.slice(0, 600) }
          : {}),
      }));

      return { name, reachable: true, tools, checkedAt };
    } finally {
      await client.close().catch(() => undefined);
    }
  } catch (error) {
    // The message is what the owner has to act on — a 401 means the token, a timeout means the
    // address. It never carries the token itself, which is only ever sent in a header.
    return {
      name,
      reachable: false,
      tools: [],
      error: (error instanceof Error ? error.message : 'The server did not answer').slice(0, 300),
      checkedAt,
    };
  } finally {
    await outbound?.close();
  }
}
