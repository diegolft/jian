import type { ModelConfig, ModelSelection, ProviderRecord } from '@jian/contracts';
import type { Queryable } from '../storage/database.js';
import type { ContextPolicy } from './service.js';

export interface ProviderAdmin {
  providers(profileId: string): Promise<ProviderRecord[]>;
  configureCodexProvider(profileId: string, secret: string): Promise<ProviderRecord>;
}

export interface ProviderSelection {
  selectedModel(
    profileId: string,
    selection: ModelSelection,
    reader: Queryable,
  ): Promise<{ config: ModelConfig; policy: ContextPolicy }>;
}
