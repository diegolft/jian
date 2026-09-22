import { createHash } from 'node:crypto';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { Run } from '@jian/contracts';
import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import { mcpSecret } from '../profiles/service.js';
import type { RuntimeOptions } from './types.js';

interface McpContext {
  vault: RuntimeOptions['vault'];
  secrets: Set<string>;
  clients: MCPClient[];
  fetcher: typeof globalThis.fetch;
  signal: AbortSignal;
}

/**
 * The exposed name has to be unique across servers and legal as a tool name, and the hash is
 * what keeps two long names from colliding once they are truncated.
 */
function exposedName(server: string, tool: string): string {
  const suffix = createHash('sha256').update(tool).digest('hex').slice(0, 8);

  return `mcp_${server}_${tool.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 18)}_${suffix}`;
}

/** Discover what each server offers now; expose a full schema only when the agent selects it. */
export async function connectMcpTools(run: Run, tools: ToolSet, context: McpContext) {
  const mcpToolNames: string[] = [];
  const selectedMcpTools = new Set<string>();

  for (const config of run.profile.mcpServers) {
    let token: string | undefined;

    if (config.bearerTokenEnv) {
      token = process.env[config.bearerTokenEnv];

      if (!token) {
        throw new Error('MCP token missing');
      }
    } else {
      // The token was typed with the server and lives in the vault under its name.
      token = await context.vault?.read(run.profileId, mcpSecret(config.name));
    }

    if (token) {
      context.secrets.add(token);
    }

    const client = await createMCPClient({
      transport: {
        type: 'http',
        url: config.url,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        fetch: context.fetcher,
        redirect: 'error',
      },
      initializationOptions: { signal: context.signal, timeout: 15_000 },
      maxRetries: 0,
    });

    context.clients.push(client);

    // Everything the server offers. A long catalog costs nothing per turn: only the tools the
    // agent has loaded are sent with a request, so a server with a hundred of them is no
    // heavier than one with three until they are used.
    for (const [name, remote] of Object.entries(await client.tools())) {
      tools[exposedName(config.name, name)] = remote;
      mcpToolNames.push(exposedName(config.name, name));
    }
  }

  if (mcpToolNames.length > 0) {
    tools.load_mcp_tools = tool({
      description: `Select the MCP tools to use before calling them. Available names: ${mcpToolNames.slice(0, 10).join(', ')}${mcpToolNames.length > 10 ? '. Use search_mcp_tools for the rest.' : ''}`,
      inputSchema: z.object({ names: z.array(z.string()).min(1).max(10) }),
      execute: async ({ names }) => {
        if (names.some((name) => !mcpToolNames.includes(name))) {
          throw new Error('No connected MCP server offers that tool');
        }

        selectedMcpTools.clear();

        for (const name of names) {
          selectedMcpTools.add(name);
        }

        return { selected: [...selectedMcpTools] };
      },
    });
  }

  if (mcpToolNames.length > 10) {
    tools.search_mcp_tools = tool({
      description:
        'Search the connected MCP servers by tool name or description. Load chosen names with load_mcp_tools.',
      inputSchema: z.object({ query: z.string().min(1).max(100) }),
      execute: async ({ query }) =>
        mcpToolNames
          .filter((name) =>
            `${name} ${tools[name]?.description ?? ''}`.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 10)
          .map((name) => {
            const description = tools[name]?.description;

            return {
              name,
              description: typeof description === 'string' ? description.slice(0, 300) : undefined,
            };
          }),
    });
  }

  return { mcpToolNames, selectedMcpTools };
}
