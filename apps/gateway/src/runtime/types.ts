import type { LanguageModel } from 'ai';
import type { ModelConfig, Run } from '../domain.js';
import type { createSafeFetch } from '../security/outbound.js';
import type { Credentials } from '../services/credentials.js';

export type ModelResolver = (
  config: ModelConfig,
  env?: NodeJS.ProcessEnv,
  fetcher?: typeof globalThis.fetch,
  explicitKey?: string,
) => LanguageModel | Promise<LanguageModel>;

export interface RuntimeOptions {
  credentials?: Pick<Credentials, 'resolve'>;
  outbound?: ReturnType<typeof createSafeFetch>;
  storeArtifact?: (
    run: Run,
    toolName: string,
    output: unknown,
  ) => Promise<{ artifactId: string; bytes: number }>;
}
