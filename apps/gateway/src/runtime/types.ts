import type { ModelConfig, Run } from '@elos/contracts';
import type { LanguageModel } from 'ai';
import type { createSafeFetch } from '../security/outbound.js';
import type { CodexLogin } from '../services/codex-login.js';
import type { Credentials } from '../services/credentials.js';

export type ModelResolver = (
  config: ModelConfig,
  env?: NodeJS.ProcessEnv,
  fetcher?: typeof globalThis.fetch,
  explicitKey?: string,
) => LanguageModel | Promise<LanguageModel>;

export interface RuntimeOptions {
  credentials?: Pick<Credentials, 'resolve'>;
  codexLogin?: Pick<CodexLogin, 'accessToken'>;
  outbound?: ReturnType<typeof createSafeFetch>;
  storeArtifact?: (
    run: Run,
    toolName: string,
    output: unknown,
  ) => Promise<{ artifactId: string; bytes: number }>;
}
