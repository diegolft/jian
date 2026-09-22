import { createHash } from 'node:crypto';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import type { Run } from '../domain.js';
import type { RuntimeOptions } from './types.js';

interface McpContext {
  credentials: RuntimeOptions['credentials'];
  secrets: Set<string>;
  clients: MCPClient[];
  fetcher: typeof globalThis.fetch;
  signal: AbortSignal;
}

/** Discover approved tools now; expose their full schemas only when the agent selects them. */
export async function connectMcpTools(run: Run, tools: ToolSet, context: McpContext) {
  const mcpToolNames: string[] = [];
  const selectedMcpTools = new Set<string>();

  for (const config of run.profile.mcpServers) {
    let token: string | undefined;

    if (config.credentialId) {
      if (!context.credentials) {
        throw new Error('MCP credential missing');
      }

      token = await context.credentials.resolve(run.profileId, config.credentialId, 'mcp');
    } else if (config.bearerTokenEnv) {
      token = process.env[config.bearerTokenEnv];
    }

    if ((config.credentialId || config.bearerTokenEnv) && !token) {
      throw new Error('MCP credential missing');
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

    const available = await client.tools();

    for (const name of config.allowedTools) {
      const remote = available[name];

      if (!remote) {
        throw new Error('Configured MCP tool is not available');
      }

      const suffix = createHash('sha256').update(name).digest('hex').slice(0, 8);
      const exposedName = `mcp_${config.name}_${name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 18)}_${suffix}`;

      tools[exposedName] = remote;
      mcpToolNames.push(exposedName);
    }
  }

  if (mcpToolNames.length > 0) {
    tools.load_mcp_tools = tool({
      description: `Select approved MCP tools before calling them. Available names: ${mcpToolNames.slice(0, 10).join(', ')}${mcpToolNames.length > 10 ? '. Use search_mcp_tools for the rest.' : ''}`,
      inputSchema: z.object({ names: z.array(z.string()).min(1).max(10) }),
      execute: async ({ names }) => {
        if (names.some((name) => !mcpToolNames.includes(name))) {
          throw new Error('MCP tool is not approved');
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
        'Search the approved MCP tool catalog by name or description. Load chosen names with load_mcp_tools.',
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
