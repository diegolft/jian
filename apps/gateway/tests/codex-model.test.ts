import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createCodexModel } from '../src/providers/codex/model.js';

describe('ChatGPT Codex model adapter', () => {
  it('keeps Jian instructions and returns a Responses result', async () => {
    let request: Record<string, unknown> = {};
    let headers = new Headers();
    const fetcher: typeof fetch = async (_input, init) => {
      request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      headers = new Headers(init?.headers);
      const item = {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Olá.', annotations: [] }],
      };
      const response = {
        id: 'resp_test',
        object: 'response',
        created_at: 1,
        model: 'gpt-5.6-terra',
        status: 'completed',
        output: [],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      };
      const events = [
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const result = await generateText({
      model: createCodexModel('synthetic-token', 'gpt-5.6-terra', fetcher),
      system: 'You are Jian.',
      prompt: 'Diga olá.',
    });

    expect(result.text).toBe('Olá.');
    expect(request.instructions).toContain('You are Jian.');
    expect(request.stream).toBe(true);
    expect(request.store).toBe(false);
    expect(headers.get('authorization')).toBe('Bearer synthetic-token');
  });

  it('passes tool calls through the same agent interface', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      const output =
        bodies.length === 1
          ? [
              {
                type: 'function_call',
                id: 'fc_1',
                call_id: 'call_1',
                name: 'lookup',
                arguments: '{"query":"x"}',
                status: 'completed',
              },
            ]
          : [
              {
                id: 'msg_2',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Found x.', annotations: [] }],
              },
            ];
      const response = {
        id: `resp_${bodies.length}`,
        object: 'response',
        created_at: 1,
        model: 'gpt-5.6-terra',
        status: 'completed',
        output,
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      };
      return new Response(`data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const result = await generateText({
      model: createCodexModel('synthetic-token', 'gpt-5.6-terra', fetcher),
      prompt: 'Look up x.',
      tools: {
        lookup: {
          inputSchema: z.object({ query: z.string() }),
          execute: async ({ query }) => query,
        },
      },
      stopWhen: ({ steps }) => steps.length >= 2,
    });

    expect(result.text).toBe('Found x.');
    expect(bodies[0]?.tools).toBeDefined();
    expect(bodies[1]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'function_call_output', call_id: 'call_1' }),
      ]),
    );
  });
});
