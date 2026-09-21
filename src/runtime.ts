import { createHash, randomUUID } from 'node:crypto';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { type LanguageModel, stepCountIs, ToolLoopAgent, type ToolSet } from 'ai';
import type { ModelConfig } from './domain.js';
import type { Gateway } from './gateway.js';
import { resolveModel } from './providers.js';
import { profileTools } from './tools.js';

export class AgentRuntime {
  private controllers = new Map<string, AbortController>();
  constructor(
    private gateway: Gateway,
    private model: (config: ModelConfig) => LanguageModel = resolveModel,
  ) {}
  cancel(runId: string) {
    this.controllers.get(runId)?.abort();
  }
  stop() {
    for (const controller of this.controllers.values()) controller.abort();
  }
  async execute(profileId: string, runId: string) {
    const owner = randomUUID();
    const run = await this.gateway.claim(runId, profileId, owner);
    if (!run) return;
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)]);
    const clients: MCPClient[] = [];
    const pulse = setInterval(() => {
      void this.gateway.heartbeat(profileId, runId, owner).catch(() => controller.abort());
    }, 10_000);
    pulse.unref();
    try {
      const tools = profileTools(this.gateway, run);
      for (const config of run.profile.mcpServers) {
        const token = config.bearerTokenEnv ? process.env[config.bearerTokenEnv] : undefined;
        if (config.bearerTokenEnv && !token) throw new Error('MCP credential missing');
        const client = await createMCPClient({
          transport: {
            type: 'http',
            url: config.url,
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
          initializationOptions: { signal, timeout: 15_000 },
          maxRetries: 0,
        });
        clients.push(client);
        const available = await client.tools();
        for (const name of config.allowedTools) {
          const remote = available[name];
          if (!remote) throw new Error('Configured MCP tool is not available');
          const suffix = createHash('sha256').update(name).digest('hex').slice(0, 8);
          tools[
            `mcp_${config.name}_${name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 18)}_${suffix}`
          ] = remote;
        }
      }
      const guarded: ToolSet = {};
      for (const [name, definition] of Object.entries(tools)) {
        const execute = definition.execute;
        guarded[name] = {
          ...definition,
          ...(execute
            ? {
                execute: async (input, options) => {
                  signal.throwIfAborted();
                  await this.gateway.heartbeat(profileId, runId, owner);
                  try {
                    return await execute(input, options);
                  } catch {
                    throw new Error(`Tool ${name} failed. Refresh state before retrying.`);
                  }
                },
              }
            : {}),
        };
      }
      const context = await this.gateway.context(run);
      const agent = new ToolLoopAgent({
        model: this.model(run.profile.model),
        instructions: context.system,
        tools: guarded,
        stopWhen: stepCountIs(12),
        maxRetries: 0,
        maxOutputTokens: 4096,
        prepareStep: async () => {
          signal.throwIfAborted();
          await this.gateway.heartbeat(profileId, runId, owner);
          return { instructions: (await this.gateway.context(run)).system };
        },
        onToolExecutionStart: async ({ toolCall }) => {
          await this.gateway.checkpoint(profileId, runId, owner, {
            phase: 'tool-started',
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
          });
        },
        onStepEnd: async ({ text, toolResults, finishReason, usage }) => {
          await this.gateway.checkpoint(profileId, runId, owner, {
            phase: 'step-completed',
            text: text.slice(0, 16_000),
            finishReason,
            usage,
            tools: toolResults.map((t) => ({
              toolName: t.toolName,
              toolCallId: t.toolCallId,
              output: JSON.stringify(t.output)?.slice(0, 16_000),
            })),
          });
        },
      });
      const result = await agent.generate({ messages: context.messages, abortSignal: signal });
      if (
        !result.text.trim() ||
        result.finishReason === 'tool-calls' ||
        result.finishReason === 'length'
      ) {
        throw new Error('Agent stopped without a complete final response');
      }
      await this.gateway.finish(profileId, runId, owner, 'completed', result.text);
    } catch {
      const current = await this.gateway.run(profileId, runId);
      if (current.status === 'running' && current.leaseOwner === owner) {
        await this.gateway
          .finish(
            profileId,
            runId,
            owner,
            signal.aborted ? 'interrupted' : 'failed',
            signal.aborted
              ? 'Execution interrupted. Inspect saved steps before continuing.'
              : 'Agent execution failed. Check provider credentials, model access and MCP configuration.',
          )
          .catch(() => {});
      }
    } finally {
      clearInterval(pulse);
      this.controllers.delete(runId);
      await Promise.allSettled(clients.map((client) => client.close()));
    }
  }
}
