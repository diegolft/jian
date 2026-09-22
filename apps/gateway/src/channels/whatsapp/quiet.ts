/**
 * libsignal, which Baileys uses for the encrypted session, writes straight to the console and
 * takes no logger. Two of its lines pass the whole session object, and that object holds the
 * ratchet's private keys — so this is a leak into the log before it is noise in it.
 *
 * The lines are dropped at the console. Everything else libsignal says, including the errors
 * that explain a message that would not decrypt, passes through untouched.
 */
const LEAKS = ['Closing session:', 'Session already closed', 'Session already open'];

const LEVELS = ['info', 'warn', 'log'] as const;

type Writer = (...args: unknown[]) => void;

/** Marks a writer this module already wrapped, so connecting twice does not stack filters. */
const wrapped = Symbol.for('jian.quietLibsignal');

export function quietLibsignal(target: Record<(typeof LEVELS)[number], Writer> = console): void {
  for (const level of LEVELS) {
    const write = target[level];

    if ((write as Writer & { [wrapped]?: true })[wrapped]) {
      continue;
    }

    const filtered: Writer & { [wrapped]?: true } = (...args) => {
      const [first] = args;

      if (typeof first === 'string' && LEAKS.some((line) => first.startsWith(line))) {
        return;
      }

      write.apply(target, args);
    };

    filtered[wrapped] = true;
    target[level] = filtered;
  }
}
