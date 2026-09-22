import type { ModelConfig, Run } from '@jian/contracts';
import type { LanguageModel } from 'ai';
import type { CodexLogin } from '../providers/codex/login.js';
import type { Credentials } from '../security/credentials.js';
import type { createSafeFetch } from '../security/outbound.js';

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
