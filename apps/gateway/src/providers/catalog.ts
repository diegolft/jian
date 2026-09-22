import { createHash } from 'node:crypto';
import type { ProviderRecord } from '@jian/contracts';

/**
 * Names and environment variables only. The models an account can use are asked of the
 * provider (see `discovery.ts`); a list written here would be a guess presented as fact.
 */
export const providerCatalog = {
  anthropic: {
    name: 'Anthropic',
    env: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_TOKEN'],
  },
  google: {
    name: 'Gemini',
    env: ['GEMINI_API_TOKEN'],
  },
  openai: {
    name: 'OpenAI',
    env: ['OPENAI_API_KEY'],
  },
} as const;

export type ProviderKind = keyof typeof providerCatalog;

export const providerKinds = Object.keys(providerCatalog) as ProviderKind[];

export function providerEnvironment(kind: ProviderKind, env: NodeJS.ProcessEnv = process.env) {
  return providerCatalog[kind].env.find((name) => !!env[name]?.trim());
}

export function environmentProvider(
  profileId: string,
  kind: ProviderKind,
  env: NodeJS.ProcessEnv = process.env,
): ProviderRecord | null {
  const apiKeyEnv = providerEnvironment(kind, env);
  if (!apiKeyEnv) return null;

  const hash = createHash('sha256').update(`${profileId}:${kind}`).digest('hex');
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;

  return {
    id,
    profileId,
    name: providerCatalog[kind].name,
    kind,
    apiKeyEnv,
    createdAt: new Date(0).toISOString(),
  };
}
