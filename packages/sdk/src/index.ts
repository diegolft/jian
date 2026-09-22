import createClient from 'openapi-fetch';
import type { paths } from './generated.js';

export type { components, operations, paths } from './generated.js';

/**
 * Keep the host token in the caller's secure storage; it opens the whole installation.
 * A caller that authenticates by cookie, such as the panel, passes headers and no token.
 */
export function createJianClient(options: {
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}) {
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    fetch: options.fetch,
  });
}
