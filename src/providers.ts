import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { ModelConfig } from './domain.js';

export function resolveModel(
  config: ModelConfig,
  env: NodeJS.ProcessEnv = process.env,
): LanguageModel {
  const apiKey = env[config.apiKeyEnv];
  if (!apiKey) throw new Error(`Provider credential is not configured: ${config.apiKeyEnv}`);
  switch (config.provider) {
    case 'openai':
      return createOpenAI({ apiKey, baseURL: config.baseURL })(config.modelId);
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL: config.baseURL })(config.modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL: config.baseURL })(config.modelId);
    case 'openai-compatible':
      if (!config.baseURL) throw new Error('baseURL is required for compatible providers');
      return createOpenAICompatible({
        name: 'compatible',
        apiKey,
        baseURL: config.baseURL,
      }).chatModel(config.modelId);
  }
}
