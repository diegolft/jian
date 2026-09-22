import createClient from 'openapi-fetch';
import type { paths } from './generated.js';

export type { components, operations, paths } from './generated.js';

/** Keep credentials in the caller's secure storage; each client belongs to one access key. */
export function createElosClient(options: {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}) {
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { Authorization: `Bearer ${options.token}` },
    fetch: options.fetch,
  });
}
