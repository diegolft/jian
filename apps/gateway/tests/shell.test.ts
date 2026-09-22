import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { profileTools } from '../src/agent/tools.js';
import { testServices } from './helpers/services.js';

const model = { provider: 'openai' as const, modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' };

async function toolsFor(allowShell: boolean) {
  const services = await testServices();
  const profile = await services.profiles.createProfile({
    name: 'Atlas',
    instructions: 'Help.',
    model,
    allowShell,
  });
  const session = await services.sessions.createSession(profile.id, { title: 'Shell' });
  const run = await services.runs.submit(profile.id, session.id, {
    text: 'Oi',
    requestKey: 'one',
  });

  return profileTools({ ...services, store: services.store }, run);
}

const call = async (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<unknown> }).execute(input, {
    toolCallId: 'test',
    messages: [],
    context: {},
  });

describe('running commands on the machine the gateway runs on', () => {
  it('hands out nothing unless the owner turned it on for this profile', async () => {
    const off = await toolsFor(false);

    expect(off.run_command).toBeUndefined();
    expect(off.read_file).toBeUndefined();
    expect(off.write_file).toBeUndefined();
    expect(off.list_directory).toBeUndefined();

    expect((await toolsFor(true)).run_command).toBeDefined();
  });

  it('reports what a command printed and how it ended', async () => {
    const tools = await toolsFor(true);

    expect(await call(tools.run_command, { command: 'echo oi', timeoutMs: 5000 })).toMatchObject({
      exitCode: 0,
      stdout: 'oi\n',
    });

    // A failure is a result to read, not an error that ends the run.
    expect(await call(tools.run_command, { command: 'exit 3', timeoutMs: 5000 })).toMatchObject({
      exitCode: 3,
    });
  });

  it('reads, writes and lists real paths', async () => {
    const tools = await toolsFor(true);
    const directory = mkdtempSync(join(tmpdir(), 'jian-shell-'));
    const file = join(directory, 'nota.txt');

    writeFileSync(file, 'primeira linha');

    expect(await call(tools.read_file, { path: file, offset: 0, limit: 400_000 })).toMatchObject({
      content: 'primeira linha',
    });

    await call(tools.write_file, { path: file, content: 'segunda' });

    expect(readFileSync(file, 'utf8')).toBe('segunda');
    expect(await call(tools.list_directory, { path: directory })).toMatchObject({
      entries: [{ name: 'nota.txt', kind: 'file' }],
    });
  });

  it('refuses a relative path, which would mean whatever the worker happened to be in', async () => {
    const tools = await toolsFor(true);
    const schema = (
      tools.read_file as { inputSchema: { safeParse(i: unknown): { success: boolean } } }
    ).inputSchema;

    expect(schema.safeParse({ path: 'package.json' }).success).toBe(false);
    expect(schema.safeParse({ path: '/etc/hosts' }).success).toBe(true);
  });
});
