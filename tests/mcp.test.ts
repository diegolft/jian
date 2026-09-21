import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { Gateway } from '../src/gateway.js';
import { AgentRuntime } from '../src/runtime.js';
import { MemoryStore } from './helpers/memory-store.js';

it('executes only allowlisted tools through an HTTP MCP server', async () => {
  const called: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    let result: unknown;
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } };
    else if (message.method === 'tools/list') result = { tools: [
      { name: 'search', description: 'Search docs', inputSchema: { type: 'object', properties: {} } },
      { name: 'delete_everything', description: 'Must not be available', inputSchema: { type: 'object', properties: {} } },
    ] };
    else if (message.method === 'tools/call') { called.push(message.params.name); result = { content: [{ type: 'text', text: 'Documentation found' }] }; }
    else { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const gateway = new Gateway(new MemoryStore());
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  let calls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async options => {
    calls++;
    if (calls === 1) {
      const tools = options.tools?.filter(t => t.type === 'function') ?? [];
      if (tools.some(t => t.name.includes('delete_everything'))) throw new Error('Forbidden tool exposed');
      const search = tools.find(t => t.name.includes('search'))!;
      return { content: [{ type: 'tool-call', toolCallId: 'one', toolName: search.name, input: '{}' }], finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage, warnings: [] };
    }
    return { content: [{ type: 'text', text: 'Found the documentation.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] };
  } });
  try {
    const profile = await gateway.createProfile({ name: 'MCP test', instructions: 'Help.', model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_TEST' },
      mcpServers: [{ name: 'docs', url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, allowedTools: ['search'] }],
    });
    const session = await gateway.createSession(profile.id, { title: 'MCP' });
    const run = await gateway.submit(profile.id, session.id, { text: 'Find docs', requestKey: 'mcp' });
    await new AgentRuntime(gateway, () => model).execute(profile.id, run.id);
    expect((await gateway.run(profile.id, run.id)).status).toBe('completed');
    expect(called).toEqual(['search']);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
});
