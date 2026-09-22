import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ModelConfig } from '@elos/contracts';
import type { LanguageModel } from 'ai';
import { createSafeFetch } from '../security/outbound.js';
import { providerEnvironment } from './catalog.js';
import { createCodexModel } from './codex/model.js';

const defaultOutbound = createSafeFetch();

export function resolveModel(
  config: ModelConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof globalThis.fetch = defaultOutbound.fetch,
  explicitKey?: string,
): LanguageModel {
  const apiKey =
    explicitKey ??
    (config.apiKeyEnv ? env[config.apiKeyEnv] : undefined) ??
    (config.apiKeyEnv ||
    config.credentialId ||
    config.provider === 'openai-compatible' ||
    config.provider === 'openai-codex'
      ? undefined
      : env[providerEnvironment(config.provider, env) ?? '']);

  if (!apiKey) {
    throw new Error('Provider credential is not configured');
  }

  switch (config.provider) {
    case 'openai':
      return createOpenAI({ apiKey, baseURL: config.baseURL, fetch: fetcher })(config.modelId);
    case 'openai-codex':
      return createCodexModel(apiKey, config.modelId, fetcher);
    case 'anthropic':
      return createAnthropic({
        ...(config.credentialId ||
        (config.apiKeyEnv ?? providerEnvironment('anthropic', env)) !== 'ANTHROPIC_API_TOKEN'
          ? { apiKey }
          : { authToken: apiKey }),
        baseURL: config.baseURL,
        fetch: fetcher,
      })(config.modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL: config.baseURL, fetch: fetcher })(
        config.modelId,
      );
    case 'openai-compatible':
      if (!config.baseURL) {
        throw new Error('baseURL is required for compatible providers');
      }
      return createOpenAICompatible({
        name: 'compatible',
        apiKey,
        baseURL: config.baseURL,
        fetch: fetcher,
      }).chatModel(config.modelId);
  }
}
