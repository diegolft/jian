import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { Gateway } from '../src/gateway.js';
import { AgentRuntime } from '../src/runtime.js';
import { MemoryStore } from './helpers/memory-store.js';

const input = {
  name: 'Atlas',
  instructions: 'Help.',
  model: { provider: 'openai', modelId: 'test', apiKeyEnv: 'ELOS_PROVIDER_TEST' },
};
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const answer = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage,
  warnings: [],
});
async function fixture() {
  const gateway = new Gateway(new MemoryStore());
  const profile = await gateway.createProfile(input);
  const session = await gateway.createSession(profile.id, { title: 'Mac' });
  const run = await gateway.submit(profile.id, session.id, {
    text: 'Remember the deployment time',
    requestKey: 'one',
  });
  return { gateway, profile, session, run };
}

describe('agent runtime', () => {
  it('refreshes shared context between real SDK tool-loop steps', async () => {
    const { gateway, profile, session, run } = await fixture();
    let step = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        step++;
        if (step === 1)
          return {
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'remember',
                input: JSON.stringify({
                  key: 'deployment',
                  content: 'Deploy at 21:00',
                  expectedVersion: 0,
                }),
              },
            ],
            finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
            usage,
            warnings: [],
          };
        const current = JSON.stringify(options.prompt.filter((m) => m.role === 'system'));
        return answer(
          current.includes('Deploy at 21:00')
            ? 'Saved: deploy at 21:00.'
            : 'I lost the shared context.',
        );
      },
    });
    await new AgentRuntime(gateway, () => model).execute(profile.id, run.id);
    const completed = await gateway.run(profile.id, run.id);
    expect(completed.status).toBe('completed');
    expect(completed.output).toBe('Saved: deploy at 21:00.');
    expect((await gateway.memories(profile.id))[0]?.sourceSessionId).toBe(session.id);
    const other = await gateway.createSession(profile.id, { title: 'Telegram' });
    const otherRun = await gateway.submit(profile.id, other.id, {
      text: 'When?',
      requestKey: 'two',
    });
    expect((await gateway.context(otherRun)).system).toContain('Deploy at 21:00');
    expect(
      (await gateway.store.events(profile.id, 0)).filter(
        (e) => e.type === 'run.step' && (e.data as { phase: string }).phase === 'step-completed',
      ),
    ).toHaveLength(2);
  });

  it('persists a safe failure without leaking provider credentials', async () => {
    const { gateway, profile, run } = await fixture();
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('Bearer secret-api-key');
      },
    });
    await new AgentRuntime(gateway, () => model).execute(profile.id, run.id);
    const result = await gateway.run(profile.id, run.id);
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('secret-api-key');
    expect(JSON.stringify(await gateway.store.events(profile.id, 0))).not.toContain(
      'secret-api-key',
    );
  });

  it('does not execute a cancelled or already claimed run', async () => {
    const { gateway, profile, run } = await fixture();
    await gateway.cancel(profile.id, run.id);
    await new AgentRuntime(gateway, () => {
      throw new Error('must not resolve');
    }).execute(profile.id, run.id);
    expect((await gateway.run(profile.id, run.id)).status).toBe('cancelled');
  });

  it('bounds context without dropping the newest user message', async () => {
    const { gateway, profile, run } = await fixture();
    for (let i = 0; i < 20; i++)
      await gateway.remember(profile.id, {
        key: `memory-${i}`,
        content: 'x'.repeat(4000),
        expectedVersion: 0,
      });
    const context = await gateway.context(run);
    expect(context.system.length).toBeLessThan(24_000);
    expect(context.messages.at(-1)?.content).toBe('Remember the deployment time');
  });
});

it('does not report completion when the agent exhausts its tool budget', async () => {
  const { gateway, profile, run } = await fixture();
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        { type: 'text', text: 'Still working.' },
        {
          type: 'tool-call',
          toolCallId: `call-${++calls}`,
          toolName: 'list_activities',
          input: '{}',
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
      usage,
      warnings: [],
    }),
  });
  await new AgentRuntime(gateway, () => model).execute(profile.id, run.id);
  expect((await gateway.run(profile.id, run.id)).status).toBe('failed');
  expect(
    (await gateway.messages(profile.id, run.sessionId)).filter((m) => m.role === 'assistant'),
  ).toHaveLength(0);
});
