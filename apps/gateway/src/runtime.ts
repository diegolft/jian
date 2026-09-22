import { randomUUID } from 'node:crypto';
import type { MCPClient } from '@ai-sdk/mcp';
import { stepCountIs, ToolLoopAgent, type ToolSet } from 'ai';
import { fitPrompt, tokenCounter } from './context/budget.js';
import type { Gateway } from './gateway.js';
import { resolveModel } from './providers.js';
import { connectMcpTools } from './runtime/mcp.js';
import { boundToolResult, redactOutput, redactText } from './runtime/results.js';
import type { ModelResolver, RuntimeOptions } from './runtime/types.js';
import { createSafeFetch } from './security/outbound.js';
import { profileTools } from './tools.js';

export type { RuntimeOptions } from './runtime/types.js';

export class AgentRuntime {
  private controllers = new Map<string, AbortController>();

  constructor(
    private gateway: Gateway,
    private model: ModelResolver = resolveModel,
    private options: RuntimeOptions = {},
  ) {}

  cancel(runId: string) {
    this.controllers.get(runId)?.abort();
  }

  stop() {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
  }

  async execute(profileId: string, runId: string) {
    const owner = randomUUID();
    const run = await this.gateway.claim(runId, profileId, owner);

    if (!run) {
      return;
    }

    const controller = new AbortController();

    this.controllers.set(runId, controller);

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)]);
    const clients: MCPClient[] = [];
    const outbound = this.options.outbound ?? createSafeFetch();
    const ownsOutbound = !this.options.outbound;
    const secrets = new Set<string>();
    let externalUncertain = false;

    const pulse = setInterval(() => {
      void this.gateway.heartbeat(profileId, runId, owner).catch(() => controller.abort());
    }, 10_000);

    pulse.unref();

    try {
      const policy = run.contextPolicy ?? run.profile.contextPolicy;
      const config = run.model ?? run.profile.model;
      let providerKey: string | undefined;

      if (config.provider === 'openai-codex' && config.credentialId) {
        if (!this.options.codexLogin) throw new Error('ChatGPT login is unavailable');
        providerKey = await this.options.codexLogin.accessToken(profileId, config.credentialId);
        secrets.add(providerKey);
      } else if (config.credentialId) {
        if (!this.options.credentials) {
          throw new Error('Provider credential is not configured');
        }

        providerKey = await this.options.credentials.resolve(
          profileId,
          config.credentialId,
          'provider',
        );

        secrets.add(providerKey);
      }

      if (config.apiKeyEnv) {
        const selectedEnvKey = process.env[config.apiKeyEnv];

        if (selectedEnvKey) {
          secrets.add(selectedEnvKey);
        }
      }

      const model = await this.model(config, process.env, outbound.fetch, providerKey);
      const tools = profileTools(this.gateway, run);
      const { mcpToolNames, selectedMcpTools } = await connectMcpTools(run, tools, {
        credentials: this.options.credentials,
        secrets,
        clients,
        fetcher: outbound.fetch,
        signal,
      });

      const guarded: ToolSet = {};
      // Serializing tool execution prevents another effect from starting after one remote outcome is uncertain.
      let toolQueue: Promise<void> = Promise.resolve();

      for (const [name, definition] of Object.entries(tools)) {
        const execute = definition.execute;

        if (!execute) {
          guarded[name] = definition;

          continue;
        }

        guarded[name] = {
          ...definition,
          execute: async (input, options) => {
            const previous = toolQueue;
            let release: () => void = () => {};

            toolQueue = new Promise<void>((resolve) => {
              release = resolve;
            });

            await previous;

            try {
              if (externalUncertain) {
                throw new Error('External tool outcome is uncertain');
              }

              signal.throwIfAborted();
              await this.gateway.heartbeat(profileId, runId, owner);

              await this.gateway.checkpoint(profileId, runId, owner, {
                phase: 'tool-started',
                toolName: name,
                toolCallId: options.toolCallId,
              });

              try {
                const output = await execute(input, options);

                // MCP can report failure in a successful HTTP response after applying an effect.
                if (
                  mcpToolNames.includes(name) &&
                  output &&
                  typeof output === 'object' &&
                  'isError' in output &&
                  output.isError === true
                ) {
                  await this.gateway.checkpoint(profileId, runId, owner, {
                    phase: 'tool-uncertain',
                    toolName: name,
                    toolCallId: options.toolCallId,
                    result: await boundToolResult(output, name, run, secrets, this.options),
                  });

                  throw new Error('External tool outcome is uncertain');
                }

                return await boundToolResult(output, name, run, secrets, this.options);
              } catch {
                if (mcpToolNames.includes(name)) {
                  externalUncertain = true;
                  controller.abort();

                  throw new Error('External tool outcome is uncertain');
                }

                throw new Error(`Tool ${name} failed. Inspect saved steps before retrying.`);
              }
            } finally {
              release();
            }
          },
        };
      }

      const context = await this.gateway.context(run);
      let usedTokens = 0;
      let preparedInputTokens = 0;

      const agent = new ToolLoopAgent({
        model,
        instructions: context.system,
        tools: guarded,
        stopWhen: stepCountIs(policy.maxSteps),
        maxRetries: 0,
        maxOutputTokens: policy.outputTokens,
        prepareStep: async ({ messages }) => {
          if (externalUncertain) {
            throw new Error('External tool outcome is uncertain');
          }

          signal.throwIfAborted();
          await this.gateway.heartbeat(profileId, runId, owner);

          if (usedTokens >= policy.maxRunTokens) {
            throw new Error('Run token budget exceeded');
          }

          const refreshed = await this.gateway.context(run);

          const activeNames = Object.keys(guarded).filter(
            (name) => !mcpToolNames.includes(name) || selectedMcpTools.has(name),
          );

          const activeTools = Object.fromEntries(
            activeNames.map((name) => [name, guarded[name]]),
          ) as ToolSet;

          const fitted = fitPrompt({
            provider: config.provider,
            modelId: config.modelId,
            policy,
            instructions: refreshed.system,
            messages,
            tools: activeTools,
          });

          preparedInputTokens = fitted.tokens;

          const availableOutput = policy.maxRunTokens - usedTokens - fitted.tokens;

          if (availableOutput < 1) {
            throw new Error('Run token budget exceeded');
          }

          return {
            instructions: fitted.instructions,
            messages: fitted.messages,
            activeTools: activeNames,
            maxOutputTokens: Math.min(policy.outputTokens, availableOutput),
          };
        },
        onStepEnd: async ({ text, toolCalls, toolResults, finishReason, usage }) => {
          const estimate = tokenCounter(config.provider, config.modelId);

          const inputTokens =
            usage.inputTokens && usage.inputTokens > 0 ? usage.inputTokens : preparedInputTokens;

          const outputTokens =
            usage.outputTokens && usage.outputTokens > 0
              ? usage.outputTokens
              : Math.max(1, estimate(JSON.stringify({ text, toolCalls })));

          usedTokens += inputTokens + outputTokens;

          await this.gateway.recordUsage(profileId, runId, owner, {
            inputTokens,
            outputTokens,
            steps: 1,
          });

          await this.gateway.checkpoint(profileId, runId, owner, {
            phase: 'step-completed',
            finishReason,
            usage: { inputTokens, outputTokens },
            tools: toolResults.map((result) => ({
              toolName: result.toolName,
              toolCallId: result.toolCallId,
              bytes: Buffer.byteLength(JSON.stringify(result.output) ?? 'null'),
              artifactId: (result.output as { artifactId?: string } | null)?.artifactId,
              result: redactOutput(result.output, secrets),
            })),
          });

          if (externalUncertain) {
            throw new Error('External tool outcome is uncertain');
          }

          if (usedTokens > policy.maxRunTokens) {
            throw new Error('Run token budget exceeded');
          }
        },
      });

      const result = await agent.generate({ messages: context.messages, abortSignal: signal });

      if (externalUncertain) {
        throw new Error('External tool outcome is uncertain');
      }

      if (
        !result.text.trim() ||
        result.finishReason === 'tool-calls' ||
        result.finishReason === 'length'
      ) {
        throw new Error('Agent stopped without a complete final response');
      }

      await this.gateway.finish(
        profileId,
        runId,
        owner,
        'completed',
        redactText(result.text, secrets),
      );
    } catch (error) {
      const current = await this.gateway.run(profileId, runId);

      if (current.status === 'running' && current.leaseOwner === owner) {
        await this.gateway
          .finish(
            profileId,
            runId,
            owner,
            externalUncertain || signal.aborted ? 'interrupted' : 'failed',
            executionFailureMessage(error, externalUncertain, signal.aborted),
          )
          .catch(() => {});
      }
    } finally {
      clearInterval(pulse);
      this.controllers.delete(runId);
      await Promise.allSettled(clients.map((client) => client.close()));

      if (ownsOutbound) {
        await outbound.close();
      }
    }
  }
}

function executionFailureMessage(error: unknown, uncertain: boolean, aborted: boolean): string {
  if (uncertain) {
    return 'External tool outcome is uncertain. Inspect checkpoints and reconcile effects before continuing.';
  }

  if (aborted) {
    return 'Execution interrupted. Inspect saved steps before continuing.';
  }

  if (
    error instanceof Error &&
    ['Context budget exceeded', 'Run token budget exceeded'].includes(error.message)
  ) {
    return 'Context or run token budget exceeded. Reduce context or tool selection before retrying.';
  }

  return 'Agent execution failed. Check provider credentials, model access and MCP configuration.';
}
