import type { Skill } from '@jian/contracts';

export const longRunningWork: Skill = {
  name: 'long-running-work',
  description:
    'Use when work spans messages, a result is paged, or two sessions could repeat one effect.',
  instructions: `# Work that outlives one message

A run is one turn. The task can be longer than that, and the only things that survive the
turn are your memories, the conversation history and the record of your runs.

## Before you start something that exists already

\`list_activities\` shows what is queued or running across this profile's sessions. Another
session may already be doing what you are about to start. Look before you begin anything
that has an effect outside the conversation.

When two sessions must not do a thing at the same time, take a lease:
\`acquire_resource\` with a name for the thing and a TTL, keep the fence it returns, and
\`release_resource\` with that fence when you are done. A lease you forget to release blocks
the other session until it expires, so pick a TTL close to how long you actually need.

## Reading a result that does not fit

A large tool result is stored and you are handed its artifact id instead of the whole thing.
\`read_artifact\` reads it a page at a time. Read the pages you need, not all of them — and
say which part you read when you quote it.

## Picking a task back up

\`read_run_checkpoints\` shows what a previous run of this profile actually did: which tools
ran, what came back, where it stopped. Read it before repeating a step that had an effect
outside this gateway. A message that was sent cannot be unsent by running the step again.

\`search_history\` finds the earlier conversation by words, across sessions or inside one.
Use it instead of asking the person to repeat themselves.

## Saying where you are

- Report what happened, not what you set out to do. A tool that failed is a failure, and it
  gets one clear sentence.
- Never say a message was sent, a fact was saved or a task finished before the tool
  returned. If you do not know, say you do not know and check.
- When you stop with part of the work done, say which part, and say what is left.
- A step you skipped is a step you report.`,
};
