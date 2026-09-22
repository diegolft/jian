import { createHash } from 'node:crypto';
import type { ProviderRecord } from '@elos/contracts';

export const providerCatalog = {
  anthropic: {
    name: 'Anthropic',
    env: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_TOKEN'],
    models: [{ id: 'claude-sonnet-5', contextWindow: 1_000_000, maxOutputTokens: 128_000 }],
  },
  google: {
    name: 'Gemini',
    env: ['GEMINI_API_TOKEN'],
    models: [{ id: 'gemini-3.8-flash', contextWindow: 1_000_000, maxOutputTokens: 65_536 }],
  },
  openai: {
    name: 'OpenAI',
    env: ['OPENAI_API_KEY'],
    models: [{ id: 'gpt-5.6-terra', contextWindow: 1_000_000, maxOutputTokens: 128_000 }],
  },
} as const;

export type ProviderKind = keyof typeof providerCatalog;

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
  const provider = providerCatalog[kind];

  return {
    id,
    profileId,
    name: provider.name,
    kind,
    apiKeyEnv,
    models: [...provider.models],
    createdAt: new Date(0).toISOString(),
  };
}
