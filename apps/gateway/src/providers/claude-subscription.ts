import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * A Claude subscription credential, issued by `claude setup-token`. It is not an API key: sent
 * as one it answers 401, and sent as a bare bearer it answers 429. Anthropic accepts it only
 * from something presenting itself as Claude Code, which is what the headers below do.
 */
const OAUTH_PREFIX = 'sk-ant-oat';

export const isSubscriptionToken = (secret: string | undefined): boolean =>
  typeof secret === 'string' && secret.startsWith(OAUTH_PREFIX);

/** Claude Code's own betas. Without them the request is refused however valid the token is. */
const BETAS = 'claude-code-20250219,oauth-2025-04-20';

/**
 * Anthropic refuses a subscription request whose client version is far behind the release, so
 * the installed CLI is asked once and this is only the answer for a host without it — a
 * container, most of the time. Raise it when refusals start mentioning the version.
 */
const FALLBACK_VERSION = '2.1.278';

const run = promisify(execFile);

let detected: Promise<string> | undefined;

async function claudeCodeVersion(): Promise<string> {
  detected ??= run('claude', ['--version'], { timeout: 5000 })
    .then(({ stdout }) => {
      const version = stdout.trim().split(/\s+/)[0];

      return version && /^\d/.test(version) ? version : FALLBACK_VERSION;
    })
    .catch(() => FALLBACK_VERSION);

  return detected;
}

export const subscriptionHeaders = (): Record<string, string> => ({ 'anthropic-beta': BETAS });

/**
 * The client identity has to be set on the request itself: the model SDK writes its own
 * user-agent over anything the provider was configured with, and Anthropic reads that header
 * to decide whether a subscription request came from Claude Code.
 */
export async function subscriptionFetch(
  fetcher: typeof globalThis.fetch,
): Promise<typeof globalThis.fetch> {
  const agent = `claude-cli/${await claudeCodeVersion()} (external, cli)`;

  return async (input, init) => {
    const headers = new Headers(init?.headers);

    headers.set('user-agent', agent);

    return fetcher(input, { ...init, headers });
  };
}

/**
 * Anthropic checks that the caller is Claude Code, and the system prompt is part of that check.
 * It is prepended, never substituted: the profile's own instructions follow it untouched.
 */
export const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

export function withClaudeCodeIdentity(system: string): string {
  return system.startsWith(CLAUDE_CODE_IDENTITY) ? system : `${CLAUDE_CODE_IDENTITY}\n\n${system}`;
}
