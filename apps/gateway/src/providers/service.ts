import { randomUUID } from 'node:crypto';
import {
  type ModelConfig,
  type ModelSelection,
  modelDefaultsInputSchema,
  modelDefaultsRecordSchema,
  type ProviderRecord,
  providerInputSchema,
  providerRecordSchema,
  type Run,
} from '@jian/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Reader, Store } from '../core/store.js';
import type { ProfileReader } from '../profiles/port.js';
import type { Vault } from '../security/vault.js';
import { environmentProvider, type ProviderKind, providerCatalog } from './catalog.js';

/** Where a provider's key lives in the vault. Revoking the provider takes the key with it. */
export const providerSecret = (providerId: string) => `provider:${providerId}`;

/** The ceilings a run freezes; the run record keeps them optional for pre-selection runs. */
export type ContextPolicy = NonNullable<Run['contextPolicy']>;

export class Providers {
  constructor(
    private readonly store: Store,
    private readonly profiles: ProfileReader,
    private readonly vault: Vault,
    private readonly clock: Clock = Date.now,
  ) {}

  async providers(profileId: string) {
    await this.profiles.profile(profileId);

    const stored = (await this.store.list('provider', { profileId, limit: 100 })).map((item) =>
      providerRecordSchema.parse(item),
    );
    // A configured provider hides the host environment's key for the same vendor.
    const environment = (Object.keys(providerCatalog) as ProviderKind[])
      .map((kind) => environmentProvider(profileId, kind))
      .filter((provider) => provider !== null)
      .filter((provider) => !stored.some((item) => !item.revokedAt && item.kind === provider.kind));

    return [...stored, ...environment];
  }

  async createProvider(profileId: string, input: unknown) {
    const { secret, ...data } = providerInputSchema.parse(input);

    if (new Set(data.models.map((model) => model.id)).size !== data.models.length) {
      throw new GatewayError(400, 'Model IDs must be unique within a provider');
    }

    return this.register(
      profileId,
      { ...data, id: randomUUID(), profileId, createdAt: nowIso(this.clock) },
      secret,
    );
  }

  configureCodexProvider(profileId: string, secret: string) {
    return this.register(
      profileId,
      providerRecordSchema.parse({
        id: randomUUID(),
        profileId,
        name: 'OpenAI',
        kind: 'openai',
        authMode: 'codex',
        models: [{ id: 'gpt-5.6-terra', contextWindow: 1_000_000, maxOutputTokens: 128_000 }],
        createdAt: nowIso(this.clock),
      }),
      secret,
    );
  }

  /** One live provider per vendor: configuring another revokes the old one and its key. */
  private async register(profileId: string, provider: ProviderRecord, secret: string) {
    return this.store.transaction(profileId, async (tx) => {
      await this.profiles.profile(profileId, tx);

      for (const item of await tx.list('provider', { profileId, limit: 100 })) {
        if (item.kind === provider.kind && !item.revokedAt) {
          await tx.put('provider', item.id, profileId, { ...item, revokedAt: nowIso(this.clock) });
          await this.vault.discard(profileId, providerSecret(item.id), tx);
        }
      }

      await this.vault.put(profileId, providerSecret(provider.id), secret, tx);
      await tx.put('provider', provider.id, profileId, provider);

      await recordEvent(tx, this.clock, profileId, 'provider.created', {
        id: provider.id,
        kind: provider.kind,
      });

      return provider;
    });
  }

  async revokeProvider(profileId: string, providerId: string) {
    return this.store.transaction(profileId, async (tx) => {
      const provider = await tx.get('provider', providerId);

      if (!provider || provider.profileId !== profileId) {
        throw new GatewayError(404, 'Provider not found');
      }

      const revoked = { ...provider, revokedAt: provider.revokedAt ?? nowIso(this.clock) };

      await tx.put('provider', providerId, profileId, revoked);
      await this.vault.discard(profileId, providerSecret(providerId), tx);
      await recordEvent(tx, this.clock, profileId, 'provider.revoked', { id: providerId });

      return revoked;
    });
  }

  async modelDefaults(profileId: string) {
    await this.profiles.profile(profileId);
    const defaults = await this.store.get('modelDefault', profileId);

    return (
      defaults ?? {
        id: profileId,
        profileId,
        conversation: null,
        channel: null,
        updatedAt: nowIso(this.clock),
      }
    );
  }

  async setModelDefaults(profileId: string, input: unknown) {
    const data = modelDefaultsInputSchema.parse(input);

    return this.store.transaction(profileId, async (tx) => {
      await this.profiles.profile(profileId, tx);

      for (const selection of [data.conversation, data.channel]) {
        if (selection) {
          await this.selectedModel(profileId, selection, tx);
        }
      }

      const defaults = modelDefaultsRecordSchema.parse({
        ...data,
        id: profileId,
        profileId,
        updatedAt: nowIso(this.clock),
      });

      await tx.put('modelDefault', profileId, profileId, defaults);
      await recordEvent(tx, this.clock, profileId, 'model-defaults.updated', data);

      return defaults;
    });
  }

  async selectedModel(
    profileId: string,
    selection: ModelSelection,
    reader: Reader,
  ): Promise<{ config: ModelConfig; policy: ContextPolicy }> {
    const provider =
      (await reader.get('provider', selection.providerId)) ??
      (Object.keys(providerCatalog) as ProviderKind[])
        .map((kind) => environmentProvider(profileId, kind))
        .find((item) => item?.id === selection.providerId);
    const model = provider?.models.find((item) => item.id === selection.modelId);

    if (!provider || provider.profileId !== profileId || provider.revokedAt || !model) {
      throw new GatewayError(409, 'Selected provider or model is unavailable');
    }

    // Ceilings, not targets: a large context window must not inflate routine memory/history.
    return {
      config: {
        provider: provider.authMode === 'codex' ? ('openai-codex' as const) : provider.kind,
        modelId: model.id,
        ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : { providerId: provider.id }),
      },
      policy: {
        inputTokens: Math.min(32_000, Math.max(4096, Math.floor(model.contextWindow * 0.45))),
        outputTokens: Math.min(4096, model.maxOutputTokens, Math.floor(model.contextWindow * 0.12)),
        memoryTokens: Math.min(1500, Math.floor(model.contextWindow * 0.04)),
        historyTokens: Math.min(6000, Math.floor(model.contextWindow * 0.12)),
        toolResultTokens: Math.min(1500, Math.max(128, Math.floor(model.contextWindow * 0.04))),
        maxSteps: 12,
        maxRunTokens: 100_000,
      },
    };
  }
}
