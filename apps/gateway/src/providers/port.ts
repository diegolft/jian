import type { ModelConfig, ModelSelection, ProviderRecord } from '@jian/contracts';
import type { Reader } from '../core/store.js';
import type { ContextPolicy } from './service.js';

export interface ProviderAdmin {
  providers(profileId: string): Promise<ProviderRecord[]>;
  configureCodexProvider(profileId: string, credentialId: string): Promise<ProviderRecord>;
}

export interface ProviderSelection {
  selectedModel(
    profileId: string,
    selection: ModelSelection,
    reader: Reader,
  ): Promise<{ config: ModelConfig; policy: ContextPolicy }>;
}
