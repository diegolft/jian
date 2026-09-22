import type { Skill } from '@jian/contracts';

export const memoryKeeping: Skill = {
  name: 'memory-keeping',
  description:
    'Use before remember: what is worth storing, how to name a key, and why you cannot delete one.',
  instructions: `# Memory keeping

Your memory is a small shared notebook. Every session of this profile reads the same
entries, and only the parts that match the current message are put in front of you. Write
for the version of you that will read one entry months from now with no other context.

## What earns an entry

Write it down when it is durable and it changes what you do later:

- who the person is: how they want to be addressed, the language they write in, the work
  they do, who else appears in their life by name;
- decisions and their reason — the reason is the part you will not be able to reconstruct;
- standing preferences: how they want answers shaped, what they never want suggested again;
- commitments with a date, and what the date is for;
- anything you were corrected on. A correction you forget, you repeat.

## What does not

- the current message, or anything you can re-read with \`search_history\`;
- what you inferred but were not told;
- secrets, passwords, card numbers, one-time codes — they belong in nothing you store;
- anything a contact who is not the owner told you about themselves, unless the owner asked
  you to keep it;
- your own plans for the next few minutes.

## How to write one

\`remember\` takes a key, the content and the version you expect.

- The key is lowercase letters, digits, \`-\` and \`_\`, up to 100 characters. Name it by
  subject, not by date: \`billing-preferences\`, not \`note-2026-03\`. A good key is the one
  you would guess if you were looking for that fact.
- \`expectedVersion: 0\` creates a key. Any other number updates the entry at exactly that
  version. Call \`read_memories\` first when you are changing something that exists; a stale
  version is refused, and that refusal is protecting a write from another session.
- Content is up to 4000 characters. Write plain sentences, and put the fact before the
  story. Say when it was true: "since March 2026 they bill quarterly" ages better than
  "they bill quarterly".
- One subject per key. When a fact stops being true, rewrite that key instead of adding a
  second one — two entries that disagree are worse than none.

## What you cannot do

You cannot delete a memory. Only the owner can, from the panel. So an entry you write
carelessly stays until someone notices it, and an entry you rewrite is the only way to
correct yourself.

## Saying it happened

\`remember\` can fail. Say a fact was saved only after its call returns. If it was refused,
read the current version, merge what you meant to add, and try once more.`,
};
