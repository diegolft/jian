import { describe, expect, it } from 'vitest';
import { profileTools } from '../src/agent/tools.js';
import { parseSkillDocument } from '../src/skills/document.js';
import { Skills } from '../src/skills/service.js';
import { testServices } from './helpers/services.js';

const model = { provider: 'openai' as const, modelId: 'test', apiKeyEnv: 'JIAN_PROVIDER_TEST' };

const document = `---
name: deploy
description: Ship a release safely
user-invocable: true
allowed-tools:
  - Read
  - Bash(ls *)
---

Check the release notes, then run the pipeline.
`;

/** Serves the paths a test declares and answers 404 for everything else, like GitHub does. */
function repository(files: Record<string, string>) {
  const asked: string[] = [];

  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);

    asked.push(url);

    const body = Object.entries(files).find(([path]) => url.endsWith(path))?.[1];

    return body === undefined
      ? new Response('Not Found', { status: 404 })
      : new Response(body, { status: 200 });
  }) as typeof globalThis.fetch;

  return { fetcher, asked };
}

async function profileWith(skills: Array<{ name: string; description: string }> = []) {
  const services = testServices();
  const profile = await services.profiles.createProfile({
    name: 'Atlas',
    instructions: 'Help.',
    model,
    skills: skills.map((skill) => ({ ...skill, instructions: 'Written by the agent.' })),
  });

  return { services, profile };
}

describe('skill documents', () => {
  it('reads the open format and ignores the keys other runtimes add', () => {
    const skill = parseSkillDocument(document);

    expect(skill.name).toBe('deploy');
    expect(skill.description).toBe('Ship a release safely');
    expect(skill.instructions).toBe('Check the release notes, then run the pipeline.');
    expect(skill.instructions).not.toContain('allowed-tools');
  });

  it('refuses a document that would leave the agent with nothing to follow', () => {
    expect(() => parseSkillDocument('no frontmatter here')).toThrow();
    expect(() => parseSkillDocument('---\nname: x\n---\n\nBody.')).toThrow();
    expect(() => parseSkillDocument('---\nname: x\ndescription: d\n---\n\n')).toThrow();
  });
});

describe('importing a skill', () => {
  it('copies the instructions and records where they came from', async () => {
    const { services, profile } = await profileWith();
    const { fetcher } = repository({ 'skills/deploy/SKILL.md': document });
    const skills = new Skills(services.profiles, fetcher);

    const updated = await skills.importSkill(profile.id, {
      url: 'https://github.com/acme/tools/tree/main/skills/deploy',
    });

    const imported = updated.skills.find((skill) => skill.name === 'deploy');

    expect(imported?.instructions).toContain('run the pipeline');
    expect(imported?.origin?.ref).toBe('main');
    expect(imported?.origin?.url).toContain('github.com/acme/tools');
  });

  it('keeps what the agent wrote and replaces only the skill of the same name', async () => {
    const { services, profile } = await profileWith([
      { name: 'notes', description: 'The agent wrote this' },
      { name: 'deploy', description: 'An older copy' },
    ]);
    const { fetcher } = repository({ 'skills/deploy/SKILL.md': document });
    const skills = new Skills(services.profiles, fetcher);

    const updated = await skills.importSkill(profile.id, {
      url: 'https://github.com/acme/tools/tree/main/skills/deploy',
    });

    expect(updated.skills).toHaveLength(2);
    expect(updated.skills.find((skill) => skill.name === 'notes')?.origin).toBeUndefined();
    expect(updated.skills.find((skill) => skill.name === 'deploy')?.description).toBe(
      'Ship a release safely',
    );
  });

  it('refuses a host it cannot resolve, without touching the profile', async () => {
    const { services, profile } = await profileWith();
    const { fetcher, asked } = repository({});
    const skills = new Skills(services.profiles, fetcher);

    await expect(
      skills.importSkill(profile.id, { url: 'https://gitlab.com/acme/tools' }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(asked).toHaveLength(0);
    expect((await services.profiles.profile(profile.id)).version).toBe(profile.version);
  });

  it('reports a rate limited host instead of leaving a half imported profile', async () => {
    const { services, profile } = await profileWith();
    const fetcher = (async () => new Response('', { status: 403 })) as typeof globalThis.fetch;
    const skills = new Skills(services.profiles, fetcher);

    await expect(
      skills.importSkill(profile.id, { url: 'https://github.com/acme/tools' }),
    ).rejects.toMatchObject({ statusCode: 429 });

    expect((await services.profiles.profile(profile.id)).skills).toHaveLength(0);
  });
});

describe('reading a catalog', () => {
  it('lists the plugins a marketplace announces', async () => {
    const { services } = await profileWith();
    const manifest = JSON.stringify({
      name: 'acme-marketplace',
      plugins: [
        {
          name: 'deploy-tools',
          description: 'Release helpers',
          source: { source: 'git-subdir', url: 'https://github.com/acme/tools.git', path: 'a/b' },
        },
      ],
    });
    const { fetcher } = repository({ '.claude-plugin/marketplace.json': manifest });

    const catalog = await new Skills(services.profiles, fetcher).catalog({
      url: 'https://github.com/acme/market',
    });

    expect(catalog.marketplace).toBe('acme-marketplace');
    expect(catalog.entries[0]).toMatchObject({ name: 'deploy-tools', plugin: 'deploy-tools' });
  });
});

describe('a self-managing agent and the skills the owner imported', () => {
  it('writes its own and cannot drop one it did not write', async () => {
    const services = testServices();
    const profile = await services.profiles.createProfile({
      name: 'Atlas',
      instructions: 'Help.',
      model,
      allowSelfManagement: true,
    });
    const { fetcher } = repository({ 'skills/deploy/SKILL.md': document });

    await new Skills(services.profiles, fetcher).importSkill(profile.id, {
      url: 'https://github.com/acme/tools/tree/main/skills/deploy',
    });

    const session = await services.sessions.createSession(profile.id, { title: 'Test' });
    const run = await services.runs.submit(profile.id, session.id, {
      text: 'Hi',
      requestKey: 'one',
    });
    const tools = profileTools({ ...services, store: services.store }, run);
    const definition = tools.update_skills;

    if (!definition?.execute) {
      throw new Error('update_skills is unavailable');
    }

    // The agent rewrites its own set and leaves the imported skill out of the payload.
    await definition.execute(
      {
        expectedVersion: (await services.profiles.profile(profile.id)).version,
        skills: [{ name: 'notes', description: 'Mine', instructions: 'Written by the agent.' }],
      } as never,
      { toolCallId: 'test', messages: [], context: {} },
    );

    const after = await services.profiles.profile(profile.id);

    expect(after.skills.map((skill) => skill.name).sort()).toEqual(['deploy', 'notes']);
    expect(after.skills.find((skill) => skill.name === 'deploy')?.origin).toBeDefined();
  });
});
