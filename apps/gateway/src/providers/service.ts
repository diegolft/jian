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
import type { ProfileReader } from '../profiles/port.js';
import type { Vault } from '../security/vault.js';
import type { Queryable, Store } from '../storage/database.js';
import { modelCapabilities } from './capabilities.js';
import { environmentProvider, providerKinds } from './catalog.js';
import {
  findProvider,
  insertProvider,
  isUniqueViolation,
  listProviders,
  markProviderRevoked,
  readModelDefaults,
  revokeLiveProviders,
  writeModelDefaults,
} from './repository.js';

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

    const stored = await listProviders(this.store.db, profileId);
    // A configured provider hides the host environment's key for the same vendor.
    const environment = providerKinds
      .map((kind) => environmentProvider(profileId, kind))
      .filter((provider) => provider !== null)
      .filter((provider) => !stored.some((item) => !item.revokedAt && item.kind === provider.kind));

    return [...stored, ...environment];
  }

  async createProvider(profileId: string, input: unknown) {
    const { secret, ...data } = providerInputSchema.parse(input);

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
        createdAt: nowIso(this.clock),
      }),
      secret,
    );
  }

  /** One live provider per vendor: configuring another revokes the old one and its key. */
  private async register(profileId: string, provider: ProviderRecord, secret: string) {
    return this.store.transaction(profileId, async (tx) => {
      await this.profiles.profile(profileId, tx);

      const now = new Date(this.clock());

      for (const revoked of await revokeLiveProviders(tx, profileId, provider.kind, now)) {
        await this.vault.discard(profileId, providerSecret(revoked), tx);
      }

      await this.vault.put(profileId, providerSecret(provider.id), secret, tx);

      try {
        await insertProvider(tx, provider);
      } catch (error) {
        // The partial unique index has the last word on one live provider per vendor. Reaching
        // it means another request configured this vendor first, which the owner has to see as
        // a conflict rather than as a gateway fault.
        if (isUniqueViolation(error)) {
          throw new GatewayError(
            409,
            'Another provider for this vendor was configured; reload before retrying',
          );
        }

        throw error;
      }

      await recordEvent(tx, this.clock, profileId, 'provider.created', {
        id: provider.id,
        kind: provider.kind,
      });

      return provider;
    });
  }

  async revokeProvider(profileId: string, providerId: string) {
    return this.store.transaction(profileId, async (tx) => {
      const provider = await findProvider(tx, providerId);

      if (!provider || provider.profileId !== profileId) {
        throw new GatewayError(404, 'Provider not found');
      }

      const revoked = { ...provider, revokedAt: provider.revokedAt ?? nowIso(this.clock) };

      await markProviderRevoked(tx, providerId, new Date(revoked.revokedAt));
      await this.vault.discard(profileId, providerSecret(providerId), tx);
      await recordEvent(tx, this.clock, profileId, 'provider.revoked', { id: providerId });

      return revoked;
    });
  }

  async modelDefaults(profileId: string) {
    await this.profiles.profile(profileId);

    // Assembled from one row per role, so a role that has no row — because it was never set, or
    // because it did not exist when the others were — reads back as empty instead of missing.
    return readModelDefaults(this.store.db, profileId, nowIso(this.clock));
  }

  async setModelDefaults(profileId: string, input: unknown) {
    const data = modelDefaultsInputSchema.parse(input);

    return this.store.transaction(profileId, async (tx) => {
      await this.profiles.profile(profileId, tx);

      // Every role is validated, including the ones no runtime executes yet: a selection that
      // cannot resolve today would fail silently the day its runtime lands.
      for (const selection of Object.values(data)) {
        if (selection) {
          await this.selectedModel(profileId, selection, tx);
        }
      }

      const updatedAt = nowIso(this.clock);

      await writeModelDefaults(tx, profileId, data, new Date(updatedAt));
      await recordEvent(tx, this.clock, profileId, 'model-defaults.updated', data);

      return modelDefaultsRecordSchema.parse({ ...data, id: profileId, profileId, updatedAt });
    });
  }

  async selectedModel(
    profileId: string,
    selection: ModelSelection,
    reader: Queryable,
  ): Promise<{ config: ModelConfig; policy: ContextPolicy }> {
    const provider =
      (await findProvider(reader, selection.providerId)) ??
      providerKinds
        .map((kind) => environmentProvider(profileId, kind))
        .find((item) => item?.id === selection.providerId);

    if (!provider || provider.profileId !== profileId || provider.revokedAt) {
      throw new GatewayError(409, 'Selected provider or model is unavailable');
    }

    // Which models exist is the provider's answer and can change between two requests, so a
    // selection is never checked against a list: a provider outage would otherwise revoke a
    // model the owner already chose. Only the provider itself has to be live.
    const model = modelCapabilities(provider.kind, selection.modelId);

    if (selection.reasoningEffort && !model.reasoningEfforts.includes(selection.reasoningEffort)) {
      throw new GatewayError(
        409,
        model.known
          ? 'This model does not accept the selected reasoning effort'
          : 'Reasoning effort is not catalogued for this model',
      );
    }

    // Ceilings, not targets: a large context window must not inflate routine memory/history.
    return {
      config: {
        provider: provider.authMode === 'codex' ? ('openai-codex' as const) : provider.kind,
        modelId: selection.modelId,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
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
