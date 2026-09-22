import { expect, it } from 'vitest';
import { testServices } from './helpers/services.js';

const profileInput = {
  name: 'Atlas',
  instructions: 'Help with engineering.',
  model: { provider: 'openai' as const, modelId: 'test-model', apiKeyEnv: 'JIAN_PROVIDER_TEST' },
};

async function setup() {
  const services = testServices();
  const profile = await services.profiles.createProfile(profileInput);
  const session = await services.sessions.createSession(profile.id, {
    title: 'Mac',
    channel: 'macos',
  });

  return { services, profile, session };
}

it('makes one session’s memory visible to another while isolating other profiles', async () => {
  const { services, profile, session } = await setup();

  const otherSession = await services.sessions.createSession(profile.id, {
    title: 'Telegram',
    channel: 'telegram',
  });

  const otherProfile = await services.profiles.createProfile({ ...profileInput, name: 'Private' });

  await services.memories.remember(
    profile.id,
    { key: 'deployment', content: 'Deploy release at 21:00.', expectedVersion: 0 },
    session.id,
  );

  const run = await services.runs.submit(profile.id, otherSession.id, {
    text: 'What time is deployment?',
    requestKey: 'req-1',
  });

  const context = await services.contexts.context(run);

  expect(context.system).toContain('Deploy release at 21:00.');
  expect(await services.memories.memories(otherProfile.id)).toEqual([]);

  await expect(services.sessions.messages(otherProfile.id, session.id)).rejects.toMatchObject({
    statusCode: 404,
  });
});

it('allows parallel sessions and exposes their actual activity', async () => {
  const { services, profile, session } = await setup();
  const other = await services.sessions.createSession(profile.id, {
    title: 'Other',
    channel: 'api',
  });

  const run = await services.runs.submit(profile.id, session.id, {
    text: 'Deploy version 2',
    requestKey: 'a',
  });

  await services.lifecycle.claim(run.id, profile.id, 'worker-a');

  const otherRun = await services.runs.submit(profile.id, other.id, {
    text: 'What is happening?',
    requestKey: 'b',
  });

  expect((await services.contexts.context(otherRun)).system).toContain('Deploy version 2');

  expect((await services.runs.activities(profile.id)).map((r) => r.status)).toEqual(
    expect.arrayContaining(['running', 'queued']),
  );
});
