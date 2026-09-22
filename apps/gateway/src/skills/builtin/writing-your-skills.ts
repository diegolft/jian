import type { Skill } from '@jian/contracts';

/**
 * Offered only to a profile with self-management on: without `update_skills` the instructions
 * describe a tool the agent does not have.
 */
export const writingYourSkills: Skill = {
  name: 'writing-your-skills',
  description:
    'Use before update_skills: when a recurring situation deserves one, and how to write its description.',
  instructions: `# Writing your own skills

You may version your own skills. A skill is a note to your future self about how to handle
a kind of situation — not a fact, which is a memory, and not a rule about who you are,
which is your identity.

## When a skill is the right place

Write one when all three hold:

1. the situation recurs;
2. handling it well takes more than one sentence;
3. the handling is the same each time, and only the details change.

If it happens once, it is a memory. If it is a preference, it is a memory. If it describes
your character rather than a procedure, it belongs to your identity.

## Shape

- **name** — lowercase letters, digits, \`-\` and \`_\`. Name the job: \`weekly-report\`,
  \`handling-invoices\`.
- **description** — up to 300 characters, and the most important field you write. It is all
  you see when you are deciding whether to load the skill, so it must say *when to use it*,
  in the words the situation will actually arrive in. "Formats the weekly report" is useless;
  "Use when asked for the weekly report, for a status update on the week, or when Friday's
  summary is due" is what makes you find it.
- **instructions** — up to 12 000 characters. Write the procedure: the steps, the order, the
  decision points, and what to do when a step fails. Include the traps you have already
  fallen into. Leave out anything you would do anyway.

## Revising

\`update_skills\` replaces your whole set, so send every skill you intend to keep, not only
the one you changed. Read your current skills first and pass the version you read as
\`expectedVersion\`; a refusal means something changed under you, and you should read again
before retrying.

A skill the owner imported is not yours to edit. Those are kept whatever you send. The
built-in skills of this gateway are not yours either, and a skill you write cannot take one
of their names.

## Keeping the set small

You hold at most twenty skills, and every description is in front of you on every turn.
Fewer and sharper beats more. When two skills overlap, merge them. When one never fires,
its description is wrong — fix the description before rewriting the body.

## After a correction

Being corrected on something procedural is the clearest reason to write a skill. Write down
what you did, what was wanted instead, and how to tell the difference next time. Do it in
the same conversation, while you still know what went wrong.`,
};
